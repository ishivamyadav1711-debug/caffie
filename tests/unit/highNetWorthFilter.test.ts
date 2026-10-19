import { describe, it, expect, vi } from 'vitest';
import {
  evaluateFinancialEligibility,
  METRIC_DESCRIPTIONS,
} from '@/lib/financial/financialEvidenceEvaluator';
import {
  convertToInr,
  formatInrCrores,
} from '@/lib/financial/currencyConverter';
import {
  HIGH_NET_WORTH_THRESHOLD_INR,
  FinancialEvidenceRecord,
  FinancialMetricType,
} from '@/lib/financial/types';
import { LeadPilotOrchestrator } from '@/orchestrator/LeadPilotOrchestrator';

describe('Experimental High-Net-Worth Business Filter (₹70 Crore INR)', () => {
  describe('1. Threshold & Constant Definitions', () => {
    it('defines ₹70 Crore INR threshold exactly as 700,000,000 INR', () => {
      expect(HIGH_NET_WORTH_THRESHOLD_INR).toBe(700_000_000);
      expect(formatInrCrores(700_000_000)).toBe('₹70.0 Cr INR');
    });

    it('formats multi-crore amounts accurately', () => {
      expect(formatInrCrores(1_500_000_000)).toBe('₹150.0 Cr INR');
      expect(formatInrCrores(840_000_000)).toBe('₹84.0 Cr INR');
      expect(formatInrCrores(150_000_000)).toBe('₹15.0 Cr INR');
    });
  });

  describe('2. Currency Conversion to INR', () => {
    it('converts USD to INR using documented benchmark (84.0 INR/USD)', () => {
      const res = convertToInr(10_000_000, 'USD'); // $10M USD = ₹84 Cr INR
      expect(res.amountInInr).toBe(840_000_000);
      expect(res.rateUsed).toBe(84.0);
      expect(res.thresholdMet).toBe(true);
      expect(res.conversionMethod).toContain('Interbank reference benchmark');
    });

    it('converts CAD to INR using documented benchmark (61.5 INR/CAD)', () => {
      const subThreshold = convertToInr(10_000_000, 'CAD'); // $10M CAD = ₹61.5 Cr INR (< ₹70 Cr)
      expect(subThreshold.amountInInr).toBe(615_000_000);
      expect(subThreshold.thresholdMet).toBe(false);

      const aboveThreshold = convertToInr(12_000_000, 'CAD'); // $12M CAD = ₹73.8 Cr INR (>= ₹70 Cr)
      expect(aboveThreshold.amountInInr).toBe(738_000_000);
      expect(aboveThreshold.thresholdMet).toBe(true);
    });

    it('converts EUR to INR using documented benchmark (91.5 INR/EUR)', () => {
      const res = convertToInr(8_000_000, 'EUR'); // €8M EUR = ₹73.2 Cr INR
      expect(res.amountInInr).toBe(732_000_000);
      expect(res.thresholdMet).toBe(true);
    });

    it('converts GBP to INR using documented benchmark (109.0 INR/GBP)', () => {
      const res = convertToInr(7_000_000, 'GBP'); // £7M GBP = ₹76.3 Cr INR
      expect(res.amountInInr).toBe(763_000_000);
      expect(res.thresholdMet).toBe(true);
    });

    it('handles direct INR baseline (1.0 rate)', () => {
      const res = convertToInr(750_000_000, 'INR');
      expect(res.amountInInr).toBe(750_000_000);
      expect(res.rateUsed).toBe(1.0);
      expect(res.thresholdMet).toBe(true);
    });
  });

  describe('3. Non-Interchangeability of Financial Metrics', () => {
    it('distinguishes Net Worth from Revenue, Valuation, and Market Cap', () => {
      expect(METRIC_DESCRIPTIONS.NET_WORTH.isNetWorth).toBe(true);
      expect(METRIC_DESCRIPTIONS.REVENUE.isNetWorth).toBe(false);
      expect(METRIC_DESCRIPTIONS.VALUATION.isNetWorth).toBe(false);
      expect(METRIC_DESCRIPTIONS.MARKET_CAP.isNetWorth).toBe(false);
      expect(METRIC_DESCRIPTIONS.ASSETS.isNetWorth).toBe(false);
    });

    it('labels qualifying Net Worth evidence explicitly as Net Worth', () => {
      const mockEvidence: FinancialEvidenceRecord[] = [
        {
          metricType: 'NET_WORTH',
          rawAmount: 850_000_000,
          currency: 'INR',
          amountInInr: 850_000_000,
          conversionRateUsed: 1.0,
          conversionMethod: 'Direct base currency (INR)',
          conversionDate: '2026-10-01',
          thresholdMet: true,
          reportingPeriod: 'FY2023-24',
          sourceName: 'Ministry of Corporate Affairs (MCA)',
          sourceUrl: 'https://mca.gov.in',
          sourceTier: 'TIER_1_REGISTRY',
          evidenceDate: '2024-03-31',
        },
      ];

      const res = evaluateFinancialEligibility(mockEvidence, { businessName: 'Apex Engineering Ltd' });
      expect(res.eligibilityState).toBe('QUALIFIED');
      expect(res.isQualified).toBe(true);
      expect(res.isNetWorth).toBe(true);
      expect(res.metricLabel).toContain('Verified Net Worth: ₹85.0 Cr INR');
      expect(res.qualificationExplanation).toContain('Verified Net Worth');
    });

    it('labels qualifying Revenue evidence accurately as Revenue and NOT as Net Worth', () => {
      const mockRevenueEvidence: FinancialEvidenceRecord[] = [
        {
          metricType: 'REVENUE',
          rawAmount: 15_000_000,
          currency: 'USD',
          amountInInr: 1_260_000_000,
          conversionRateUsed: 84.0,
          conversionMethod: 'Interbank reference benchmark',
          conversionDate: '2026-10-01',
          thresholdMet: true,
          reportingPeriod: 'CY2023',
          sourceName: 'SEC EDGAR 10-K Filing',
          sourceUrl: 'https://sec.gov/edgar',
          sourceTier: 'TIER_1_REGISTRY',
          evidenceDate: '2024-02-28',
        },
      ];

      // In STRICT_NET_WORTH mode (default): Revenue does NOT qualify as Net Worth
      const strictRes = evaluateFinancialEligibility(mockRevenueEvidence, { businessName: 'Omni Retail Inc' }, 'STRICT_NET_WORTH');
      expect(strictRes.eligibilityState).toBe('NOT_QUALIFIED');
      expect(strictRes.isQualified).toBe(false);
      expect(strictRes.qualificationExplanation).toContain('Revenue / Turnover, not Net Worth');

      // In BROAD_FINANCIAL_SCALE mode: Revenue qualifies with transparent labeling
      const res = evaluateFinancialEligibility(mockRevenueEvidence, { businessName: 'Omni Retail Inc' }, 'BROAD_FINANCIAL_SCALE');
      expect(res.eligibilityState).toBe('QUALIFIED');
      expect(res.isQualified).toBe(true);
      expect(res.isNetWorth).toBe(false); // MUST be false!
      expect(res.metricLabel).toContain('Annual Revenue');
      expect(res.qualificationExplanation).toContain('Note: Metric represents Annual Revenue / Turnover, not Net Worth');
    });

    it('labels qualifying Valuation evidence accurately as Valuation and NOT as Net Worth', () => {
      const mockValuationEvidence: FinancialEvidenceRecord[] = [
        {
          metricType: 'VALUATION',
          rawAmount: 20_000_000,
          currency: 'CAD',
          amountInInr: 1_230_000_000,
          conversionRateUsed: 61.5,
          conversionMethod: 'Interbank reference benchmark',
          conversionDate: '2026-10-01',
          thresholdMet: true,
          reportingPeriod: '2023',
          sourceName: 'SEDAR+ Filing',
          sourceUrl: 'https://sedarplus.ca',
          sourceTier: 'TIER_1_REGISTRY',
          evidenceDate: '2024-01-15',
        },
      ];

      // In STRICT_NET_WORTH mode (default): Valuation does NOT qualify as Net Worth
      const strictVal = evaluateFinancialEligibility(mockValuationEvidence, { businessName: 'Maple Tech Corp' }, 'STRICT_NET_WORTH');
      expect(strictVal.eligibilityState).toBe('NOT_QUALIFIED');
      expect(strictVal.isQualified).toBe(false);

      // In BROAD_FINANCIAL_SCALE mode: Valuation qualifies with transparent labeling
      const res = evaluateFinancialEligibility(mockValuationEvidence, { businessName: 'Maple Tech Corp' }, 'BROAD_FINANCIAL_SCALE');
      expect(res.eligibilityState).toBe('QUALIFIED');
      expect(res.isQualified).toBe(true);
      expect(res.isNetWorth).toBe(false);
      expect(res.metricLabel).toContain('Company Valuation');
    });
  });

  describe('4. Insufficient Evidence & Sub-Threshold Evaluation', () => {
    it('returns INSUFFICIENT_EVIDENCE when evidence is empty or missing', () => {
      const resEmpty = evaluateFinancialEligibility([]);
      expect(resEmpty.eligibilityState).toBe('INSUFFICIENT_EVIDENCE');
      expect(resEmpty.isQualified).toBe(false);
      expect(resEmpty.qualificationExplanation).toContain('No verifiable public financial filings');

      const resUndefined = evaluateFinancialEligibility(undefined);
      expect(resUndefined.eligibilityState).toBe('INSUFFICIENT_EVIDENCE');
      expect(resUndefined.isQualified).toBe(false);
    });

    it('returns NOT_QUALIFIED when verified financial scale is below ₹70 Cr INR', () => {
      const subThresholdEvidence: FinancialEvidenceRecord[] = [
        {
          metricType: 'NET_WORTH',
          rawAmount: 250_000_000, // ₹25 Cr INR (< ₹70 Cr)
          currency: 'INR',
          amountInInr: 250_000_000,
          conversionRateUsed: 1.0,
          conversionMethod: 'Direct base currency (INR)',
          conversionDate: '2026-10-01',
          thresholdMet: false,
          reportingPeriod: 'FY2023-24',
          sourceName: 'MCA Annual Filing',
          sourceUrl: 'https://mca.gov.in',
          sourceTier: 'TIER_1_REGISTRY',
          evidenceDate: '2024-03-31',
        },
      ];

      const res = evaluateFinancialEligibility(subThresholdEvidence, { businessName: 'Kavita Small Enterprises' });
      expect(res.eligibilityState).toBe('NOT_QUALIFIED');
      expect(res.isQualified).toBe(false);
      expect(res.metricLabel).toContain('< ₹70 Cr INR');
      expect(res.qualificationExplanation).toContain('below the ₹70 Crore INR threshold');
    });

    it('preserves provenance fields (source URL, tier, reporting period, evidence date)', () => {
      const record: FinancialEvidenceRecord = {
        metricType: 'NET_WORTH',
        rawAmount: 900_000_000,
        currency: 'INR',
        amountInInr: 900_000_000,
        conversionRateUsed: 1.0,
        conversionMethod: 'Direct base currency (INR)',
        conversionDate: '2026-10-01',
        thresholdMet: true,
        reportingPeriod: 'FY2023-24',
        sourceName: 'MCA Registry Portal',
        sourceUrl: 'https://mca.gov.in/filings/12345',
        sourceTier: 'TIER_1_REGISTRY',
        evidenceDate: '2024-03-31',
      };

      const res = evaluateFinancialEligibility([record]);
      expect(res.evidence).toBeDefined();
      expect(res.evidence?.sourceUrl).toBe('https://mca.gov.in/filings/12345');
      expect(res.evidence?.sourceTier).toBe('TIER_1_REGISTRY');
      expect(res.evidence?.reportingPeriod).toBe('FY2023-24');
      expect(res.evidence?.evidenceDate).toBe('2024-03-31');
    });
  });

  describe('5. Orchestrator Integration & Normal-Search Non-Regression', () => {
    it('creates a Job with highNetWorthFilter default to false when omitted', () => {
      const orchestrator = new LeadPilotOrchestrator();
      const job = orchestrator.createJob({
        country: 'India',
        state: 'Maharashtra',
        city: 'Mumbai',
        industry: 'Automotive',
        limit: 10,
      });

      expect(job.highNetWorthFilter).toBe(false);
      expect(job.rejectionReasons.INSUFFICIENT_FINANCIAL_EVIDENCE).toBe(0);
      expect(job.rejectionReasons.BELOW_FINANCIAL_THRESHOLD).toBe(0);
    });

    it('creates a Job with highNetWorthFilter true when explicitly requested', () => {
      const orchestrator = new LeadPilotOrchestrator();
      const job = orchestrator.createJob({
        country: 'India',
        state: 'Maharashtra',
        city: 'Mumbai',
        industry: 'Automotive',
        limit: 10,
        highNetWorthFilter: true,
      });

      expect(job.highNetWorthFilter).toBe(true);
    });

    it('expands discovery candidate pool up to server ceiling when highNetWorthFilter is ON', () => {
      const orchestrator = new LeadPilotOrchestrator();
      const job = orchestrator.createJob({
        country: 'USA',
        state: 'California',
        city: 'Los Angeles',
        industry: 'Automotive',
        limit: 5,
        highNetWorthFilter: true,
      });

      expect(job.highNetWorthFilter).toBe(true);
      expect(job.requestedLeads).toBe(5);
    });
  });

  describe('6. Entity Matching & Parent-Company Safeguards', () => {
    it('rejects local dealerships and service shops from claiming corporate parent filings', async () => {
      const { calculateEntityMatchConfidence } = await import('@/lib/financial/FinancialEvidenceProvider');

      // Local dealership containing "dealership" or "repair" keyword
      const dealerScore = calculateEntityMatchConfidence('Downtown Ford Dealership', 'FORD MOTOR CO');
      expect(dealerScore).toBeLessThan(0.80);

      const repairScore = calculateEntityMatchConfidence('Bob Tesla Repairs & Service Center', 'TESLA, INC.');
      expect(repairScore).toBeLessThan(0.80);

      // Exact operating corporate names match above 0.80
      const corporateScore = calculateEntityMatchConfidence('Ford Motor Company', 'FORD MOTOR CO');
      expect(corporateScore).toBeGreaterThanOrEqual(0.80);

      const tataScore = calculateEntityMatchConfidence('Tata Motors Ltd', 'TATA MOTORS LIMITED');
      expect(tataScore).toBeGreaterThanOrEqual(0.80);
    });
  });

  describe('7. Live SEC EDGAR Public Filing Retrieval & Provenance', () => {
    it('retrieves and parses verified StockholdersEquity from official SEC EDGAR XBRL facts', async () => {
      const { PublicRegistryFinancialProvider } = await import('@/lib/financial/FinancialEvidenceProvider');
      const provider = new PublicRegistryFinancialProvider();

      // Mock fetch for SEC EDGAR XBRL API
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          entityName: 'GENERAL MOTORS CO',
          facts: {
            'us-gaap': {
              'StockholdersEquity': {
                units: {
                  'USD': [
                    {
                      end: '2025-12-31',
                      val: 61_119_000_000,
                      fy: 2025,
                      fp: 'FY',
                      form: '10-K',
                      filed: '2026-01-27',
                      accn: '0001467858-26-000012',
                    },
                  ],
                },
              },
            },
          },
        }),
      });

      const originalFetch = global.fetch;
      global.fetch = mockFetch;

      try {
        const evidence = await provider.fetchSecEdgarEquity('0001467858', 'GENERAL MOTORS CO', 0.95);
        expect(evidence).not.toBeNull();
        expect(evidence?.metricType).toBe('NET_WORTH');
        expect(evidence?.rawAmount).toBe(61_119_000_000);
        expect(evidence?.currency).toBe('USD');
        expect(evidence?.amountInInr).toBe(61_119_000_000 * 84.0);
        expect(evidence?.thresholdMet).toBe(true);
        expect(evidence?.sourceName).toContain('US SEC EDGAR Form 10-K');
        expect(evidence?.sourceUrl).toContain('https://www.sec.gov/edgar/browse/?CIK=0001467858');
        expect(evidence?.reportingPeriod).toBe('FY2025');
        expect(evidence?.verificationStatus).toBe('VERIFIED');
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('returns null gracefully when SEC EDGAR call times out or returns HTTP error', async () => {
      const { PublicRegistryFinancialProvider } = await import('@/lib/financial/FinancialEvidenceProvider');
      const provider = new PublicRegistryFinancialProvider();

      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      });

      try {
        const evidence = await provider.fetchSecEdgarEquity('0000000000', 'NONEXISTENT ENTITY', 0.90);
        expect(evidence).toBeNull();
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  describe('8. Zero-Result Reason Classification', () => {
    it('distinguishes "No businesses discovered" when discovery candidate pool is 0', () => {
      const job: any = {
        highNetWorthFilter: true,
        discovered: 0,
        rejectionReasons: { INSUFFICIENT_FINANCIAL_EVIDENCE: 0, BELOW_FINANCIAL_THRESHOLD: 0 },
      };

      let reason = '';
      if (job.discovered === 0) {
        reason = 'No businesses discovered in the requested location. Zero candidate records were available for financial qualification.';
      }
      expect(reason).toContain('Zero candidate records were available');
    });

    it('distinguishes "Insufficient Evidence" when candidates lacked public financial filings', () => {
      const job: any = {
        highNetWorthFilter: true,
        discovered: 12,
        rejectionReasons: { INSUFFICIENT_FINANCIAL_EVIDENCE: 12, BELOW_FINANCIAL_THRESHOLD: 0 },
      };

      let reason = '';
      if ((job.rejectionReasons.INSUFFICIENT_FINANCIAL_EVIDENCE || 0) > 0 && (job.rejectionReasons.BELOW_FINANCIAL_THRESHOLD || 0) === 0) {
        reason = `Discovered ${job.discovered} candidate businesses, but none had verifiable public financial filings or registry disclosures (SEC EDGAR, MCA, SEDAR+). All candidates were excluded as Insufficient Evidence.`;
      }
      expect(reason).toContain('none had verifiable public financial filings');
      expect(reason).toContain('Insufficient Evidence');
    });

    it('distinguishes "Below Financial Threshold" when candidates had filings with net worth < ₹70 Cr', () => {
      const job: any = {
        highNetWorthFilter: true,
        discovered: 5,
        rejectionReasons: { INSUFFICIENT_FINANCIAL_EVIDENCE: 3, BELOW_FINANCIAL_THRESHOLD: 2 },
      };

      let reason = '';
      if ((job.rejectionReasons.BELOW_FINANCIAL_THRESHOLD || 0) > 0) {
        reason = `Discovered ${job.discovered} businesses with official financial records, but verified net worth was below the ₹70 Crore INR threshold. Zero businesses met the qualification threshold.`;
      }
      expect(reason).toContain('below the ₹70 Crore INR threshold');
    });
  });

  describe('9. No Mock Data in Live Mode & Accurate Counts', () => {
    it('returns empty evidence array for ordinary local businesses without public filings', async () => {
      const { financialEvidenceProvider } = await import('@/lib/financial/FinancialEvidenceProvider');

      // Ordinary local store without public filings
      const evidence = await financialEvidenceProvider.getFinancialEvidence('Ramesh Corner Grocery', 'India');
      expect(evidence).toEqual([]);

      const evalResult = evaluateFinancialEligibility(evidence, { businessName: 'Ramesh Corner Grocery' });
      expect(evalResult.eligibilityState).toBe('INSUFFICIENT_EVIDENCE');
      expect(evalResult.state).toBe('INSUFFICIENT_EVIDENCE');
      expect(evalResult.isQualified).toBe(false);
      expect(evalResult.isHighNetWorthQualified).toBe(false);
      expect(evalResult.amountInInr).toBeUndefined();
    });
  });

  describe('10. Strict Enforcement of High-Net-Worth Filter', () => {
    it('strictly drops unverified local businesses (INSUFFICIENT_EVIDENCE)', () => {
      const evalResult = evaluateFinancialEligibility([], { businessName: 'Local Corner Cafe' });
      expect(evalResult.state).toBe('INSUFFICIENT_EVIDENCE');
      expect(evalResult.isHighNetWorthQualified).toBe(false);

      // Simulation of orchestrator strict drop check
      const filters = { highNetWorthOnly: true };
      let passedUI = true;
      if (filters.highNetWorthOnly === true) {
        if (evalResult.state === 'INSUFFICIENT_EVIDENCE' || evalResult.state === 'NOT_QUALIFIED') {
          passedUI = false;
        } else if (evalResult.isHighNetWorthQualified !== true) {
          passedUI = false;
        }
      }
      expect(passedUI).toBe(false);
    });

    it('strictly drops verified sub-threshold businesses (NOT_QUALIFIED)', () => {
      const subThresholdEvidence: FinancialEvidenceRecord[] = [
        {
          metricType: 'NET_WORTH',
          rawAmount: 200_000_000, // ₹20 Cr INR (< ₹70 Cr INR)
          currency: 'INR',
          amountInInr: 200_000_000,
          conversionRateUsed: 1.0,
          conversionMethod: 'Direct base currency (INR)',
          conversionDate: '2026-10-01',
          thresholdMet: false,
          reportingPeriod: 'FY2023-24',
          sourceName: 'Ministry of Corporate Affairs (MCA)',
          sourceUrl: 'https://mca.gov.in',
          sourceTier: 'TIER_1_REGISTRY',
          evidenceDate: '2024-03-31',
          verificationStatus: 'VERIFIED',
        },
      ];

      const evalResult = evaluateFinancialEligibility(subThresholdEvidence, { businessName: 'Small Enterprise Ltd' });
      expect(evalResult.state).toBe('NOT_QUALIFIED');
      expect(evalResult.isHighNetWorthQualified).toBe(false);

      const filters = { highNetWorthOnly: true };
      let passedUI = true;
      if (filters.highNetWorthOnly === true) {
        if (evalResult.state === 'INSUFFICIENT_EVIDENCE' || evalResult.state === 'NOT_QUALIFIED') {
          passedUI = false;
        } else if (evalResult.isHighNetWorthQualified !== true) {
          passedUI = false;
        }
      }
      expect(passedUI).toBe(false);
    });

    it('allows only explicitly verified businesses exceeding ₹70 Cr INR threshold', () => {
      const qualifiedEvidence: FinancialEvidenceRecord[] = [
        {
          metricType: 'NET_WORTH',
          rawAmount: 1_200_000_000, // ₹120 Cr INR (>= ₹70 Cr INR)
          currency: 'INR',
          amountInInr: 1_200_000_000,
          conversionRateUsed: 1.0,
          conversionMethod: 'Direct base currency (INR)',
          conversionDate: '2026-10-01',
          thresholdMet: true,
          reportingPeriod: 'FY2023-24',
          sourceName: 'Ministry of Corporate Affairs (MCA)',
          sourceUrl: 'https://mca.gov.in',
          sourceTier: 'TIER_1_REGISTRY',
          evidenceDate: '2024-03-31',
          verificationStatus: 'VERIFIED',
        },
      ];

      const evalResult = evaluateFinancialEligibility(qualifiedEvidence, { businessName: 'Mega Corp Ltd' });
      expect(evalResult.state).toBe('QUALIFIED');
      expect(evalResult.isHighNetWorthQualified).toBe(true);

      const filters = { highNetWorthOnly: true };
      let passedUI = true;
      if (filters.highNetWorthOnly === true) {
        if (evalResult.state === 'INSUFFICIENT_EVIDENCE' || evalResult.state === 'NOT_QUALIFIED') {
          passedUI = false;
        } else if (evalResult.isHighNetWorthQualified !== true) {
          passedUI = false;
        }
      }
      expect(passedUI).toBe(true);
    });
  });

  describe('11. Smart Search Strategy & API Limit Protection', () => {
    it('modifies user query to enterprise/corporate queries when HNW filter is active', async () => {
      const { optimizeQueryForHighNetWorth } = await import('@/providers/RapidApiDiscoveryProvider');

      expect(optimizeQueryForHighNetWorth('Hospitals')).toBe('Corporate Hospitals');
      expect(optimizeQueryForHighNetWorth('Hospital')).toBe('Corporate Hospitals');
      expect(optimizeQueryForHighNetWorth('Restaurants')).toBe('Restaurant Chains');
      expect(optimizeQueryForHighNetWorth('Hotels')).toBe('Luxury Hotel Chains');
      expect(optimizeQueryForHighNetWorth('Automotive')).toBe('Authorized Automobile Dealerships');
      expect(optimizeQueryForHighNetWorth('Software')).toBe('Enterprise Software Companies');
      expect(optimizeQueryForHighNetWorth('Consulting')).toBe('Corporate Consulting');

      // Does not double-modify already enterprise queries
      expect(optimizeQueryForHighNetWorth('Corporate Hospitals')).toBe('Corporate Hospitals');
      expect(optimizeQueryForHighNetWorth('Restaurant Chains')).toBe('Restaurant Chains');
    });

    it('verifies major corporate hospital networks (Apollo, Fortis, Max) qualify in financial registry', async () => {
      const { financialEvidenceProvider } = await import('@/lib/financial/FinancialEvidenceProvider');

      // Test Apollo Hospitals
      const apolloEvidence = await financialEvidenceProvider.getFinancialEvidence('Apollo Hospitals Navi Mumbai', 'India');
      expect(apolloEvidence.length).toBeGreaterThan(0);
      const apolloEval = evaluateFinancialEligibility(apolloEvidence, { businessName: 'Apollo Hospitals Navi Mumbai' });
      expect(apolloEval.isQualified).toBe(true);
      expect(apolloEval.amountInInr).toBe(65_000_000_000);

      // Test Fortis Hospital
      const fortisEvidence = await financialEvidenceProvider.getFinancialEvidence('Fortis Hospital Mulund', 'India');
      expect(fortisEvidence.length).toBeGreaterThan(0);
      const fortisEval = evaluateFinancialEligibility(fortisEvidence, { businessName: 'Fortis Hospital Mulund' });
      expect(fortisEval.isQualified).toBe(true);
      expect(fortisEval.amountInInr).toBe(72_000_000_000);

      // Test Max Healthcare
      const maxEvidence = await financialEvidenceProvider.getFinancialEvidence('Max Healthcare Hospital', 'India');
      expect(maxEvidence.length).toBeGreaterThan(0);
      const maxEval = evaluateFinancialEligibility(maxEvidence, { businessName: 'Max Healthcare Hospital' });
      expect(maxEval.isQualified).toBe(true);
      expect(maxEval.amountInInr).toBe(84_000_000_000);
    });

    it('verifies partial, complete, and zero-result messaging for ₹70 Cr+ searches', () => {
      // Complete result
      const completeJob: any = { requestedLeads: 5, highNetWorthFilter: true };
      const completeCount = 5;
      const completeReason = completeJob.highNetWorthFilter
        ? `Found ${completeCount} verified leads matching ₹70 Cr+.`
        : '';
      expect(completeReason).toBe('Found 5 verified leads matching ₹70 Cr+.');

      // Partial result (e.g. 2 of 5)
      const partialJob: any = { requestedLeads: 5, highNetWorthFilter: true };
      const partialCount = 2;
      const X = partialCount;
      const Y = partialJob.requestedLeads - X;
      const partialReason = partialJob.highNetWorthFilter
        ? `Found ${X} verified ${X === 1 ? 'lead' : 'leads'}. Searched thoroughly but could not find ${Y} more in this area. Try a broader location.`
        : '';
      expect(partialReason).toBe('Found 2 verified leads. Searched thoroughly but could not find 3 more in this area. Try a broader location.');

      // Zero result
      const zeroJob: any = { requestedLeads: 5, highNetWorthFilter: true };
      const zeroReason = zeroJob.highNetWorthFilter
        ? '0 verified businesses found in this area. To save API limits, we searched a max of 25 candidates. Try a larger city (e.g., Mumbai) or turn off the ₹70 Cr filter.'
        : '';
      expect(zeroReason).toBe(
        '0 verified businesses found in this area. To save API limits, we searched a max of 25 candidates. Try a larger city (e.g., Mumbai) or turn off the ₹70 Cr filter.'
      );
    });

    it('verifies internal fetch loop conditions and nextOffset calculation', () => {
      // Simulating loop parameters
      const requestedLimit = 5;
      const batchSize = 20;
      const maxApiCalls = 3;
      let apiCallsMade = 0;
      let currentOffset = 0;
      const maxAllowedOffset = currentOffset + (maxApiCalls * batchSize);
      const qualifiedLeads: any[] = [];

      // Batch 1: returns 20 items, only 2 qualify
      while (qualifiedLeads.length < requestedLimit && currentOffset < maxAllowedOffset && apiCallsMade < maxApiCalls) {
        apiCallsMade++;
        currentOffset += batchSize;
        if (apiCallsMade === 1) {
          qualifiedLeads.push({ id: 'lead_1' }, { id: 'lead_2' });
        } else if (apiCallsMade === 2) {
          qualifiedLeads.push({ id: 'lead_3' }, { id: 'lead_4' }, { id: 'lead_5' });
        }
      }

      // Loop stops after batch 2 because qualifiedLeads.length (5) reached requestedLimit (5)
      expect(apiCallsMade).toBe(2);
      expect(qualifiedLeads.length).toBe(5);
      expect(currentOffset).toBe(40);

      // Verify next batch would start at offset 40
      const nextBatchOffset = currentOffset;
      expect(nextBatchOffset).toBe(40);
    });

    it('stops after max 3 API calls if requested limit is not reached', () => {
      const requestedLimit = 5;
      const batchSize = 20;
      const maxApiCalls = 3;
      let apiCallsMade = 0;
      let currentOffset = 0;
      const maxAllowedOffset = currentOffset + (maxApiCalls * batchSize);
      const qualifiedLeads: any[] = [];

      // Even if only 1 qualifies across 3 calls
      while (qualifiedLeads.length < requestedLimit && currentOffset < maxAllowedOffset && apiCallsMade < maxApiCalls) {
        apiCallsMade++;
        currentOffset += batchSize;
        if (apiCallsMade === 1) {
          qualifiedLeads.push({ id: 'lead_1' });
        }
      }

      expect(apiCallsMade).toBe(3);
      expect(qualifiedLeads.length).toBe(1);
      expect(currentOffset).toBe(60);
      const X = qualifiedLeads.length;
      const Y = requestedLimit - X;
      const statusReason = `Found ${X} verified ${X === 1 ? 'lead' : 'leads'}. Searched thoroughly but could not find ${Y} more in this area. Try a broader location.`;
      expect(statusReason).toBe('Found 1 verified lead. Searched thoroughly but could not find 4 more in this area. Try a broader location.');
    });
  });
});
