import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { enrichContact } from '@/lib/enrichment';
import { icypeasFindPhone } from '@/lib/enrichment/icypeas';
import { leadmagicFindPersonalEmail } from '@/lib/enrichment/leadmagic';

describe('Enrichment Phase 3 - Phone (Icypeas) & Personal Email (LeadMagic)', () => {
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
    };
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('Personal Email (LeadMagic)', () => {
    it('finds personal email when first_name is provided, charging +$0.03', async () => {
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('leadmagic.io')) {
          return {
            ok: true,
            json: async () => ({
              personal_email: 'patrick.collison@gmail.com',
            }),
          };
        }
        return { ok: false };
      });

      const result = await enrichContact({
        company_domain: 'stripe.com',
        first_name: 'Patrick',
        last_name: 'Collison',
        fields: ['personalEmail'],
      });

      expect(result.personalEmail).toEqual({
        value: 'patrick.collison@gmail.com',
        provider: 'leadmagic',
        confidence: 0.85,
        type: 'PERSONAL',
        status: 'FOUND',
      });
      expect(result.totalCost).toBe(0.03);
      expect(result.workEmail).toBeNull();
      expect(result.phone).toBeNull();
    });

    it('skips personal email when first_name is null/empty and incurs $0 cost', async () => {
      const result = await enrichContact({
        company_domain: 'stripe.com',
        first_name: null,
        fields: ['personalEmail'],
      });

      expect(result.personalEmail?.status).toBe('SKIPPED');
      expect(result.personalEmail?.reason).toBe('Requires first_name');
      expect(result.personalEmail?.value).toBeNull();
      expect(result.totalCost).toBe(0);
    });

    it('returns NOT_FOUND when LeadMagic returns no email', async () => {
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('leadmagic.io')) {
          return {
            ok: true,
            json: async () => ({ personal_email: null }),
          };
        }
        return { ok: false };
      });

      const result = await enrichContact({
        company_domain: 'stripe.com',
        first_name: 'Unknown',
        last_name: 'Person',
        fields: ['personalEmail'],
      });

      expect(result.personalEmail?.status).toBe('NOT_FOUND');
      expect(result.personalEmail?.type).toBe('PERSONAL');
      expect(result.personalEmail?.value).toBeNull();
      expect(result.totalCost).toBe(0.03);
    });
  });

  describe('Phone (Icypeas)', () => {
    it('finds phone number when domain is provided, charging +$0.019', async () => {
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('icypeas.com')) {
          return {
            ok: true,
            json: async () => ({
              phone: '+14155552671',
            }),
          };
        }
        return { ok: false };
      });

      const result = await enrichContact({
        company_domain: 'stripe.com',
        first_name: 'Patrick',
        last_name: 'Collison',
        fields: ['phone'],
      });

      expect(result.phone).toEqual({
        value: '+1 415 555 2671',
        provider: 'icypeas',
        confidence: 0.85,
        type: 'MOBILE',
        status: 'FOUND',
      });
      expect(result.totalCost).toBe(0.019);
      expect(result.workEmail).toBeNull();
      expect(result.personalEmail).toBeNull();
    });

    it('returns FAILED when domain is missing for phone search', async () => {
      const result = await enrichContact({
        company_name: 'Acme Corp',
        company_domain: null,
        first_name: 'Patrick',
        fields: ['phone'],
      });

      expect(result.phone?.status).toBe('FAILED');
      expect(result.phone?.reason).toBe('Domain required');
      expect(result.totalCost).toBe(0);
    });

    it('returns NOT_FOUND when Icypeas returns no phone number', async () => {
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('icypeas.com')) {
          return {
            ok: true,
            json: async () => ({ phone: null }),
          };
        }
        return { ok: false };
      });

      const result = await enrichContact({
        company_domain: 'nonexistent-firm.io',
        first_name: 'No',
        last_name: 'Number',
        fields: ['phone'],
      });

      expect(result.phone?.status).toBe('NOT_FOUND');
      expect(result.phone?.type).toBe('MOBILE');
      expect(result.phone?.value).toBeNull();
      expect(result.totalCost).toBe(0.019);
    });
  });

  describe('Combined Multi-Field Waterfall & Cost Accumulation', () => {
    it('accurately aggregates cost across Work Email ($0.01), Personal Email ($0.03), and Phone ($0.019)', async () => {
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('prospeo.io/email-finder')) {
          return {
            ok: true,
            json: async () => ({
              response: { email: 'patrick@stripe.com', score: 95 },
            }),
          };
        }
        if (url.includes('leadmagic.io')) {
          return {
            ok: true,
            json: async () => ({
              personal_email: 'p.collison@gmail.com',
            }),
          };
        }
        if (url.includes('icypeas.com')) {
          return {
            ok: true,
            json: async () => ({
              phone: '+14155552671',
            }),
          };
        }
        return { ok: false };
      });

      const result = await enrichContact({
        company_domain: 'stripe.com',
        first_name: 'Patrick',
        last_name: 'Collison',
        fields: ['workEmail', 'personalEmail', 'phone'],
      });

      expect(result.workEmail?.status).toBe('FOUND');
      expect(result.workEmail?.value).toBe('patrick@stripe.com');
      expect(result.personalEmail?.status).toBe('FOUND');
      expect(result.personalEmail?.value).toBe('p.collison@gmail.com');
      expect(result.phone?.status).toBe('FOUND');
      expect(result.phone?.value).toBe('+1 415 555 2671');

      // Total cost = 0.01 (Prospeo) + 0.03 (LeadMagic) + 0.019 (Icypeas) = 0.059
      expect(result.totalCost).toBe(0.059);
    });
  });
});
