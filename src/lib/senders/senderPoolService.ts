/**
 * LeadPilot — Multi-Sender Pool Service
 *
 * Implements Phase 2 Multi-Sender Company Outreach:
 * - Genuine sender mailbox pool management for authenticated company users
 * - Strict server-side ownership verification
 * - Controlled application safety limits (per-sender and domain-level)
 * - Truthful DNS readiness & Postmaster monitoring status
 * - Never leaks OAuth tokens
 */
import { prisma } from '@/lib/prisma';
import { CapacityConfigService, CapacityConfiguration } from './capacityConfig';
import { DnsVerificationService, DnsVerificationResult } from './dnsVerificationService';
import { SenderHealthService, SenderHealthState } from './senderHealthService';
import { SenderAllocationEngine, SenderAllocationPlan } from './senderAllocationEngine';

export const DEFAULT_SENDER_SAFETY_LIMIT = 25; // 25 emails / day per mailbox
export const DEFAULT_DOMAIN_SAFETY_LIMIT = 100; // 100 emails / day per domain

export type SenderHealthStatus =
  | 'HEALTHY'
  | 'WARNING'
  | 'RESTRICTED'
  | 'PAUSED'
  | 'LIMITED'
  | 'AUTH_REQUIRED'
  | 'ERROR';

export interface SenderAccountSummary {
  id: string;
  email: string;
  domain: string;
  displayName?: string | null;
  provider: string;
  status: string; // CONNECTED | DISCONNECTED | EXPIRED | REVOKED
  health: SenderHealthStatus;
  healthState?: SenderHealthState;
  healthScore?: number;
  bounceRate?: number;
  hardBounces?: number;
  apiFailures?: number;
  unsubscribes?: number;
  todaySentCount: number;
  dailySafetyLimit: number;
  remainingCapacity: number;
  effectiveCapacity?: number;
  lastUsedAt?: Date | null;
  lastError?: string | null;
  healthReasons?: string[];
  createdAt: Date;
}

export interface DomainStats {
  domain: string;
  senderCount: number;
  todaySentCount: number;
  domainSafetyLimit: number;
  remainingCapacity: number;
  senderEmails: string[];
}

export interface DnsChecklistItem {
  name: string;
  status: 'CONFIGURED' | 'NOT_CONFIGURED' | 'MANAGED_BY_PROVIDER' | 'VERIFIED' | 'NOT_VERIFIED' | 'SELECTOR_REQUIRED';
  displayStatus: string;
  description: string;
}

export interface SenderPoolResult {
  senders: SenderAccountSummary[];
  connectedCount: number;
  totalCapacity: number;
  totalTodaySent: number;
  domainStats: DomainStats[];
  capacityConfig: CapacityConfiguration & {
    globalRemaining: number;
  };
  domainConsistency: {
    isConsistent: boolean;
    primaryDomain?: string;
    notice: string;
  };
  dnsReadiness: {
    statusText: string;
    checklist: DnsChecklistItem[];
  };
  reputationMonitoring: {
    statusText: string;
    connected: boolean;
    provider: string;
  };
}

export class SenderPoolService {
  /**
   * Helper to get start of today in UTC for daily usage calculation.
   */
  static getTodayMidnightUtc(): Date {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  }

  /**
   * Extract domain from email address.
   */
  static extractDomain(email: string): string {
    const parts = email.trim().toLowerCase().split('@');
    return parts.length > 1 ? parts[1] : 'unknown';
  }

  /**
   * Fetch all senders owned by the authenticated user with usage, capacity, and health.
   * NEVER returns tokens.
   */
  static async getSenderPool(userId: string): Promise<SenderPoolResult> {
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
      },
      orderBy: { createdAt: 'asc' },
    });

    const todayMidnight = this.getTodayMidnightUtc();

    // Query today's sent outreach records for this user's senders
    const senderIds = rawSenders.map((s) => s.id);
    let todaySentOutreaches: any[] = [];
    if (senderIds.length > 0) {
      try {
        const res = await prisma.outreach.groupBy({
          by: ['senderAccountId'],
          where: {
            senderAccountId: { in: senderIds },
            status: 'SENT',
            sentAt: { gte: todayMidnight },
          },
          _count: { id: true },
        });
        if (Array.isArray(res)) todaySentOutreaches = res;
      } catch {
        todaySentOutreaches = [];
      }
    }

    const sentCountMap = new Map<string, number>();
    for (const group of todaySentOutreaches) {
      if (group && group.senderAccountId) {
        sentCountMap.set(group.senderAccountId, group._count?.id || 0);
      }
    }

    const capacityConfig = CapacityConfigService.getConfig();
    const domainMap = new Map<string, { senderCount: number; todaySentCount: number; senderEmails: string[] }>();

    const senders: SenderAccountSummary[] = rawSenders.map((s) => {
      const domain = this.extractDomain(s.email);
      const sentCount = sentCountMap.get(s.id) || 0;
      const limit = capacityConfig.maxPerSenderPerDay;
      const remaining = Math.max(0, limit - sentCount);

      // Determine health
      let health: SenderHealthStatus = 'HEALTHY';
      if (s.status !== 'CONNECTED') {
        health = 'AUTH_REQUIRED';
      } else if (s.tokenExpiry && s.tokenExpiry < new Date() && !s.refreshToken) {
        health = 'AUTH_REQUIRED';
      } else if (s.lastError) {
        health = 'ERROR';
      } else if (remaining === 0) {
        health = 'LIMITED';
      }

      // Group domain stats
      const existingDomain = domainMap.get(domain) || { senderCount: 0, todaySentCount: 0, senderEmails: [] };
      existingDomain.senderCount += 1;
      existingDomain.todaySentCount += sentCount;
      existingDomain.senderEmails.push(s.email);
      domainMap.set(domain, existingDomain);

      return {
        id: s.id,
        email: s.email,
        domain,
        displayName: s.displayName,
        provider: s.provider,
        status: s.status,
        health,
        todaySentCount: sentCount,
        dailySafetyLimit: limit,
        remainingCapacity: remaining,
        lastUsedAt: s.lastUsedAt,
        lastError: s.lastError,
        createdAt: s.createdAt,
      };
    });

    const domainStats: DomainStats[] = Array.from(domainMap.entries()).map(([domain, data]) => {
      const domainLimit = capacityConfig.maxPerDomainPerDay;
      const remainingDomainCapacity = Math.max(0, domainLimit - data.todaySentCount);
      return {
        domain,
        senderCount: data.senderCount,
        todaySentCount: data.todaySentCount,
        domainSafetyLimit: domainLimit,
        remainingCapacity: remainingDomainCapacity,
        senderEmails: data.senderEmails,
      };
    });

    // Domain consistency evaluation
    const uniqueDomains = domainStats.map((d) => d.domain);
    const isConsistent = uniqueDomains.length <= 1;
    const primaryDomain = uniqueDomains[0];
    const notice = isConsistent
      ? 'All sender accounts share the same company domain.'
      : `Senders span multiple domains (${uniqueDomains.join(', ')}). Domain reputation is shared across accounts on each respective domain.`;

    const connectedSenders = senders.filter((s) => s.status === 'CONNECTED' && s.health === 'HEALTHY');
    const totalTodaySent = senders.reduce((acc, s) => acc + s.todaySentCount, 0);

    // Total usable capacity is sum of individual sender remaining capacities,
    // bounded by respective domain remaining capacities AND global daily limit
    let domainUsableCapacity = 0;
    for (const d of domainStats) {
      const sendersInDomain = senders.filter((s) => s.domain === d.domain && s.status === 'CONNECTED' && s.health === 'HEALTHY');
      const sumSenderCapacity = sendersInDomain.reduce((acc, s) => acc + s.remainingCapacity, 0);
      domainUsableCapacity += Math.min(sumSenderCapacity, d.remainingCapacity);
    }

    const globalRemaining = Math.max(0, capacityConfig.maxTotalDailyOutreach - totalTodaySent);
    const totalCapacity = Math.min(domainUsableCapacity, globalRemaining);

    return {
      senders,
      connectedCount: connectedSenders.length,
      totalCapacity,
      totalTodaySent,
      domainStats,
      capacityConfig: {
        ...capacityConfig,
        globalRemaining,
      },
      domainConsistency: {
        isConsistent,
        primaryDomain,
        notice,
      },
      dnsReadiness: {
        statusText: 'Truthful DNS check available on demand (live DNS query)',
        checklist: [
          {
            name: 'SPF (Sender Policy Framework)',
            status: 'NOT_CONFIGURED',
            displayStatus: 'Verification Available on Demand',
            description: 'Authorizes Google Workspace mail servers to send emails on behalf of your domain.',
          },
          {
            name: 'DKIM (DomainKeys Identified Mail)',
            status: 'SELECTOR_REQUIRED',
            displayStatus: 'DKIM Selector Required',
            description: 'Cryptographic signature verifying headers. Requires configured selector (e.g. google).',
          },
          {
            name: 'DMARC (Domain-based Message Authentication)',
            status: 'NOT_CONFIGURED',
            displayStatus: 'Verification Available on Demand',
            description: 'Domain alignment policy protecting against domain spoofing.',
          },
          {
            name: 'TLS (Transport Layer Security)',
            status: 'MANAGED_BY_PROVIDER',
            displayStatus: 'Enforced via Gmail API HTTPS',
            description: 'All outbound requests are transmitted over secure TLS encryption.',
          },
          {
            name: 'Google Workspace Mailbox Authorization',
            status: connectedSenders.length > 0 ? 'CONFIGURED' : 'NOT_CONFIGURED',
            displayStatus: connectedSenders.length > 0 ? `${connectedSenders.length} Mailbox(es) Authorized` : 'No Mailboxes Connected',
            description: 'OAuth2 authorization grants with required gmail.send and gmail.readonly scopes.',
          },
        ],
      },
      reputationMonitoring: {
        statusText: 'Postmaster monitoring not connected',
        connected: false,
        provider: 'Google Postmaster Tools',
      },
    };
  }

  /**
   * Disconnect a sender account belonging to the authenticated user.
   */
  static async disconnectSender(userId: string, senderAccountId: string): Promise<boolean> {
    const sender = await prisma.senderAccount.findUnique({
      where: { id: senderAccountId },
    });

    if (!sender || sender.userId !== userId) {
      throw new Error('Sender account not found or not owned by user.');
    }

    await prisma.senderAccount.update({
      where: { id: senderAccountId },
      data: {
        status: 'DISCONNECTED',
      },
    });

    return true;
  }

  /**
   * Reconnect a sender (resets last error and flags for re-auth if needed).
   */
  static async reconnectSender(userId: string, senderAccountId: string): Promise<{ needsOAuth: boolean }> {
    const sender = await prisma.senderAccount.findUnique({
      where: { id: senderAccountId },
    });

    if (!sender || sender.userId !== userId) {
      throw new Error('Sender account not found or not owned by user.');
    }

    // If refreshToken exists, attempt to reconnect
    if (sender.refreshToken) {
      await prisma.senderAccount.update({
        where: { id: senderAccountId },
        data: {
          status: 'CONNECTED',
          lastError: null,
        },
      });
      return { needsOAuth: false };
    }

    return { needsOAuth: true };
  }

  /**
   * Deterministic controlled sender allocation for bulk outreach.
   * Allocates leads to available healthy senders up to safety limits using SenderAllocationEngine.
   * Excess leads beyond capacity are marked for queueing.
   */
  static async allocateSendersForBatch(
    userId: string,
    recipientsCount: number
  ): Promise<{
    allocations: Array<{ senderAccountId: string; senderEmail: string; capacityAllocated: number }>;
    totalAllocated: number;
    queuedCount: number;
    redistributedCount?: number;
    unhealthySendersBypassed?: number;
  }> {
    const plan = await SenderAllocationEngine.planAllocation(userId, recipientsCount);
    return {
      allocations: plan.allocations.map((a) => ({
        senderAccountId: a.senderAccountId,
        senderEmail: a.senderEmail,
        capacityAllocated: a.capacityAllocated,
      })),
      totalAllocated: plan.totalAllocated,
      queuedCount: plan.queuedCount,
      redistributedCount: plan.redistributedCount,
      unhealthySendersBypassed: plan.unhealthySendersBypassed,
    };
  }

  /**
   * Verify domain DNS records (SPF, DMARC, DKIM) via live DNS queries.
   */
  static async verifyDomainDns(domain: string, dkimSelector?: string): Promise<DnsVerificationResult> {
    return DnsVerificationService.verifyDomain(domain, dkimSelector);
  }
}
