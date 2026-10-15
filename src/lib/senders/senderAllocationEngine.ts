/**
 * LeadPilot — Dynamic Sender Allocation Engine
 *
 * Implements intelligent, reputation-preserving workload distribution:
 * - Dynamically distributes eligible outreach across multiple authorized mailboxes (e.g. 5–6 senders)
 * - Prioritizes HEALTHY senders with high health scores and lower daily utilization
 * - Reduces workload on WARNING or RESTRICTED senders
 * - Bypasses PAUSED / disconnected senders
 * - Redistributes unassigned workload to other healthy authorized senders up to safe capacity
 * - Strictly respects per-sender, per-domain, and global application safety limits
 */
import { SenderHealthService, SenderHealthMetrics, SenderHealthState } from './senderHealthService';
import { CapacityConfigService } from './capacityConfig';

export interface AllocationPlanItem {
  senderAccountId: string;
  senderEmail: string;
  domain: string;
  healthState: SenderHealthState;
  healthScore: number;
  capacityAllocated: number;
  effectiveCapacity: number;
}

export interface SenderAllocationPlan {
  allocations: AllocationPlanItem[];
  totalAllocated: number;
  queuedCount: number;
  redistributedCount: number;
  unhealthySendersBypassed: number;
}

export class SenderAllocationEngine {
  /**
   * Plans dynamic allocation for a batch of eligible leads across user's sender mailboxes.
   */
  static async planAllocation(
    userId: string,
    eligibleLeadCount: number
  ): Promise<SenderAllocationPlan> {
    const config = CapacityConfigService.getConfig();
    const metricsList = await SenderHealthService.evaluateUserSenders(userId);

    if (metricsList.length === 0 || eligibleLeadCount <= 0) {
      return {
        allocations: [],
        totalAllocated: 0,
        queuedCount: eligibleLeadCount,
        redistributedCount: 0,
        unhealthySendersBypassed: 0,
      };
    }

    // Filter out PAUSED senders
    const usableSenders = metricsList.filter((m) => m.healthState !== 'PAUSED' && m.effectiveCapacity > 0);
    const unhealthyBypassed = metricsList.filter((m) => m.healthState === 'PAUSED').length;

    if (usableSenders.length === 0) {
      return {
        allocations: [],
        totalAllocated: 0,
        queuedCount: eligibleLeadCount,
        redistributedCount: 0,
        unhealthySendersBypassed: unhealthyBypassed,
      };
    }

    // Calculate domain sent today across all senders
    const domainSentToday = new Map<string, number>();
    let totalSentToday = 0;
    for (const m of metricsList) {
      const current = domainSentToday.get(m.domain) || 0;
      domainSentToday.set(m.domain, current + m.sentToday);
      totalSentToday += m.sentToday;
    }

    // Global remaining limit
    const globalRemaining = Math.max(0, config.maxTotalDailyOutreach - totalSentToday);
    const maxAllocatableGlobally = Math.min(eligibleLeadCount, globalRemaining);

    if (maxAllocatableGlobally <= 0) {
      return {
        allocations: [],
        totalAllocated: 0,
        queuedCount: eligibleLeadCount,
        redistributedCount: 0,
        unhealthySendersBypassed: unhealthyBypassed,
      };
    }

    // Sort senders: HEALTHY first (highest healthScore, lowest sentToday), then WARNING, then RESTRICTED
    usableSenders.sort((a, b) => {
      // Prefer HEALTHY over WARNING/RESTRICTED
      if (a.healthState === 'HEALTHY' && b.healthState !== 'HEALTHY') return -1;
      if (b.healthState === 'HEALTHY' && a.healthState !== 'HEALTHY') return 1;

      // Higher health score preferred
      if (b.healthScore !== a.healthScore) return b.healthScore - a.healthScore;

      // Lower sent today preferred (load balancing)
      return a.sentToday - b.sentToday;
    });

    const allocations: AllocationPlanItem[] = usableSenders.map((s) => ({
      senderAccountId: s.senderAccountId,
      senderEmail: s.senderEmail,
      domain: s.domain,
      healthState: s.healthState,
      healthScore: s.healthScore,
      capacityAllocated: 0,
      effectiveCapacity: s.effectiveCapacity,
    }));

    let remainingToAllocate = eligibleLeadCount;
    let allocated = 0;
    const domainBatchAllocated = new Map<string, number>();

    // Initial equal-share baseline expectation (for measuring dynamic redistribution)
    const baseSharePerSender = Math.floor(eligibleLeadCount / usableSenders.length);
    let redistributedCount = 0;

    // Iterative deterministic allocation with dynamic redistribution
    let progress = true;
    while (remainingToAllocate > 0 && allocated < maxAllocatableGlobally && progress) {
      progress = false;

      for (let i = 0; i < usableSenders.length && remainingToAllocate > 0 && allocated < maxAllocatableGlobally; i++) {
        const sender = usableSenders[i];
        const alloc = allocations[i];
        const domain = sender.domain;

        const currentDomainBatch = domainBatchAllocated.get(domain) || 0;
        const domainUsedToday = domainSentToday.get(domain) || 0;
        const domainRemainingCapacity = Math.max(0, config.maxPerDomainPerDay - domainUsedToday);

        // Check if sender can take another recipient:
        // 1. Within sender's health-adjusted effective capacity
        // 2. Within domain daily limit
        // 3. Within global limit
        if (
          alloc.capacityAllocated < sender.effectiveCapacity &&
          currentDomainBatch < domainRemainingCapacity &&
          allocated < maxAllocatableGlobally
        ) {
          alloc.capacityAllocated += 1;
          allocated += 1;
          remainingToAllocate -= 1;
          domainBatchAllocated.set(domain, currentDomainBatch + 1);
          progress = true;

          // If this allocation exceeds the standard equal share, it was redistributed from unhealthy/limited accounts
          if (alloc.capacityAllocated > baseSharePerSender) {
            redistributedCount++;
          }
        }
      }
    }

    const queuedCount = eligibleLeadCount - allocated;

    return {
      allocations: allocations.filter((a) => a.capacityAllocated > 0),
      totalAllocated: allocated,
      queuedCount,
      redistributedCount,
      unhealthySendersBypassed: unhealthyBypassed,
    };
  }
}
