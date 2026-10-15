import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/auth/sessionService';
import { prisma } from '@/lib/prisma';
import { SenderPoolService } from '@/lib/senders/senderPoolService';
import { OutreachSafetyGate } from '@/lib/outreach/outreachSafetyGate';
import { OutreachProviderFactory } from '@/lib/outreach/providers/providerFactory';
import { OutreachIdempotencyGuard } from '@/lib/outreach/outreachIdempotency';
import { SuppressionService } from '@/lib/outreach/suppressionService';

export async function POST(req: NextRequest) {
  try {
    const userId = await getAuthenticatedUserId();
    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized. Authentication session required.' },
        { status: 401 }
      );
    }

    // 1. Recalculate sender health, domain capacity, and global capacity
    const pool = await SenderPoolService.getSenderPool(userId);
    const availableCapacity = pool.totalCapacity;

    if (availableCapacity <= 0) {
      return NextResponse.json({
        success: false,
        error: `Daily application capacity limit reached (${pool.totalTodaySent}/${pool.capacityConfig.maxTotalDailyOutreach} sent today). Cannot dispatch next batch until daily reset (00:00 UTC) or until limit is increased by administrator.`,
        availableCapacity: 0,
      }, { status: 429 });
    }

    // 2. Fetch user's connected senders to verify ownership
    const userSenderIds = pool.senders.filter((s) => s.status === 'CONNECTED').map((s) => s.id);
    if (userSenderIds.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'No connected sender mailboxes available. Connect a Gmail/Workspace account first.',
      }, { status: 400 });
    }

    // 3. Find existing QUEUED records associated with user's senders or unassigned
    const queuedRecords = await prisma.outreach.findMany({
      where: {
        status: 'QUEUED',
        OR: [
          { senderAccountId: { in: userSenderIds } },
          { senderAccountId: null },
        ],
      },
      take: availableCapacity,
      orderBy: { createdAt: 'asc' },
    });

    if (queuedRecords.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No queued leads found awaiting delivery.',
        sentCount: 0,
        skippedCount: 0,
        failedCount: 0,
        remainingQueued: 0,
      });
    }

    // 4. Recalculate lead eligibility, suppression, duplicate status
    const eligibleRecords: typeof queuedRecords = [];
    let skippedCount = 0;

    for (const record of queuedRecords) {
      const evaluation = await OutreachSafetyGate.evaluateLead(record.businessId, record.recipient);
      if (!evaluation.eligible) {
        skippedCount++;
        await prisma.outreach.update({
          where: { id: record.id },
          data: {
            status: 'SKIPPED',
            errorCode: evaluation.skipReasonCode || 'INELIGIBLE',
            errorMessage: evaluation.skipReasonMessage || 'Lead became ineligible prior to dispatch.',
          },
        });
      } else {
        eligibleRecords.push(record);
      }
    }

    if (eligibleRecords.length === 0) {
      const remainingQueued = await prisma.outreach.count({
        where: {
          status: 'QUEUED',
          OR: [
            { senderAccountId: { in: userSenderIds } },
            { senderAccountId: null },
          ],
        },
      });

      return NextResponse.json({
        success: true,
        message: 'All checked queued leads were ineligible or suppressed.',
        sentCount: 0,
        skippedCount,
        failedCount: 0,
        remainingQueued,
      });
    }

    // 5. Deterministic sender allocation for eligible items
    const allocationResult = await SenderPoolService.allocateSendersForBatch(userId, eligibleRecords.length);
    const senderAssignmentQueue: Array<{ senderAccountId: string; senderEmail: string }> = [];
    for (const alloc of allocationResult.allocations) {
      for (let j = 0; j < alloc.capacityAllocated; j++) {
        senderAssignmentQueue.push({
          senderAccountId: alloc.senderAccountId,
          senderEmail: alloc.senderEmail,
        });
      }
    }

    const itemsToSend = eligibleRecords.slice(0, senderAssignmentQueue.length);
    const gmailProvider = OutreachProviderFactory.getGmailProvider();

    let sentCount = 0;
    let failedCount = 0;

    // 6. Bounded concurrency execution (concurrency: 2)
    const CONCURRENCY = 2;
    for (let i = 0; i < itemsToSend.length; i += CONCURRENCY) {
      const chunk = itemsToSend.slice(i, i + CONCURRENCY);

      await Promise.all(
        chunk.map(async (record, indexInChunk) => {
          const overallIndex = i + indexInChunk;
          const assigned = senderAssignmentQueue[overallIndex];
          const idempotencyKey = OutreachIdempotencyGuard.generateKey(record.businessId, 'EMAIL', record.recipient);

          // Mark SENDING
          await prisma.outreach.update({
            where: { id: record.id },
            data: {
              status: 'SENDING',
              senderAccountId: assigned.senderAccountId,
              provider: 'gmail',
            },
          });

          try {
            const sendResult = await gmailProvider.sendEmail({
              to: record.recipient,
              subject: record.subject,
              bodyText: record.message,
              businessName: '',
              leadId: record.businessId,
              idempotencyKey,
              senderAccountId: assigned.senderAccountId,
              userId,
            } as any);

            if (sendResult.success) {
              sentCount++;
              await prisma.outreach.update({
                where: { id: record.id },
                data: {
                  status: 'SENT',
                  gmailMessageId: sendResult.gmailMessageId,
                  gmailThreadId: sendResult.gmailThreadId,
                  providerMessageId: sendResult.gmailMessageId,
                  sentAt: new Date(),
                  errorCode: null,
                  errorMessage: null,
                },
              });
            } else {
              failedCount++;
              let errorCode = sendResult.errorCode || 'UNKNOWN';
              const errorMsg = sendResult.errorMessage || 'Gmail sending failed.';

              if (errorMsg.includes('Invalid To header') || errorMsg.includes('Recipient address rejected')) {
                errorCode = 'INVALID_RECIPIENT';
                await SuppressionService.suppressContact(record.recipient, 'EMAIL', 'INVALID', 'Gmail API Error');
              }

              await prisma.outreach.update({
                where: { id: record.id },
                data: {
                  status: 'FAILED',
                  errorCode,
                  errorMessage: errorMsg,
                  failedAt: new Date(),
                },
              });
            }
          } catch (err: any) {
            failedCount++;
            await prisma.outreach.update({
              where: { id: record.id },
              data: {
                status: 'FAILED',
                errorCode: 'GMAIL_NETWORK_ERROR',
                errorMessage: err.message,
                failedAt: new Date(),
              },
            });
          }
        })
      );
    }

    const remainingQueued = await prisma.outreach.count({
      where: {
        status: 'QUEUED',
        OR: [
          { senderAccountId: { in: userSenderIds } },
          { senderAccountId: null },
        ],
      },
    });

    const updatedPool = await SenderPoolService.getSenderPool(userId);

    return NextResponse.json({
      success: true,
      sentCount,
      failedCount,
      skippedCount,
      remainingQueued,
      availableCapacityRemaining: updatedPool.totalCapacity,
      message: `Batch dispatched: ${sentCount} sent, ${failedCount} failed, ${skippedCount} skipped. ${remainingQueued} remain in queue.`,
    });
  } catch (err: any) {
    console.error('[API /api/outreach/send-next-batch] Error:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Failed to dispatch next batch.' },
      { status: 500 }
    );
  }
}
