import { prisma } from '@/lib/prisma';
import { SenderHealthService, SenderHealthState, SenderHealthMetrics } from './senderHealthService';
import { CapacityConfigService } from './capacityConfig';

export interface GlobalCapacity {
  totalAvailable: number;
  targetDaily: number;
}

export class AdaptiveCapacityEngine {
  /**
   * Evaluate Domain Health and update DomainHealth table.
   */
  static async evaluateDomainHealth(domain: string, userId: string): Promise<any> {
    let domainHealth = await prisma.domainHealth.findUnique({ where: { domain } });

    if (!domainHealth) {
      domainHealth = await prisma.domainHealth.create({
        data: {
          userId,
          domain,
          spfStatus: 'UNKNOWN',
          dkimStatus: 'UNKNOWN',
          dmarcStatus: 'UNKNOWN',
          healthState: 'HEALTHY',
          lastEvaluation: new Date(),
        },
      });
    }

    // A real implementation would query DNS or Postmaster tools here.
    // We update lastEvaluation
    await prisma.domainHealth.update({
      where: { domain },
      data: { lastEvaluation: new Date() },
    });

    return domainHealth;
  }

  /**
   * Evaluate Sender Health
   */
  static async evaluateSenderHealth(senderId: string): Promise<SenderHealthMetrics> {
    const sender = await prisma.senderAccount.findUnique({
      where: { id: senderId },
    });
    if (!sender) throw new Error('Sender not found');

    const metrics = await SenderHealthService.evaluateSenderHealth(sender);
    
    // Update sender healthState in DB
    await prisma.senderAccount.update({
      where: { id: senderId },
      data: {
        healthState: metrics.healthState,
        lastHealthEvaluation: new Date(),
      },
    });

    return metrics;
  }

  /**
   * Record capacity history
   */
  static async recordCapacityHistory(
    senderId: string,
    previousCapacity: number,
    newCapacity: number,
    reason: string,
    healthState: string
  ) {
    await prisma.capacityHistory.create({
      data: {
        senderAccountId: senderId,
        previousCapacity,
        newCapacity,
        reason,
        healthState,
      },
    });
  }

  /**
   * Main recalculation engine for a sender's capacity
   */
  static async calculateSenderCapacity(senderId: string): Promise<void> {
    const sender = await prisma.senderAccount.findUnique({
      where: { id: senderId },
    });
    if (!sender) throw new Error('Sender not found');

    const metrics = await this.evaluateSenderHealth(senderId);
    const domainHealth = await this.evaluateDomainHealth(metrics.domain, sender.userId);

    const prevCapacity = sender.currentCapacity;
    let nextCapacity = prevCapacity;
    let reason = '';
    
    // Config limit acts as a ceiling
    const effectiveMaximum = Math.min(sender.configuredMaximum, CapacityConfigService.getConfig().maxPerSenderPerDay);

    // If domain is restricted or paused
    if (domainHealth.healthState === 'CRITICAL' || domainHealth.healthState === 'PAUSED') {
      nextCapacity = Math.floor(prevCapacity / 2);
      reason = `Domain health is ${domainHealth.healthState}. Automatically reducing capacity.`;
      if (nextCapacity < sender.startingCapacity) nextCapacity = sender.startingCapacity; // Minimum bound unless paused
    } else {
      // Evaluate based on sender health
      switch (metrics.healthState) {
        case 'HEALTHY':
          // Must have been at least 1 day since last capacity change to increase
          const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
          if (!sender.lastCapacityChange || sender.lastCapacityChange <= oneDayAgo) {
            nextCapacity = Math.min(effectiveMaximum, prevCapacity + sender.incrementStep);
            reason = 'Sender remained HEALTHY during evaluation period; no critical provider errors; domain authentication healthy.';
          } else {
            reason = 'Sender is HEALTHY but minimum evaluation period has not passed.';
          }
          break;

        case 'WARNING':
          nextCapacity = prevCapacity; // HOLD
          reason = 'Sender in WARNING state. Holding capacity.';
          break;

        case 'RESTRICTED':
          nextCapacity = Math.floor(prevCapacity * 0.5);
          reason = 'Capacity reduced due to repeated delivery failures or RESTRICTED state.';
          if (nextCapacity < sender.startingCapacity) nextCapacity = sender.startingCapacity;
          break;

        case 'PAUSED':
          nextCapacity = 0;
          reason = 'Sender is PAUSED or disconnected. Capacity set to 0.';
          break;
      }
    }

    if (nextCapacity !== prevCapacity || sender.healthState !== metrics.healthState) {
      await prisma.senderAccount.update({
        where: { id: senderId },
        data: {
          currentCapacity: nextCapacity,
          lastCapacityChange: nextCapacity !== prevCapacity ? new Date() : sender.lastCapacityChange,
        },
      });

      if (nextCapacity !== prevCapacity) {
        await this.recordCapacityHistory(
          senderId,
          prevCapacity,
          nextCapacity,
          reason,
          metrics.healthState
        );
      }
    }
  }

  /**
   * Pause a sender explicitly
   */
  static async pauseSender(senderId: string, explicitReason: string) {
    const sender = await prisma.senderAccount.findUnique({ where: { id: senderId } });
    if (!sender) return;

    await prisma.senderAccount.update({
      where: { id: senderId },
      data: {
        currentCapacity: 0,
        healthState: 'PAUSED',
        lastCapacityChange: new Date(),
      },
    });

    await this.recordCapacityHistory(senderId, sender.currentCapacity, 0, explicitReason, 'PAUSED');
  }

  /**
   * Recover a sender
   */
  static async recoverSender(senderId: string) {
    const sender = await prisma.senderAccount.findUnique({ where: { id: senderId } });
    if (!sender) return;

    await prisma.senderAccount.update({
      where: { id: senderId },
      data: {
        currentCapacity: sender.startingCapacity,
        healthState: 'HEALTHY',
        lastCapacityChange: new Date(),
        status: 'CONNECTED' // assume status is reconnected
      },
    });

    await this.recordCapacityHistory(senderId, sender.currentCapacity, sender.startingCapacity, 'Manual recovery initiated. Restarting capacity ramp.', 'HEALTHY');
  }

  /**
   * Calculate global capacity across all connected and non-paused senders
   */
  static async calculateGlobalCapacity(): Promise<GlobalCapacity> {
    const senders = await prisma.senderAccount.findMany({
      where: {
        status: 'CONNECTED',
        healthState: { notIn: ['PAUSED', 'CRITICAL'] },
      },
    });

    const totalAvailable = senders.reduce((sum, s) => sum + s.currentCapacity, 0);
    const config = CapacityConfigService.getConfig();

    return {
      totalAvailable,
      targetDaily: config.targetDailyCapacity,
    };
  }
}
