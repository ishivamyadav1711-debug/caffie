import { SearchRequestPayload, SearchSummary } from '@/types';
import { jobManager } from '@/jobs/JobManager';
import { leadEntityToFrontend } from '@/models/Lead';
import { Job } from '@/models/Job';
import { leadPilotDb } from '@/db';

export class SearchService {
  public async startSearch(criteria: SearchRequestPayload, sync: boolean = true) {
    if (sync) {
      const job = await jobManager.executeJobSync(criteria);
      return this.formatJobResponse(job);
    }

    const job = await jobManager.dispatchJob(criteria);
    return {
      success: true,
      jobId: job.id,
      status: job.status,
      message: 'Lead discovery job dispatched successfully.',
    };
  }

  public getJobStatus(jobId: string) {
    const job = jobManager.getJob(jobId);
    if (!job) return null;
    return this.formatJobResponse(job);
  }

  public getJobProgress(jobId: string) {
    return jobManager.getProgress(jobId);
  }

  public async getJobProgressAsync(jobId: string) {
    return jobManager.getProgressAsync(jobId);
  }

  public getJobResults(jobId: string) {
    const job = jobManager.getJob(jobId);
    if (!job) return null;
    return this.formatJobResponse(job);
  }

  public async getJobResultsAsync(jobId: string) {
    const job = await jobManager.getJobAsync(jobId);
    if (!job) return null;
    return this.formatJobResponse(job);
  }

  public resumeSearch(jobId: string) {
    return jobManager.resumeJob(jobId);
  }

  private formatJobResponse(job: Job) {
    // Read up-to-date entities from persistent database so background enrichment immediately reflects
    const freshLeads = (job.leads || []).map((l) => leadPilotDb.getLead(l.leadId) || l);
    const frontendLeads = freshLeads.map(leadEntityToFrontend);

    const summary: SearchSummary = {
      total: frontendLeads.length,
      withPhone: frontendLeads.filter((l) => Boolean(l.phone)).length,
      withEmail: frontendLeads.filter((l) => Boolean(l.email)).length,
      emailAndPhone: frontendLeads.filter((l) => Boolean(l.email && l.phone)).length,
      hasPhoneOrEmail: frontendLeads.filter((l) => Boolean(l.email || l.phone)).length,
      noContact: frontendLeads.filter((l) => !l.email && !l.phone).length,
      noWebsite: frontendLeads.filter((l) => !l.websiteUrl || l.websiteStatus === 'No Website' || l.websiteStatus === 'NO_WEBSITE').length,
      websiteAvailable: frontendLeads.filter((l) => Boolean(l.websiteUrl) && (l.websiteStatus === 'Working' || l.websiteStatus === 'WORKING' || l.websiteStatus === 'Needs Improvement' || l.websiteStatus === 'NEEDS_IMPROVEMENT')).length,
      workingWebsite: frontendLeads.filter((l) => l.websiteStatus === 'Working' || l.websiteStatus === 'WORKING').length,
      needsImprovement: frontendLeads.filter((l) => l.websiteStatus === 'Needs Improvement' || l.websiteStatus === 'NEEDS_IMPROVEMENT').length,
      unreachable: frontendLeads.filter((l) => l.websiteStatus === 'Unreachable' || l.websiteStatus === 'UNREACHABLE').length,
    };

    return {
      success: job.status !== 'FAILED',
      searchId: job.id,
      jobId: job.id,
      status: job.status,
      searchStatus: job.sourceStatus,
      sourceComplete: job.sourceComplete,
      statusReason: job.statusReason,
      latencyMs: job.latencyMs || job.fastPathLatencyMs || 0,
      fastPathLatencyMs: job.fastPathLatencyMs || 0,
      backgroundJobsQueued: job.backgroundJobsQueued || 0,
      leads: frontendLeads,
      results: frontendLeads,
      summary,
      primaryProvider: (job.primaryProvider || process.env.PRIMARY_DISCOVERY_PROVIDER || 'rapidapi').toLowerCase(),
      providerStats: {
        primaryProvider: (job.primaryProvider || process.env.PRIMARY_DISCOVERY_PROVIDER || 'rapidapi').toLowerCase(),
        rapidapi: job.providerStats?.rapidapi || {
          rawCount: job.providersReport?.rapidapi?.discovered ?? 0,
          status: job.providersReport?.rapidapi?.status || (process.env.RAPIDAPI_MOCK_MODE === 'true' ? 'SUCCESS' : (process.env.RAPIDAPI_KEY ? 'SUCCESS' : 'NOT_CONFIGURED')),
          durationMs: 0,
        },
        googlePlaces: job.providerStats?.googlePlaces || {
          rawCount: job.providersReport?.googlePlaces?.discovered ?? 0,
          status: job.providersReport?.googlePlaces?.status || (process.env.GOOGLE_PLACES_ENABLED === 'true' ? (process.env.GOOGLE_PLACES_API_KEY ? 'SUCCESS' : 'NOT_CONFIGURED') : 'DISABLED'),
          durationMs: 0,
        },
        osm: job.providerStats?.osm || {
          rawCount: job.providersReport?.osm?.discovered ?? 0,
          status: job.providersReport?.osm?.status || (process.env.OSM_ENABLED === 'false' ? 'DISABLED' : ((job.providersReport?.osm?.discovered ?? 0) > 0 ? 'SUCCESS' : 'NOT_NEEDED')),
          durationMs: 0,
        },
        web: { rawCount: 0, status: 'NOT_NEEDED', durationMs: 0 },
        webSearch: job.providerStats?.webSearch || { rawCount: 0, status: 'NOT_NEEDED', durationMs: 0 },
        directory: job.providerStats?.directory || { rawCount: 0, status: 'NOT_NEEDED', durationMs: 0 },
      },
      pipelineStats: {
        rawOsmCount: job.providerStats?.osm?.rawCount ?? 0,
        namedCount: job.pipelineBreakdown?.normalizedCount ?? job.normalizedCount ?? job.discovered ?? 0,
        inCityBoundsCount: job.pipelineBreakdown?.locationVerifiedCount ?? job.pipelineBreakdown?.inCityBoundsCount ?? job.locationVerifiedCount ?? 0,
        locationVerifiedCount: job.pipelineBreakdown?.locationVerifiedCount ?? job.pipelineBreakdown?.inCityBoundsCount ?? job.locationVerifiedCount ?? 0,
        outsideLocationCount: job.pipelineBreakdown?.outsideLocationCount ?? job.rejectionReasons?.OUTSIDE_LOCATION ?? 0,
        unknownLocationCount: job.pipelineBreakdown?.unknownLocationCount ?? job.rejectionReasons?.UNKNOWN_LOCATION ?? 0,
        locationCheckedCount: job.pipelineBreakdown?.locationCheckedCount ?? ((job.pipelineBreakdown?.locationVerifiedCount ?? job.locationVerifiedCount ?? 0) + (job.pipelineBreakdown?.outsideLocationCount ?? job.rejectionReasons?.OUTSIDE_LOCATION ?? 0) + (job.pipelineBreakdown?.unknownLocationCount ?? job.rejectionReasons?.UNKNOWN_LOCATION ?? 0)),
        deduplicatedCount: job.pipelineBreakdown?.deduplicatedCount ?? job.deduplicatedCount ?? job.deduplicated ?? 0,
        withPhoneCount: summary.withPhone,
        withEmailCount: summary.withEmail,
        withWebsiteCount: summary.websiteAvailable,
        contactFilteredCount: job.enriched ?? 0,
        websiteFilteredCount: job.audited ?? 0,
        finalDeliveredCount: frontendLeads.length,
        requestedLimit: job.requestedLeads,
      },
      discardedBreakdown: {
        noName: job.rejectionReasons.MISSING_NAME,
        outsideCity: job.rejectionReasons.OUTSIDE_LOCATION,
        duplicate: job.rejectionReasons.DUPLICATE,
        contactFilterExcluded: job.rejectionReasons.NO_CONTACT,
        websiteFilterExcluded: (job.rejectionReasons.NO_WEBSITE || 0) + (job.rejectionReasons.HAS_WEBSITE || 0) + (job.rejectionReasons.WEBSITE_FILTER_MISMATCH || 0) + (job.rejectionReasons.WEBSITE_UNREACHABLE || 0),
      },
      rejectionReasons: job.rejectionReasons,
      providers: {
        rapidapi: {
          status: job.providersReport?.rapidapi?.status || job.providerStats?.rapidapi?.status || (process.env.RAPIDAPI_MOCK_MODE === 'true' ? 'SUCCESS' : (process.env.RAPIDAPI_KEY ? 'SUCCESS' : 'NOT_CONFIGURED')),
          discovered: job.providersReport?.rapidapi?.discovered ?? job.providerStats?.rapidapi?.rawCount ?? 0,
          errors: job.providersReport?.rapidapi?.errors || job.providerStats?.rapidapi?.errors || [],
        },
        googlePlaces: {
          status: job.providersReport?.googlePlaces?.status || job.providerStats?.googlePlaces?.status || (process.env.GOOGLE_PLACES_ENABLED === 'true' ? (process.env.GOOGLE_PLACES_API_KEY ? 'SUCCESS' : 'NOT_CONFIGURED') : 'DISABLED'),
          discovered: job.providersReport?.googlePlaces?.discovered ?? job.providerStats?.googlePlaces?.rawCount ?? 0,
          pagesRequested: (job.providersReport?.googlePlaces as any)?.pagesRequested || (job.providerStats?.googlePlaces as any)?.pagesRequested || 0,
          errors: job.providersReport?.googlePlaces?.errors || job.providerStats?.googlePlaces?.errors || [],
        },
        osm: {
          status: job.providersReport?.osm?.status || job.providerStats?.osm?.status || (process.env.OSM_ENABLED === 'false' ? 'DISABLED' : (job.providerStats?.osm?.rawCount ? 'SUCCESS' : 'NOT_NEEDED')),
          discovered: job.providersReport?.osm?.discovered ?? job.providerStats?.osm?.rawCount ?? 0,
          errors: job.providersReport?.osm?.errors || job.providerStats?.osm?.errors || [],
        },
        webSearch: {
          status: job.providersReport?.webSearch?.status || job.providerStats?.webSearch?.status || 'NOT_NEEDED',
          discovered: job.providersReport?.webSearch?.discovered ?? job.providerStats?.webSearch?.rawCount ?? 0,
          errors: job.providersReport?.webSearch?.errors || job.providerStats?.webSearch?.errors || [],
        },
        directory: {
          status: (job.providersReport as any)?.directory?.status || (job.providerStats as any)?.directory?.status || 'NOT_NEEDED',
          discovered: (job.providersReport as any)?.directory?.discovered ?? (job.providerStats as any)?.directory?.rawCount ?? 0,
          errors: (job.providersReport as any)?.directory?.errors || (job.providerStats as any)?.directory?.errors || [],
        },
        ...(job.providersReport || {}),
      },

      mergedCount: job.mergedCount ?? job.deduplicated ?? 0,
      normalizedCount: job.pipelineBreakdown?.normalizedCount ?? job.normalizedCount ?? job.discovered ?? 0,
      locationVerifiedCount: job.pipelineBreakdown?.locationVerifiedCount ?? job.pipelineBreakdown?.inCityBoundsCount ?? job.locationVerifiedCount ?? 0,
      deduplicatedCount: job.pipelineBreakdown?.deduplicatedCount ?? job.deduplicatedCount ?? job.deduplicated ?? 0,
      phoneCount: job.phoneCount ?? summary.withPhone,
      emailCount: job.emailCount ?? summary.withEmail,
      phoneOrEmailCount: job.phoneOrEmailCount ?? summary.hasPhoneOrEmail,
      websiteDiscoveredCount: job.websiteDiscoveredCount ?? summary.websiteAvailable,
      websiteVerifiedCount: job.websiteVerifiedCount ?? summary.websiteAvailable,
      noWebsiteCount: job.noWebsiteCount ?? summary.noWebsite,
      enrichedCount: job.enrichedCount ?? job.enriched ?? 0,
      finalCount: job.finalCount ?? frontendLeads.length,
      rotationStats: job.rotationStats,
      pipelineBreakdown: job.pipelineBreakdown || {
        rawDiscoveredCount: job.discovered || 0,
        normalizedCount: job.normalizedCount ?? job.discovered ?? 0,
        locationCheckedCount: (job.locationVerifiedCount || 0) + (job.rejectionReasons?.OUTSIDE_LOCATION || 0) + (job.rejectionReasons?.UNKNOWN_LOCATION || 0),
        locationVerifiedCount: job.locationVerifiedCount || 0,
        inCityBoundsCount: job.locationVerifiedCount || 0,
        outsideLocationCount: job.rejectionReasons?.OUTSIDE_LOCATION || 0,
        unknownLocationCount: job.rejectionReasons?.UNKNOWN_LOCATION || 0,
        deduplicatedCount: job.deduplicated || 0,
        phoneCount: summary.withPhone,
        emailCount: summary.withEmail,
        phoneOrEmailCount: summary.hasPhoneOrEmail,
        websiteAvailableCount: summary.websiteAvailable,
        websiteUnavailableCount: summary.noWebsite,
        verifiedNoWebsiteCount: summary.noWebsite,
        websiteUnreachableCount: summary.unreachable,
        finalQualifiedCount: frontendLeads.length,
      },
      rejectedCandidates: job.rejectedCandidates || [],
      progressLog: job.progressLog,
      error: job.error,
    };
  }
}

export const searchService = new SearchService();
