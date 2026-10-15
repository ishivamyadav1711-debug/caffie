/**
 * LeadPilot — Configurable Outreach Capacity Model
 *
 * Implements Phase 3 Production-Ready Capacity Control:
 * - Distinguishes business TARGET (500/day) from CURRENT CONFIGURED SAFETY LIMIT (e.g. 100/day)
 * - Application safety limits:
 *   - MAX_PER_SENDER_PER_DAY (default: 25)
 *   - MAX_PER_DOMAIN_PER_DAY (default: 100)
 *   - MAX_TOTAL_DAILY_OUTREACH (default: 100)
 * - Requires explicit administrator action to increase limits after verification
 * - Never automatically assumes 500/day is safe
 */

export interface CapacityConfiguration {
  targetDailyCapacity: number; // Business goal / Target: 500/day
  maxPerSenderPerDay: number; // Safety limit per mailbox (default: 25)
  maxPerDomainPerDay: number; // Safety limit per domain (default: 100)
  maxTotalDailyOutreach: number; // Overall current application safety limit (default: 100)
  updatedAt: string;
  updatedBy?: string;
}

// In-memory persistent configuration store (can be initialized from env or defaults)
let currentConfig: CapacityConfiguration = {
  targetDailyCapacity: parseInt(process.env.OUTREACH_TARGET_DAILY_CAPACITY || '500', 10),
  maxPerSenderPerDay: parseInt(process.env.MAX_PER_SENDER_PER_DAY || '25', 10),
  maxPerDomainPerDay: parseInt(process.env.MAX_PER_DOMAIN_PER_DAY || '100', 10),
  maxTotalDailyOutreach: parseInt(process.env.MAX_TOTAL_DAILY_OUTREACH || '100', 10),
  updatedAt: new Date().toISOString(),
};

export class CapacityConfigService {
  /**
   * Get the current capacity configuration.
   */
  static getConfig(): CapacityConfiguration {
    return { ...currentConfig };
  }

  /**
   * Update the application capacity configuration.
   * Requires explicit administrator action.
   */
  static updateConfig(
    userId: string,
    updates: Partial<Pick<CapacityConfiguration, 'maxPerSenderPerDay' | 'maxPerDomainPerDay' | 'maxTotalDailyOutreach' | 'targetDailyCapacity'>>
  ): CapacityConfiguration {
    const nextSenderLimit = updates.maxPerSenderPerDay !== undefined
      ? Math.max(1, Math.min(200, Math.floor(updates.maxPerSenderPerDay)))
      : currentConfig.maxPerSenderPerDay;

    const nextDomainLimit = updates.maxPerDomainPerDay !== undefined
      ? Math.max(1, Math.min(1000, Math.floor(updates.maxPerDomainPerDay)))
      : currentConfig.maxPerDomainPerDay;

    const nextTotalLimit = updates.maxTotalDailyOutreach !== undefined
      ? Math.max(1, Math.min(2000, Math.floor(updates.maxTotalDailyOutreach)))
      : currentConfig.maxTotalDailyOutreach;

    const nextTarget = updates.targetDailyCapacity !== undefined
      ? Math.max(1, Math.min(5000, Math.floor(updates.targetDailyCapacity)))
      : currentConfig.targetDailyCapacity;

    currentConfig = {
      targetDailyCapacity: nextTarget,
      maxPerSenderPerDay: nextSenderLimit,
      maxPerDomainPerDay: nextDomainLimit,
      maxTotalDailyOutreach: nextTotalLimit,
      updatedAt: new Date().toISOString(),
      updatedBy: userId,
    };

    return { ...currentConfig };
  }

  /**
   * Reset configuration to safe defaults (e.g. for testing).
   */
  static resetToDefaults(): CapacityConfiguration {
    currentConfig = {
      targetDailyCapacity: 500,
      maxPerSenderPerDay: 25,
      maxPerDomainPerDay: 100,
      maxTotalDailyOutreach: 100,
      updatedAt: new Date().toISOString(),
    };
    return { ...currentConfig };
  }
}
