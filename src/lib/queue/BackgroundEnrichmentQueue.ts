import { leadPilotDb } from '@/db';
import { LeadEntity } from '@/models/Lead';
import { semaphores } from '../config/concurrencyConfig';
import { contactExtractionActor } from '@/actors/ContactExtractionActor';
import { websiteCrawlerActor } from '@/actors/WebsiteCrawlerActor';
import { websiteAuditActor } from '@/actors/WebsiteAuditActor';
import { leadScoringActor } from '@/actors/LeadScoringActor';
import { websiteDiscoveryActor } from '@/actors/WebsiteDiscoveryActor';
import { websiteReachabilityActor } from '@/actors/WebsiteReachabilityActor';
import { commercialEnrichmentActor } from '@/actors/CommercialEnrichmentActor';

export type BackgroundJobType =
  | 'CONTACT_ENRICHMENT'
  | 'EMAIL_EXTRACTION'
  | 'WEBSITE_DISCOVERY'
  | 'WEBSITE_REACHABILITY'
  | 'WEBSITE_CRAWL'
  | 'WEBSITE_AUDIT'
  | 'LEAD_SCORING'
  | 'COMMERCIAL_INTELLIGENCE';

export type BackgroundJobStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'RETRYING'
  | 'CANCELLED';

export interface BackgroundEnrichmentJob {
  id: string;
  leadId: string;
  searchId: string;
  type: BackgroundJobType;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  status: BackgroundJobStatus;
  attempts: number;
  provider?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  durationMs?: number;
  payload?: any;
}

export class BackgroundEnrichmentQueue {
  private static instance: BackgroundEnrichmentQueue;

  private jobs = new Map<string, BackgroundEnrichmentJob>();
  private searchJobsMap = new Map<string, string[]>(); // searchId -> jobIds
  private isProcessing = false;
  private queue: string[] = []; // jobIds in order

  private constructor() {}

  public static getInstance(): BackgroundEnrichmentQueue {
    if (!BackgroundEnrichmentQueue.instance) {
      BackgroundEnrichmentQueue.instance = new BackgroundEnrichmentQueue();
    }
    return BackgroundEnrichmentQueue.instance;
  }

  /**
   * Enqueues a new background job.
   */
  public enqueue(jobData: {
    leadId: string;
    searchId: string;
    type: BackgroundJobType;
    priority?: 'HIGH' | 'MEDIUM' | 'LOW';
    payload?: any;
    provider?: string;
  }): BackgroundEnrichmentJob {
    const jobId = `bg_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const job: BackgroundEnrichmentJob = {
      id: jobId,
      leadId: jobData.leadId,
      searchId: jobData.searchId,
      type: jobData.type,
      priority: jobData.priority || 'MEDIUM',
      status: 'QUEUED',
      attempts: 0,
      provider: jobData.provider,
      createdAt: new Date().toISOString(),
      payload: jobData.payload,
    };

    this.jobs.set(jobId, job);
    if (!this.searchJobsMap.has(jobData.searchId)) {
      this.searchJobsMap.set(jobData.searchId, []);
    }
    this.searchJobsMap.get(jobData.searchId)!.push(jobId);

    // High priority goes to front of queue
    if (job.priority === 'HIGH') {
      this.queue.unshift(jobId);
    } else {
      this.queue.push(jobId);
    }

    // Trigger queue processing asynchronously
    this.processNext();

    return job;
  }

  public getJobsForSearch(searchId: string): BackgroundEnrichmentJob[] {
    const ids = this.searchJobsMap.get(searchId) || [];
    return ids.map((id) => this.jobs.get(id)!).filter(Boolean);
  }

  public getQueueStats(searchId?: string) {
    let jobList = Array.from(this.jobs.values());
    if (searchId) {
      jobList = jobList.filter((j) => j.searchId === searchId);
    }

    return {
      total: jobList.length,
      queued: jobList.filter((j) => j.status === 'QUEUED').length,
      running: jobList.filter((j) => j.status === 'RUNNING').length,
      completed: jobList.filter((j) => j.status === 'COMPLETED').length,
      failed: jobList.filter((j) => j.status === 'FAILED').length,
    };
  }

  private async processNext(): Promise<void> {
    if (this.queue.length === 0) return;

    const jobId = this.queue.shift();
    if (!jobId) return;

    const job = this.jobs.get(jobId);
    if (!job || job.status === 'CANCELLED') {
      return this.processNext();
    }

    job.status = 'RUNNING';
    job.startedAt = new Date().toISOString();
    job.attempts++;

    // Process job with concurrency control according to job type
    (async () => {
      const startTime = Date.now();
      try {
        await this.executeJob(job);
        job.status = 'COMPLETED';
        job.completedAt = new Date().toISOString();
        job.durationMs = Date.now() - startTime;
      } catch (err: any) {
        job.error = err.message || 'Background execution failed';
        if (job.attempts < 2) {
          job.status = 'RETRYING';
          this.queue.push(job.id);
        } else {
          job.status = 'FAILED';
          job.completedAt = new Date().toISOString();
          job.durationMs = Date.now() - startTime;
        }
      } finally {
        this.processNext();
      }
    })();
  }

  private async executeJob(job: BackgroundEnrichmentJob): Promise<void> {
    const lead = leadPilotDb.getLead(job.leadId);
    if (!lead) return;

    switch (job.type) {
      case 'WEBSITE_DISCOVERY': {
        const release = await semaphores.webSearch.acquire();
        try {
          if (!lead.website) {
            const discRes = await websiteDiscoveryActor.execute({
              jobId: job.searchId,
              input: [
                {
                  id: lead.leadId,
                  businessName: lead.businessName,
                  category: lead.category,
                  city: lead.city,
                  state: lead.state,
                  source: lead.sources?.[0] || 'google_places',
                  sourceId: lead.googlePlaceId || lead.osmId || lead.leadId,
                  phone: lead.phone,
                  email: lead.email,
                  address: lead.address,
                  rawTags: {},
                } as any,
              ],
            });
            const discoveredUrl = discRes.data[0]?.websiteUrl;
            if (discoveredUrl) {
              lead.website = discoveredUrl;
              lead.websiteStatus = 'Live';
              leadPilotDb.upsertLead(lead);
            }
          }
        } finally {
          release();
        }
        break;
      }

      case 'WEBSITE_REACHABILITY': {
        const release = await semaphores.websiteFetch.acquire();
        try {
          if (lead.website) {
            const reachRes = await websiteReachabilityActor.execute({
              jobId: job.searchId,
              input: [
                {
                  id: lead.leadId,
                  businessName: lead.businessName,
                  category: lead.category,
                  websiteUrl: lead.website,
                  city: lead.city,
                  state: lead.state,
                  source: lead.sources?.[0] || 'google_places',
                  sourceId: lead.googlePlaceId || lead.osmId || lead.leadId,
                  rawTags: {},
                } as any,
              ],
            });
            const reach = reachRes.data[0]?.reachability;
            if (reach) {
              if (reach.status === 'LIVE' || reach.status === 'REDIRECTED') {
                lead.websiteStatus = 'Live';
              } else if (reach.status === 'UNREACHABLE' || reach.status === 'DNS_ERROR') {
                lead.websiteStatus = 'Unreachable';
              }
              leadPilotDb.upsertLead(lead);
            }
          }
        } finally {
          release();
        }
        break;
      }

      case 'EMAIL_EXTRACTION':
      case 'CONTACT_ENRICHMENT': {
        const release = await semaphores.crawler.acquire();
        try {
          // If website exists and email is missing, perform official website crawl & extraction
          if (lead.website && !lead.email) {
            const crawlRes = await websiteCrawlerActor.execute({
              jobId: job.searchId,
              input: [
                {
                  id: lead.leadId,
                  businessName: lead.businessName,
                  category: lead.category,
                  websiteUrl: lead.website,
                  city: lead.city,
                  state: lead.state,
                  source: lead.sources?.[0] || 'google_places',
                  sourceId: lead.googlePlaceId || lead.osmId || lead.leadId,
                  reachability: { status: 'LIVE', isOnline: true },
                  rawTags: {},
                } as any,
              ],
            });

            const contactRes = await contactExtractionActor.execute({
              jobId: job.searchId,
              input: crawlRes.data,
            });

            const enriched = contactRes.data[0];
            if (enriched) {
              if (enriched.email && !lead.email) {
                lead.email = enriched.email;
                lead.contacts = [
                  ...(lead.contacts || []),
                  {
                    value: enriched.email,
                    type: 'email',
                    source: 'official_website',
                    sourceType: 'website',
                    confidence: 'verified',
                    verified: true,
                  },
                ];
              }
              if (enriched.phone && !lead.phone) {
                lead.phone = enriched.phone;
              }
              lead.enrichmentStatus = 'ENRICHED';
              leadPilotDb.upsertLead(lead);
            }
          }
        } finally {
          release();
        }
        break;
      }

      case 'WEBSITE_AUDIT': {
        const release = await semaphores.pagespeed.acquire();
        try {
          if (lead.website) {
            const auditRes = await websiteAuditActor.execute({
              jobId: job.searchId,
              input: [
                {
                  id: lead.leadId,
                  businessName: lead.businessName,
                  category: lead.category,
                  websiteUrl: lead.website,
                  city: lead.city,
                  state: lead.state,
                  source: lead.sources?.[0] || 'google_places',
                  sourceId: lead.googlePlaceId || lead.osmId || lead.leadId,
                  contacts: lead.contacts || [],
                  crawlResult: {
                    baseUrl: lead.website,
                    finalUrl: lead.website,
                    pages: [{ url: lead.website, title: lead.businessName, html: '', status: 200 }],
                    extractedEmails: [],
                    extractedPhones: [],
                    extractedAddresses: [],
                    socialLinks: {},
                  },
                  rawTags: {},
                } as any,
              ],
            });

            const audited = auditRes.data[0];
            if (audited?.auditResult) {
              lead.websiteAudit = {
                overallScore: audited.auditResult.overallScore || 70,
                issues: audited.auditResult.issues || [],
                pagesCrawled: 1,
              };
              lead.auditStatus = 'AUDITED';
              leadPilotDb.upsertLead(lead);
            }
          }
        } finally {
          release();
        }
        break;
      }

      case 'LEAD_SCORING': {
        try {
          const scoreRes = await leadScoringActor.execute({
            jobId: job.searchId,
            input: [
              {
                id: lead.leadId,
                businessName: lead.businessName,
                category: lead.category,
                websiteUrl: lead.website,
                city: lead.city,
                state: lead.state,
                source: lead.sources?.[0] || 'google_places',
                sourceId: lead.googlePlaceId || lead.osmId || lead.leadId,
                contacts: lead.contacts || [],
                auditResult: lead.websiteAudit,
                rawTags: {},
              } as any,
            ],
          });
          const scored = scoreRes.data[0];
          if (scored) {
            lead.leadScore = (scored as any).leadScore || lead.leadScore;
            leadPilotDb.upsertLead(lead);
          }
        } catch (scoreErr) {
          console.warn('[LeadScoring] Background scoring failed:', scoreErr);
        }
        break;
      }
      
      case 'COMMERCIAL_INTELLIGENCE': {
        const release = await semaphores.webSearch.acquire();
        try {
          const enrichRes = await commercialEnrichmentActor.execute({
            jobId: job.searchId,
            input: [
              {
                leadId: lead.leadId,
                businessName: lead.businessName,
                category: lead.category,
                city: lead.city,
                state: lead.state,
                websiteUrl: lead.website
              }
            ]
          });
          const enriched = enrichRes.data[0];
          if (enriched && enriched.milestones && enriched.milestones.length > 0) {
            lead.commercialMilestones = lead.commercialMilestones || [];
            lead.commercialMilestones!.push(...enriched.milestones);
            leadPilotDb.upsertLead(lead);
          }
        } finally {
          release();
        }
        break;
      }
    }
  }
}

export const backgroundEnrichmentQueue = BackgroundEnrichmentQueue.getInstance();
