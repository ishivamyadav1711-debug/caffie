import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { enrichContact } from '@/lib/enrichment';
import { icypeasFindPhone } from '@/lib/enrichment/icypeas';
import { leadmagicFindPersonalEmail } from '@/lib/enrichment/leadmagic';
import { enrichsoFindPersonalEmail, enrichsoFindPhone } from '@/lib/enrichment/enrichso';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    enrichmentResult: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'res_1' }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    enrichmentRequest: {
      create: vi.fn().mockResolvedValue({ id: 'req_1' }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  },
}));

vi.mock('@/lib/enrichment/verify', () => ({
  verifyEmail: vi.fn().mockResolvedValue(true),
  verifyPhone: vi.fn().mockResolvedValue(true),
}));

describe('Enrichment Phase 3 - Phone & Personal Email with Enrich.so Free Demo', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = {
      ...originalEnv,
      PROSPEO_API_KEY: 'test_prospeo',
      TOMBA_API_KEY: 'test_tomba',
      TOMBA_SECRET_KEY: 'test_secret',
      ICYPEAS_API_KEY: 'test_icypeas',
      LEADMAGIC_API_KEY: 'test_leadmagic',
      ENRICHSO_API_KEY: 'test_enrichso',
    };
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('LeadMagic Adapter (Direct)', () => {
    it('finds personal email via leadmagicFindPersonalEmail', async () => {
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('leadmagic.io')) {
          return {
            ok: true,
            json: async () => ({ personal_email: 'patrick.collison@gmail.com' }),
          };
        }
        return { ok: false };
      });

      const res = await leadmagicFindPersonalEmail('stripe.com', 'Patrick', 'Collison');
      expect(res).toEqual({
        email: 'patrick.collison@gmail.com',
        provider: 'leadmagic',
        confidence: 0.85,
        type: 'PERSONAL',
      });
    });
  });

  describe('Icypeas Adapter (Direct)', () => {
    it('finds phone number via icypeasFindPhone', async () => {
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('icypeas.com')) {
          return {
            ok: true,
            json: async () => ({
              phone: '+1 415 555 2671',
              type: 'mobile',
            }),
          };
        }
        return { ok: false };
      });

      const res = await icypeasFindPhone('stripe.com', 'Patrick', 'Collison', 'US');
      expect(res).toEqual({
        phone: '+1 415 555 2671',
        provider: 'icypeas',
        confidence: 0.85,
        type: 'MOBILE',
      });
    });
  });

  describe('Enrich.so Adapter (Direct)', () => {
    it('finds personal email via enrichsoFindPersonalEmail', async () => {
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('linkedin-to-personal-email')) {
          return {
            ok: true,
            json: async () => ({
              success: true,
              data: {
                found: true,
                personalEmail: 'satya.nadella@gmail.com',
              },
            }),
          };
        }
        return { ok: false };
      });

      const res = await enrichsoFindPersonalEmail('microsoft.com', 'Satya', 'Nadella', 'https://linkedin.com/in/satyanadella');
      expect(res).toEqual({
        email: 'satya.nadella@gmail.com',
        provider: 'enrich.so',
        type: 'PERSONAL',
        confidence: 0.9,
      });
    });

    it('rejects work email or corporate domain email for personal email', async () => {
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('linkedin-to-personal-email')) {
          return {
            ok: true,
            json: async () => ({
              success: true,
              data: {
                found: true,
                personalEmail: 'ritesh@oyorooms.com',
              },
            }),
          };
        }
        return { ok: false };
      });

      const res = await enrichsoFindPersonalEmail('oyorooms.com', 'Ritesh', 'Agarwal', 'https://linkedin.com/in/riteshagar');
      expect(res).toBeNull();
    });

    it('returns null when enrichsoFindPhone has no phone', async () => {
      const res = await enrichsoFindPhone('microsoft.com', 'Satya', 'Nadella');
      expect(res).toBeNull();
    });
  });

  describe('Pipeline Flow with Enrich.so Free Demo ($0.00 cost)', () => {
    it('enriches personal email with Enrich.so without cost ($0.00)', async () => {
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('linkedin-to-personal-email')) {
          return {
            ok: true,
            json: async () => ({
              success: true,
              data: { found: true, personalEmail: 'satya.personal@gmail.com' },
            }),
          };
        }
        return { ok: false };
      });

      const result = await enrichContact({
        company_domain: 'microsoft.com',
        first_name: 'Satya',
        last_name: 'Nadella',
        linkedin_url: 'https://linkedin.com/in/satyanadella',
        fields: ['personalEmail'],
      });

      expect(result.personalEmail).toEqual({
        value: 'satya.personal@gmail.com',
        provider: 'enrich.so',
        confidence: 0.9,
        type: 'PERSONAL',
        status: 'FOUND',
        verified: true,
      });
      expect(result.totalCost).toBe(0.00);
      expect(result.routing.plannedWaterfall.personalEmail).toEqual(['enrich.so']);
    });

    it('sets personalEmail to NOT_FOUND when Enrich.so returns corporate domain email', async () => {
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('linkedin-to-personal-email')) {
          return {
            ok: true,
            json: async () => ({
              success: true,
              data: { found: true, personalEmail: 'ritesh@oyorooms.com' },
            }),
          };
        }
        return { ok: false };
      });

      const result = await enrichContact({
        company_domain: 'oyorooms.com',
        first_name: 'Ritesh',
        last_name: 'Agarwal',
        linkedin_url: 'https://linkedin.com/in/riteshagar',
        fields: ['personalEmail'],
      });

      expect(result.personalEmail).toEqual({
        value: null,
        provider: null,
        confidence: null,
        type: 'PERSONAL',
        status: 'NOT_FOUND',
        reason: 'No personal email found',
      });
      expect(result.totalCost).toBe(0.00);
    });

    it('returns NOT_FOUND when Enrich.so returns no phone', async () => {
      const result = await enrichContact({
        company_domain: 'microsoft.com',
        first_name: 'Satya',
        last_name: 'Nadella',
        fields: ['phone'],
      });

      expect(result.phone).toEqual({
        value: null,
        provider: null,
        confidence: null,
        type: 'MOBILE',
        status: 'NOT_FOUND',
        reason: 'No direct phone found',
      });
      expect(result.totalCost).toBe(0.00);
      expect(result.routing.plannedWaterfall.phone).toEqual(['prospeo', 'icypeas', 'enrich.so']);
    });

    it('skips personal email when first_name is missing', async () => {
      const result = await enrichContact({
        company_domain: 'microsoft.com',
        first_name: null,
        fields: ['personalEmail'],
      });

      expect(result.personalEmail?.status).toBe('SKIPPED');
      expect(result.personalEmail?.reason).toBe('Requires first_name');
      expect(result.totalCost).toBe(0);
    });

    it('fails phone when domain is missing', async () => {
      const result = await enrichContact({
        company_name: 'Microsoft Inc',
        first_name: 'Satya',
        fields: ['phone'],
      });

      expect(result.phone?.status).toBe('FAILED');
      expect(result.phone?.reason).toBe('Domain required');
    });

    it('enriches contacts returning real API data without mock phone', async () => {
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('api.prospeo.io/enrich-person')) {
          return {
            ok: true,
            json: async () => ({
              error: false,
              person: {
                email: { email: 'satya.nadella@microsoft.com', status: 'VERIFIED' },
              },
            }),
          };
        }
        return { ok: false };
      });

      const result = await enrichContact({
        company_domain: 'microsoft.com',
        company_name: 'Microsoft',
        first_name: 'Satya',
        last_name: 'Nadella',
        fields: ['workEmail', 'personalEmail', 'phone'],
      });

      expect(result.workEmail?.status).toBe('FOUND');
      expect(result.workEmail?.value).toBe('satya.nadella@microsoft.com');
      expect(result.phone?.status).toBe('NOT_FOUND');
      expect(result.phone?.value).toBeNull();
      expect(result.phone?.provider).toBeNull();

      // Only Prospeo was charged ($0.01)
      expect(result.totalCost).toBe(0.01);
    });
  });
});
