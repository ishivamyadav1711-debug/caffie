import { LeadEntity } from '@/models/Lead';
import { Job, ActorRun } from '@/models/Job';

export interface CacheEntry<T = any> {
  key: string;
  data: T;
  expiresAt: number; // unix timestamp in ms
}

class LeadPilotDatabase {
  private leadsMap: Map<string, LeadEntity> = new Map();
  private jobsMap: Map<string, Job> = new Map();
  private actorRunsMap: Map<string, ActorRun> = new Map();
  private cacheMap: Map<string, CacheEntry> = new Map();

  // --- Leads Operations ---
  public upsertLead(lead: LeadEntity): LeadEntity {
    if (lead.isMock) {
      return lead; // Do not store synthetic mock demo leads into persistent production tables
    }
    lead.updatedAt = new Date().toISOString();
    this.leadsMap.set(lead.leadId, lead);
    return lead;
  }

  public upsertLeadsBatch(leads: LeadEntity[]): void {
    for (const lead of leads) {
      if (lead.isMock) continue; // Do not store synthetic mock demo leads into persistent production tables
      lead.updatedAt = new Date().toISOString();
      this.leadsMap.set(lead.leadId, lead);
    }
  }

  public getLead(leadId: string): LeadEntity | undefined {
    return this.leadsMap.get(leadId);
  }

  public getAllLeads(): LeadEntity[] {
    return Array.from(this.leadsMap.values()).filter((l) => !l.isMock);
  }

  /**
   * Section 12 & 26: Finds previously discovered and verified businesses for the location & industry.
   * Enables persistent data reuse without calling external APIs repeatedly.
   */
  public findLeadsByLocationAndIndustry(params: {
    state: string;
    city?: string;
    industry: string;
  }): LeadEntity[] {
    const norm = (s?: string) => (s || '').toLowerCase().trim();
    const targetState = norm(params.state);
    const targetCity = params.city ? norm(params.city) : '';
    const targetInd = norm(params.industry);

    return Array.from(this.leadsMap.values()).filter((lead) => {
      if (lead.isMock) return false; // Synthetic mock demo leads must never be served as real leads
      const lState = norm(lead.state);
      const lCity = norm(lead.city);
      const lInd = norm(lead.industry || lead.category);

      const stateMatch = lState === targetState || lState.includes(targetState) || targetState.includes(lState);
      const cityMatch = !targetCity || lCity === targetCity || lCity.includes(targetCity) || targetCity.includes(lCity);
      const indMatch = lInd === targetInd || lInd.includes(targetInd) || targetInd.includes(lInd);

      return stateMatch && cityMatch && indMatch;
    });
  }

  // --- Jobs Operations ---
  public async persistJobToDb(job: Job): Promise<void> {
    try {
      const { prisma } = await import('@/lib/prisma');
      const serialized = JSON.stringify({
        job,
        progressLog: job.progressLog,
        rejectionReasons: job.rejectionReasons,
        sourceStatus: job.sourceStatus,
        statusReason: job.statusReason,
        pipelineBreakdown: job.pipelineBreakdown,
        providerStats: job.providerStats,
        providersReport: job.providersReport,
        rotationStats: job.rotationStats,
        rejectedCandidates: job.rejectedCandidates,
        leads: job.leads,
      });

      await prisma.job.upsert({
        where: { id: job.id },
        update: {
          status: job.status,
          totalDiscovered: job.discovered,
          totalProcessed: job.verified,
          totalQualified: job.qualified,
          error: serialized,
          completedAt: job.completedAt ? new Date(job.completedAt) : null,
        },
        create: {
          id: job.id,
          type: 'LEAD_SEARCH',
          status: job.status,
          criteria: JSON.stringify(job.criteria),
          totalDiscovered: job.discovered,
          totalProcessed: job.verified,
          totalQualified: job.qualified,
          error: serialized,
          createdAt: new Date(job.startedAt || Date.now()),
          completedAt: job.completedAt ? new Date(job.completedAt) : null,
        },
      });
    } catch (err) {
      console.warn('[LeadPilotDb] Failed to persist job to PostgreSQL:', err);
    }
  }

  public createJob(job: Job): Job {
    this.jobsMap.set(job.id, job);
    this.persistJobToDb(job).catch(() => {});
    return job;
  }

  public updateJob(jobId: string, updates: Partial<Job>): Job | undefined {
    const existing = this.jobsMap.get(jobId);
    if (!existing) return undefined;
    const updated = { ...existing, ...updates };
    this.jobsMap.set(jobId, updated);
    this.persistJobToDb(updated).catch(() => {});
    return updated;
  }

  public getJob(jobId: string): Job | undefined {
    return this.jobsMap.get(jobId);
  }

  public async getJobAsync(jobId: string): Promise<Job | undefined> {
    const memoryJob = this.jobsMap.get(jobId);
    if (memoryJob) return memoryJob;

    try {
      const { prisma } = await import('@/lib/prisma');
      const dbJob = await prisma.job.findUnique({
        where: { id: jobId },
      });

      if (!dbJob) return undefined;

      let criteria: any = {};
      try {
        criteria = JSON.parse(dbJob.criteria);
      } catch {}

      let extra: any = {};
      if (dbJob.error) {
        try {
          extra = JSON.parse(dbJob.error);
        } catch {}
      }

      const hydratedJob: Job = extra.job || {
        id: dbJob.id,
        searchId: dbJob.id,
        status: dbJob.status as any,
        criteria,
        requestedLeads: criteria.limit || 25,
        discovered: dbJob.totalDiscovered,
        verified: dbJob.totalProcessed,
        deduplicated: dbJob.totalProcessed,
        enriched: dbJob.totalQualified,
        audited: dbJob.totalQualified,
        qualified: dbJob.totalQualified,
        completed: dbJob.totalQualified,
        failed: 0,
        sourceStatus: extra.sourceStatus || 'COMPLETE',
        sourceComplete: true,
        statusReason: extra.statusReason,
        rejectionReasons: extra.rejectionReasons || {
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
        },
        progressLog: extra.progressLog || [],
        leads: extra.leads || [],
        providerStats: extra.providerStats,
        providersReport: extra.providersReport,
        pipelineBreakdown: extra.pipelineBreakdown,
        rotationStats: extra.rotationStats,
        rejectedCandidates: extra.rejectedCandidates || [],
        startedAt: dbJob.createdAt.toISOString(),
        completedAt: dbJob.completedAt ? dbJob.completedAt.toISOString() : undefined,
      };

      this.jobsMap.set(hydratedJob.id, hydratedJob);
      return hydratedJob;
    } catch (err) {
      console.warn('[LeadPilotDb] Failed to fetch job from PostgreSQL:', err);
      return undefined;
    }
  }

  public listJobs(): Job[] {
    return Array.from(this.jobsMap.values()).sort(
      (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    );
  }

  // --- ActorRuns Operations ---
  public createActorRun(run: ActorRun): ActorRun {
    this.actorRunsMap.set(run.id, run);
    return run;
  }

  public updateActorRun(runId: string, updates: Partial<ActorRun>): ActorRun | undefined {
    const existing = this.actorRunsMap.get(runId);
    if (!existing) return undefined;
    const updated = { ...existing, ...updates };
    this.actorRunsMap.set(runId, updated);
    return updated;
  }

  public getActorRunsByJob(jobId: string): ActorRun[] {
    return Array.from(this.actorRunsMap.values()).filter((r) => r.jobId === jobId);
  }

  // --- Caching Operations ---
  public getCache<T = any>(key: string): T | null {
    const entry = this.cacheMap.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cacheMap.delete(key);
      return null;
    }
    return entry.data as T;
  }

  public setCache<T = any>(key: string, data: T, ttlMs: number = 3600000): void {
    this.cacheMap.set(key, {
      key,
      data,
      expiresAt: Date.now() + ttlMs,
    });
  }

  public clearExpiredCache(): void {
    const now = Date.now();
    for (const [k, v] of this.cacheMap.entries()) {
      if (now > v.expiresAt) {
        this.cacheMap.delete(k);
      }
    }
  }
}

export const leadPilotDb = new LeadPilotDatabase();
