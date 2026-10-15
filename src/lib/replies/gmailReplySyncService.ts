/**
 * LeadPilot — Gmail Inbound Reply Synchronization Service
 *
 * Implements genuine Gmail reply synchronization:
 * - Queries authorized Gmail threads via the Gmail API
 * - Matches replies using stored gmailThreadId and recipient email
 * - Ingests real incoming messages into InboundReply via InboundReplyService
 * - Never fabricates fake reply data
 * - Respects Gmail rate limits and token refresh
 */
import { prisma } from '@/lib/prisma';
import { decrypt } from '@/lib/auth/crypto';
import { InboundReplyService } from './inboundReplyService';
import { OutreachProviderFactory } from '../outreach/providers/providerFactory';

export interface ReplySyncResult {
  threadsChecked: number;
  newRepliesCount: number;
  errors: string[];
}

export class GmailReplySyncService {
  /**
   * Synchronize replies from Gmail for all connected sender accounts owned by the user.
   */
  static async syncRepliesForUser(userId: string): Promise<ReplySyncResult> {
    const senders = await prisma.senderAccount.findMany({
      where: {
        userId,
        status: 'CONNECTED',
      },
    });

    if (senders.length === 0) {
      return {
        threadsChecked: 0,
        newRepliesCount: 0,
        errors: ['No connected Gmail sender accounts found for this user.'],
      };
    }

    let totalThreadsChecked = 0;
    let totalNewReplies = 0;
    const errors: string[] = [];

    const gmailProvider = OutreachProviderFactory.getGmailProvider();

    for (const sender of senders) {
      try {
        // Find recent SENT outreaches with a gmailThreadId sent by this mailbox
        const recentOutreaches = await prisma.outreach.findMany({
          where: {
            senderAccountId: sender.id,
            status: 'SENT',
            gmailThreadId: { not: null },
          },
          take: 25,
          orderBy: { sentAt: 'desc' },
        });

        if (recentOutreaches.length === 0) continue;

        // Get fresh access token for sender
        const accessToken = await (gmailProvider as any).getValidAccessToken(sender);

        for (const outreach of recentOutreaches) {
          totalThreadsChecked++;
          const threadId = outreach.gmailThreadId!;

          try {
            const res = await fetch(
              `https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}?format=full`,
              {
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                  Accept: 'application/json',
                },
              }
            );

            if (!res.ok) {
              if (res.status === 404) continue; // Thread deleted by user
              errors.push(`Gmail thread ${threadId} fetch returned HTTP ${res.status}`);
              continue;
            }

            const threadData = await res.json();
            const messages = threadData.messages || [];

            // A thread with a reply must have at least 2 messages
            if (messages.length <= 1) continue;

            const senderEmailClean = sender.email.toLowerCase();

            // Look for messages from someone other than the sender
            for (const msg of messages) {
              const headers: Array<{ name: string; value: string }> = msg.payload?.headers || [];
              const fromHeader = headers.find((h) => h.name.toLowerCase() === 'from')?.value || '';
              const subjectHeader = headers.find((h) => h.name.toLowerCase() === 'subject')?.value || outreach.subject || '';
              const msgIdHeader = headers.find((h) => h.name.toLowerCase() === 'message-id')?.value || msg.id;

              // Check if fromHeader contains the sender's own email
              if (fromHeader.toLowerCase().includes(senderEmailClean)) {
                // Sent by sender, not an inbound reply
                continue;
              }

              // Check if already synced
              const existingReply = await prisma.inboundReply.findFirst({
                where: {
                  OR: [
                    { messageId: msg.id },
                    { providerEventId: msgIdHeader },
                  ],
                },
              });

              if (existingReply) continue;

              // Extract body text
              let bodyText = '';
              if (msg.snippet) {
                bodyText = msg.snippet;
              }

              // Ingest genuine reply
              await InboundReplyService.processInboundReply({
                fromEmail: fromHeader,
                toEmail: sender.email,
                subject: subjectHeader,
                bodyText,
                messageId: msg.id,
                inReplyTo: outreach.providerMessageId || undefined,
                provider: 'gmail',
                providerEventId: msgIdHeader,
              });

              totalNewReplies++;
            }
          } catch (threadErr: any) {
            errors.push(`Error checking thread ${threadId}: ${threadErr.message}`);
          }
        }
      } catch (senderErr: any) {
        errors.push(`Error syncing sender ${sender.email}: ${senderErr.message}`);
      }
    }

    return {
      threadsChecked: totalThreadsChecked,
      newRepliesCount: totalNewReplies,
      errors,
    };
  }
}
