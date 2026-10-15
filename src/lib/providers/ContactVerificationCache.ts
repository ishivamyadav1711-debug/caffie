/**
 * Verification Cache Service for LeadPilot
 * 
 * Implements persistent & memory verification caching:
 * - Avoids paying external verification fees for previously verified contacts
 * - Configurable TTL (default: CONTACT_VERIFICATION_TTL_DAYS = 30)
 * - Checks PostgreSQL ContactVerification table as persistent cache
 * - Maintains fast in-memory LRU for hot contacts during job execution
 * - Clean expiry handling: if verification expired, returns null to trigger re-verification
 */
import { prisma } from '@/lib/prisma';
import type { PhoneVerificationResult } from './phoneVerificationProvider';
import type { EmailVerificationResult } from './emailVerificationProvider2';

export interface CachedVerificationItem {
  key: string;
  type: 'PHONE' | 'EMAIL';
  normalizedValue: string;
  provider: string;
  status: string;
  level: string;
  providerStatus?: string;
  lineType?: string;
  carrier?: string;
  hasMxRecords?: boolean | null;
  isDisposable?: boolean;
  isRoleBased?: boolean;
  confidence: number;
  evidence?: string;
  details?: Record<string, any>;
  verifiedAt: Date;
  expiresAt: Date;
}

const memoryCache = new Map<string, { item: CachedVerificationItem; expiresAtMs: number }>();
const DEFAULT_TTL_DAYS = 30;

export class ContactVerificationCache {
  private getTtlDays(): number {
    const envVal = Number(process.env.CONTACT_VERIFICATION_TTL_DAYS);
    return !isNaN(envVal) && envVal > 0 ? envVal : DEFAULT_TTL_DAYS;
  }

  public getCacheKey(type: 'PHONE' | 'EMAIL', normalizedValue: string, provider: string): string {
    return `${type}:${normalizedValue.trim().toLowerCase()}:${provider.trim().toLowerCase()}`;
  }

  /**
   * Retrieves a cached verification if available and within TTL.
   */
  public async get(
    type: 'PHONE' | 'EMAIL',
    normalizedValue: string,
    provider: string
  ): Promise<CachedVerificationItem | null> {
    const key = this.getCacheKey(type, normalizedValue, provider);
    const now = Date.now();

    // 1. Fast in-memory check
    const memEntry = memoryCache.get(key);
    if (memEntry) {
      if (memEntry.expiresAtMs > now) {
        return memEntry.item;
      }
      memoryCache.delete(key);
    }

    // 2. Persistent PostgreSQL lookup
    try {
      const record = await prisma.contactVerification.findFirst({
        where: {
          normalizedValue: normalizedValue.trim().toLowerCase(),
          provider: provider.trim().toLowerCase(),
          expiresAt: { gt: new Date(now) },
        },
        orderBy: { verifiedAt: 'desc' },
      });

      if (!record || !record.expiresAt) {
        return null;
      }

      let parsedDetails: Record<string, any> | undefined;
      if (record.details) {
        try {
          parsedDetails = JSON.parse(record.details);
        } catch {
          // ignore parsing error
        }
      }

      const item: CachedVerificationItem = {
        key,
        type,
        normalizedValue: record.normalizedValue || normalizedValue,
        provider: record.provider,
        status: record.status,
        level: record.level,
        providerStatus: record.providerStatus || undefined,
        lineType: record.lineType || undefined,
        carrier: record.carrier || undefined,
        hasMxRecords: record.hasMxRecords,
        isDisposable: record.isDisposable,
        isRoleBased: record.isRoleBased,
        confidence: record.confidence,
        evidence: record.evidence || undefined,
        details: parsedDetails,
        verifiedAt: record.verifiedAt,
        expiresAt: record.expiresAt,
      };

      // Populate memory cache
      memoryCache.set(key, { item, expiresAtMs: record.expiresAt.getTime() });
      return item;
    } catch {
      return null;
    }
  }

  /**
   * Stores a verification result into both memory and persistent storage with expiration.
   */
  public async set(
    type: 'PHONE' | 'EMAIL',
    normalizedValue: string,
    provider: string,
    data: {
      status: string;
      level: string;
      providerStatus?: string;
      lineType?: string;
      carrier?: string;
      hasMxRecords?: boolean | null;
      isDisposable?: boolean;
      isRoleBased?: boolean;
      confidence: number;
      evidence?: string;
      details?: Record<string, any>;
    }
  ): Promise<void> {
    const key = this.getCacheKey(type, normalizedValue, provider);
    const ttlDays = this.getTtlDays();
    const verifiedAt = new Date();
    const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);

    const item: CachedVerificationItem = {
      key,
      type,
      normalizedValue: normalizedValue.trim().toLowerCase(),
      provider: provider.trim().toLowerCase(),
      status: data.status,
      level: data.level,
      providerStatus: data.providerStatus,
      lineType: data.lineType,
      carrier: data.carrier,
      hasMxRecords: data.hasMxRecords,
      isDisposable: data.isDisposable,
      isRoleBased: data.isRoleBased,
      confidence: data.confidence,
      evidence: data.evidence,
      details: data.details,
      verifiedAt,
      expiresAt,
    };

    memoryCache.set(key, { item, expiresAtMs: expiresAt.getTime() });
  }

  public async savePhoneVerification(
    phone: string,
    result: any,
    ttlDays?: number
  ): Promise<void> {
    const ttl = ttlDays || this.getTtlDays();
    const verifiedAt = new Date();
    const expiresAt = new Date(Date.now() + ttl * 24 * 60 * 60 * 1000);
    const key = this.getCacheKey('PHONE', phone, result.provider);

    const item: CachedVerificationItem = {
      key,
      type: 'PHONE',
      normalizedValue: phone.trim().toLowerCase(),
      provider: result.provider.trim().toLowerCase(),
      status: result.verificationStatus,
      level: result.verificationLevel,
      providerStatus: result.providerStatus,
      lineType: result.lineType,
      carrier: result.carrier,
      confidence: result.confidence,
      details: result.details,
      verifiedAt,
      expiresAt,
    };

    memoryCache.set(key, { item, expiresAtMs: expiresAt.getTime() });
  }

  public async getCachedPhoneVerification(
    phone: string,
    provider: string
  ): Promise<CachedVerificationItem | null> {
    return this.get('PHONE', phone, provider);
  }

  public async saveEmailVerification(
    email: string,
    result: any,
    ttlDays?: number
  ): Promise<void> {
    const ttl = ttlDays || this.getTtlDays();
    const verifiedAt = new Date();
    const expiresAt = new Date(Date.now() + ttl * 24 * 60 * 60 * 1000);
    const key = this.getCacheKey('EMAIL', email, result.provider);

    const item: CachedVerificationItem = {
      key,
      type: 'EMAIL',
      normalizedValue: email.trim().toLowerCase(),
      provider: result.provider.trim().toLowerCase(),
      status: result.verificationStatus,
      level: result.verificationLevel,
      providerStatus: result.providerStatus,
      hasMxRecords: result.hasMxRecords,
      isDisposable: result.isDisposable,
      isRoleBased: result.isRoleBased,
      confidence: result.confidence,
      details: result.details,
      verifiedAt,
      expiresAt,
    };

    memoryCache.set(key, { item, expiresAtMs: expiresAt.getTime() });
  }

  public async getCachedEmailVerification(
    email: string,
    provider: string
  ): Promise<CachedVerificationItem | null> {
    return this.get('EMAIL', email, provider);
  }

  public clearMemoryCache(): void {
    memoryCache.clear();
  }
}

export const contactVerificationCache = new ContactVerificationCache();
