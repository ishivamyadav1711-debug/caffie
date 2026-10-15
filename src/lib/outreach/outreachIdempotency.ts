import { prisma } from '../prisma';

export interface DuplicateCheckResult {
  hasDuplicate: boolean;
  existingOutreachId?: string;
  existingStatus?: string;
  sentAt?: Date;
  reason?: string;
}

export class OutreachIdempotencyGuard {
  /**
   * Generates a stable deterministic idempotency key for an outreach attempt.
   */
  static generateKey(businessId: string, channel: string, recipient: string): string {
    const today = new Date().toISOString().split('T')[0]; // One attempt per day per channel/recipient
    return `outreach_${businessId}_${channel.toLowerCase()}_${recipient.replace(/[^a-zA-Z0-9]/g, '')}_${today}`;
  }

  /**
   * Verifies if a message has already been sent or is currently queued for this lead & channel.
   * Default cooldown: 7 days for successfully sent outreach.
   */
  static async checkDuplicate(
    businessId: string,
    channel: string,
    recipient: string,
    cooldownDays: number = 7
  ): Promise<DuplicateCheckResult> {
    const cooldownDate = new Date();
    cooldownDate.setDate(cooldownDate.getDate() - cooldownDays);

    try {
      const existing = await prisma.outreach.findFirst({
        where: {
          businessId,
          channel: channel.toUpperCase(),
          recipient,
          OR: [
            // Currently in-flight
            { status: { in: ['PENDING', 'QUEUED', 'SENDING'] } },
            // Sent within cooldown period
            {
              status: { in: ['SENT', 'DELIVERED', 'READ'] },
              sentAt: { gte: cooldownDate },
            },
          ],
        },
        orderBy: { createdAt: 'desc' },
      });

      if (existing) {
        const isPending = ['PENDING', 'QUEUED', 'SENDING'].includes(existing.status);
        const reason = isPending
          ? `Outreach is already in progress (${existing.status}) for ${recipient}.`
          : `Outreach was already successfully sent to ${recipient} on ${existing.sentAt?.toLocaleDateString() || 'recently'}. (7-day cooldown active)`;

        return {
          hasDuplicate: true,
          existingOutreachId: existing.id,
          existingStatus: existing.status,
          sentAt: existing.sentAt || undefined,
          reason,
        };
      }

      return { hasDuplicate: false };
    } catch (err: any) {
      return { hasDuplicate: false };
    }
  }

  private static inFlightLocks = new Set<string>();

  /**
   * Acquire an in-memory lock for a sending operation (prevents double-clicking send).
   */
  static acquireLock(key: string): boolean {
    if (this.inFlightLocks.has(key)) return false;
    this.inFlightLocks.add(key);
    return true;
  }

  /**
   * Release an acquired in-memory lock.
   */
  static releaseLock(key: string): void {
    this.inFlightLocks.delete(key);
  }
}
