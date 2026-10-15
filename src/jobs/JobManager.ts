import { Job } from '@/models/Job';
import { SearchRequestPayload } from '@/types';
import { orchestrator } from '@/orchestrator/LeadPilotOrchestrator';
import { leadPilotDb } from '@/db';

export class JobManager {
  // In-flight request deduplication map (Section 18 & 54)
  private inFlightExecutions: Map<string, Promise<Job>> = new Map();

  /**
   * Generates a unique searchRequestKey for concurrent in-flight request deduplication.
   */
  public getSearchRequestKey(criteria: SearchRequestPayload): string {
    const norm = (s?: any) => String(s || '').toLowerCase().trim();
    return [
      norm(criteria.country || 'india'),
      norm(criteria.state),
      norm(criteria.city || 'all'),
      norm(criteria.industry),
      norm(criteria.contactFilter || 'all_contacts'),
      norm(criteria.websiteFilter || 'any_website'),
      norm(criteria.minRating || 'none'),
      norm(criteria.minReviews || 'none'),
      norm(criteria.excludePerfectRating || 'false'),
      norm(criteria.requirePositiveReviewEvidence || 'false'),
      norm(criteria.reviewSort || 'default'),
      norm(criteria.limit || 50),
    ].join(':');
  }

  /**
   * Dispatches a new search job asynchronously and returns immediately.
   */
  public async dispatchJob(criteria: SearchRequestPayload): Promise<Job> {
    const requestKey = this.getSearchRequestKey(criteria);

    // If an identical job is actively running in-flight, return the existing job record
    const existingPromise = this.inFlightExecutions.get(requestKey);
    if (existingPromise) {
      const activeJobs = leadPilotDb.listJobs();
      const match = activeJobs.find(
        (j) => j.status === 'RUNNING' && this.getSearchRequestKey(j.criteria) === requestKey
      );
      if (match) return match;
    }

    const job = orchestrator.createJob(criteria);

    // Fire execution asynchronously without blocking the caller
    const executionPromise = (async () => {
      try {
        return await orchestrator.executeJob(job.id);
      } catch (err) {
        console.error(`[JobManager] Error executing job ${job.id}:`, err);
        throw err;
      } finally {
        this.inFlightExecutions.delete(requestKey);
      }
    })();

    this.inFlightExecutions.set(requestKey, executionPromise);

    return job;
  }

  /**
   * Executes a job synchronously to completion.
   * If an identical query is already executing, attaches to the in-flight promise (Request Deduplication).
   */
  public async executeJobSync(criteria: SearchRequestPayload): Promise<Job> {
    const requestKey = this.getSearchRequestKey(criteria);

    // Section 18 & 54: In-flight request deduplication
    const existing = this.inFlightExecutions.get(requestKey);
    if (existing) {
      return await existing;
    }

    const job = orchestrator.createJob(criteria);

    const execPromise = (async () => {
      try {
        return await orchestrator.executeJob(job.id);
      } finally {
        this.inFlightExecutions.delete(requestKey);
      }
    })();

    this.inFlightExecutions.set(requestKey, execPromise);
    return await execPromise;
  }

  public getInFlightPromise(criteria: SearchRequestPayload): Promise<Job> | undefined {
    const requestKey = this.getSearchRequestKey(criteria);
    return this.inFlightExecutions.get(requestKey);
  }

  public getJob(jobId: string): Job | undefined {
    return leadPilotDb.getJob(jobId);
  }

  public async getJobAsync(jobId: string): Promise<Job | undefined> {
    return leadPilotDb.getJobAsync(jobId);
  }

  public getProgress(jobId: string) {
    const job = leadPilotDb.getJob(jobId);
    if (!job) return null;
    return {
      jobId: job.id,
      status: job.status,
      sourceStatus: job.sourceStatus,
      progressLog: job.progressLog,
      counters: {
        discovered: job.discovered,
        verified: job.verified,
        deduplicated: job.deduplicated,
        enriched: job.enriched,
        audited: job.audited,
        qualified: job.qualified,
        completed: job.completed,
      },
      rejectionReasons: job.rejectionReasons,
      error: job.error,
    };
  }

  public async getProgressAsync(jobId: string) {
    const job = await leadPilotDb.getJobAsync(jobId);
    if (!job) return null;
    return {
      jobId: job.id,
      status: job.status,
      sourceStatus: job.sourceStatus,
      progressLog: job.progressLog,
      counters: {
        discovered: job.discovered,
        verified: job.verified,
        deduplicated: job.deduplicated,
        enriched: job.enriched,
        audited: job.audited,
        qualified: job.qualified,
        completed: job.completed,
      },
      rejectionReasons: job.rejectionReasons,
      error: job.error,
    };
  }

  public resumeJob(jobId: string): Promise<Job> {
    return orchestrator.resumeJob(jobId);
  }
}

export const jobManager = new JobManager();
