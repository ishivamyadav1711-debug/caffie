import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sanitizeDatabaseUrl } from '@/lib/prisma';
import { leadHistoryService } from '@/lib/workflow/LeadHistoryService';
import {
  evaluateFinancialEligibility,
  METRIC_DESCRIPTIONS,
} from '@/lib/financial/financialEvidenceEvaluator';
import {
  convertToInr,
  formatInrCrores,
  EXCHANGE_RATES,
} from '@/lib/financial/currencyConverter';
import {
  HIGH_NET_WORTH_THRESHOLD_INR,
  FinancialEvidenceRecord,
} from '@/lib/financial/types';
import {
  financialEvidenceProvider,
  calculateEntityMatchConfidence,
} from '@/lib/financial/FinancialEvidenceProvider';
import { LeadPilotOrchestrator } from '@/orchestrator/LeadPilotOrchestrator';

describe('Database and Financial Safety Suite (LeadPilot ₹70 Cr Experimental Evaluation)', () => {
  describe('1. Database URL Sanitization & Protocol Validation', () => {
    it('handles clean postgresql:// and postgres:// URLs without changes', () => {
      const cleanUrl = 'postgresql://leadpilot_user:secret_pass@ep-rest-123.us-east-1.aws.neon.tech/scrapper_db?sslmode=require';
      expect(sanitizeDatabaseUrl(cleanUrl)).toBe(cleanUrl);

      const postgresUrl = 'postgres://user:pass@localhost:5432/testdb';
      expect(sanitizeDatabaseUrl(postgresUrl)).toBe(postgresUrl);
    });

    it('strips leading and trailing double-quotes injected by deployment environments', () => {
      const quoted = '""postgresql://leadpilot_user:secret_pass@ep-rest-123.us-east-1.aws.neon.tech/scrapper_db?sslmode=require""';
      const expected = 'postgresql://leadpilot_user:secret_pass@ep-rest-123.us-east-1.aws.neon.tech/scrapper_db?sslmode=require';
      expect(sanitizeDatabaseUrl(quoted)).toBe(expected);
    });

    it('strips escaped quotes and surrounding whitespace', () => {
      const escaped = ' \\"postgresql://user:pass@host:5432/db\\" \n';
      expect(sanitizeDatabaseUrl(escaped)).toBe('postgresql://user:pass@host:5432/db');
    });

    it('returns empty string safely when URL is undefined or empty', () => {
      expect(sanitizeDatabaseUrl(undefined)).toBe('');
      expect(sanitizeDatabaseUrl('')).toBe('');
      expect(sanitizeDatabaseUrl('   ')).toBe('');
    });
  });

  describe('2. Search-History Persistence & Database Resilience', () => {
    it('gracefully handles database lookup failures without crashing the pipeline', async () => {
      const placeIds = await leadHistoryService.getRecentDeliveredPlaceIds('fp_maharashtra_automotive');
      expect(placeIds instanceof Set).toBe(true);
    });

    it('falls back to in-memory history when recording delivery fails', async () => {
      // Should not throw even if DB write encounters issues
      await expect(
        leadHistoryService.recordDeliveryToDb(
          'fp_maharashtra_automotive',
          'job_123',
          [
            { placeId: 'place_123', name: 'Auto Services Ltd' },
            { placeId: 'place_456', name: 'Precision Motors' },
          ]
        )
      ).resolves.not.toThrow();

      // Recent place IDs should now contain the delivered items in memory
      const recent = await leadHistoryService.getRecentDeliveredPlaceIds('fp_maharashtra_automotive');
      expect(recent.has('place_123')).toBe(true);
      expect(recent.has('place_456')).toBe(true);
    });
  });

  describe('3. ₹70 Crore Threshold Exact Boundary & Edge Cases', () => {
    it('strictly evaluates the exact boundary of 700,000,000 INR', () => {
      expect(HIGH_NET_WORTH_THRESHOLD_INR).toBe(700_000_000);

      // 69.99 Crore INR (1 rupee below 70 Cr) -> thresholdMet = false
      const below = convertToInr(699_999_999, 'INR');
      expect(below.thresholdMet).toBe(false);

      // Exactly 70.00 Crore INR -> thresholdMet = true
      const exact = convertToInr(700_000_000, 'INR');
      expect(exact.thresholdMet).toBe(true);

      // 70.01 Crore INR -> thresholdMet = true
      const above = convertToInr(700_100_000, 'INR');
      expect(above.thresholdMet).toBe(true);
    });

    it('safely handles zero, negative, NaN, and non-numeric amounts', () => {
      const zero = convertToInr(0, 'INR');
      expect(zero.amountInInr).toBe(0);
      expect(zero.thresholdMet).toBe(false);

      const negative = convertToInr(-500_000_000, 'INR');
      expect(negative.amountInInr).toBe(0);
      expect(negative.thresholdMet).toBe(false);

      const nanVal = convertToInr(NaN, 'USD');
      expect(nanVal.amountInInr).toBe(0);
      expect(nanVal.thresholdMet).toBe(false);
    });
  });

  describe('4. Strict Net Worth vs Broad Financial Scale Modes', () => {
    const revenueEvidence: FinancialEvidenceRecord[] = [
      {
        metricType: 'REVENUE',
        rawAmount: 1_000_000_000, // ₹100 Cr INR
        currency: 'INR',
        amountInInr: 1_000_000_000,
        conversionRateUsed: 1.0,
        conversionMethod: 'Direct base currency (INR)',
        conversionDate: '2026-10-01',
        thresholdMet: true,
        reportingPeriod: 'FY2023-24',
        sourceName: 'MCA Official Filing',
        sourceTier: 'TIER_1_REGISTRY',
        evidenceDate: '2024-03-31',
        matchingConfidence: 0.95,
      },
    ];

    const netWorthEvidence: FinancialEvidenceRecord[] = [
      {
        metricType: 'NET_WORTH',
        rawAmount: 750_000_000, // ₹75 Cr INR
        currency: 'INR',
        amountInInr: 750_000_000,
        conversionRateUsed: 1.0,
        conversionMethod: 'Direct base currency (INR)',
        conversionDate: '2026-10-01',
        thresholdMet: true,
        reportingPeriod: 'FY2023-24',
        sourceName: 'MCA Official Filing',
        sourceTier: 'TIER_1_REGISTRY',
        evidenceDate: '2024-03-31',
        matchingConfidence: 0.95,
      },
    ];

    it('in STRICT_NET_WORTH mode: rejects businesses with only revenue or valuation', () => {
      const evalRevenue = evaluateFinancialEligibility(
        revenueEvidence,
        { businessName: 'Tech Services Pvt Ltd' },
        'STRICT_NET_WORTH'
      );
      expect(evalRevenue.eligibilityState).toBe('NOT_QUALIFIED');
      expect(evalRevenue.isQualified).toBe(false);
      expect(evalRevenue.qualificationExplanation).toContain('Revenue / Turnover, not Net Worth');

      const evalNetWorth = evaluateFinancialEligibility(
        netWorthEvidence,
        { businessName: 'Tech Services Pvt Ltd' },
        'STRICT_NET_WORTH'
      );
      expect(evalNetWorth.eligibilityState).toBe('QUALIFIED');
      expect(evalNetWorth.isQualified).toBe(true);
      expect(evalNetWorth.isNetWorth).toBe(true);
      expect(evalNetWorth.metricLabel).toContain('Verified Net Worth');
    });

    it('in BROAD_FINANCIAL_SCALE mode: qualifies businesses with verified revenue ≥ ₹70 Cr with clear labeling', () => {
      const evalRevenue = evaluateFinancialEligibility(
        revenueEvidence,
        { businessName: 'Tech Services Pvt Ltd' },
        'BROAD_FINANCIAL_SCALE'
      );
      expect(evalRevenue.eligibilityState).toBe('QUALIFIED');
      expect(evalRevenue.isQualified).toBe(true);
      expect(evalRevenue.isNetWorth).toBe(false);
      expect(evalRevenue.metricLabel).toContain('Annual Revenue');
    });
  });

  describe('5. Entity Matching & Parent-Child Decoupling', () => {
    it('calculates token similarity and prevents attributing corporate filings to independent shops', () => {
      // Unrelated or distinct entities must have low similarity
      const confLocal = calculateEntityMatchConfidence('Sharma Auto Repair', 'Tata Motors Limited');
      expect(confLocal).toBeLessThan(0.3);

      // Near identical names have high confidence
      const confExact = calculateEntityMatchConfidence('Tata Motors Limited', 'Tata Motors Ltd');
      expect(confExact).toBeGreaterThan(0.85);

      const confParent = calculateEntityMatchConfidence('Reliance Retail Limited', 'Reliance Retail Ltd');
      expect(confParent).toBeGreaterThan(0.85);
    });

    it('rejects evidence with matchingConfidence below 0.80 as INSUFFICIENT_EVIDENCE', () => {
      const lowConfidenceEvidence: FinancialEvidenceRecord[] = [
        {
          metricType: 'NET_WORTH',
          rawAmount: 5_000_000_000,
          currency: 'INR',
          amountInInr: 5_000_000_000,
          conversionRateUsed: 1.0,
          conversionMethod: 'Direct base currency (INR)',
          conversionDate: '2026-10-01',
          thresholdMet: true,
          reportingPeriod: 'FY2023-24',
          sourceName: 'MCA Official Filing',
          sourceTier: 'TIER_1_REGISTRY',
          evidenceDate: '2024-03-31',
          matchingConfidence: 0.55, // Low match!
        },
      ];

      const res = evaluateFinancialEligibility(
        lowConfidenceEvidence,
        { businessName: 'Independent Sharma Garage' },
        'STRICT_NET_WORTH'
      );
      expect(res.eligibilityState).toBe('INSUFFICIENT_EVIDENCE');
      expect(res.isQualified).toBe(false);
      expect(res.qualificationExplanation).toContain('Entity match confidence');
    });
  });

  describe('6. Evidence Freshness & Contradiction Handling', () => {
    it('marks evidence older than 5 years as STALE and rejects it as INSUFFICIENT_EVIDENCE', () => {
      const staleEvidence: FinancialEvidenceRecord[] = [
        {
          metricType: 'NET_WORTH',
          rawAmount: 1_000_000_000,
          currency: 'INR',
          amountInInr: 1_000_000_000,
          conversionRateUsed: 1.0,
          conversionMethod: 'Direct base currency (INR)',
          conversionDate: '2026-10-01',
          thresholdMet: true,
          reportingPeriod: 'FY2018-19',
          sourceName: 'Archived Filing',
          sourceTier: 'TIER_2_DISCLOSURE',
          evidenceDate: '2019-03-31', // > 5 years old relative to 2026
          verificationStatus: 'STALE',
          matchingConfidence: 0.95,
        },
      ];

      const res = evaluateFinancialEligibility(
        staleEvidence,
        { businessName: 'Old Steel Industries' },
        'STRICT_NET_WORTH'
      );
      expect(res.eligibilityState).toBe('INSUFFICIENT_EVIDENCE');
      expect(res.isQualified).toBe(false);
      expect(res.qualificationExplanation).toContain('stale or contradictory');
    });

    it('rejects records flagged as CONTRADICTORY or UNVERIFIED', () => {
      const contradictoryEvidence: FinancialEvidenceRecord[] = [
        {
          metricType: 'NET_WORTH',
          rawAmount: 900_000_000,
          currency: 'INR',
          amountInInr: 900_000_000,
          conversionRateUsed: 1.0,
          conversionMethod: 'Direct base currency (INR)',
          conversionDate: '2026-10-01',
          thresholdMet: true,
          reportingPeriod: 'FY2023-24',
          sourceName: 'Conflicting Sources',
          sourceTier: 'TIER_2_DISCLOSURE',
          evidenceDate: '2024-03-31',
          verificationStatus: 'CONTRADICTORY',
          matchingConfidence: 0.95,
        },
      ];

      const res = evaluateFinancialEligibility(
        contradictoryEvidence,
        { businessName: 'Unclear Holdings' },
        'STRICT_NET_WORTH'
      );
      expect(res.eligibilityState).toBe('INSUFFICIENT_EVIDENCE');
      expect(res.isQualified).toBe(false);
      expect(res.qualificationExplanation).toContain('contradictory');
    });
  });

  describe('7. Absence of Synthetic Data in Live Mode', () => {
    it('returns empty evidence array for ordinary local businesses without public filings', async () => {
      // Ordinary unlisted business
      const evidence = await financialEvidenceProvider.getFinancialEvidence('Ganesh Kirana Store', 'India');
      expect(evidence).toEqual([]);

      const evalRes = evaluateFinancialEligibility(evidence, { businessName: 'Ganesh Kirana Store' });
      expect(evalRes.eligibilityState).toBe('INSUFFICIENT_EVIDENCE');
      expect(evalRes.isQualified).toBe(false);
    });
  });
});
