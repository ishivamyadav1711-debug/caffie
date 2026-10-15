import { prisma } from '../prisma';
import { businessDiscovery } from '../providers/businessDiscoveryProvider';
import { websiteCrawler } from '../providers/websiteCrawlerProvider';
import { websiteAuditor } from '../providers/websiteAuditProvider';
import { emailVerifier } from '../providers/emailVerificationProvider';
import { phoneValidator } from '../providers/phoneValidationProvider';
import { calculateExplainableLeadScore } from '../scoring/leadScorer';
import { DiscoveryCriteria, DiscoveredBusiness } from '../providers/types';
import { Lead, SearchSummary, WebsiteStatus } from '@/types';
import { normalizeWebsiteFilter } from '@/lib/audit/WebsiteStatusClassifier';

export interface PipelineExecutionResult {
  jobId: string;
  pipelineRunId: string;
  leads: Lead[];
  summary: SearchSummary;
  totalDiscovered: number;
  totalMatched: number;
  sourceStatus?: 'COMPLETE' | 'PARTIAL' | 'FAILED';
  providers?: any;
}


export class PipelineOrchestrator {
  /**
   * Executes the 13-stage LeadPilot pipeline with full persistence and error isolation.
   */
  async executePipeline(criteria: {
    country?: string;
    state: string;
    city?: string;
    industry: string;
    contactFilter?: string;
    websiteFilter?: string;
    limit: number;
  }): Promise<PipelineExecutionResult> {
    const startTime = Date.now();
    const criteriaJson = JSON.stringify(criteria);

    // 1. STAGE: TARGET_CREATED
    const job = await prisma.job.create({
      data: {
        type: 'LEAD_SEARCH',
        status: 'RUNNING',
        criteria: criteriaJson,
      },
    });

    const pipelineRun = await prisma.pipelineRun.create({
      data: {
        jobId: job.id,
        status: 'RUNNING',
        stage: 'DISCOVERING',
      },
    });

    let discoveredCandidates: DiscoveredBusiness[] = [];

    // 2. STAGE: DISCOVERING
    const actorDiscoveryStart = Date.now();
    try {
      discoveredCandidates = await businessDiscovery.searchBusinesses({
        industry: criteria.industry,
        state: criteria.state,
        city: criteria.city,
        country: criteria.country || 'India',
        limit: criteria.limit,
      });

      await prisma.actorRun.create({
        data: {
          pipelineRunId: pipelineRun.id,
          actorName: 'BusinessDiscoveryActor',
          status: 'COMPLETED',
          inputCount: 1,
          outputCount: discoveredCandidates.length,
          durationMs: Date.now() - actorDiscoveryStart,
        },
      });
    } catch (err: any) {
      try {
        await prisma.actorRun.create({
          data: {
            pipelineRunId: pipelineRun.id,
            actorName: 'BusinessDiscoveryActor',
            status: 'FAILED',
            inputCount: 1,
            outputCount: 0,
            durationMs: Date.now() - actorDiscoveryStart,
            error: err.message,
          },
        });

        await prisma.pipelineRun.update({
          where: { id: pipelineRun.id },
          data: { status: 'FAILED', error: err.message },
        });

        await prisma.job.update({
          where: { id: job.id },
          data: { status: 'FAILED', error: err.message },
        });
      } catch (dbErr) {
        console.warn('[pipelineOrchestrator] Failed to update DB on error (P2025 or connection closed):', dbErr);
      }

      throw err;
    }

    // 3. STAGES: EXTRACTING, ENRICHING, DEDUPLICATING, CRAWLING, AUDITING, VERIFYING, QUALIFYING
    try {
      await prisma.pipelineRun.update({
        where: { id: pipelineRun.id },
        data: { stage: 'PROCESSING', recordsProcessed: discoveredCandidates.length },
      });
    } catch (dbErr) {
      console.warn('[pipelineOrchestrator] PipelineRun update failed (P2025):', dbErr);
    }

    const processedLeads: Lead[] = [];
    const BATCH_SIZE = 5;

    for (let i = 0; i < discoveredCandidates.length; i += BATCH_SIZE) {
      const batch = discoveredCandidates.slice(i, i + BATCH_SIZE);

      await Promise.all(
        batch.map(async (candidate) => {
          try {
            const lead = await this.processSingleBusiness(candidate, pipelineRun.id);
            if (lead) {
              processedLeads.push(lead);
            }
          } catch (itemErr: any) {
            console.warn(`[Pipeline] Failed processing candidate ${candidate.name}:`, itemErr.message);
          }
        })
      );
    }

    // Filter by user selection
    const filteredLeads = this.applyFilters(processedLeads, criteria.contactFilter, criteria.websiteFilter);
    const finalLeads = filteredLeads.slice(0, criteria.limit);

    // Compute dynamic real summary
    const summary: SearchSummary = {
      total: finalLeads.length,
      withPhone: finalLeads.filter((l) => Boolean(l.phone)).length,
      withEmail: finalLeads.filter((l) => Boolean(l.email)).length,
      emailAndPhone: finalLeads.filter((l) => Boolean(l.email && l.phone)).length,
      hasPhoneOrEmail: finalLeads.filter((l) => Boolean(l.email || l.phone)).length,
      noContact: finalLeads.filter((l) => !l.email && !l.phone).length,
      noWebsite: finalLeads.filter((l) => !l.websiteUrl || l.websiteStatus === 'No Website').length,
      websiteAvailable: finalLeads.filter((l) => Boolean(l.websiteUrl)).length,
      workingWebsite: finalLeads.filter((l) => l.websiteStatus === 'Working').length,
      needsImprovement: finalLeads.filter((l) => l.websiteStatus === 'Needs Improvement').length,
      unreachable: finalLeads.filter((l) => l.websiteStatus === 'Unreachable').length,
    };

    // Complete Job & Pipeline Run in Canonical Database
    try {
      await prisma.pipelineRun.update({
        where: { id: pipelineRun.id },
        data: {
          status: 'COMPLETED',
          stage: 'COMPLETED',
          recordsProcessed: discoveredCandidates.length,
          completedAt: new Date(),
        },
      });

      await prisma.job.update({
        where: { id: job.id },
        data: {
          status: 'COMPLETED',
          totalDiscovered: discoveredCandidates.length,
          totalProcessed: processedLeads.length,
          totalQualified: finalLeads.length,
          completedAt: new Date(),
        },
      });
    } catch (dbErr) {
      console.warn('[pipelineOrchestrator] Failed to update Job/PipelineRun on completion (P2025):', dbErr);
    }

    return {
      jobId: job.id,
      pipelineRunId: pipelineRun.id,
      leads: finalLeads,
      summary,
      totalDiscovered: discoveredCandidates.length,
      totalMatched: finalLeads.length,
      sourceStatus: businessDiscovery.getLastSourceStatus(),
      providers: businessDiscovery.getLastProvidersReport(),
    };

  }

  private async processSingleBusiness(candidate: DiscoveredBusiness, pipelineRunId: string): Promise<Lead> {
    const now = new Date();

    // 1. Phone validation (libphonenumber)
    let phoneValResult = candidate.phone
      ? await phoneValidator.validatePhone(candidate.phone, 'IN')
      : undefined;

    // 2. Website Crawl & Audit (if URL present)
    let crawlResult = undefined;
    let auditResult = undefined;
    let websiteStatus: WebsiteStatus = 'No Website';

    if (candidate.websiteUrl) {
      crawlResult = await websiteCrawler.crawl(candidate.websiteUrl, 3);
      auditResult = await websiteAuditor.auditWebsite(candidate.websiteUrl);

      if (!crawlResult.isReachable) {
        websiteStatus = 'Unreachable';
      } else if (auditResult.technicalIssues.length > 0 || auditResult.mobileIssues.length > 0 || auditResult.conversionIssues.length > 0) {
        websiteStatus = 'Needs Improvement';
      } else {
        websiteStatus = 'Working';
      }
    }

    // 3. Email discovery & verification
    let discoveredEmail: string | undefined = undefined;
    if (crawlResult && crawlResult.emails.length > 0) {
      discoveredEmail = crawlResult.emails[0];
    }

    let emailValResult = discoveredEmail ? await emailVerifier.verifyEmail(discoveredEmail) : undefined;

    // 4. Calculate Explainable Score & Evidence
    const scoreResult = calculateExplainableLeadScore({
      businessName: candidate.name,
      hasWebsite: Boolean(candidate.websiteUrl),
      websiteUrl: candidate.websiteUrl,
      audit: auditResult,
      crawl: crawlResult,
      emailVerification: emailValResult,
      phoneValidation: phoneValResult,
      ratings: { rating: candidate.rating, reviewCount: candidate.reviewCount },
    });

    // 5. Persist into Canonical Database (Prisma)
    // Deduplication check by normalized name + city or sourceId
    const existing = await prisma.business.findFirst({
      where: {
        OR: [
          { sources: { some: { provider: candidate.provider, sourceId: candidate.sourceId } } },
          { name: candidate.name, city: candidate.city },
        ],
      },
    });

    const business = existing
      ? await prisma.business.update({
          where: { id: existing.id },
          data: {
            phone: phoneValResult?.formattedE164 || candidate.phone || existing.phone,
            email: discoveredEmail || existing.email,
            websiteUrl: candidate.websiteUrl || existing.websiteUrl,
            opportunityScore: scoreResult.opportunityScore,
          },
        })
      : await prisma.business.create({
          data: {
            name: candidate.name,
            category: candidate.category,
            industry: candidate.industry,
            address: candidate.address,
            city: candidate.city,
            state: candidate.state,
            country: candidate.country,
            postcode: candidate.postcode,
            latitude: candidate.latitude,
            longitude: candidate.longitude,
            phone: phoneValResult?.formattedE164 || candidate.phone,
            email: discoveredEmail,
            websiteUrl: candidate.websiteUrl,
            rating: candidate.rating,
            reviewCount: candidate.reviewCount,
            businessStatus: candidate.businessStatus || 'OPERATIONAL',
            opportunityScore: scoreResult.opportunityScore,
            status: 'New',
          },
        });

    // Record Business Source
    await prisma.businessSource.create({
      data: {
        businessId: business.id,
        provider: candidate.provider,
        sourceId: candidate.sourceId,
        sourceUrl: candidate.sourceUrl,
        rawPayload: candidate.rawPayload ? JSON.stringify(candidate.rawPayload) : undefined,
      },
    });

    // Record Contact
    if (business.phone || business.email) {
      await prisma.contact.create({
        data: {
          businessId: business.id,
          name: business.name,
          email: business.email,
          phone: business.phone,
          type: business.email?.includes('info@') || business.email?.includes('contact@') ? 'GENERIC_BUSINESS' : 'PERSONAL_DECISION_MAKER',
          verificationStatus: emailValResult?.status === 'DELIVERABLE' || phoneValResult?.isValid ? 'VERIFIED' : 'UNVERIFIED',
          sourceUrl: candidate.websiteUrl || candidate.sourceUrl,
        },
      });
    }

    // Record Website Audit
    if (candidate.websiteUrl && auditResult) {
      await prisma.websiteAudit.create({
        data: {
          businessId: business.id,
          url: candidate.websiteUrl,
          status: websiteStatus,
          performanceScore: auditResult.performanceScore,
          accessibilityScore: auditResult.accessibilityScore,
          bestPracticesScore: auditResult.bestPracticesScore,
          seoScore: auditResult.seoScore,
          hasMobileViewport: crawlResult?.hasMobileViewport ?? false,
          hasContactForm: crawlResult?.hasContactForm ?? false,
          hasBookingCta: crawlResult?.hasBookingCta ?? false,
          hasPhoneCta: crawlResult?.hasPhoneCta ?? false,
          hasWhatsappLink: Boolean(crawlResult && crawlResult.whatsappLinks.length > 0),
          detectedIssues: JSON.stringify([
            ...auditResult.technicalIssues,
            ...auditResult.mobileIssues,
            ...auditResult.conversionIssues,
            ...auditResult.seoIssues,
          ]),
        },
      });
    }

    // Record Lead Score & Evidence
    await prisma.leadScore.create({
      data: {
        businessId: business.id,
        opportunityScore: scoreResult.opportunityScore,
        fitScore: scoreResult.fitScore,
        needScore: scoreResult.digitalNeedScore,
        contactabilityScore: scoreResult.contactabilityScore,
        evidenceScore: scoreResult.evidenceScore,
        reasons: JSON.stringify(scoreResult.reasons),
      },
    });

    for (const ev of scoreResult.evidence) {
      await prisma.leadEvidence.create({
        data: {
          businessId: business.id,
          evidenceType: ev.evidenceType,
          claim: ev.claim,
          sourceUrl: ev.sourceUrl,
          snippet: ev.snippet,
          confidence: ev.confidence,
        },
      });
    }

    // Map to frontend Lead contract
    const hasPhone = Boolean(business.phone);
    const hasEmail = Boolean(business.email);
    const hasWebsite = Boolean(business.websiteUrl);

    const lead: Lead = {
      id: business.id,
      source: candidate.provider === 'google_places' ? 'Google Places' : 'OpenStreetMap',
      sourceId: candidate.sourceId,
      businessName: business.name,
      category: business.category,
      industry: business.industry,
      address: business.address || undefined,
      city: business.city || undefined,
      state: business.state || undefined,
      postcode: business.postcode || undefined,
      phone: business.phone || undefined,
      email: business.email || undefined,
      websiteUrl: business.websiteUrl || undefined,
      latitude: business.latitude || undefined,
      longitude: business.longitude || undefined,
      websiteStatus,
      websiteIssues: scoreResult.reasons,
      createdAt: business.createdAt.toISOString(),
      updatedAt: business.updatedAt.toISOString(),
      dateDiscovered: business.createdAt.toISOString().split('T')[0],

      location: {
        city: business.city || '',
        state: business.state || undefined,
        country: business.country,
        address: business.address || `${business.city || ''}, India`,
        postcode: business.postcode || undefined,
      },
      website: {
        url: business.websiteUrl || undefined,
        hasWebsite,
        status: websiteStatus,
        detectedIssues: scoreResult.reasons,
        qualityReason: scoreResult.reasons[0],
        pagesAnalyzed: crawlResult?.pagesCrawled.length || (hasWebsite ? 1 : 0),
        speedScore: auditResult?.performanceScore,
        mobileOptimized: crawlResult?.hasMobileViewport,
        sslSecure: crawlResult?.isHttps,
      },
      contact: {
        name: business.name,
        email: business.email || undefined,
        phone: business.phone || undefined,
        hasEmail,
        hasPhone,
        verified: (phoneValResult?.isValid ?? false) || emailValResult?.status === 'DELIVERABLE',
        contactType: hasEmail && hasPhone ? 'Email + Phone' : hasPhone ? 'Phone' : hasEmail ? 'Email' : 'None',
      },
      leadScore: scoreResult.opportunityScore,
      notes: scoreResult.reasons.join('. '),
      auditIssues: scoreResult.reasons,
      aiOpportunity: scoreResult.reasons[0] ? `High value opportunity: ${scoreResult.reasons[0]}` : undefined,
    };

    return lead;
  }

  private applyFilters(leads: Lead[], contactFilter?: string, websiteFilter?: string): Lead[] {
    return leads.filter((lead) => {
      // Contact filter
      const hasPhone = Boolean(lead.phone);
      const hasEmail = Boolean(lead.email);

      let matchesContact = true;
      if (contactFilter === 'Email + Phone') matchesContact = hasPhone && hasEmail;
      else if (contactFilter === 'Email Only') matchesContact = hasEmail && !hasPhone;
      else if (contactFilter === 'Phone Only') matchesContact = hasPhone && !hasEmail;
      else if (contactFilter === 'No Contact') matchesContact = !hasPhone && !hasEmail;
      else if (contactFilter === 'Has Phone or Email' || contactFilter === 'Phone or Email') matchesContact = hasPhone || hasEmail;
      else if (contactFilter === 'Has Email') matchesContact = hasEmail;
      else if (contactFilter === 'Has Phone') matchesContact = hasPhone;

      // Canonical Website filter semantics
      const canonicalFilter = normalizeWebsiteFilter(websiteFilter);
      let matchesWebsite = true;
      if (canonicalFilter === 'WORKING') {
        matchesWebsite = Boolean(lead.websiteUrl) && (status === 'Working' || status === 'WORKING');
      } else if (canonicalFilter === 'UNREACHABLE') {
        matchesWebsite = Boolean(lead.websiteUrl) && (status === 'Unreachable' || status === 'UNREACHABLE');
      } else if (canonicalFilter === 'NO_WEBSITE') {
        matchesWebsite = !lead.websiteUrl || status === 'No Website' || status === 'NO_WEBSITE';
      } else if (canonicalFilter === 'NEEDS_IMPROVEMENT') {
        matchesWebsite = Boolean(lead.websiteUrl) && (status === 'Needs Improvement' || status === 'NEEDS_IMPROVEMENT');
      }

      return matchesContact && matchesWebsite;
    });
  }
}

export const pipelineOrchestrator = new PipelineOrchestrator();
