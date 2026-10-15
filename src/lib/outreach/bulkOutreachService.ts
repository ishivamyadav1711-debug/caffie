/**
 * LeadPilot — Bulk AI Outreach Service
 *
 * Implements Phase 2 Multi-Sender Company Outreach Review & Controlled Execution:
 * - Evidence-based individual AI personalization via AIPersonalizedOutreachService
 * - Safety gate enforcement (suppression, duplicates, email validation)
 * - Controlled multi-sender pool allocation adhering to per-sender and domain safety limits
 * - Explicit review modal support: READY vs QUEUED vs SKIPPED
 * - Bounded concurrency execution via GmailEmailProvider (no Resend/SendGrid fallback)
 * - Zero automatic sending without explicit user approval
 */
import { prisma } from '@/lib/prisma';
import { AIPersonalizedOutreachService } from '@/lib/ai/aiPersonalizedOutreach';
import { OutreachSafetyGate, SkipReasonCode } from './outreachSafetyGate';
import { SenderPoolService } from '@/lib/senders/senderPoolService';
import { SenderAllocationEngine, SenderAllocationPlan } from '@/lib/senders/senderAllocationEngine';
import { OutreachProviderFactory } from './providers/providerFactory';
import { OutreachIdempotencyGuard } from './outreachIdempotency';
import { SuppressionService } from './suppressionService';

export interface BulkOutreachLeadItem {
  leadId: string;
  businessName: string;
  recipientEmail: string;
  senderAccountId?: string;
  senderEmail?: string;
  subject: string;
  bodyText: string;
  bodyHtml: string;
  evidenceUsed: string[];
  status: 'READY' | 'QUEUED' | 'SKIPPED';
  skipReasonCode?: SkipReasonCode | 'CAPACITY_EXCEEDED';
  skipReasonMessage?: string;
}

export interface BulkPreparationResult {
  totalSelected: number;
  readyCount: number;
  queuedCount: number;
  skippedCount: number;
  senderPoolSummary: {
    connectedSendersCount: number;
    totalAvailableCapacity: number;
    totalTodaySent: number;
    domainConsistencyNotice: string;
    targetDailyCapacity: number;
    maxTotalDailyOutreach: number;
  };
  allocationPlan?: SenderAllocationPlan;
  items: BulkOutreachLeadItem[];
}

export interface BulkSendItemInput {
  leadId: string;
  recipientEmail: string;
  senderAccountId: string;
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  evidenceUsed?: string[];
  status: 'READY' | 'QUEUED';
}

export interface SendExecutionOutcome {
  leadId: string;
  recipientEmail: string;
  senderAccountId?: string;
  senderEmail?: string;
  status: 'SENT' | 'QUEUED' | 'FAILED' | 'SKIPPED' | 'BOUNCED';
  outreachId?: string;
  gmailMessageId?: string;
  gmailThreadId?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface BulkExecutionResult {
  totalProcessed: number;
  sentCount: number;
  queuedCount: number;
  failedCount: number;
  bouncedCount?: number;
  skippedCount?: number;
  outcomes: SendExecutionOutcome[];
}

export class BulkOutreachService {
  /**
   * Prepares bulk AI outreach for review:
   * 1. Evaluates safety gate for each lead with batch deduplication (1 email / unique business).
   * 2. Generates personalized AI message for eligible leads based on real evidence.
   * 3. Allocates available senders using dynamic SenderAllocationEngine.
   * 4. Excess leads are marked QUEUED.
   * DOES NOT SEND ANY EMAILS.
   */
  static async prepareBulkOutreach(
    userId: string,
    leadIds: string[]
  ): Promise<BulkPreparationResult> {
    const pool = await SenderPoolService.getSenderPool(userId);
    const availableCapacity = pool.totalCapacity;

    const items: BulkOutreachLeadItem[] = [];
    const eligibleForGeneration: Array<{ leadId: string; businessName: string; email: string }> = [];
    const seenBusinessIds = new Set<string>();
    const seenRecipientEmails = new Set<string>();

    type PreEvaluation =
      | { eligible: false; leadId: string; businessName: string; recipientEmail: string; skipReasonCode: SkipReasonCode; skipReasonMessage: string }
      | { eligible: true; leadId: string; businessName: string; email: string };

    const preEvals: PreEvaluation[] = [];

    // Step 1: Pre-evaluate safety gate for all leads with 500 Unique Business enforcement
    for (const leadId of leadIds) {
      if (seenBusinessIds.has(leadId)) {
        preEvals.push({
          eligible: false,
          leadId,
          businessName: 'Business',
          recipientEmail: 'N/A',
          skipReasonCode: 'DUPLICATE_BUSINESS_IN_BATCH',
          skipReasonMessage: 'Duplicate business in batch. Only one initial outreach per unique business allowed.',
        });
        continue;
      }
      seenBusinessIds.add(leadId);

      const evaluation = await OutreachSafetyGate.evaluateLead(leadId);
      if (!evaluation.eligible) {
        preEvals.push({
          eligible: false,
          leadId,
          businessName: evaluation.businessName || 'Business',
          recipientEmail: evaluation.recipientEmail || 'N/A',
          skipReasonCode: evaluation.skipReasonCode || 'MISSING_EMAIL',
          skipReasonMessage: evaluation.skipReasonMessage || 'Lead failed safety check.',
        });
      } else {
        const cleanEmail = evaluation.recipientEmail!.toLowerCase();
        if (seenRecipientEmails.has(cleanEmail)) {
          preEvals.push({
            eligible: false,
            leadId,
            businessName: evaluation.businessName || 'Business',
            recipientEmail: cleanEmail,
            skipReasonCode: 'DUPLICATE_RECIPIENT_IN_BATCH',
            skipReasonMessage: `Duplicate recipient (${cleanEmail}) in batch. Lead skipped to protect recipient.`,
          });
          continue;
        }
        seenRecipientEmails.add(cleanEmail);

        preEvals.push({
          eligible: true,
          leadId,
          businessName: evaluation.businessName!,
          email: cleanEmail,
        });

        eligibleForGeneration.push({
          leadId,
          businessName: evaluation.businessName!,
          email: cleanEmail,
        });
      }
    }

    // Step 2: Bounded concurrent AI message generation for eligible leads (concurrency 3)
    const generatedMap = new Map<string, any>();
    const CHUNK_SIZE = 3;
    for (let i = 0; i < eligibleForGeneration.length; i += CHUNK_SIZE) {
      const chunk = eligibleForGeneration.slice(i, i + CHUNK_SIZE);
      const results = await Promise.all(
        chunk.map((c) => AIPersonalizedOutreachService.generate(c.leadId))
      );
      results.forEach((res, index) => {
        generatedMap.set(chunk[index].leadId, res);
      });
    }

    // Step 3: Dynamic sender allocation engine (prefers healthy senders, redistributes unallocated load)
    const allocationPlan = await SenderAllocationEngine.planAllocation(
      userId,
      eligibleForGeneration.length
    );

    // Flatten allocations into a queue of sender accounts
    const senderAssignmentQueue: Array<{ senderAccountId: string; senderEmail: string }> = [];
    for (const alloc of allocationPlan.allocations) {
      for (let j = 0; j < alloc.capacityAllocated; j++) {
        senderAssignmentQueue.push({
          senderAccountId: alloc.senderAccountId,
          senderEmail: alloc.senderEmail,
        });
      }
    }

    // Assign senders to leads preserving original input ordering
    for (const pre of preEvals) {
      if (!pre.eligible) {
        items.push({
          leadId: pre.leadId,
          businessName: pre.businessName,
          recipientEmail: pre.recipientEmail,
          subject: '',
          bodyText: '',
          bodyHtml: '',
          evidenceUsed: [],
          status: 'SKIPPED',
          skipReasonCode: pre.skipReasonCode,
          skipReasonMessage: pre.skipReasonMessage,
        });
      } else {
        const gen = generatedMap.get(pre.leadId);
        const subject = gen?.subject || `Partnership Opportunity for ${pre.businessName}`;
        const bodyText = gen?.bodyText || '';
        const bodyHtml = gen?.bodyHtml || '';
        const evidenceUsed = gen?.evidenceUsed || [];

        if (senderAssignmentQueue.length > 0) {
          const assignedSender = senderAssignmentQueue.shift()!;
          items.push({
            leadId: pre.leadId,
            businessName: pre.businessName,
            recipientEmail: pre.email,
            senderAccountId: assignedSender.senderAccountId,
            senderEmail: assignedSender.senderEmail,
            subject,
            bodyText,
            bodyHtml,
            evidenceUsed,
            status: 'READY',
          });
        } else {
          // Capacity exceeded — queue for next delivery window
          items.push({
            leadId: pre.leadId,
            businessName: pre.businessName,
            recipientEmail: pre.email,
            subject,
            bodyText,
            bodyHtml,
            evidenceUsed,
            status: 'QUEUED',
            skipReasonCode: 'CAPACITY_EXCEEDED',
            skipReasonMessage: `Sender pool capacity reached for today (${availableCapacity} available). Queued for controlled dispatch.`,
          });
        }
      }
    }

    const readyCount = items.filter((i) => i.status === 'READY').length;
    const queuedCount = items.filter((i) => i.status === 'QUEUED').length;
    const skippedCount = items.filter((i) => i.status === 'SKIPPED').length;

    return {
      totalSelected: leadIds.length,
      readyCount,
      queuedCount,
      skippedCount,
      senderPoolSummary: {
        connectedSendersCount: pool.connectedCount,
        totalAvailableCapacity: pool.totalCapacity,
        totalTodaySent: pool.totalTodaySent,
        domainConsistencyNotice: pool.domainConsistency.notice,
        targetDailyCapacity: pool.capacityConfig.targetDailyCapacity,
        maxTotalDailyOutreach: pool.capacityConfig.maxTotalDailyOutreach,
      },
      allocationPlan,
      items,
    };
  }

  /**
   * Executes approved sending for a batch of items with bounded concurrency.
   * MUST be explicitly invoked after user review.
   */
  static async executeControlledSend(
    userId: string,
    approvedItems: BulkSendItemInput[]
  ): Promise<BulkExecutionResult> {
    const outcomes: SendExecutionOutcome[] = [];
    const gmailProvider = OutreachProviderFactory.getGmailProvider();

    // Verify sender ownership beforehand
    const userSenders = await prisma.senderAccount.findMany({
      where: { userId },
      select: {
        id: true,
        email: true,
        status: true,
        tokenExpiry: true,
        refreshToken: true,
        lastError: true,
      },
    });
    const senderMap = new Map(userSenders.map((s) => [s.id, s]));

    // Separate READY from QUEUED
    const readyItems = approvedItems.filter((i) => i.status === 'READY');
    const queuedItems = approvedItems.filter((i) => i.status === 'QUEUED');

    // 1. Process QUEUED items: Persist as QUEUED in database without transmitting
    for (const item of queuedItems) {
      try {
        const record = await prisma.outreach.create({
          data: {
            businessId: item.leadId,
            channel: 'EMAIL',
            recipient: item.recipientEmail,
            subject: item.subject,
            message: item.bodyText,
            status: 'QUEUED',
            provider: 'gmail',
            evidenceUsed: JSON.stringify(item.evidenceUsed || []),
            senderAccountId: item.senderAccountId || null,
          },
        });
        outcomes.push({
          leadId: item.leadId,
          recipientEmail: item.recipientEmail,
          senderAccountId: item.senderAccountId,
          status: 'QUEUED',
          outreachId: record.id,
        });
      } catch (err: any) {
        outcomes.push({
          leadId: item.leadId,
          recipientEmail: item.recipientEmail,
          status: 'FAILED',
          errorCode: 'DB_ERROR',
          errorMessage: err.message,
        });
      }
    }

    // 2. Process READY items with bounded concurrency (concurrency 2 to respect Gmail rate limits)
    const CONCURRENCY = 2;
    for (let i = 0; i < readyItems.length; i += CONCURRENCY) {
      const chunk = readyItems.slice(i, i + CONCURRENCY);

      const chunkResults = await Promise.all(
        chunk.map(async (item) => {
          const sender = senderMap.get(item.senderAccountId);

          // Phase 5: Sender Ownership, Authorization & Health Validation at send time
          if (!sender) {
            return {
              leadId: item.leadId,
              recipientEmail: item.recipientEmail,
              status: 'FAILED' as const,
              errorCode: 'SENDER_NOT_AUTHORIZED',
              errorMessage: 'Sender account does not belong to the authenticated user.',
            };
          }

          if (sender.status !== 'CONNECTED') {
            return {
              leadId: item.leadId,
              recipientEmail: item.recipientEmail,
              senderAccountId: sender.id,
              senderEmail: sender.email,
              status: 'FAILED' as const,
              errorCode: 'AUTH_ERROR',
              errorMessage: `Sender account status is ${sender.status}. Re-authorize Gmail.`,
            };
          }

          if (sender.tokenExpiry && sender.tokenExpiry < new Date() && !sender.refreshToken) {
            return {
              leadId: item.leadId,
              recipientEmail: item.recipientEmail,
              senderAccountId: sender.id,
              senderEmail: sender.email,
              status: 'FAILED' as const,
              errorCode: 'AUTH_ERROR',
              errorMessage: 'Sender token is expired and no refresh token is available. Re-authorize Gmail.',
            };
          }

          if (sender.lastError?.includes('403') || sender.lastError?.includes('invalid_grant')) {
            return {
              leadId: item.leadId,
              recipientEmail: item.recipientEmail,
              senderAccountId: sender.id,
              senderEmail: sender.email,
              status: 'FAILED' as const,
              errorCode: 'SENDER_PAUSED',
              errorMessage: `Sender account has persistent authorization error (${sender.lastError}). Re-authorization required.`,
            };
          }

          // Phase 2: Final Pre-Send Server-Side Suppression Revalidation immediately before dispatch
          const suppression = await SuppressionService.isSuppressed(item.recipientEmail, 'EMAIL');
          if (suppression.isSuppressed) {
            return {
              leadId: item.leadId,
              recipientEmail: item.recipientEmail,
              senderAccountId: sender.id,
              senderEmail: sender.email,
              status: 'SKIPPED' as const,
              errorCode: 'RECIPIENT_SUPPRESSED',
              errorMessage: `Recipient is suppressed (${suppression.reason || 'Suppression List'}). Send aborted.`,
            };
          }

          const previousBounce = await prisma.outreach.findFirst({
            where: {
              recipient: item.recipientEmail.toLowerCase(),
              status: 'BOUNCED',
            },
          });
          if (previousBounce) {
            return {
              leadId: item.leadId,
              recipientEmail: item.recipientEmail,
              senderAccountId: sender.id,
              senderEmail: sender.email,
              status: 'SKIPPED' as const,
              errorCode: 'RECIPIENT_SUPPRESSED',
              errorMessage: 'Recipient has a prior permanent delivery failure on record. Send aborted.',
            };
          }

          // Phase 6: Concurrency and Idempotency Guard (In-memory + DB cross-instance claim)
          const idempotencyKey = OutreachIdempotencyGuard.generateKey(item.leadId, 'EMAIL', item.recipientEmail);
          if (!OutreachIdempotencyGuard.acquireLock(idempotencyKey)) {
            return {
              leadId: item.leadId,
              recipientEmail: item.recipientEmail,
              senderAccountId: sender.id,
              senderEmail: sender.email,
              status: 'SKIPPED' as const,
              errorCode: 'IN_FLIGHT_SENDING',
              errorMessage: 'Outreach sending is currently in-flight for this recipient.',
            };
          }

          try {
            // Duplicate check safeguard (prevents double-click races)
            const dup = await OutreachIdempotencyGuard.checkDuplicate(item.leadId, 'EMAIL', item.recipientEmail, 7);
            if (dup.hasDuplicate) {
              return {
                leadId: item.leadId,
                recipientEmail: item.recipientEmail,
                senderAccountId: sender.id,
                senderEmail: sender.email,
                status: 'SKIPPED' as const,
                errorCode: 'ALREADY_CONTACTED',
                errorMessage: dup.reason || 'Lead was already contacted recently.',
              };
            }

            // Create PENDING Outreach record
            let outreachRecord;
            try {
              outreachRecord = await prisma.outreach.create({
                data: {
                  businessId: item.leadId,
                  channel: 'EMAIL',
                  recipient: item.recipientEmail,
                  subject: item.subject,
                  message: item.bodyText,
                  status: 'SENDING',
                  provider: 'gmail',
                  senderAccountId: sender.id,
                  evidenceUsed: JSON.stringify(item.evidenceUsed || []),
                  excelSyncStatus: 'PENDING',
                },
              });
            } catch (err: any) {
              return {
                leadId: item.leadId,
                recipientEmail: item.recipientEmail,
                status: 'FAILED' as const,
                errorCode: 'DB_ERROR',
                errorMessage: err.message,
              };
            }

            // Cross-instance concurrency verification: check if another worker also claimed this recipient concurrently
            const concurrentInFlight = await prisma.outreach.findFirst({
              where: {
                id: { not: outreachRecord.id },
                businessId: item.leadId,
                channel: 'EMAIL',
                recipient: item.recipientEmail,
                status: { in: ['SENDING', 'SENT'] },
                createdAt: { gte: new Date(Date.now() - 60 * 1000) },
              },
            });
            if (concurrentInFlight) {
              await prisma.outreach.delete({ where: { id: outreachRecord.id } }).catch(() => {});
              return {
                leadId: item.leadId,
                recipientEmail: item.recipientEmail,
                senderAccountId: sender.id,
                senderEmail: sender.email,
                status: 'SKIPPED' as const,
                errorCode: 'ALREADY_CONTACTED',
                errorMessage: 'Concurrent worker already claimed this recipient.',
              };
            }

            // Transmit via Gmail API using GmailProvider exclusively
            try {
              const sendResult = await gmailProvider.sendEmail({
                to: item.recipientEmail,
                subject: item.subject,
                bodyText: item.bodyText,
                bodyHtml: item.bodyHtml,
                businessName: '',
                leadId: item.leadId,
                idempotencyKey,
                senderAccountId: sender.id,
                userId,
              } as any);

              if (sendResult.success) {
                const now = new Date();
                await prisma.outreach.update({
                  where: { id: outreachRecord.id },
                  data: {
                    status: 'SENT',
                    provider: 'gmail',
                    providerMessageId: sendResult.providerMessageId || sendResult.gmailMessageId,
                    gmailMessageId: sendResult.gmailMessageId,
                    gmailThreadId: sendResult.gmailThreadId,
                    sentAt: now,
                    excelSyncStatus: 'SYNCED',
                  },
                });

                return {
                  leadId: item.leadId,
                  recipientEmail: item.recipientEmail,
                  senderAccountId: sender.id,
                  senderEmail: sender.email,
                  status: 'SENT' as const,
                  outreachId: outreachRecord.id,
                  gmailMessageId: sendResult.gmailMessageId,
                  gmailThreadId: sendResult.gmailThreadId,
                };
              } else {
                // Classify failure
                let errorCode = sendResult.errorCode || 'UNKNOWN';
                const errorMsg = sendResult.errorMessage || 'Gmail sending failed.';
                let outcomeStatus: 'FAILED' | 'BOUNCED' = 'FAILED';

                if (errorMsg.includes('401') || errorMsg.includes('403') || errorMsg.includes('invalid_grant')) {
                  errorCode = 'AUTH_ERROR';
                } else if (errorMsg.includes('429') || errorMsg.includes('quota') || errorMsg.includes('rateLimitExceeded') || errorCode === 'RATE_LIMIT_EXCEEDED') {
                  errorCode = 'RATE_LIMIT';
                } else if (errorMsg.includes('500') || errorMsg.includes('503') || errorMsg.includes('backendError')) {
                  errorCode = 'TEMPORARY_GMAIL_ERROR';
                } else if (
                  errorMsg.includes('Invalid To header') ||
                  errorMsg.includes('Recipient address rejected') ||
                  errorMsg.includes('550') ||
                  errorMsg.toLowerCase().includes('user unknown') ||
                  errorMsg.toLowerCase().includes('no such user') ||
                  errorMsg.toLowerCase().includes('mailbox unavailable')
                ) {
                  errorCode = 'PERMANENT_BOUNCE';
                  outcomeStatus = 'BOUNCED';
                  // Immediately suppress recipient across all future campaigns
                  await SuppressionService.suppressContact(item.recipientEmail, 'EMAIL', 'BOUNCED', 'Gmail Permanent Delivery Rejection');
                }

                await prisma.outreach.update({
                  where: { id: outreachRecord.id },
                  data: {
                    status: outcomeStatus,
                    errorCode,
                    errorMessage: errorMsg,
                    failedAt: new Date(),
                  },
                });

                return {
                  leadId: item.leadId,
                  recipientEmail: item.recipientEmail,
                  senderAccountId: sender.id,
                  senderEmail: sender.email,
                  status: outcomeStatus,
                  outreachId: outreachRecord.id,
                  errorCode,
                  errorMessage: errorMsg,
                };
              }
            } catch (err: any) {
              await prisma.outreach.update({
                where: { id: outreachRecord.id },
                data: {
                  status: 'FAILED',
                  errorCode: 'GMAIL_NETWORK_ERROR',
                  errorMessage: err.message,
                  failedAt: new Date(),
                },
              });

              return {
                leadId: item.leadId,
                recipientEmail: item.recipientEmail,
                senderAccountId: sender.id,
                senderEmail: sender.email,
                status: 'FAILED' as const,
                outreachId: outreachRecord.id,
                errorCode: 'GMAIL_NETWORK_ERROR',
                errorMessage: err.message,
              };
            }
          } finally {
            OutreachIdempotencyGuard.releaseLock(idempotencyKey);
          }
        })
      );

      outcomes.push(...chunkResults);

      // Phase 3: Inter-batch pacing delay between chunks (no delay after final chunk)
      if (i + CONCURRENCY < readyItems.length) {
        const interBatchDelayMs = parseInt(process.env.OUTREACH_INTER_BATCH_DELAY_MS || '1500', 10);
        if (interBatchDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, interBatchDelayMs));
        }
      }
    }

    const sentCount = outcomes.filter((o) => o.status === 'SENT').length;
    const queuedCount = outcomes.filter((o) => o.status === 'QUEUED').length;
    const failedCount = outcomes.filter((o) => o.status === 'FAILED').length;
    const bouncedCount = outcomes.filter((o) => o.status === 'BOUNCED').length;
    const skippedCount = outcomes.filter((o) => o.status === 'SKIPPED').length;

    return {
      totalProcessed: outcomes.length,
      sentCount,
      queuedCount,
      failedCount,
      bouncedCount,
      skippedCount,
      outcomes,
    };
  }
}
