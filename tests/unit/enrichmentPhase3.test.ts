import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { enrichContact } from '@/lib/enrichment';
import { icypeasFindPhone } from '@/lib/enrichment/icypeas';
import { leadmagicFindPersonalEmail } from '@/lib/enrichment/leadmagic';
import { enrichsoFindPersonalEmail, enrichsoFindPhone } from '@/lib/enrichment/enrichso';

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
        if (url.includes('/api/v1/enrich/email')) {
          return {
            ok: true,
            json: async () => ({ email: 'satya@microsoft.com' }),
          };
        }
        return { ok: false };
      });

      const res = await enrichsoFindPersonalEmail('microsoft.com', 'Satya', 'Nadella');
      expect(res).toEqual({
        email: 'satya@microsoft.com',
        provider: 'enrich.so',
      });
    });

    it('finds phone number via enrichsoFindPhone', async () => {
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/api/v1/enrich/phone')) {
          return {
            ok: true,
            json: async () => ({ phone: '+1 425 882 8080' }),
          };
        }
        return { ok: false };
      });

      const res = await enrichsoFindPhone('microsoft.com', 'Satya', 'Nadella');
      expect(res).toEqual({
        phone: '+1 425 882 8080',
        provider: 'enrich.so',
      });
    });
  });

  describe('Pipeline Flow with Enrich.so Free Demo ($0.00 cost)', () => {
    it('enriches personal email with Enrich.so without cost ($0.00)', async () => {
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/api/v1/enrich/email')) {
          return {
            ok: true,
            json: async () => ({ email: 'satya@microsoft.com' }),
          };
        }
        return { ok: false };
      });

      const result = await enrichContact({
        company_domain: 'microsoft.com',
        first_name: 'Satya',
        last_name: 'Nadella',
        fields: ['personalEmail'],
      });

      expect(result.personalEmail).toEqual({
        value: 'satya@microsoft.com',
        provider: 'enrich.so',
        confidence: 0.9,
        type: 'PERSONAL',
        status: 'FOUND',
      });
      expect(result.totalCost).toBe(0.00);
      expect(result.routing.plannedWaterfall.personalEmail).toEqual(['enrich.so']);
    });

    it('enriches phone number with Enrich.so without cost ($0.00)', async () => {
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/api/v1/enrich/phone')) {
          return {
            ok: true,
            json: async () => ({ phone: '+1 425 882 8080' }),
          };
        }
        return { ok: false };
      });

      const result = await enrichContact({
        company_domain: 'microsoft.com',
        first_name: 'Satya',
        last_name: 'Nadella',
        fields: ['phone'],
      });

      expect(result.phone).toEqual({
        value: '+1 425 882 8080',
        provider: 'enrich.so',
        confidence: 0.85,
        type: 'MOBILE',
        status: 'FOUND',
      });
      expect(result.totalCost).toBe(0.00);
      expect(result.routing.plannedWaterfall.phone).toEqual(['enrich.so']);
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

    it('enriches all 3 fields together (Free Demo preset)', async () => {
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('api.prospeo.io')) {
          return {
            ok: true,
            json: async () => ({
              error: false,
              response: { email: 'satya.nadella@microsoft.com' },
            }),
          };
        }
        if (url.includes('/api/v1/enrich/email')) {
          return {
            ok: true,
            json: async () => ({ email: 'satya.personal@outlook.com' }),
          };
        }
        if (url.includes('/api/v1/enrich/phone')) {
          return {
            ok: true,
            json: async () => ({ phone: '+1 425 882 8080' }),
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
      expect(result.personalEmail?.status).toBe('FOUND');
      expect(result.personalEmail?.value).toBe('satya.personal@outlook.com');
      expect(result.personalEmail?.provider).toBe('enrich.so');
      expect(result.phone?.status).toBe('FOUND');
      expect(result.phone?.value).toBe('+1 425 882 8080');
      expect(result.phone?.provider).toBe('enrich.so');

      // Only Prospeo was charged ($0.01), Enrich.so is free ($0.00)
      expect(result.totalCost).toBe(0.01);
    });
  });
});
