import { SearchRequestPayload } from '@/types';
import { Job, ProgressStep, RejectionBreakdown, PipelineBreakdown } from '@/models/Job';
import { LeadEntity, ContactItem, leadEntityToFrontend } from '@/models/Lead';
import { leadPilotDb } from '@/db';
import { leadsDb } from '@/lib/leadsDb';
import { logger } from '@/utils/logger';
import { validateLocation } from '@/data/geographyData';
import { resolveIndiaLocation } from '@/lib/geoResolver';
import { searchPlanner } from '@/lib/search/SearchPlanner';
import { performanceTracker, SearchTimestamps } from '@/lib/metrics/PerformanceTracker';
import { backgroundEnrichmentQueue } from '@/lib/queue/BackgroundEnrichmentQueue';
import { smartRotationService } from '@/lib/workflow/SmartRotationService';
import { leadHistoryService } from '@/lib/workflow/LeadHistoryService';
import {
  normalizeWebsiteFilter,
  checkBatchReachability,
  classifyCandidateWebsite,
  assertHardGuarantee,
} from '@/lib/audit/WebsiteStatusClassifier';
import { extractBatchEmailsForCandidates } from '@/utils/emailUtils';
import { normalizePhone } from '@/utils/phoneUtils';
import { calculateLeadScore } from '@/lib/scoring/leadScoreCalculator';

import { contactEnrichmentPipeline, ContactEnrichmentOutput } from '@/lib/providers/contactEnrichmentPipeline';
import { normalizeContactFilter, evaluateContactFilter, assessContactQuality, CanonicalContact } from '@/lib/providers/contactTypes';

// Blocking Fast Path Actors
import { businessDiscoveryActor } from '@/actors/BusinessDiscoveryActor';
import { multiSourceMergeActor } from '@/actors/MultiSourceMergeActor';
import { locationVerificationActor } from '@/actors/LocationVerificationActor';
import { businessVerificationActor } from '@/actors/BusinessVerificationActor';
import { deduplicationActor } from '@/actors/DeduplicationActor';

export type PipelineStageState = 'PASSED' | 'FAILED' | 'SKIPPED' | 'UNKNOWN';

export interface CanonicalPipelineRecord {
  id: string;
  source: string;
  sources: string[];
  sourceId?: string;
  businessName: string;
  category?: string;
  industry?: string;
  address?: string;
  city?: string;
  state?: string;
  phone?: string;
  email?: string;
  website?: string;
  latitude?: number;
  longitude?: number;
  stages: {
    discovery: 'PASSED';
    location: PipelineStageState;
    normalization: PipelineStageState;
    deduplication: PipelineStageState;
    contact: PipelineStageState;
    website: PipelineStageState;
    qualification: PipelineStageState;
  };
  primaryRejectionReason?: string;
  rejectionDetails?: string;
  websiteStatus?: 'Working' | 'Unreachable' | 'No Website' | 'Needs Improvement';
}

export class LeadPilotOrchestrator {
  /**
   * Creates a new Job record in PENDING status.
   */
  public createJob(criteria: SearchRequestPayload): Job {
    const jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const now = new Date().toISOString();

    const initialRejections: RejectionBreakdown = {
      OUTSIDE_LOCATION: 0,
      INVALID_CATEGORY: 0,
      MISSING_NAME: 0,
      DUPLICATE: 0,
      NO_CONTACT: 0,
      HAS_WEBSITE: 0,
      NO_WEBSITE: 0,
      WEBSITE_UNREACHABLE: 0,
      AUDIT_FAILED: 0,
      NOT_QUALIFIED: 0,
      OTHER: 0,
      WEBSITE_FILTER_MISMATCH: 0,
      CONTACT_FILTER_MISMATCH: 0,
      NOT_PROCESSED_BEFORE_DEADLINE: 0,
      TRANSIENT_FAILURE: 0,
      FILTER_MISMATCH: 0,
    };

    const job: Job = {
      id: jobId,
      searchId: jobId,
      status: 'PENDING',
      criteria,
      requestedLeads: Math.max(Number(criteria.limit) || 25, 5),
      discovered: 0,
      verified: 0,
      deduplicated: 0,
      enriched: 0,
      audited: 0,
      qualified: 0,
      completed: 0,
      failed: 0,
      sourceStatus: 'COMPLETE',
      sourceComplete: true,
      rejectionReasons: initialRejections,
      progressLog: [
        {
          actorId: 'orchestrator',
          stepName: 'Job Initialized',
          message: `Job ${jobId} initialized for ${criteria.industry} in ${criteria.city || criteria.state}`,
          status: 'pending',
          timestamp: now,
        },
      ],
      leads: [],
      startedAt: now,
    };

    return leadPilotDb.createJob(job);
  }

  /**
   * Records a progress update in the job log.
   */
  private logProgress(job: Job, actorId: string, stepName: string, message: string, count?: number) {
    const step: ProgressStep = {
      actorId,
      stepName,
      message,
      count,
      status: 'in_progress',
      timestamp: new Date().toISOString(),
    };
    job.progressLog.push(step);
    leadPilotDb.updateJob(job.id, { progressLog: [...job.progressLog] });
    logger.info({ jobId: job.id, actorId, message, extra: { count } });
  }

  /**
   * Helper to execute a fast blocking actor with full tracking in the ActorRuns table.
   */
  private async executeTrackedActor<TInput, TOutput>(
    actor: {
      readonly actorId: string;
      readonly name: string;
      execute: (context: any) => Promise<{ status: any; data: TOutput; metrics?: any; errors?: any; warnings?: any }>;
    },
    job: Job,
    input: TInput,
    stepName: string
  ): Promise<TOutput> {
    const runId = `run_${actor.actorId}_${Date.now()}`;
    const startTime = new Date().toISOString();

    leadPilotDb.createActorRun({
      id: runId,
      jobId: job.id,
      actorId: actor.actorId,
      status: 'RUNNING',
      startedAt: startTime,
      attempts: 1,
      metrics: {},
      errors: [],
      warnings: [],
    });

    const result = await actor.execute({
      jobId: job.id,
      input,
      onProgress: (msg: string, count?: number) => this.logProgress(job, actor.actorId, stepName, msg, count),
    });

    leadPilotDb.updateActorRun(runId, {
      status: result.status,
      completedAt: new Date().toISOString(),
      metrics: result.metrics,
      errors: result.errors,
      warnings: result.warnings,
    });

    if (result.status === 'FAILED') {
      throw new Error(`Actor ${actor.name} failed: ${result.errors.join('; ')}`);
    }

    return result.data;
  }

  /**
   * Main Pipeline Execution: FAST PATH + ASYNC BACKGROUND ENRICHMENT
   * Bounded by global search deadline (default LEAD_SEARCH_DEADLINE_MS = 8000ms, Section 13).
   */
  public async executeJob(jobId: string): Promise<Job> {
    const deadlineMs = Number(process.env.LEAD_SEARCH_DEADLINE_MS) || 45000;
    let timeoutHandle: NodeJS.Timeout | undefined;


    const deadlinePromise = new Promise<{ deadlineReached: true }>((resolve) => {
      timeoutHandle = setTimeout(() => resolve({ deadlineReached: true }), deadlineMs);
    });

    try {
      const result = await Promise.race([
        this.runPipeline(jobId, deadlineMs),
        deadlinePromise,
      ]);

      if (timeoutHandle) clearTimeout(timeoutHandle);

      if ('deadlineReached' in result) {
        // Global search deadline reached: Return whatever verified results are ready (Section 13)
        const job = leadPilotDb.getJob(jobId);
        if (job) {
          job.sourceStatus = 'PARTIAL';
          job.statusReason = 'SEARCH_DEADLINE_REACHED';
          job.status = (job.leads && job.leads.length > 0) ? 'DISCOVERY_COMPLETE' : 'COMPLETED';
          job.completedAt = new Date().toISOString();

          // Ensure pipeline breakdown is truthful and strictly non-negative
          if (!job.pipelineBreakdown) {
            const locVer = job.locationVerifiedCount || 0;
            const outLoc = job.rejectionReasons?.OUTSIDE_LOCATION || 0;
            const unkLoc = job.rejectionReasons?.UNKNOWN_LOCATION || 0;
            const unproc = job.rejectionReasons?.NOT_PROCESSED_BEFORE_DEADLINE || Math.max(0, (job.deduplicated || 0) - (job.leads || []).length);
            job.pipelineBreakdown = {
              rawDiscoveredCount: job.discovered || 0,
              normalizedCount: job.normalizedCount || job.discovered || 0,
              locationCheckedCount: locVer + outLoc + unkLoc,
              locationVerifiedCount: locVer,
              inCityBoundsCount: locVer,
              outsideLocationCount: outLoc,
              unknownLocationCount: unkLoc,
              deduplicatedCount: job.deduplicated || 0,
              queuedCount: job.deduplicated || 0,
              processedCount: Math.max(0, (job.deduplicated || 0) - unproc),
              notProcessedCount: unproc,
              notProcessedBeforeDeadlineCount: unproc,
              phoneCount: job.phoneCount || 0,
              emailCount: job.emailCount || 0,
              phoneOrEmailCount: job.phoneOrEmailCount || 0,
              websiteAvailableCount: job.websiteVerifiedCount || 0,
              websiteUnavailableCount: job.noWebsiteCount || 0,
              verifiedNoWebsiteCount: job.noWebsiteCount || 0,
              websiteUnreachableCount: 0,
              finalQualifiedCount: (job.leads || []).length,
              deliveredCount: (job.leads || []).length,
            };
          }

          leadPilotDb.updateJob(job.id, job);
          return job;
        }
      }

      return result as Job;
    } catch (err: any) {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      const job = leadPilotDb.getJob(jobId);
      if (job) {
        job.status = 'FAILED';
        job.sourceStatus = 'FAILED';
        job.error = err.message || 'Pipeline execution failed';
        job.completedAt = new Date().toISOString();
        leadPilotDb.updateJob(job.id, job);
        return job;
      }
      throw err;
    }
  }

  private async runPipeline(jobId: string, deadlineMs: number): Promise<Job> {
    const job = leadPilotDb.getJob(jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);

    const timestamps: SearchTimestamps = {
      searchStart: Date.now(),
    };

    try {
      job.status = 'RUNNING';
      leadPilotDb.updateJob(job.id, { status: 'RUNNING' });

      const criteria = job.criteria;

      // 0. Location Pre-validation
      const validation = validateLocation(criteria.country || 'India', criteria.state, criteria.city);
      if (!validation.valid) {
        throw new Error(validation.error || 'Invalid State or City specification.');
      }

      const verifiedCountry = validation.country;
      const verifiedState = validation.matchedState || criteria.state;
      const verifiedCity = validation.matchedCity || criteria.city;
      const bbox = verifiedCountry === 'India' ? await resolveIndiaLocation(verifiedState, verifiedCity) : undefined;

      // Check persistent storage for previously discovered businesses (Section 12 & 26)
      const existingLeads = leadPilotDb.findLeadsByLocationAndIndustry({
        state: verifiedState,
        city: verifiedCity,
        industry: criteria.industry,
      });

      const cachedCandidates = existingLeads.map((l) => ({
        source: (l.sources && l.sources[0]) || 'stored',
        sources: l.sources || ['stored'],
        sourceId: l.googlePlaceId || l.osmId || l.leadId,
        name: l.businessName,
        businessName: l.businessName,
        category: l.category,
        industry: l.industry || criteria.industry,
        address: l.address,
        city: l.city,
        state: l.state,
        phone: l.phone,
        email: l.email,
        website: l.website,
        latitude: l.latitude,
        longitude: l.longitude,
        rawTags: {},
      }));

      // --- STAGE 1: Fast Business Discovery (Google Places Primary + Multi-Provider Fallback) ---
      const targetDiscoveryPool = Math.max(job.requestedLeads * 3, 100);
      timestamps.googleStart = Date.now();
      const discoveryOutput = await this.executeTrackedActor(
        businessDiscoveryActor,
        job,
        {
          industry: criteria.industry,
          state: verifiedState,
          city: verifiedCity,
          country: verifiedCountry,
          limit: targetDiscoveryPool,
          bbox,
        },
        'Discovering businesses (Google Places Primary + Multi-Provider Fallback)...'
      );
      timestamps.googleEnd = Date.now();

      job.discovered = discoveryOutput.rawCount + cachedCandidates.length;
      job.sourceComplete = discoveryOutput.sourceComplete || cachedCandidates.length > 0;
      job.statusReason = discoveryOutput.statusReason;
      job.providerStats = discoveryOutput.providerStats as any;

      const gStats = discoveryOutput.providerStats.googlePlaces;
      const oStats = discoveryOutput.providerStats.osm;
      const wStats = discoveryOutput.providerStats.webSearch;
      const dStats = discoveryOutput.providerStats.directory;

      job.providersReport = {
        googlePlaces: {
          status: gStats?.status || (!process.env.GOOGLE_PLACES_API_KEY ? 'NOT_CONFIGURED' : (gStats && gStats.rawCount > 0 ? 'SUCCESS' : 'NO_RESULTS')),
          discovered: gStats?.rawCount || 0,
          pagesRequested: gStats?.pagesRequested || (gStats && gStats.rawCount > 0 ? 1 : 0),
          errors: gStats?.errors || [],
        },
        osm: {
          status: oStats?.status || (process.env.OSM_ENABLED === 'false' ? 'DISABLED' : (oStats && oStats.rawCount > 0 ? 'SUCCESS' : 'NO_RESULTS')),
          discovered: oStats?.rawCount || 0,
          errors: oStats?.errors || [],
        },
        webSearch: {
          status: wStats?.status || 'NOT_NEEDED',
          discovered: wStats?.rawCount || 0,
          errors: wStats?.errors || [],
        },
        directory: {
          status: dStats?.status || 'NOT_NEEDED',
          discovered: dStats?.rawCount || 0,
          errors: dStats?.errors || [],
        },
      } as any;

      job.sourceStatus = (discoveryOutput.sourceStatus as any) || (discoveryOutput.sourceComplete || cachedCandidates.length > 0 ? 'COMPLETE' : 'PARTIAL');

      // Initialize initial pipeline breakdown to prevent 0 / undefined / desynchronized state on timeout
      job.pipelineBreakdown = {
        rawDiscoveredCount: job.discovered,
        normalizedCount: job.discovered,
        locationCheckedCount: 0,
        locationVerifiedCount: 0,
        inCityBoundsCount: 0,
        outsideLocationCount: 0,
        unknownLocationCount: 0,
        deduplicatedCount: 0,
        phoneCount: 0,
        emailCount: 0,
        phoneOrEmailCount: 0,
        websiteAvailableCount: 0,
        websiteUnavailableCount: 0,
        verifiedNoWebsiteCount: 0,
        websiteUnreachableCount: 0,
        finalQualifiedCount: 0,
      };

      // Persist discovered state immediately before any long-running stages can time out
      leadPilotDb.updateJob(job.id, job);

      const allCandidates = [...discoveryOutput.businesses, ...cachedCandidates];

      if (allCandidates.length === 0) {
        const effStatus = discoveryOutput.sourceStatus || 'NO_RESULTS';
        job.sourceStatus = effStatus as any;
        job.status = effStatus === 'NO_RESULTS' ? 'COMPLETED' : 'FAILED';
        job.statusReason = discoveryOutput.statusReason || 'No businesses found.';
        job.completedAt = new Date().toISOString();
        leadPilotDb.updateJob(job.id, job);
        return job;
      }

      // --- STAGE 1.5: Multi-Source Merge & Cross-Deduplication ---
      timestamps.mergeStart = Date.now();
      const mergeOutput = await this.executeTrackedActor(
        multiSourceMergeActor,
        job,
        allCandidates,
        'Merging and cross-deduplicating multi-source candidates...'
      );
      timestamps.mergeEnd = Date.now();

      job.mergedCount = mergeOutput.merged.length;
      job.deduplicated = mergeOutput.merged.length;
      job.rejectionReasons.DUPLICATE += mergeOutput.deduplicatedCount;
      leadPilotDb.updateJob(job.id, job);

      // --- STAGE 2: Location Verification ---
      const locationOutput = await this.executeTrackedActor(
        locationVerificationActor,
        job,
        {
          businesses: mergeOutput.merged,
          state: verifiedState,
          city: verifiedCity,
          country: verifiedCountry,
        },
        'Verifying municipal boundaries...'
      );

      job.locationVerifiedCount = locationOutput.verified.length;
      job.rejectionReasons.OUTSIDE_LOCATION += locationOutput.rejected.length;
      job.rejectionReasons.UNKNOWN_LOCATION = (job.rejectionReasons.UNKNOWN_LOCATION || 0) + locationOutput.unknown.length;

      job.pipelineBreakdown.locationVerifiedCount = locationOutput.verified.length;
      job.pipelineBreakdown.inCityBoundsCount = locationOutput.verified.length;
      job.pipelineBreakdown.outsideLocationCount = locationOutput.rejected.length;
      job.pipelineBreakdown.unknownLocationCount = locationOutput.unknown.length;
      job.pipelineBreakdown.locationCheckedCount =
        locationOutput.verified.length + locationOutput.rejected.length + locationOutput.unknown.length;

      // Persist verified location state
      leadPilotDb.updateJob(job.id, job);

      // --- STAGE 3: Business Verification & Early Industry Relevance Validation ---
      const businessVerificationOutput = await this.executeTrackedActor(
        businessVerificationActor,
        job,
        {
          businesses: locationOutput.verified,
          requestedIndustry: criteria.industry,
        },
        'Verifying business identity & industry relevance...'
      );


      for (const rej of businessVerificationOutput.rejected) {
        if (rej.reason === 'MISSING_NAME') job.rejectionReasons.MISSING_NAME++;
        if (rej.reason === 'INVALID_CATEGORY') job.rejectionReasons.INVALID_CATEGORY++;
      }

      job.pipelineBreakdown.normalizedCount = businessVerificationOutput.verified.length;
      leadPilotDb.updateJob(job.id, job);

      // --- STAGE 4: Deduplication ---
      const deduplicationOutput = await this.executeTrackedActor(
        deduplicationActor,
        job,
        businessVerificationOutput.verified,
        'Removing duplicates...'
      );

      job.deduplicated = deduplicationOutput.unique.length;
      job.deduplicatedCount = deduplicationOutput.unique.length;
      job.rejectionReasons.DUPLICATE += deduplicationOutput.duplicatesCount;
      job.pipelineBreakdown.deduplicatedCount = deduplicationOutput.unique.length;
      leadPilotDb.updateJob(job.id, job);

      // --- STAGE 5: Contact Qualification FIRST, then Website Filter ONLY WHEN REQUIRED ---
      const userWebsiteFilter = normalizeWebsiteFilter(criteria.websiteFilter);
      const normContact = normalizeContactFilter(criteria.contactFilter);

      const plan = searchPlanner.planSearch({
        industry: criteria.industry,
        state: verifiedState,
        city: verifiedCity,
        contactFilter: criteria.contactFilter,
        websiteFilter: criteria.websiteFilter,
        limit: job.requestedLeads,
        isGoogleConfigured: true,
        isGoogleCircuitOpen: false,
        isGoogleBudgetAllowed: true,
      });

      const fastCandidates = deduplicationOutput.unique;

      // --- STAGE 4.8: Targeted Pre-Qualification Email Extraction ONLY WHEN REQUIRED ---
      const requiresEmail = normContact === 'EMAIL_ONLY' || normContact === 'EMAIL_AND_PHONE' || normContact === 'VERIFIED_EMAIL';
      const mayNeedEmail = normContact === 'PHONE_OR_EMAIL' || normContact === 'VERIFIED_PHONE_OR_EMAIL';

      const candidatesNeedingEmail: typeof fastCandidates = [];
      for (const b of fastCandidates) {
        if (b.email && b.email.trim().length > 0) continue; // Already has verified email
        if (!b.website || b.website.trim().length === 0) continue; // No website to extract from

        if (requiresEmail) {
          if (normContact === 'EMAIL_AND_PHONE') {
            // Must have both: only crawl if candidate already has phone
            if (b.phone && b.phone.trim().length > 0) {
              candidatesNeedingEmail.push(b);
            }
          } else {
            // EMAIL_ONLY / VERIFIED_EMAIL: crawl candidates with websites
            candidatesNeedingEmail.push(b);
          }
        } else if (mayNeedEmail) {
          // PHONE_OR_EMAIL: only crawl if candidate has NO phone
          if (!b.phone || b.phone.trim().length === 0) {
            candidatesNeedingEmail.push(b);
          }
        }
      }

      if (candidatesNeedingEmail.length > 0) {
        const poolLimit = Math.min(candidatesNeedingEmail.length, Math.max(job.requestedLeads * 2, 25));
        this.logProgress(
          job,
          'email_enrichment',
          'Extracting Verified Contact Emails',
          `Checking official websites for ${poolLimit} candidates (Filter: ${criteria.contactFilter})...`
        );
        await extractBatchEmailsForCandidates(candidatesNeedingEmail, poolLimit);
      }

      const contactPassedCandidates: typeof fastCandidates = [];
      const rejectedCandidatesList: any[] = [];

      for (const b of fastCandidates) {
        const hasPhone = Boolean(b.phone && b.phone.trim().length > 0);
        const hasEmail = Boolean(b.email && b.email.trim().length > 0);
        let matchesContact = true;
        let contactRejectionReason: 'NO_CONTACT' | 'NO_PHONE' | 'NO_EMAIL' | 'EMAIL_OR_PHONE_MISSING' | 'HAS_CONTACT' = 'NO_CONTACT';

        if (normContact === 'ALL_CONTACTS') {
          matchesContact = true;
        } else if (normContact === 'PHONE_ONLY') {
          matchesContact = hasPhone;
          contactRejectionReason = 'NO_PHONE';
        } else if (normContact === 'EMAIL_ONLY') {
          matchesContact = hasEmail;
          contactRejectionReason = 'NO_EMAIL';
        } else if (normContact === 'EMAIL_AND_PHONE') {
          matchesContact = hasPhone && hasEmail;
          contactRejectionReason = 'EMAIL_OR_PHONE_MISSING';
        } else if (normContact === 'PHONE_OR_EMAIL') {
          matchesContact = hasPhone || hasEmail;
          contactRejectionReason = 'NO_CONTACT';
        } else if (normContact === 'NO_CONTACT') {
          matchesContact = !hasPhone && !hasEmail;
          contactRejectionReason = 'HAS_CONTACT';
        } else if (normContact === 'VERIFIED_PHONE') {
          // Pre-filter: candidate must at least have a phone to potentially have a verified phone
          matchesContact = hasPhone;
          contactRejectionReason = 'NO_PHONE';
        } else if (normContact === 'VERIFIED_EMAIL') {
          // Pre-filter: candidate must have an email or website to potentially have verified email
          matchesContact = hasEmail || Boolean(b.website);
          contactRejectionReason = 'NO_EMAIL';
        } else if (normContact === 'VERIFIED_PHONE_OR_EMAIL') {
          matchesContact = hasPhone || hasEmail || Boolean(b.website);
          contactRejectionReason = 'NO_CONTACT';
        }

        if (!matchesContact) {
          rejectedCandidatesList.push({
            name: b.businessName,
            category: b.category,
            city: b.city,
            state: b.state,
            phone: b.phone,
            email: b.email,
            websiteUrl: b.website,
            websiteStatus: b.website ? 'Working' : 'No Website',
            rejectionReason: contactRejectionReason as any,
            rejectionDetails: `Failed contact filter: ${criteria.contactFilter}`,
          });
          job.rejectionReasons.NO_CONTACT++;
          continue;
        }

        contactPassedCandidates.push(b);
      }

      // --- STAGE 5.2: Website Reachability ONLY WHEN REQUIRED ---
      const requiresNetworkReachability = ['WORKING', 'UNREACHABLE', 'NEEDS_IMPROVEMENT'].includes(userWebsiteFilter);
      let reachabilityMap = new Map<string, any>();

      if (requiresNetworkReachability) {
        const candidateUrls = contactPassedCandidates
          .map((b) => b.website)
          .filter((u): u is string => Boolean(u && u.trim().length > 0))
          .slice(0, Math.max(job.requestedLeads * 2, 40));

        if (candidateUrls.length > 0) {
          this.logProgress(
            job,
            'reachability',
            'Testing Website Reachability',
            `Testing reachability for ${candidateUrls.length} contact-qualified candidates (Filter: ${userWebsiteFilter})...`
          );
          reachabilityMap = await checkBatchReachability(candidateUrls);
        }
      }

      const qualifiedEntities: LeadEntity[] = [];
      let backgroundJobsQueued = 0;

      // --- STAGE 5.3: High-Throughput Bounded Concurrent Candidate Processing (Section J & K) ---
      const CONCURRENCY = Math.min(
        Number(process.env.CANDIDATE_PROCESSING_CONCURRENCY) || 12,
        20
      );
      const targetQualifiedQuota = Math.max(job.requestedLeads * 2, 25);
      const evaluatedIndices = new Set<number>();
      let candidateQueueIndex = 0;

      const evaluateCandidate = async (b: typeof fastCandidates[0], bIndex: number): Promise<LeadEntity | null> => {
        // Evaluate Website Reachability & Filter
        const reachCheck = b.website ? reachabilityMap.get(b.website) : undefined;
        const webClass = classifyCandidateWebsite(b.website, userWebsiteFilter, reachCheck);

        if (!webClass.matchesFilter) {
          rejectedCandidatesList.push({
            name: b.businessName,
            category: b.category,
            city: b.city,
            state: b.state,
            phone: b.phone,
            email: b.email,
            websiteUrl: b.website,
            websiteStatus: webClass.status,
            rejectionReason: (webClass.rejectionReason as any) || 'WEBSITE_FILTER_MISMATCH',
            rejectionDetails: webClass.rejectionDetails || `Failed website filter: ${userWebsiteFilter}`,
          });

          if (webClass.rejectionReason === 'HAS_WEBSITE') job.rejectionReasons.HAS_WEBSITE++;
          else if (webClass.rejectionReason === 'NO_WEBSITE') job.rejectionReasons.NO_WEBSITE++;
          else if (webClass.rejectionReason === 'WEBSITE_UNREACHABLE') job.rejectionReasons.WEBSITE_UNREACHABLE++;
          else if (webClass.rejectionReason === 'WEBSITE_WORKING') job.rejectionReasons.OTHER++;
          else if (webClass.rejectionReason === 'NO_IMPROVEMENT_OPPORTUNITY') job.rejectionReasons.AUDIT_FAILED++;
          else job.rejectionReasons.OTHER++;

          return null;
        }

        // Assemble Qualified Lead Entity with Verified Provenance
        const leadId = `lead_${b.sourceId ? b.sourceId.replace(/[^a-zA-Z0-9_-]/g, '_') : Date.now()}_${Math.random().toString(36).substr(2, 4)}`;

        const emailSource = (b as any).emailSourceUrl
          ? 'official_website'
          : b.source === 'osm' || b.source === 'openstreetmap'
          ? 'openstreetmap'
          : b.email
          ? 'official_website'
          : b.source || 'google_places';

        // --- Section 6 & 7: Google Data First & Contact Filter Fast Path ---
        const normPhone = normalizePhone(b.phone);
        const normEmail = b.email && b.email.includes('@') ? b.email.trim().toLowerCase() : undefined;
        const normContact = normalizeContactFilter(criteria.contactFilter);

        const satisfiedByExistingData =
          (normContact === 'ALL_CONTACTS') ||
          (normContact === 'PHONE_OR_EMAIL' && (normPhone || normEmail)) ||
          (normContact === 'PHONE_ONLY' && normPhone) ||
          (normContact === 'VERIFIED_PHONE' && normPhone) ||
          (normContact === 'EMAIL_ONLY' && normEmail) ||
          (normContact === 'EMAIL_AND_PHONE' && normPhone && normEmail);

        const contacts: ContactItem[] = [];
        const verifiedStatuses = new Set(['VERIFIED', 'MOBILE', 'LANDLINE']);
        let enrichmentOutput: ContactEnrichmentOutput | undefined;

        if (satisfiedByExistingData) {
          // Google/OSM structured data satisfies requirement immediately (0.05ms)
          if (normPhone) {
            contacts.push({
              value: normPhone,
              type: 'phone',
              source: b.source || 'google_places',
              sourceType: b.source || 'google_places',
              sourceUrl: (b as any).emailSourceUrl || b.sourceUrl || (b.source === 'google_places' ? `https://www.google.com/maps/place/?q=place_id:${b.sourceId}` : undefined),
              confidence: 'verified',
              verified: true,
            });
          }
          if (normEmail) {
            contacts.push({
              value: normEmail,
              type: 'email',
              source: emailSource,
              sourceType: emailSource,
              sourceUrl: (b as any).emailSourceUrl || b.website || b.sourceUrl,
              confidence: 'verified',
              verified: true,
            });
          }
        } else {
          // Only perform external enrichment when required contact is genuinely missing
          try {
            const enrichPromise = contactEnrichmentPipeline.enrichAndVerify({

              businessId: leadId,
              businessName: b.businessName,
              phone: b.phone,
              email: b.email,
              websiteUrl: b.website,
              source: emailSource,
              sourceUrl: (b as any).emailSourceUrl || b.sourceUrl || (b.source === 'google_places' ? `https://www.google.com/maps/place/?q=place_id:${b.sourceId}` : undefined),
              contactFilter: criteria.contactFilter,
              crawlResult: (b as any).crawlResult ? {
                extractedEmails: (b as any).crawlResult.extractedEmails || [],
                extractedPhones: (b as any).crawlResult.extractedPhones || [],
                finalUrl: (b as any).crawlResult.finalUrl,
                pages: (b as any).crawlResult.pages,
                socialLinks: (b as any).crawlResult.socialLinks,
                ctas: (b as any).crawlResult.ctas,
              } : undefined,
            });

            // Bounded per-candidate timeout: 2500ms
            let timeoutHandle: NodeJS.Timeout | undefined;
            const timeoutPromise = new Promise<undefined>((resolve) => {
              timeoutHandle = setTimeout(() => resolve(undefined), 2500);
            });
            enrichmentOutput = await Promise.race([enrichPromise, timeoutPromise]).finally(() => {
              if (timeoutHandle) clearTimeout(timeoutHandle);
            });
          } catch {
            // Non-fatal: enrichment failure does not reject the lead
          }

          if (enrichmentOutput) {
            for (const c of enrichmentOutput.contacts) {
              if (c.contactType === 'PHONE') {
                contacts.push({
                  value: c.normalizedValue,
                  type: 'phone',
                  source: c.source,
                  sourceType: c.sourceProvider || c.source,
                  sourceUrl: c.sourceUrl,
                  confidence: verifiedStatuses.has(c.verificationStatus) ? 'verified' : (c.confidence >= 0.6 ? 'high' : 'medium'),
                  verified: verifiedStatuses.has(c.verificationStatus),
                });
              } else if (c.contactType === 'EMAIL') {
                contacts.push({
                  value: c.normalizedValue,
                  type: 'email',
                  source: c.source,
                  sourceType: c.sourceProvider || c.source,
                  sourceUrl: c.sourceUrl,
                  confidence: c.verificationStatus === 'VERIFIED' ? 'verified' : (c.confidence >= 0.6 ? 'high' : 'medium'),
                  verified: c.verificationStatus === 'VERIFIED',
                });
              } else if (c.contactType === 'WHATSAPP' || c.contactType === 'CONTACT_FORM') {
                contacts.push({
                  value: c.normalizedValue,
                  type: c.contactType === 'WHATSAPP' ? 'whatsapp' : 'contact_form',
                  source: c.source,
                  sourceType: c.sourceProvider || c.source,
                  sourceUrl: c.sourceUrl,
                  confidence: 'medium',
                  verified: false,
                });
              }
            }
          } else {
            if (normPhone) {
              contacts.push({
                value: normPhone,
                type: 'phone',
                source: b.source || 'google_places',
                sourceType: b.source || 'google_places',
                confidence: 'medium',
                verified: false,
              });
            }
            if (normEmail) {
              contacts.push({
                value: normEmail,
                type: 'email',
                source: (b as any).emailSourceUrl ? 'official_website' : (b.source || 'openstreetmap'),
                sourceType: (b as any).emailSourceUrl ? 'website' : (b.source || 'openstreetmap'),
                sourceUrl: (b as any).emailSourceUrl || b.website,
                confidence: 'medium',
                verified: false,
              });
            }
          }
        }


        const resolvedSources = b.sources && b.sources.length > 0 ? b.sources : [b.source || 'google_places'];
        const resolvedEvidence =
          b.sourceEvidence && b.sourceEvidence.length > 0
            ? b.sourceEvidence.map((ev: any) => ({
                sourceName: ev.source || ev.sourceName || 'google_places',
                sourceId: ev.sourceId,
                rawTags: ev.rawTags,
                observedAt: new Date().toISOString(),
              }))
            : [
                {
                  sourceName: b.source || 'google_places',
                  sourceId: b.sourceId,
                  rawTags: b.rawTags,
                  observedAt: new Date().toISOString(),
                },
              ];

        const googlePlaceId =
          b.rawTags?.googlePlaceId ||
          (b.source === 'google_places' ? b.sourceId : undefined) ||
          b.sourceEvidence?.find((e: any) => e.source === 'google_places' || e.sourceName === 'google_places')?.sourceId;

        const osmId =
          b.rawTags?.osmId
            ? String(b.rawTags.osmId)
            : (b.source === 'osm' || b.source === 'openstreetmap' ? b.sourceId : undefined) ||
              b.sourceEvidence?.find((e: any) => e.source === 'osm' || e.source === 'openstreetmap' || e.sourceName === 'openstreetmap')?.sourceId;

        const httpsSecure = reachCheck?.isHttps ?? (webClass.url?.startsWith('https') || false);
        const scoreResult = calculateLeadScore({
          businessName: b.businessName,
          category: b.category,
          address: b.address,
          city: b.city || verifiedCity,
          state: b.state || verifiedState,
          country: (b as any).country || criteria.country || 'India',
          phone: b.phone,
          email: b.email,
          website: webClass.url,
          websiteStatus: webClass.status,
          https: httpsSecure,
          locationVerificationStatus: (b as any).locationVerificationStatus || 'VERIFIED',
          businessVerificationStatus: 'VERIFIED',
          sources: resolvedSources,
          rawTags: b.rawTags,
          audit: (b as any).auditResult || (b as any).websiteAudit,
        });

        const entity: LeadEntity = {
          leadId,
          businessName: b.businessName,
          category: b.category,
          industry: criteria.industry,
          address: b.address || '',
          city: b.city || verifiedCity || '',
          state: b.state || verifiedState,
          country: (b as any).country || verifiedCountry,
          postcode: b.postalCode || b.postcode,
          latitude: b.latitude,
          longitude: b.longitude,
          phone: b.phone,
          email: b.email,
          website: webClass.url,
          websiteStatus: webClass.status,
          https: httpsSecure,
          socialLinks: {},
          contacts,
          businessVerificationStatus: 'VERIFIED',
          locationVerificationStatus: 'VERIFIED',
          auditIssues: webClass.detectedIssues.map((issue) => ({ issue, category: 'technical' as const, severity: 'medium' as const, evidence: issue })),
          scoreBreakdown: scoreResult.breakdown,
          leadScore: scoreResult.score,
          sources: resolvedSources,
          sourceEvidence: resolvedEvidence,
          enrichmentStatus: 'QUALIFIED',
          auditStatus: webClass.hasEvidenceBackedImprovement ? 'AUDITED' : 'PENDING',
          googlePlaceId: b.googlePlaceId || googlePlaceId,
          rating: b.rating !== undefined ? b.rating : null,
          userRatingCount: b.userRatingCount !== undefined ? b.userRatingCount : null,
          reviewCount: b.userRatingCount !== undefined ? b.userRatingCount : null,
          businessStatus: b.businessStatus,
          positiveReviewDataAvailable: b.positiveReviewDataAvailable,
          positiveReviewCount: b.positiveReviewCount,
          negativeReviewCount: b.negativeReviewCount,
          neutralReviewCount: b.neutralReviewCount,
          positiveReviewRatio: b.positiveReviewRatio,
          reviews: b.reviews,
          osmId,
          provenance: {
            phone: {
              value: b.phone,
              source: enrichmentOutput?.contacts.find(c => c.contactType === 'PHONE')?.source || contacts.find(c => c.type === 'phone')?.source || resolvedSources.join(', '),
              verified: enrichmentOutput ? enrichmentOutput.quality.hasVerifiedPhone : contacts.some(c => c.type === 'phone' && c.verified),
            },
            website: { value: webClass.url, source: resolvedSources.join(', '), verified: Boolean(webClass.url) },
            email: {
              value: b.email,
              source: enrichmentOutput?.contacts.find(c => c.contactType === 'EMAIL')?.source
                || contacts.find(c => c.type === 'email')?.source
                || (b.email ? ((b as any).emailSourceUrl ? 'official_website' : (resolvedSources.find((s: string) => s === 'openstreetmap' || s === 'osm') || 'official_website')) : 'none'),
              verified: enrichmentOutput ? enrichmentOutput.quality.hasVerifiedEmail : contacts.some(c => c.type === 'email' && c.verified),
            },
          },

          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        // Review Intelligence Filters (Sections 9, 10, 11 - REAL DATA ONLY)
        if (criteria.excludePerfectRating && entity.rating === 5.0) {
          rejectedCandidatesList.push({
            name: b.businessName,
            category: b.category,
            city: b.city,
            state: b.state,
            phone: b.phone,
            email: b.email,
            websiteUrl: b.website,
            websiteStatus: webClass.status,
            rejectionReason: 'FILTER_MISMATCH' as any,
            rejectionDetails: 'Excluded because: Perfect 5.0 rating',
          });
          job.rejectionReasons.FILTER_MISMATCH = (job.rejectionReasons.FILTER_MISMATCH || 0) + 1;
          return null;
        }

        if (typeof criteria.minRating === 'number' && criteria.minRating > 0) {
          if (entity.rating === null || entity.rating === undefined || entity.rating < criteria.minRating) {
            rejectedCandidatesList.push({
              name: b.businessName,
              category: b.category,
              city: b.city,
              state: b.state,
              phone: b.phone,
              email: b.email,
              websiteUrl: b.website,
              websiteStatus: webClass.status,
              rejectionReason: 'FILTER_MISMATCH' as any,
              rejectionDetails: `Excluded because: Rating (${entity.rating ?? 'none'}) below minimum requirement (${criteria.minRating})`,
            });
            job.rejectionReasons.FILTER_MISMATCH = (job.rejectionReasons.FILTER_MISMATCH || 0) + 1;
            return null;
          }
        }

        if (typeof criteria.minReviews === 'number' && criteria.minReviews > 0) {
          const reviewsCount = entity.userRatingCount || 0;
          if (reviewsCount < criteria.minReviews) {
            rejectedCandidatesList.push({
              name: b.businessName,
              category: b.category,
              city: b.city,
              state: b.state,
              phone: b.phone,
              email: b.email,
              websiteUrl: b.website,
              websiteStatus: webClass.status,
              rejectionReason: 'FILTER_MISMATCH' as any,
              rejectionDetails: `Excluded because: Review count (${reviewsCount}) below minimum requirement (${criteria.minReviews})`,
            });
            job.rejectionReasons.FILTER_MISMATCH = (job.rejectionReasons.FILTER_MISMATCH || 0) + 1;
            return null;
          }
        }

        if (criteria.requirePositiveReviewEvidence && !entity.positiveReviewDataAvailable) {
          rejectedCandidatesList.push({
            name: b.businessName,
            category: b.category,
            city: b.city,
            state: b.state,
            phone: b.phone,
            email: b.email,
            websiteUrl: b.website,
            websiteStatus: webClass.status,
            rejectionReason: 'FILTER_MISMATCH' as any,
            rejectionDetails: 'Excluded because: Insufficient positive review evidence',
          });
          job.rejectionReasons.FILTER_MISMATCH = (job.rejectionReasons.FILTER_MISMATCH || 0) + 1;
          return null;
        }

        // Strict Post-Enrichment Contact Filter Verification
        const contactFilterEval = evaluateContactFilter(
          normContact,
          enrichmentOutput?.quality || {
            level: (contacts.some(c => c.verified) ? 'MEDIUM' : (contacts.length > 0 ? 'LOW' : 'NONE')),
            hasPhone: contacts.some(c => c.type === 'phone'),
            hasEmail: contacts.some(c => c.type === 'email'),
            hasVerifiedPhone: contacts.some(c => c.type === 'phone' && c.verified),
            hasVerifiedEmail: contacts.some(c => c.type === 'email' && c.verified),
            hasContact: contacts.length > 0,
            hasVerifiedContact: contacts.some(c => c.verified),
            phoneCount: contacts.filter(c => c.type === 'phone').length,
            emailCount: contacts.filter(c => c.type === 'email').length,
            verifiedPhoneCount: contacts.filter(c => c.type === 'phone' && c.verified).length,
            verifiedEmailCount: contacts.filter(c => c.type === 'email' && c.verified).length,
            explanation: 'Inferred from contacts list',
          }
        );

        if (!contactFilterEval.match) {
          rejectedCandidatesList.push({
            name: b.businessName,
            category: b.category,
            city: b.city,
            state: b.state,
            phone: b.phone,
            email: b.email,
            websiteUrl: b.website,
            websiteStatus: webClass.status,
            rejectionReason: 'CONTACT_FILTER_MISMATCH' as any,
            rejectionDetails: `Failed strict contact filter: ${criteria.contactFilter}`,
          });
          job.rejectionReasons.NO_CONTACT++;
          if (job.rejectionReasons.CONTACT_FILTER_MISMATCH !== undefined) {
            job.rejectionReasons.CONTACT_FILTER_MISMATCH++;
          }
          return null;
        }

        return entity;
      };

      // Worker loop executing bounded concurrent processing with error isolation and deadline control
      const worker = async () => {
        while (true) {
          if (qualifiedEntities.length >= targetQualifiedQuota) {
            break;
          }
          if (Date.now() - timestamps.searchStart > deadlineMs - 2500) {
            break;
          }

          const idx = candidateQueueIndex++;
          if (idx >= contactPassedCandidates.length) {
            break;
          }

          evaluatedIndices.add(idx);
          const candidate = contactPassedCandidates[idx];

          try {
            const entity = await evaluateCandidate(candidate, idx);
            if (entity) {
              qualifiedEntities.push(entity);
            }
          } catch (evalErr: any) {
            rejectedCandidatesList.push({
              name: candidate.businessName,
              category: candidate.category,
              city: candidate.city,
              state: candidate.state,
              phone: candidate.phone,
              email: candidate.email,
              websiteUrl: candidate.website,
              websiteStatus: candidate.website ? 'Working' : 'No Website',
              rejectionReason: 'TRANSIENT_FAILURE' as any,
              rejectionDetails: evalErr.message || 'Transient error during candidate evaluation',
            });
            job.rejectionReasons.OTHER++;
            if (job.rejectionReasons.TRANSIENT_FAILURE !== undefined) {
              job.rejectionReasons.TRANSIENT_FAILURE++;
            }
          }
        }
      };

      const workerCount = Math.min(CONCURRENCY, contactPassedCandidates.length);
      if (workerCount > 0) {
        this.logProgress(
          job,
          'orchestrator',
          'Concurrent Candidate Qualification',
          `Evaluating ${contactPassedCandidates.length} candidate businesses with ${workerCount} concurrent workers...`,
          contactPassedCandidates.length
        );
        await Promise.all(Array.from({ length: workerCount }, () => worker()));
      }

      // Truthful Candidate Accounting (Sections E & F):
      // Any candidate not processed before the deadline must be recorded with NOT_PROCESSED_BEFORE_DEADLINE,
      // NOT converted to NO_CONTACT or silently dropped!
      for (let i = 0; i < contactPassedCandidates.length; i++) {
        if (!evaluatedIndices.has(i)) {
          const unproc = contactPassedCandidates[i];
          rejectedCandidatesList.push({
            name: unproc.businessName,
            category: unproc.category,
            city: unproc.city,
            state: unproc.state,
            phone: unproc.phone,
            email: unproc.email,
            websiteUrl: unproc.website,
            websiteStatus: unproc.website ? 'Working' : 'No Website',
            rejectionReason: 'NOT_PROCESSED_BEFORE_DEADLINE' as any,
            rejectionDetails: 'Candidate evaluation deferred because global search deadline was reached.',
          });
          job.rejectionReasons.NOT_PROCESSED_BEFORE_DEADLINE = (job.rejectionReasons.NOT_PROCESSED_BEFORE_DEADLINE || 0) + 1;
        }
      }

      // --- STAGE 5.5: Smart Rotation & Lead History Prioritization ---
      const fingerprintKey = leadHistoryService.generateFingerprintKey({
        country: criteria.country,
        state: verifiedState,
        city: verifiedCity,
        industry: criteria.industry,
        contactFilter: criteria.contactFilter,
        websiteFilter: criteria.websiteFilter,
      });

      const rotationResult = await smartRotationService.rotateCandidates(
        job.id,
        qualifiedEntities,
        job.requestedLeads,
        fingerprintKey,
        {
          country: criteria.country,
          state: verifiedState,
          city: verifiedCity,
          industry: criteria.industry,
          contactFilter: criteria.contactFilter,
          websiteFilter: criteria.websiteFilter,
        }
      );

      // --- STAGE 5.6: Hard Guarantee Assertion ---
      const { validLeads: strictlyGuaranteedEntities, violationsCount } = assertHardGuarantee(
        rotationResult.orderedLeads,
        userWebsiteFilter
      );

      if (violationsCount > 0) {
        job.rejectionReasons.WEBSITE_FILTER_MISMATCH =
          (job.rejectionReasons.WEBSITE_FILTER_MISMATCH || 0) + violationsCount;
      }

      let initialEntities = [...strictlyGuaranteedEntities];

      // Review Sorting Logic (Section 10 - Transparent Scoring & Provider Data)
      if (criteria.reviewSort && criteria.reviewSort !== 'default') {
        if (criteria.reviewSort === 'most_reviews') {
          initialEntities.sort((a, b) => (b.userRatingCount || 0) - (a.userRatingCount || 0));
        } else if (criteria.reviewSort === 'highest_rating') {
          initialEntities.sort((a, b) => {
            const diff = (b.rating || 0) - (a.rating || 0);
            if (Math.abs(diff) > 0.01) return diff;
            return (b.userRatingCount || 0) - (a.userRatingCount || 0);
          });
        } else if (criteria.reviewSort === 'highest_positive_signal') {
          // Transparent formula: (rating || 0) * log10(userRatingCount + 1) + (positiveReviewRatio ? positiveReviewRatio * 5 : 0)
          const score = (e: LeadEntity) => {
            const r = e.rating || 0;
            const count = e.userRatingCount || 0;
            const volScore = Math.log10(count + 1);
            const evidenceBoost = e.positiveReviewRatio ? e.positiveReviewRatio * 5 : 0;
            return r * volScore + evidenceBoost;
          };
          initialEntities.sort((a, b) => score(b) - score(a));
        } else if (criteria.reviewSort === 'needs_attention') {
          // Prioritizes businesses with low ratings or few reviews that need reputation management
          const score = (e: LeadEntity) => {
            const r = e.rating || 3.0;
            const count = e.userRatingCount || 0;
            return (5.0 - r) * 10 + (count < 20 ? 10 : 0);
          };
          initialEntities.sort((a, b) => score(b) - score(a));
        }
      }

      job.rotationStats = rotationResult.stats;

      // Queue Background Enrichment for Delivered Leads
      for (const entity of initialEntities) {
        if (plan.plannedFilters.enrichmentFilters.requireEmailExtraction && !entity.email && entity.website) {
          backgroundEnrichmentQueue.enqueue({
            leadId: entity.leadId,
            searchId: job.id,
            type: 'EMAIL_EXTRACTION',
            priority: 'HIGH',
            provider: 'crawler',
          });
          backgroundJobsQueued++;
        }

        if (plan.plannedFilters.enrichmentFilters.requireReachabilityCheck && entity.website) {
          backgroundEnrichmentQueue.enqueue({
            leadId: entity.leadId,
            searchId: job.id,
            type: 'WEBSITE_REACHABILITY',
            priority: 'MEDIUM',
            provider: 'http_reachability',
          });
          backgroundJobsQueued++;
        }

        if (!entity.website && plan.plannedFilters.enrichmentFilters.requireWebsiteDiscovery) {
          backgroundEnrichmentQueue.enqueue({
            leadId: entity.leadId,
            searchId: job.id,
            type: 'WEBSITE_DISCOVERY',
            priority: 'LOW',
            provider: 'web_search',
          });
          backgroundJobsQueued++;
        }

        if (plan.plannedFilters.deepAuditFilters.requireSeoAudit && entity.website) {
          backgroundEnrichmentQueue.enqueue({
            leadId: entity.leadId,
            searchId: job.id,
            type: 'WEBSITE_AUDIT',
            priority: 'LOW',
            provider: 'lighthouse',
          });
          backgroundJobsQueued++;
        }

        // Always queue commercial intelligence
        backgroundEnrichmentQueue.enqueue({
          leadId: entity.leadId,
          searchId: job.id,
          type: 'COMMERCIAL_INTELLIGENCE',
          priority: 'LOW',
          provider: 'gemini_search',
        });
        backgroundJobsQueued++;
      }

      // Fast response assembly with truthful metrics
      const phoneCount = initialEntities.filter((l) => Boolean(l.phone)).length;
      const emailCount = initialEntities.filter((l) => Boolean(l.email)).length;
      const phoneOrEmailCount = initialEntities.filter((l) => Boolean(l.phone || l.email)).length;
      const workingWebsiteCount = initialEntities.filter((l) => l.websiteStatus === 'Working').length;
      const needsImprovementCount = initialEntities.filter((l) => l.websiteStatus === 'Needs Improvement').length;
      const unreachableCount = initialEntities.filter((l) => l.websiteStatus === 'Unreachable').length;
      const noWebsiteCount = initialEntities.filter((l) => l.websiteStatus === 'No Website' || !l.website).length;
      const websiteAvailableCount = workingWebsiteCount + needsImprovementCount;

      job.leads = initialEntities;
      job.verified = initialEntities.length;
      job.completed = initialEntities.length;
      job.qualified = initialEntities.length;
      job.phoneCount = phoneCount;
      job.emailCount = emailCount;
      job.phoneOrEmailCount = phoneOrEmailCount;
      job.websiteVerifiedCount = websiteAvailableCount;
      job.noWebsiteCount = noWebsiteCount;
      job.backgroundJobsQueued = backgroundJobsQueued;

      const unprocBeforeDeadline = job.rejectionReasons.NOT_PROCESSED_BEFORE_DEADLINE || 0;
      job.pipelineBreakdown = {
        rawDiscoveredCount: job.discovered,
        normalizedCount: businessVerificationOutput.verified.length,
        locationCheckedCount: locationOutput.verified.length + locationOutput.rejected.length + locationOutput.unknown.length,
        locationVerifiedCount: locationOutput.verified.length,
        inCityBoundsCount: locationOutput.verified.length,
        outsideLocationCount: locationOutput.rejected.length,
        unknownLocationCount: locationOutput.unknown.length,
        deduplicatedCount: deduplicationOutput.unique.length,
        queuedCount: fastCandidates.length,
        processedCount: Math.max(0, fastCandidates.length - unprocBeforeDeadline),
        notProcessedCount: unprocBeforeDeadline,
        notProcessedBeforeDeadlineCount: unprocBeforeDeadline,
        phoneCount,
        emailCount,
        phoneOrEmailCount,
        websiteAvailableCount,
        websiteUnavailableCount: noWebsiteCount,
        verifiedNoWebsiteCount: noWebsiteCount,
        websiteUnreachableCount: unreachableCount,
        websiteNeedsImprovementCount: needsImprovementCount,
        finalQualifiedCount: initialEntities.length,
        deliveredCount: initialEntities.length,
      };

      job.rejectedCandidates = [
        ...locationOutput.rejected.map((r) => ({
          name: r.business.businessName,
          category: r.business.category,
          city: r.business.city,
          state: r.business.state,
          rejectionReason: 'OUTSIDE_LOCATION' as const,
          rejectionDetails: 'Candidate is outside the specified geographic boundary.',
        })),
        ...locationOutput.unknown.map((u) => ({
          name: u.businessName,
          category: u.category,
          city: u.city,
          state: u.state,
          rejectionReason: 'UNKNOWN_LOCATION' as const,
          rejectionDetails: 'Candidate location could not be verified within municipal boundary.',
        })),
        ...businessVerificationOutput.rejected.map((r) => ({
          name: r.business.businessName,
          category: r.business.category,
          city: r.business.city,
          state: r.business.state,
          rejectionReason: (r.reason || 'MISSING_NAME') as any,
          rejectionDetails: 'Candidate failed identity or name verification.',
        })),
        ...rejectedCandidatesList,
      ];

      // Section 10 & 11: Truthful status semantics
      if (initialEntities.length >= job.requestedLeads) {
        job.sourceStatus = 'COMPLETE';
        job.statusReason = `Discovered and qualified ${initialEntities.length} verified leads satisfying all criteria.`;
      } else if (initialEntities.length > 0) {
        job.sourceStatus = 'PARTIAL';
        job.statusReason = `Delivered ${initialEntities.length} of ${job.requestedLeads} qualified leads. All configured discovery sources evaluated.`;
      } else {
        job.sourceStatus = 'NO_RESULTS';
        job.statusReason = `0 leads met the selected criteria.`;
      }

      // Persist delivered leads in LeadPilot database for instant reuse & rotation (Section 12)
      leadPilotDb.upsertLeadsBatch(initialEntities);

      // Mark status as DISCOVERY_COMPLETE immediately!
      job.status = 'DISCOVERY_COMPLETE';
      job.completedAt = new Date().toISOString();

      timestamps.responseSent = Date.now();
      const fastPathLatencyMs = timestamps.responseSent - timestamps.searchStart;
      job.fastPathLatencyMs = fastPathLatencyMs;
      job.latencyMs = fastPathLatencyMs;

      // Record performance measurements
      performanceTracker.recordSearchEnd({
        searchId: job.id,
        query: `${criteria.industry} in ${verifiedCity || verifiedState}`,
        timestamps,
        googleLatencyMs: discoveryOutput.googleLatencyMs || 0,
        osmLatencyMs: discoveryOutput.osmLatencyMs || 0,
        mergeLatencyMs: (timestamps.mergeEnd || 0) - (timestamps.mergeStart || 0),
        fastPathLatencyMs,
        backgroundLatencyMs: 0,
        totalLatencyMs: fastPathLatencyMs,
        cacheHit: Boolean(discoveryOutput.cacheHit),
        providers: {
          google: {
            status: gStats?.status || 'DISABLED',
            discovered: gStats?.rawCount || 0,
          },
          osm: {
            status: oStats?.status || 'NOT_NEEDED',
            discovered: oStats?.rawCount || 0,
          },
        },
      });

      // Persist leads and job to DB (both memory/disk and Prisma SQLite)
      leadPilotDb.upsertLeadsBatch(initialEntities);
      leadPilotDb.updateJob(job.id, job);

      for (const ent of initialEntities) {
        try {
          leadsDb.upsertLead(leadEntityToFrontend(ent));
        } catch {
          // non-blocking
        }
      }

      this.logProgress(
        job,
        'orchestrator',
        'Discovery Complete (Fast Path)',
        `Delivered ${initialEntities.length} candidates in ${fastPathLatencyMs}ms. Queued ${backgroundJobsQueued} background enrichment jobs.`,
        initialEntities.length
      );

      return job;
    } catch (err: any) {
      job.status = 'FAILED';
      job.sourceStatus = 'FAILED';
      job.error = err.message || 'Pipeline execution failed';
      job.completedAt = new Date().toISOString();
      leadPilotDb.updateJob(job.id, job);
      logger.error({ jobId: job.id, message: 'Orchestrator Job Failed', error: err });
      return job;
    }
  }

  /**
   * Resumes a previously failed or partial job.
   */
  public async resumeJob(jobId: string): Promise<Job> {
    const job = leadPilotDb.getJob(jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);
    return this.executeJob(jobId);
  }
}

export const orchestrator = new LeadPilotOrchestrator();
