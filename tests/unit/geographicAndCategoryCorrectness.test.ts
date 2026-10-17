import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { locationVerificationActor } from '@/actors/LocationVerificationActor';
import { businessVerificationActor } from '@/actors/BusinessVerificationActor';
import { validateIndustryRelevance } from '@/lib/taxonomy/industryTaxonomy';
import { leadPilotDb } from '@/db';
import { evaluateFinancialEligibility } from '@/lib/financial/financialEvidenceEvaluator';
import { FinancialEvidenceRecord } from '@/lib/financial/types';
import { RapidApiDiscoveryProvider } from '@/providers/RapidApiDiscoveryProvider';
import { isCoordinateInLocation } from '@/lib/geoResolver';
import { RawDiscoveredBusiness } from '@/providers/BusinessDiscoveryProvider';

describe('Geographic and Category Correctness Regression Suite (Critical Bug Fix)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.PRIMARY_DISCOVERY_PROVIDER = 'rapidapi';
    process.env.RAPIDAPI_KEY = 'mock_key';
    process.env.RAPIDAPI_ENABLED = 'true';
    process.env.RAPIDAPI_MOCK_MODE = 'false';
    process.env.ALLOWED_DISCOVERY_COUNTRIES = 'IN,US,CA';

    RapidApiDiscoveryProvider.setSimulateTimeout(false);
    RapidApiDiscoveryProvider.setSimulateQuotaExceeded(false);
    RapidApiDiscoveryProvider.setSimulateAuthFailed(false);
    RapidApiDiscoveryProvider.setSimulateResults(null);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    RapidApiDiscoveryProvider.setSimulateResults(null);
  });

  // =========================================================================
  // 1. Mumbai Search NEVER Returns Atlanta Businesses
  // =========================================================================
  describe('1. Geographic Isolation: Mumbai, India vs Atlanta, USA', () => {
    it('rejects Atlanta, GA businesses when the search target is Mumbai, Maharashtra, India', async () => {
      const candidates: RawDiscoveredBusiness[] = [
        {
          source: 'rapidapi',
          sources: ['rapidapi'],
          sourceId: 'atlanta_hotel_1',
          name: 'The Georgian Terrace Hotel',
          businessName: 'The Georgian Terrace Hotel',
          category: 'Hotel',
          address: '659 Peachtree St NE, Atlanta, GA 30308, USA',
          city: 'Atlanta',
          state: 'Georgia',
          country: 'USA',
          latitude: 33.7725,
          longitude: -84.3853,
          phone: '+1 404-897-1991',
          website: 'https://www.thegeorgianterrace.com',
        },
        {
          source: 'rapidapi',
          sources: ['rapidapi'],
          sourceId: 'mumbai_hotel_1',
          name: 'The Taj Mahal Palace',
          businessName: 'The Taj Mahal Palace',
          category: 'Hotel',
          address: 'Apollo Bunder, Colaba, Mumbai, Maharashtra 400001, India',
          city: 'Mumbai',
          state: 'Maharashtra',
          country: 'India',
          latitude: 18.9217,
          longitude: 72.8332,
          phone: '+91 22 6665 3366',
          website: 'https://www.tajhotels.com',
        },
      ];

      const res = await locationVerificationActor.execute({
        jobId: 'test_mumbai_search',
        input: {
          businesses: candidates,
          country: 'India',
          state: 'Maharashtra',
          city: 'Mumbai',
        },
      });

      expect(res.status).toBe('COMPLETED');
      const locationOutput = res.data;

      // Atlanta hotel must be strictly rejected
      expect(locationOutput.rejected.some((r) => r.business.businessName.includes('Georgian Terrace'))).toBe(true);
      expect(locationOutput.verified.some((v) => v.businessName.includes('Georgian Terrace'))).toBe(false);

      // Taj Mahal Palace in Mumbai must be verified
      expect(locationOutput.verified.some((v) => v.businessName.includes('Taj Mahal Palace'))).toBe(true);
      expect(locationOutput.verified.length).toBe(1);
    });

    it('rejects coordinate bounds from Atlanta (lat 33.7, lon -84.3) when target is India or California', () => {
      const atlLat = 33.7725;
      const atlLon = -84.3853;

      // When target is India, Maharashtra, Mumbai -> false
      expect(isCoordinateInLocation(atlLat, atlLon, 'Mumbai', 'Maharashtra', 'India')).toBe(false);

      // When target is USA, California, Los Angeles -> false (Atlanta is in Georgia, not California)
      expect(isCoordinateInLocation(atlLat, atlLon, 'Los Angeles', 'California', 'USA')).toBe(false);

      // When target is USA, Georgia, Atlanta -> true
      expect(isCoordinateInLocation(atlLat, atlLon, 'Atlanta', 'Georgia', 'USA')).toBe(true);
    });
  });

  // =========================================================================
  // 2. India-Only Search Rejects US Businesses
  // =========================================================================
  describe('2. Cross-Country Boundary Enforcement', () => {
    it('rejects US candidates when target country is India', async () => {
      const usCandidate: RawDiscoveredBusiness = {
        source: 'rapidapi',
        sources: ['rapidapi'],
        sourceId: 'us_biz_1',
        name: 'Downtown Dental Studio',
        businessName: 'Downtown Dental Studio',
        category: 'Dentist',
        address: '100 Main St, Austin, TX 78701, USA',
        city: 'Austin',
        state: 'Texas',
        country: 'USA',
        latitude: 30.2672,
        longitude: -97.7431,
      };

      const res = await locationVerificationActor.execute({
        jobId: 'test_india_only',
        input: {
          businesses: [usCandidate],
          country: 'India',
          state: 'Karnataka',
          city: 'Bengaluru',
        },
      });

      expect(res.status).toBe('COMPLETED');
      const locationOutput = res.data;
      expect(locationOutput.verified.length).toBe(0);
      expect(locationOutput.rejected.length).toBe(1);
      expect(locationOutput.rejected[0].reason).toBe('OUTSIDE_LOCATION');
    });

    it('rejects Canadian candidates when target country is USA', async () => {
      const caCandidate: RawDiscoveredBusiness = {
        source: 'rapidapi',
        sources: ['rapidapi'],
        sourceId: 'ca_biz_1',
        name: 'Toronto Auto Care',
        businessName: 'Toronto Auto Care',
        category: 'Automotive',
        address: '500 Yonge St, Toronto, ON M4Y 1X8, Canada',
        city: 'Toronto',
        state: 'Ontario',
        country: 'Canada',
        latitude: 43.6655,
        longitude: -79.3853,
      };

      const res = await locationVerificationActor.execute({
        jobId: 'test_usa_only',
        input: {
          businesses: [caCandidate],
          country: 'USA',
          state: 'New York',
          city: 'New York',
        },
      });

      expect(res.status).toBe('COMPLETED');
      const locationOutput = res.data;
      expect(locationOutput.verified.length).toBe(0);
      expect(locationOutput.rejected.length).toBe(1);
    });
  });

  // =========================================================================
  // 3. Category Separation: Restaurants vs Hotels vs Automotive
  // =========================================================================
  describe('3. Strict Industry/Category Separation', () => {
    it('rejects hotels when searching for Restaurants', () => {
      const hotelResult = validateIndustryRelevance(
        {
          businessName: 'Hyatt Regency Atlanta Downtown',
          category: 'Hotel',
          types: ['hotel', 'lodging', 'point_of_interest'],
        },
        'Restaurants'
      );

      expect(hotelResult.isValid).toBe(false);
      expect(hotelResult.canonicalIndustry).toBe('Restaurants');
    });

    it('rejects resort/motel when searching for Restaurants even if name contains food words', () => {
      const resortResult = validateIndustryRelevance(
        {
          businessName: 'Lakeside Resort & Dining Lounge',
          category: 'Resort hotel',
          types: ['lodging', 'resort_hotel', 'food'],
        },
        'Restaurants'
      );

      expect(resortResult.isValid).toBe(false);
    });

    it('accepts genuine restaurants with verified food/restaurant category', () => {
      const restaurantResult = validateIndustryRelevance(
        {
          businessName: 'Trishna Seafood Restaurant',
          category: 'Seafood restaurant',
          types: ['restaurant', 'food', 'point_of_interest'],
        },
        'Restaurants'
      );

      expect(restaurantResult.isValid).toBe(true);
    });

    it('rejects dentists when searching for Automotive', () => {
      const dentalResult = validateIndustryRelevance(
        {
          businessName: 'Smiles Dental Clinic',
          category: 'Dentist',
          types: ['dentist', 'health'],
        },
        'Automotive'
      );

      expect(dentalResult.isValid).toBe(false);
    });

    it('marks candidates with missing category evidence as CATEGORY_UNVERIFIED', async () => {
      const missingCategoryCandidate: RawDiscoveredBusiness = {
        source: 'rapidapi',
        sources: ['rapidapi'],
        sourceId: 'unverified_1',
        name: 'Vague Mystery Enterprise',
        businessName: 'Vague Mystery Enterprise',
        category: '',
        types: [],
        address: '123 MG Road, Mumbai, Maharashtra, India',
        city: 'Mumbai',
        state: 'Maharashtra',
        country: 'India',
      };

      const res = await businessVerificationActor.execute({
        jobId: 'test_missing_cat',
        input: {
          businesses: [missingCategoryCandidate],
          requestedIndustry: 'Restaurants',
        },
      });

      expect(res.status).toBe('COMPLETED');
      const output = res.data;
      expect(output.verified.length).toBe(0);
      expect(output.rejected.some((r) => r.reason === 'CATEGORY_UNVERIFIED')).toBe(true);
    });
  });

  // =========================================================================
  // 4. City/State Aliases Do Not Match Unrelated Cities
  // =========================================================================
  describe('4. City and State Aliases Precision', () => {
    it('accepts known aliases for Mumbai (Bombay) but rejects Pune or Bangalore', async () => {
      const candidates: RawDiscoveredBusiness[] = [
        {
          source: 'rapidapi',
          sources: ['rapidapi'],
          sourceId: 'bombay_alias',
          name: 'Colaba Cafe',
          businessName: 'Colaba Cafe',
          category: 'Cafe',
          address: 'Colaba Causeway, Bombay 400005, India',
          city: 'Bombay',
          state: 'Maharashtra',
          country: 'India',
          latitude: 18.922,
          longitude: 72.832,
        },
        {
          source: 'rapidapi',
          sources: ['rapidapi'],
          sourceId: 'pune_unrelated',
          name: 'Pune FC Cafe',
          businessName: 'Pune FC Cafe',
          category: 'Cafe',
          address: 'FC Road, Pune, Maharashtra 411004, India',
          city: 'Pune',
          state: 'Maharashtra',
          country: 'India',
          latitude: 18.5204,
          longitude: 73.8567,
        },
      ];

      const res = await locationVerificationActor.execute({
        jobId: 'test_alias',
        input: {
          businesses: candidates,
          country: 'India',
          state: 'Maharashtra',
          city: 'Mumbai',
        },
      });

      expect(res.status).toBe('COMPLETED');
      const locationOutput = res.data;

      // Bombay alias accepted for Mumbai
      expect(locationOutput.verified.some((v) => v.businessName === 'Colaba Cafe')).toBe(true);

      // Pune rejected when Mumbai was targeted
      expect(locationOutput.rejected.some((r) => r.business.businessName === 'Pune FC Cafe')).toBe(true);
    });

    it('rejects San Francisco candidate when Los Angeles, California is targeted', async () => {
      const sfCandidate: RawDiscoveredBusiness = {
        source: 'rapidapi',
        sources: ['rapidapi'],
        sourceId: 'sf_biz',
        name: 'Fisherman\'s Wharf Seafood',
        businessName: 'Fisherman\'s Wharf Seafood',
        category: 'Restaurant',
        address: 'Pier 39, San Francisco, CA 94133, USA',
        city: 'San Francisco',
        state: 'California',
        country: 'USA',
        latitude: 37.8087,
        longitude: -122.4098,
      };

      const res = await locationVerificationActor.execute({
        jobId: 'test_sf_la',
        input: {
          businesses: [sfCandidate],
          country: 'USA',
          state: 'California',
          city: 'Los Angeles',
        },
      });

      expect(res.status).toBe('COMPLETED');
      const locationOutput = res.data;
      expect(locationOutput.verified.length).toBe(0);
      expect(locationOutput.rejected.length).toBe(1);
      expect(locationOutput.rejected[0].reason).toBe('OUTSIDE_LOCATION');
    });
  });

  // =========================================================================
  // 5. Database Cache Isolation (No Cross-Country or Cross-City Leakage)
  // =========================================================================
  describe('5. Database Cache Isolation', () => {
    it('never leaks Atlanta, USA cached leads into a Mumbai, India search', () => {
      const atlantaLead = {
        leadId: 'lead_atlanta_test_999',
        businessName: 'Atlanta Peach Hotel',
        category: 'Hotels',
        country: 'USA',
        state: 'Georgia',
        city: 'Atlanta',
        address: '100 Peachtree St, Atlanta, GA 30303, USA',
        sources: ['rapidapi'],
        sourceUrl: 'https://test.invalid',
        isMock: false,
      };

      const mumbaiLead = {
        leadId: 'lead_mumbai_test_999',
        businessName: 'Marine Drive Seafood',
        category: 'Restaurants',
        country: 'India',
        state: 'Maharashtra',
        city: 'Mumbai',
        address: 'Marine Drive, Mumbai 400020, India',
        sources: ['rapidapi'],
        sourceUrl: 'https://test.invalid',
        isMock: false,
      };

      leadPilotDb.upsertLead(atlantaLead as any);
      leadPilotDb.upsertLead(mumbaiLead as any);

      // Search for India, Maharashtra, Mumbai, Restaurants
      const mumbaiResults = leadPilotDb.findLeadsByLocationAndIndustry({
        state: 'Maharashtra',
        city: 'Mumbai',
        industry: 'Restaurants',
        country: 'India',
      });

      // Must find the Mumbai lead
      expect(mumbaiResults.some((l) => l.leadId === 'lead_mumbai_test_999')).toBe(true);

      // Must NEVER find the Atlanta lead
      expect(mumbaiResults.some((l) => l.leadId === 'lead_atlanta_test_999')).toBe(false);

      // And searching for India, Maharashtra, Mumbai, Hotels must not return Atlanta either
      const hotelResults = leadPilotDb.findLeadsByLocationAndIndustry({
        state: 'Maharashtra',
        city: 'Mumbai',
        industry: 'Hotels',
        country: 'India',
      });
      expect(hotelResults.some((l) => l.leadId === 'lead_atlanta_test_999')).toBe(false);
    });
  });

  // =========================================================================
  // 6. Strict ₹70 Crore Net Worth Threshold Evaluator
  // =========================================================================
  describe('6. Strict ₹70 Crore (₹700M INR) Net Worth Threshold', () => {
    it('qualifies a business when verified net worth is >= ₹70 Cr INR', () => {
      const qualifyingEvidence: FinancialEvidenceRecord = {
        entityName: 'Tata Steel Limited',
        matchingConfidence: 0.95,
        metricType: 'NET_WORTH',
        rawAmount: 105000000000,
        currency: 'INR',
        amountInInr: 105000000000, // ₹10,500 Cr (well above ₹70 Cr)
        conversionRateUsed: 1.0,
        conversionMethod: 'Direct base currency (INR)',
        conversionDate: '2026-10-01',
        thresholdMet: true,
        reportingPeriod: 'FY2023-24',
        sourceName: 'Ministry of Corporate Affairs (MCA)',
        sourceUrl: 'https://mca.gov.in/filing/test',
        sourceTier: 'TIER_1_REGISTRY',
        retrievalDate: '2026-10-01',
        evidenceDate: '2024-03-31',
        verificationStatus: 'VERIFIED',
      };

      const result = evaluateFinancialEligibility(
        [qualifyingEvidence],
        { businessName: 'Tata Steel Limited', country: 'India' },
        'STRICT_NET_WORTH'
      );

      expect(result.isQualified).toBe(true);
      expect(result.eligibilityState).toBe('QUALIFIED');
      expect(result.amountInInr).toBeGreaterThanOrEqual(700000000);
      expect(result.isNetWorth).toBe(true);
    });

    it('rejects a business when verified net worth is below ₹70 Cr INR', () => {
      const belowThresholdEvidence: FinancialEvidenceRecord = {
        entityName: 'Small Enterprise Pvt Ltd',
        matchingConfidence: 0.92,
        metricType: 'NET_WORTH',
        rawAmount: 150000000,
        currency: 'INR',
        amountInInr: 150000000, // ₹15 Cr (below ₹70 Cr)
        conversionRateUsed: 1.0,
        conversionMethod: 'Direct base currency (INR)',
        conversionDate: '2026-10-01',
        thresholdMet: false,
        reportingPeriod: 'FY2023-24',
        sourceName: 'Ministry of Corporate Affairs (MCA)',
        sourceUrl: 'https://mca.gov.in/filing/test',
        sourceTier: 'TIER_1_REGISTRY',
        retrievalDate: '2026-10-01',
        evidenceDate: '2024-03-31',
        verificationStatus: 'VERIFIED',
      };

      const result = evaluateFinancialEligibility(
        [belowThresholdEvidence],
        { businessName: 'Small Enterprise Pvt Ltd', country: 'India' },
        'STRICT_NET_WORTH'
      );

      expect(result.isQualified).toBe(false);
      expect(result.eligibilityState).toBe('NOT_QUALIFIED');
      expect(result.amountInInr).toBe(150000000);
    });

    it('rejects a business when only revenue or assets are present without verified net worth/equity', () => {
      const revenueOnlyEvidence: FinancialEvidenceRecord = {
        entityName: 'High Revenue Trading Co',
        matchingConfidence: 0.9,
        metricType: 'REVENUE', // Revenue is NOT net worth
        rawAmount: 2000000000,
        currency: 'INR',
        amountInInr: 2000000000, // ₹200 Cr revenue
        conversionRateUsed: 1.0,
        conversionMethod: 'Direct base currency (INR)',
        conversionDate: '2026-10-01',
        thresholdMet: true,
        reportingPeriod: 'FY2023',
        sourceName: 'US SEC EDGAR 10-K / XBRL',
        sourceUrl: 'https://sec.gov',
        sourceTier: 'TIER_1_REGISTRY',
        retrievalDate: '2026-10-01',
        evidenceDate: '2023-12-31',
        verificationStatus: 'VERIFIED',
      };

      const result = evaluateFinancialEligibility(
        [revenueOnlyEvidence],
        { businessName: 'High Revenue Trading Co', country: 'India' },
        'STRICT_NET_WORTH'
      );

      expect(result.isQualified).toBe(false);
      expect(result.eligibilityState).toBe('NOT_QUALIFIED');
      expect(result.qualificationExplanation).toContain('Net Worth');
    });

    it('rejects a business with zero public financial filings as INSUFFICIENT_EVIDENCE', () => {
      const result = evaluateFinancialEligibility(
        undefined,
        { businessName: 'Local Corner Bakery', country: 'India' },
        'STRICT_NET_WORTH'
      );

      expect(result.isQualified).toBe(false);
      expect(result.eligibilityState).toBe('INSUFFICIENT_EVIDENCE');
    });
  });

  // =========================================================================
  // 7. Pipeline Execution: Wrong Location & Category Candidates Rejected Before Financial Lookup
  // =========================================================================
  describe('7. Pipeline Stage Ordering & Quota Protection', () => {
    it('discards out-of-location candidates during LocationVerification before financial evaluation', async () => {
      const mixedCandidates: RawDiscoveredBusiness[] = [
        {
          source: 'rapidapi',
          sources: ['rapidapi'],
          sourceId: 'c1_wrong_country',
          name: 'Atlanta Fine Dine',
          businessName: 'Atlanta Fine Dine',
          category: 'Restaurant',
          address: '100 Peachtree St, Atlanta, GA 30303, USA',
          city: 'Atlanta',
          state: 'Georgia',
          country: 'USA',
          latitude: 33.749,
          longitude: -84.388,
        },
        {
          source: 'rapidapi',
          sources: ['rapidapi'],
          sourceId: 'c2_wrong_category',
          name: 'Mumbai Grand Hotel',
          businessName: 'Mumbai Grand Hotel',
          category: 'Hotel',
          types: ['hotel', 'lodging'],
          address: 'Nariman Point, Mumbai, Maharashtra 400021, India',
          city: 'Mumbai',
          state: 'Maharashtra',
          country: 'India',
          latitude: 18.9256,
          longitude: 72.8242,
        },
      ];

      // Step 1: Location Verification
      const locRes = await locationVerificationActor.execute({
        jobId: 'test_pipeline_loc',
        input: {
          businesses: mixedCandidates,
          country: 'India',
          state: 'Maharashtra',
          city: 'Mumbai',
        },
      });

      expect(locRes.status).toBe('COMPLETED');
      const locData = locRes.data;

      // c1_wrong_country rejected in Location verification
      expect(locData.rejected.some((r) => r.business.sourceId === 'c1_wrong_country')).toBe(true);
      expect(locData.verified.some((v) => v.sourceId === 'c1_wrong_country')).toBe(false);

      // Step 2: Category Verification for remaining location-verified candidates
      const catRes = await businessVerificationActor.execute({
        jobId: 'test_pipeline_cat',
        input: {
          businesses: locData.verified,
          requestedIndustry: 'Restaurants',
        },
      });

      expect(catRes.status).toBe('COMPLETED');
      const catData = catRes.data;

      // c2_wrong_category rejected in Category verification
      expect(catData.rejected.some((r) => r.business.sourceId === 'c2_wrong_category')).toBe(true);

      // Final verified candidates that reach financial stage is 0
      expect(catData.verified.length).toBe(0);
    });
  });
});
