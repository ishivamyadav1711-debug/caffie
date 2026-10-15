/**
 * LeadPilot — Production Sender Health Service
 *
 * Tracks real observed deliverability and account health signals:
 * - Emails sent today & rolling 7 days
 * - Hard bounces & soft bounces / deferrals
 * - Unsubscribe counts from real inbound signals
 * - Gmail API failures & authentication errors
 * - State machine: HEALTHY | WARNING | RESTRICTED | PAUSED
 * - Configurable thresholds and allocation capacity multipliers
 */
import { prisma } from '@/lib/prisma';
import { CapacityConfigService } from './capacityConfig';

export type SenderHealthState = 'HEALTHY' | 'WARNING' | 'RESTRICTED' | 'PAUSED';

export interface SenderHealthMetrics {
  senderAccountId: string;
  senderEmail: string;
  domain: string;
  provider: string;
  status: string; // CONNECTED | DISCONNECTED | EXPIRED | REVOKED
  healthState: SenderHealthState;
  healthScore: number; // 0 to 100
  capacityMultiplier: number; // 1.0 (HEALTHY), 0.5 (WARNING), 0.2 (RESTRICTED), 0.0 (PAUSED)
  effectiveCapacity: number; // remaining daily capacity after applying health multiplier
  sentToday: number;
  sent7d: number;
  hardBounces: number;
  softBounces: number;
  bounceRate: number; // percentage (0.0 to 1.0)
  unsubscribes: number;
  complaints: number;
  apiFailures: number;
  authErrors: number;
  deferrals: number;
  lastSuccessfulSend: Date | null;
  lastFailure: Date | null;
  lastError: string | null;
  reasons: string[];
}

export class SenderHealthService {
  /**
   * Helper to get start of today in UTC.
   */
  static getTodayMidnightUtc(): Date {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  }

  /**
   * Helper to get date 7 days ago.
   */
  static getSevenDaysAgo(): Date {
    return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  }

  /**
   * Compute comprehensive health metrics for a single sender account based on real signals.
   */
  static async evaluateSenderHealth(senderAccount: {
    id: string;
    email: string;
    status: string;
    provider: string;
    lastError?: string | null;
    lastUsedAt?: Date | null;
    tokenExpiry?: Date | null;
    refreshToken?: string | null;
    currentCapacity?: number;
  }): Promise<SenderHealthMetrics> {
    const todayMidnight = this.getTodayMidnightUtc();
    const sevenDaysAgo = this.getSevenDaysAgo();
    const domain = senderAccount.email.split('@')[1] || 'unknown';
    const config = CapacityConfigService.getConfig();
    const limit = senderAccount.currentCapacity !== undefined ? senderAccount.currentCapacity : config.maxPerSenderPerDay;

    // 1. Sent today
    let sentTodayCount = 0;
    try {
      sentTodayCount = (await prisma.outreach.count({
        where: {
          senderAccountId: senderAccount.id,
          status: 'SENT',
          sentAt: { gte: todayMidnight },
        },
      })) || 0;
    } catch {
      sentTodayCount = 0;
    }

    // 2. Sent rolling 7 days
    let sent7dCount = 0;
    try {
      sent7dCount = (await prisma.outreach.count({
        where: {
          senderAccountId: senderAccount.id,
          status: 'SENT',
          sentAt: { gte: sevenDaysAgo },
        },
      })) || 0;
    } catch {
      sent7dCount = 0;
    }

    // 3. Hard Bounces (rolling 7 days)
    let hardBouncesCount = 0;
    try {
      hardBouncesCount = (await prisma.outreach.count({
        where: {
          senderAccountId: senderAccount.id,
          status: 'BOUNCED',
          createdAt: { gte: sevenDaysAgo },
        },
      })) || 0;
    } catch {
      hardBouncesCount = 0;
    }

    // 4. Failed outreaches (rolling 7 days)
    let failedOutreaches: Array<{ errorCode?: string | null; errorMessage?: string | null; failedAt?: Date | null; createdAt?: Date | null }> = [];
    try {
      const res = await prisma.outreach.findMany({
        where: {
          senderAccountId: senderAccount.id,
          status: 'FAILED',
          createdAt: { gte: sevenDaysAgo },
        },
        select: { errorCode: true, errorMessage: true, failedAt: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      });
      if (Array.isArray(res)) failedOutreaches = res;
    } catch {
      failedOutreaches = [];
    }

    let authErrors = 0;
    let deferrals = 0; // rate limits or temporary deferrals
    let apiFailures = 0;

    for (const f of failedOutreaches) {
      const code = (f.errorCode || '').toUpperCase();
      const msg = (f.errorMessage || '').toLowerCase();
      if (code.includes('AUTH') || code.includes('401') || code.includes('403') || msg.includes('invalid_grant')) {
        authErrors++;
      } else if (code.includes('RATE_LIMIT') || code.includes('429') || msg.includes('quota')) {
        deferrals++;
      } else {
        apiFailures++;
      }
    }

    // 5. Inbound Unsubscribes associated with this sender
    let unsubscribes = 0;
    try {
      unsubscribes = (await prisma.inboundReply.count({
        where: {
          classification: 'UNSUBSCRIBE',
          toEmail: senderAccount.email.toLowerCase(),
          createdAt: { gte: sevenDaysAgo },
        },
      })) || 0;
    } catch {
      unsubscribes = 0;
    }

    // 6. Last successful send and last failure
    let latestSent: { sentAt?: Date | null } | null = null;
    try {
      latestSent = await prisma.outreach.findFirst({
        where: { senderAccountId: senderAccount.id, status: 'SENT' },
        orderBy: { sentAt: 'desc' },
        select: { sentAt: true },
      });
    } catch {
      latestSent = null;
    }

    const latestFailureRecord = failedOutreaches[0];
    const lastFailureDate = latestFailureRecord?.failedAt || latestFailureRecord?.createdAt || null;

    // 7. Calculate bounce rate
    const totalConsidered = sent7dCount + hardBouncesCount;
    const bounceRate = totalConsidered > 0 ? hardBouncesCount / totalConsidered : 0;

    // 8. Determine Health State and Reasons
    const reasons: string[] = [];
    let healthState: SenderHealthState = 'HEALTHY';
    let healthScore = 100;
    let capacityMultiplier = 1.0;

    // A. Check for PAUSED conditions (Cannot send at all)
    if (senderAccount.status !== 'CONNECTED') {
      healthState = 'PAUSED';
      healthScore = 0;
      capacityMultiplier = 0.0;
      reasons.push(`Account status is ${senderAccount.status}. Re-authorization required.`);
    } else if (authErrors > 0 || (senderAccount.tokenExpiry && senderAccount.tokenExpiry < new Date() && !senderAccount.refreshToken)) {
      healthState = 'PAUSED';
      healthScore = 10;
      capacityMultiplier = 0.0;
      reasons.push('Authentication error or token revoked. Requires Gmail reconnect.');
    } else if (senderAccount.lastError?.includes('403') || senderAccount.lastError?.includes('invalid_grant')) {
      healthState = 'PAUSED';
      healthScore = 10;
      capacityMultiplier = 0.0;
      reasons.push(`Persistent authorization error: ${senderAccount.lastError}`);
    }

    // B. Check for RESTRICTED conditions (High risk, strongly throttled to protect domain)
    if (healthState !== 'PAUSED') {
      if (bounceRate >= 0.05 && totalConsidered >= 10) {
        healthState = 'RESTRICTED';
        healthScore = 30;
        capacityMultiplier = 0.2;
        reasons.push(`High bounce rate (${(bounceRate * 100).toFixed(1)}%). Strongly throttled to protect domain reputation.`);
      } else if (apiFailures >= 8) {
        healthState = 'RESTRICTED';
        healthScore = 35;
        capacityMultiplier = 0.2;
        reasons.push(`Frequent Gmail API failures (${apiFailures} in last 7 days). Throttled to prevent account suspension.`);
      }
    }

    // C. Check for WARNING conditions (Moderate risk or daily capacity cap)
    if (healthState !== 'PAUSED' && healthState !== 'RESTRICTED') {
      const remainingRaw = Math.max(0, limit - sentTodayCount);

      if (remainingRaw === 0) {
        healthState = 'WARNING';
        healthScore = 65;
        capacityMultiplier = 0.0; // limit reached for today
        reasons.push(`Daily application safety limit reached (${sentTodayCount}/${limit}).`);
      } else if (bounceRate >= 0.02 && totalConsidered >= 10) {
        healthState = 'WARNING';
        healthScore = 60;
        capacityMultiplier = 0.5;
        reasons.push(`Elevated bounce rate (${(bounceRate * 100).toFixed(1)}%). Capacity halved.`);
      } else if (deferrals >= 3) {
        healthState = 'WARNING';
        healthScore = 65;
        capacityMultiplier = 0.5;
        reasons.push(`Gmail rate-limit deferrals observed (${deferrals}). Reduced allocation.`);
      } else if (unsubscribes >= 5) {
        healthState = 'WARNING';
        healthScore = 70;
        capacityMultiplier = 0.7;
        reasons.push(`Recent opt-outs detected (${unsubscribes}). Capacity slightly moderated.`);
      } else if (senderAccount.lastError) {
        healthState = 'WARNING';
        healthScore = 70;
        capacityMultiplier = 0.5;
        reasons.push(`Recent error recorded: ${senderAccount.lastError}`);
      }
    }

    // D. Normal HEALTHY condition
    if (healthState === 'HEALTHY') {
      reasons.push('Mailbox connected, tokens valid, zero critical deliverability anomalies.');
    }

    const rawRemaining = Math.max(0, limit - sentTodayCount);
    const effectiveCapacity = Math.floor(rawRemaining * capacityMultiplier);

    return {
      senderAccountId: senderAccount.id,
      senderEmail: senderAccount.email,
      domain,
      provider: senderAccount.provider,
      status: senderAccount.status,
      healthState,
      healthScore,
      capacityMultiplier,
      effectiveCapacity,
      sentToday: sentTodayCount,
      sent7d: sent7dCount,
      hardBounces: hardBouncesCount,
      softBounces: deferrals,
      bounceRate,
      unsubscribes,
      complaints: 0,
      apiFailures,
      authErrors,
      deferrals,
      lastSuccessfulSend: latestSent?.sentAt || senderAccount.lastUsedAt || null,
      lastFailure: lastFailureDate,
      lastError: senderAccount.lastError || null,
      reasons,
    };
  }

  /**
   * Evaluate health for all senders owned by the user.
   */
  static async evaluateUserSenders(userId: string): Promise<SenderHealthMetrics[]> {
    const rawSenders = await prisma.senderAccount.findMany({
      where: { userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        provider: true,
        status: true,
        lastError: true,
        lastUsedAt: true,
        tokenExpiry: true,
        refreshToken: true,
        createdAt: true,
        currentCapacity: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    const evaluations = await Promise.all(
      rawSenders.map((s) => this.evaluateSenderHealth(s))
    );

    return evaluations;
  }
}
