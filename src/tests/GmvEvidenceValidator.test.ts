import { describe, it, expect, beforeAll, vi, afterAll } from 'vitest';
import { GmvEvidenceValidator } from '../lib/commercial/GmvEvidenceValidator';

describe('GmvEvidenceValidator', () => {
  let validator: GmvEvidenceValidator;
  const originalFetch = global.fetch;

  beforeAll(() => {
    validator = new GmvEvidenceValidator();
    // Mock DNS for safe testing of SSRF
    vi.spyOn(validator as any, 'isSafeHostname').mockImplementation(async (hostname: string) => {
      if (hostname === 'localhost' || hostname === '127.0.0.1') return false;
      return true;
    });
  });

  afterAll(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('should reject Non-GMV metrics (Revenue/Sales/ARR/Funding/Valuation)', async () => {
    const revenueCase = await validator.validateEvidence({
      evidenceText: 'Stripe hit $1 billion in annual revenue last year.',
      sourceUrl: 'https://example.com/stripe-revenue',
      businessName: 'Stripe',
      claimedGmvAmount: 1000000000,
      claimedDate: '2023-01-01',
      claimedDateAccuracy: 'YEAR'
    });
    expect(revenueCase.valid).toBe(false);
    expect(revenueCase.rejectionReason).toBe('NON_GMV_METRIC');

    const salesCase = await validator.validateEvidence({
      evidenceText: 'Shopify reported $5B in quarterly sales.',
      sourceUrl: 'https://example.com/shopify-sales',
      businessName: 'Shopify',
      claimedGmvAmount: 5000000000,
      claimedDate: '2023-01-01',
      claimedDateAccuracy: 'YEAR'
    });
    expect(salesCase.valid).toBe(false);
    expect(salesCase.rejectionReason).toBe('NON_GMV_METRIC');

    const fundingCase = await validator.validateEvidence({
      evidenceText: 'Flipkart raised $1B in fresh funding.',
      sourceUrl: 'https://example.com/flipkart-funding',
      businessName: 'Flipkart',
      claimedGmvAmount: 1000000000,
      claimedDate: '2023-01-01',
      claimedDateAccuracy: 'YEAR'
    });
    expect(fundingCase.valid).toBe(false);
    expect(fundingCase.rejectionReason).toBe('NON_GMV_METRIC');
  });

  it('should accept valid GMV claims', async () => {
    const mockValidator = new GmvEvidenceValidator();
    vi.spyOn(mockValidator as any, 'isSafeHostname').mockResolvedValue(true);
    
    // Mock global fetch to return corroborating page
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: {
        getReader: () => {
          let readOnce = false;
          return {
            read: async () => {
              if (readOnce) return { done: true, value: undefined };
              readOnce = true;
              return { done: false, value: new TextEncoder().encode('Flipkart crossed $1.5 billion in Gross Merchandise Value (GMV) during the festive season sales.') };
            }
          };
        }
      }
    } as any);
    
    const validCase = await mockValidator.validateEvidence({
      evidenceText: 'Flipkart crossed $1.5 billion in Gross Merchandise Value (GMV) during the festive season sales.',
      sourceUrl: 'https://example.com/flipkart-gmv',
      businessName: 'Flipkart',
      claimedGmvAmount: 1500000000,
      claimedDate: '2023-10-01',
      claimedDateAccuracy: 'MONTH_YEAR'
    });
    
    expect(validCase.valid).toBe(true);
  });

  it('should reject when page content does not corroborate evidence snippet (Hallucination)', async () => {
    const mockValidator = new GmvEvidenceValidator();
    vi.spyOn(mockValidator as any, 'isSafeHostname').mockResolvedValue(true);
    
    // Mock global fetch to return different page
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: {
        getReader: () => {
          let readOnce = false;
          return {
            read: async () => {
              if (readOnce) return { done: true, value: undefined };
              readOnce = true;
              return { done: false, value: new TextEncoder().encode('Flipkart is a great company but nothing else is here.') };
            }
          };
        }
      }
    } as any);
    
    const hallucinationCase = await mockValidator.validateEvidence({
      evidenceText: 'Flipkart crossed $1.5 billion in Gross Merchandise Value (GMV) during the festive season sales.',
      sourceUrl: 'https://example.com/flipkart-gmv',
      businessName: 'Flipkart',
      claimedGmvAmount: 1500000000,
      claimedDate: '2023-10-01',
      claimedDateAccuracy: 'MONTH_YEAR'
    });
    
    expect(hallucinationCase.valid).toBe(false);
    expect(hallucinationCase.rejectionReason).toBe('SOURCE_UNVERIFIED');
  });

  it('should reject private or internal SSRF URLs', async () => {
    const mockValidator = new GmvEvidenceValidator();
    
    const localCase = await mockValidator.validateEvidence({
      evidenceText: 'Test GMV claim 1 billion',
      sourceUrl: 'http://localhost:8080/admin',
      businessName: 'Test',
      claimedGmvAmount: 1000000000,
      claimedDate: '2023-01-01',
      claimedDateAccuracy: 'YEAR'
    });
    expect(localCase.valid).toBe(false);
    expect(localCase.rejectionReason).toBe('FABRICATED_OR_INVALID_URL');
  });
});
