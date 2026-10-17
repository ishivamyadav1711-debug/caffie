import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { enrichContact } from '@/lib/enrichment';
import { selectBestGenericEmail } from '@/lib/enrichment/prospeo';

describe('Enrichment Phase 2 - Work Email Waterfall & Search Modes', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = {
      ...originalEnv,
      PROSPEO_API_KEY: 'test_prospeo_key',
      TOMBA_API_KEY: 'test_tomba_key',
      TOMBA_SECRET_KEY: 'test_tomba_secret',
    };
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('selectBestGenericEmail helper', () => {
    it('selects info@ or contact@ over personal emails', () => {
      const candidates = ['john@acme.com', 'sales@acme.com', 'info@acme.com'];
      const best = selectBestGenericEmail(candidates);
      expect(best).toBe('info@acme.com');
    });

    it('falls back to first cleaned email if no generic alias matches', () => {
      const candidates = ['founder@acme.com', 'team-lead@acme.com'];
      const best = selectBestGenericEmail(candidates);
      expect(best).toBe('founder@acme.com');
    });
  });

  describe('Rule 2: Missing company_domain', () => {
    it('skips real API calls and returns status FAILED with reason Domain required', async () => {
      const result = await enrichContact({
        company_name: 'Acme Technologies',
        company_domain: null,
        first_name: 'John',
        fields: ['workEmail'],
      });

      expect(result.workEmail?.status).toBe('FAILED');
      expect(result.workEmail?.reason).toBe('Domain required');
      expect(result.totalCost).toBe(0);
    });
  });

  describe('Mode A: Person Search (first_name is provided)', () => {
    it('returns Prospeo email and stops on first success with cost 0.01', async () => {
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('prospeo.io/email-finder')) {
          return {
            ok: true,
            json: async () => ({
              error: false,
              response: { email: 'satya.nadella@microsoft.com', score: 98 },
            }),
          };
        }
        return { ok: false };
      });

      const result = await enrichContact({
        company_domain: 'microsoft.com',
        first_name: 'Satya',
        last_name: 'Nadella',
        fields: ['workEmail'],
      });

      expect(result.workEmail).toEqual({
        value: 'satya.nadella@microsoft.com',
        provider: 'prospeo',
        confidence: 0.98,
        type: 'SPECIFIC',
        status: 'FOUND',
      });
      expect(result.totalCost).toBe(0.01);
      // Tomba should NOT have been called
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('falls back to Tomba if Prospeo fails and sets cost 0.0178', async () => {
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('prospeo.io/email-finder')) {
          return {
            ok: true,
            json: async () => ({ error: true, response: null }),
          };
        }
        if (url.includes('tomba.io/v1/email-finder')) {
          return {
            ok: true,
            json: async () => ({
              data: { email: 'tim.cook@apple.com', score: 92 },
            }),
          };
        }
        return { ok: false };
      });

      const result = await enrichContact({
        company_domain: 'apple.com',
        first_name: 'Tim',
        last_name: 'Cook',
        fields: ['workEmail'],
      });

      expect(result.workEmail).toEqual({
        value: 'tim.cook@apple.com',
        provider: 'tomba',
        confidence: 0.92,
        type: 'SPECIFIC',
        status: 'FOUND',
      });
      expect(result.totalCost).toBe(0.0178);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('returns NOT_FOUND if both Prospeo and Tomba fail', async () => {
      global.fetch = vi.fn().mockImplementation(async () => ({
        ok: false,
        status: 404,
      }));

      const result = await enrichContact({
        company_domain: 'unknowncompany12345.org',
        first_name: 'Unknown',
        last_name: 'User',
        fields: ['workEmail'],
      });

      expect(result.workEmail?.status).toBe('NOT_FOUND');
      expect(result.workEmail?.type).toBe('SPECIFIC');
      expect(result.workEmail?.value).toBeNull();
      expect(result.totalCost).toBe(0.0178);
    });
  });

  describe('Mode B: Domain Search (first_name is missing)', () => {
    it('returns Prospeo generic email on first success with cost 0.01', async () => {
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('prospeo.io/domain-search')) {
          return {
            ok: true,
            json: async () => ({
              response: {
                generic_emails: ['support@stripe.com', 'info@stripe.com'],
              },
            }),
          };
        }
        return { ok: false };
      });

      const result = await enrichContact({
        company_domain: 'stripe.com',
        fields: ['workEmail'],
      });

      expect(result.workEmail).toEqual({
        value: 'info@stripe.com',
        provider: 'prospeo',
        confidence: 0.85,
        type: 'GENERIC',
        status: 'FOUND',
      });
      expect(result.totalCost).toBe(0.01);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('falls back to Tomba domain search when Prospeo returns no generic emails', async () => {
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('prospeo.io')) {
          return {
            ok: true,
            json: async () => ({ response: { generic_emails: [] } }),
          };
        }
        if (url.includes('tomba.io/v1/domain-search')) {
          return {
            ok: true,
            json: async () => ({
              data: {
                emails: [
                  { email: 'john@uber.com', type: 'personal' },
                  { email: 'contact@uber.com', type: 'generic' },
                ],
              },
            }),
          };
        }
        return { ok: false };
      });

      const result = await enrichContact({
        company_domain: 'uber.com',
        fields: ['workEmail'],
      });

      expect(result.workEmail).toEqual({
        value: 'contact@uber.com',
        provider: 'tomba',
        confidence: 0.85,
        type: 'GENERIC',
        status: 'FOUND',
      });
      expect(result.totalCost).toBe(0.0178);
    });

    it('returns NOT_FOUND with type GENERIC if both fail in Domain Search mode', async () => {
      global.fetch = vi.fn().mockImplementation(async () => ({
        ok: false,
        status: 404,
      }));

      const result = await enrichContact({
        company_domain: 'nonexistent-startup-xyz.io',
        fields: ['workEmail'],
      });

      expect(result.workEmail?.status).toBe('NOT_FOUND');
      expect(result.workEmail?.type).toBe('GENERIC');
      expect(result.workEmail?.value).toBeNull();
      expect(result.totalCost).toBe(0.0178);
    });
  });
});
