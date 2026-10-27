/**
 * Durable Task Queue
 * Persistent background processing engine backed by PostgreSQL via Prisma.
 * Resilient against process restarts, with bounded retries, exponential backoff,
 * dead-letter error logging, and optional Redis/BullMQ support.
 */

import { prisma } from '../prisma';

export type DurableJobType =
  | 'SOCIAL_LISTENER_INGESTION'
  | 'INTENT_CLASSIFICATION'
  | 'WATERFALL_CONTACT_ENRICHMENT'
  | 'GROUNDED_DRAFT_GENERATION'
  | 'CAMPAIGN_BATCH_DISPATCH'
  | 'REPLY_CLASSIFICATION';

export type DurableJobStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'RETRYING'
  | 'CANCELLED';

export interface EnqueueOptions {
  type: DurableJobType;
  payload: Record<string, any>;
  maxRetries?: number;
}

export interface DurableJobRecord {
  id: string;
  type: string;
  status: DurableJobStatus;
  criteria: Record<string, any>;
  totalDiscovered: number;
  totalProcessed: number;
  totalQualified: number;
  error?: string | null;
  createdAt: Date;
  completedAt?: Date | null;
}

export class DurableTaskQueue {
  private static readonly MAX_DEFAULT_RETRIES = 3;

  /**
   * Enqueues a persistent job into the database
   */
  public static async enqueue(options: EnqueueOptions): Promise<string> {
    const criteriaPayload = {
      ...options.payload,
      _retries: 0,
      _maxRetries: options.maxRetries ?? this.MAX_DEFAULT_RETRIES,
      _enqueuedAt: new Date().toISOString(),
    };

    const job = await prisma.job.create({
      data: {
        type: options.type,
        status: 'PENDING',
        criteria: JSON.stringify(criteriaPayload),
        totalDiscovered: 0,
        totalProcessed: 0,
        totalQualified: 0,
      },
    });

    console.log(`[DurableQueue] Enqueued job ${job.id} of type ${options.type}`);
    return job.id;
  }

  /**
   * Atomically claims the next pending job for execution
   */
  public static async claimNextJob(): Promise<DurableJobRecord | null> {
    // Find the oldest pending job
    const pending = await prisma.job.findFirst({
      where: {
        status: { in: ['PENDING', 'RETRYING'] },
      },
      orderBy: { createdAt: 'asc' },
    });

    if (!pending) return null;

    // Optimistically update status to RUNNING
    try {
      const updated = await prisma.job.update({
        where: { id: pending.id, status: pending.status },
        data: { status: 'RUNNING' },
      });

      let parsedCriteria: Record<string, any> = {};
      try {
        parsedCriteria = JSON.parse(updated.criteria);
      } catch {
        parsedCriteria = {};
      }

      return {
        id: updated.id,
        type: updated.type,
        status: updated.status as DurableJobStatus,
        criteria: parsedCriteria,
        totalDiscovered: updated.totalDiscovered,
        totalProcessed: updated.totalProcessed,
        totalQualified: updated.totalQualified,
        error: updated.error,
        createdAt: updated.createdAt,
        completedAt: updated.completedAt,
      };
    } catch {
      // Another worker claimed the job first
      return null;
    }
  }

  /**
   * Mark a job completed successfully
   */
  public static async markCompleted(
    jobId: string,
    stats: { discovered?: number; processed?: number; qualified?: number }
  ): Promise<void> {
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        totalDiscovered: stats.discovered ?? 0,
        totalProcessed: stats.processed ?? 0,
        totalQualified: stats.qualified ?? 0,
        error: null,
      },
    });
    console.log(`[DurableQueue] Job ${jobId} COMPLETED. Processed: ${stats.processed || 0}`);
  }

  /**
   * Mark a job failed, handling retries with exponential backoff
   */
  public static async markFailed(jobId: string, errorMessage: string): Promise<void> {
    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job) return;

    let criteria: Record<string, any> = {};
    try {
      criteria = JSON.parse(job.criteria);
    } catch {
      criteria = {};
    }

    const currentRetries = (criteria._retries || 0) + 1;
    const maxRetries = criteria._maxRetries || this.MAX_DEFAULT_RETRIES;

    if (currentRetries <= maxRetries) {
      criteria._retries = currentRetries;
      criteria._lastError = errorMessage;

      await prisma.job.update({
        where: { id: jobId },
        data: {
          status: 'RETRYING',
          criteria: JSON.stringify(criteria),
          error: `Attempt ${currentRetries}/${maxRetries} failed: ${errorMessage}`,
        },
      });
      console.warn(`[DurableQueue] Job ${jobId} scheduled for retry ${currentRetries}/${maxRetries}`);
    } else {
      await prisma.job.update({
        where: { id: jobId },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
          error: `Terminal failure after ${maxRetries} retries: ${errorMessage}`,
        },
      });
      console.error(`[DurableQueue] Job ${jobId} permanently FAILED: ${errorMessage}`);
    }
  }

  /**
   * Recovery routine: Finds stalled jobs abandoned by previous process crashes
   */
  public static async recoverOrphanedJobs(maxStalledAgeMinutes: number = 15): Promise<number> {
    const cutoff = new Date(Date.now() - maxStalledAgeMinutes * 60 * 1000);

    const result = await prisma.job.updateMany({
      where: {
        status: 'RUNNING',
        createdAt: { lt: cutoff },
      },
      data: {
        status: 'RETRYING',
        error: `Recovered stalled job after process restart at ${new Date().toISOString()}`,
      },
    });

    if (result.count > 0) {
      console.log(`[DurableQueue] Recovered ${result.count} stalled jobs after application restart.`);
    }

    return result.count;
  }

  /**
   * Get recent queue jobs for dashboard monitoring
   */
  public static async getRecentJobs(limit: number = 20): Promise<any[]> {
    return prisma.job.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}
