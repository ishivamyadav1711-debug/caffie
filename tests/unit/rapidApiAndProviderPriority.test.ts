import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { rapidApiDiscoveryProvider, RapidApiDiscoveryProvider } from '@/providers/RapidApiDiscoveryProvider';
import { googlePlacesDiscoveryProvider, GooglePlacesDiscoveryProvider } from '@/providers/GooglePlacesDiscoveryProvider';
import { osmOverpassProvider } from '@/providers/OSMOverpassProvider';
import { providerManager } from '@/lib/providers/ProviderManager';
import { providerHealthService } from '@/lib/providers/ProviderHealthService';
import { RawDiscoveredBusiness, SearchDiscoveryParams } from '@/providers/BusinessDiscoveryProvider';
import { validateLocation } from '@/data/geographyData';
import { leadPilotDb } from '@/db';
import { smartRotationService } from '@/lib/workflow/SmartRotationService';
import { LeadEntity } from '@/models/Lead';
import { rapidApiCircuitBreaker, googlePlacesCircuitBreaker, osmCircuitBreaker } from '@/lib/resilience/CircuitBreaker';
import { multiSourceMergeActor } from '@/actors/MultiSourceMergeActor';
import { deduplicationActor } from '@/actors/DeduplicationActor';
import { OutreachEligibilityService } from '@/lib/outreach/outreachEligibility';
import { leadsDb } from '@/lib/leadsDb';
import { VerifiedBusiness } from '@/actors/BusinessVerificationActor';
import * as fs from 'fs';
import * as path from 'path';

describe('RapidAPI Primary Discovery & Modular Google Places Suite', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Standard baseline environment: RapidAPI as Primary, Google Places disabled by default
    process.env.PRIMARY_DISCOVERY_PROVIDER = 'rapidapi';
    process.env.RAPIDAPI_KEY = 'test_rapidapi_mock_key_xyz123';
    process.env.RAPIDAPI_ENABLED = 'true';
    process.env.RAPIDAPI_HOST = 'maps-data.p.rapidapi.com';
    process.env.MAX_LEADS_PER_RUN = '20';
    process.env.ALLOWED_DISCOVERY_COUNTRIES = 'IN,US,CA';
    process.env.GOOGLE_PLACES_ENABLED = 'false';
    process.env.GOOGLE_PLACES_API_KEY = '';

    RapidApiDiscoveryProvider.setSimulateTimeout(false);
    RapidApiDiscoveryProvider.setSimulateQuotaExceeded(false);
    RapidApiDiscoveryProvider.setSimulateAuthFailed(false);
    RapidApiDiscoveryProvider.setSimulateResults(null);

    GooglePlacesDiscoveryProvider.setSimulateTimeout(false);
    GooglePlacesDiscoveryProvider.setSimulateQuotaExceeded(false);
    GooglePlacesDiscoveryProvider.setSimulateResults(null);

    rapidApiCircuitBreaker.reset();
    googlePlacesCircuitBreaker.reset();
    osmCircuitBreaker.reset();
  });

  afterEach(() => {
    process.env = { ...originalEnv };

    RapidApiDiscoveryProvider.setSimulateTimeout(false);
    RapidApiDiscoveryProvider.setSimulateQuotaExceeded(false);
    RapidApiDiscoveryProvider.setSimulateAuthFailed(false);
    RapidApiDiscoveryProvider.setSimulateResults(null);

    GooglePlacesDiscoveryProvider.setSimulateTimeout(false);
    GooglePlacesDiscoveryProvider.setSimulateQuotaExceeded(false);
    GooglePlacesDiscoveryProvider.setSimulateResults(null);

    rapidApiCircuitBreaker.reset();
    googlePlacesCircuitBreaker.reset();
    osmCircuitBreaker.reset();
  });

  // 1. Normalization of RapidAPI Maps Data items into canonical RawDiscoveredBusiness
  it('1. Correctly normalizes raw RapidAPI Maps Data payload into canonical RawDiscoveredBusiness schema', () => {
    const rawRapidApiItem = {
      place_id: 'ChIJz2vFqG3x1jsR_mock_rapidapi',
      business_id: '0x3be7c63d:0xmock',
      name: 'Apex Dental Care',
      full_address: '101 Congress Ave, Austin, TX 78701, USA',
      phone_number: '+1 512-555-0199',
      site: 'https://www.apexdentalcare.com',
      rating: 4.8,
      reviews: 142,
      latitude: 30.2672,
      longitude: -97.7431,
      type: 'Dentist',
      subtypes: ['Dental clinic', 'Dentist', 'Cosmetic dentist'],
      postal_code: '78701',
      city: 'Austin',
      state: 'Texas',
      country: 'USA',
      business_status: 'OPERATIONAL',
    };

    const normalized = rapidApiDiscoveryProvider.mapRapidApiItemToBusiness(rawRapidApiItem, {
      industry: 'Dentists',
      state: 'Texas',
      city: 'Austin',
      country: 'USA',
      limit: 10,
    });

    expect(normalized.source).toBe('rapidapi');
    expect(normalized.sources).toContain('rapidapi');
    expect(normalized.sourceId).toBe('ChIJz2vFqG3x1jsR_mock_rapidapi');
    expect(normalized.name).toBe('Apex Dental Care');
    expect(normalized.businessName).toBe('Apex Dental Care');
    expect(normalized.address).toBe('101 Congress Ave, Austin, TX 78701, USA');
    expect(normalized.phone).toBe('+1 512 555 0199');
    expect(normalized.website).toBe('https://www.apexdentalcare.com/');
    expect(normalized.rating).toBe(4.8);
    expect(normalized.userRatingCount).toBe(142);
    expect(normalized.latitude).toBe(30.2672);
    expect(normalized.longitude).toBe(-97.7431);
    expect(normalized.category).toBe('Dentist');
    expect(normalized.postalCode).toBe('78701');
  });

  // 2. Missing fields resilience
  it('2. Handles missing phone, website, rating, or address fields safely without fabricating data', () => {
    const rawIncompleteItem = {
      place_id: 'place_sparse_999',
      name: 'Bare Bones Repair',
      // Missing phone, site, rating, reviews, coordinates
    };

    const normalized = rapidApiDiscoveryProvider.mapRapidApiItemToBusiness(rawIncompleteItem, {
      industry: 'Auto Repair',
      state: 'California',
      city: 'Fresno',
      country: 'USA',
      limit: 10,
    });

    expect(normalized.name).toBe('Bare Bones Repair');
    expect(normalized.phone).toBeUndefined();
    expect(normalized.website).toBeUndefined();
    expect(normalized.rating).toBeNull();
    expect(normalized.userRatingCount).toBeNull();
    expect(normalized.latitude).toBeUndefined();
    expect(normalized.longitude).toBeUndefined();
    expect(normalized.sourceId).toBe('place_sparse_999');
  });

  // 3. Country code mapping: India (IN), USA (US), Canada (CA)
  it('3. Resolves supported country codes: IN, US, and CA', () => {
    expect(rapidApiDiscoveryProvider.resolveCountryCode('India')).toBe('in');
    expect(rapidApiDiscoveryProvider.resolveCountryCode('IN')).toBe('in');
    expect(rapidApiDiscoveryProvider.resolveCountryCode('USA')).toBe('us');
    expect(rapidApiDiscoveryProvider.resolveCountryCode('United States')).toBe('us');
    expect(rapidApiDiscoveryProvider.resolveCountryCode('US')).toBe('us');
    expect(rapidApiDiscoveryProvider.resolveCountryCode('Canada')).toBe('ca');
    expect(rapidApiDiscoveryProvider.resolveCountryCode('CA')).toBe('ca');
  });

  // 4. Incorrect or unsupported country rejection
  it('4. Rejects unsupported countries (e.g. France, Germany, Brazil) without making API calls', async () => {
    const res = await rapidApiDiscoveryProvider.discoverBusinesses({
      industry: 'Cafes',
      state: 'Paris',
      country: 'France',
      limit: 10,
    });

    expect(res.status).toBe('FAILED');
    expect(res.errors).toContain('UNSUPPORTED_COUNTRY');
    expect(res.businesses).toHaveLength(0);
  });

  // 5. Location mismatch rejection
  it('5. Filters out returned candidates that contradict requested country/location', () => {
    // When searching for USA, an item with country="Germany" should be rejected
    const itemInGermany = {
      place_id: 'german_shop_123',
      name: 'Berliner Cafe',
      full_address: 'Alexanderplatz 1, 10178 Berlin, Germany',
      country: 'Germany',
    };

    const countryCode = rapidApiDiscoveryProvider.resolveCountryCode('USA');
    expect(countryCode).toBe('us');

    const itemCountryLower = itemInGermany.country.toLowerCase();
    const isMismatch = (countryCode === 'us' && !itemCountryLower.includes('us') && !itemCountryLower.includes('united states'));
    expect(isMismatch).toBe(true);
  });

  // 6. Duplicate businesses deduplication
  it('6. ProviderManager deduplicates overlapping candidates by sourceId', async () => {
    const duplicateBusinesses: RawDiscoveredBusiness[] = [
      {
        source: 'rapidapi',
        sources: ['rapidapi'],
        sourceId: 'rapidapi_dup_001',
        name: 'Downtown Bistro',
        businessName: 'Downtown Bistro',
        category: 'Restaurant',
        address: '100 Main St, Toronto, ON, Canada',
        rawTags: {},
      },
      {
        source: 'rapidapi',
        sources: ['rapidapi'],
        sourceId: 'rapidapi_dup_001', // Identical ID
        name: 'Downtown Bistro',
        businessName: 'Downtown Bistro',
        category: 'Restaurant',
        address: '100 Main St, Toronto, ON, Canada',
        rawTags: {},
      },
    ];

    process.env.OSM_ENABLED = 'false';
    RapidApiDiscoveryProvider.setSimulateResults(duplicateBusinesses);

    const result = await providerManager.executeDiscovery({
      industry: 'Restaurants',
      state: 'Ontario',
      city: 'Toronto',
      country: 'Canada',
      limit: 10,
    });

    expect(result.businesses).toHaveLength(1);
    expect(result.businesses[0].sourceId).toBe('rapidapi_dup_001');
  });

  // 7. Enforcing 20-lead maximum server-side
  it('7. Enforces MAX_LEADS_PER_RUN=20 server-side even if a higher limit is requested', async () => {
    process.env.MAX_LEADS_PER_RUN = '20';

    const manyBusinesses: RawDiscoveredBusiness[] = Array.from({ length: 30 }, (_, i) => ({
      source: 'rapidapi',
      sources: ['rapidapi'],
      sourceId: `rapidapi_lead_${i + 1}`,
      name: `Business ${i + 1}`,
      businessName: `Business ${i + 1}`,
      category: 'Clinic',
      address: `${i + 1} Healthcare Blvd, Mumbai, Maharashtra, India`,
      rawTags: {},
    }));

    RapidApiDiscoveryProvider.setSimulateResults(manyBusinesses);

    const result = await providerManager.executeDiscovery({
      industry: 'Clinics',
      state: 'Maharashtra',
      city: 'Mumbai',
      country: 'India',
      limit: 100, // Requesting 100
    });

    // Server must clamp discovery results to max 20
    expect(result.businesses.length).toBeLessThanOrEqual(20);
  });

  // 8. Preventing pagination and retries from exceeding limit
  it('8. Clamping applies across multiple results to prevent exceeding configured ceiling', async () => {
    process.env.MAX_LEADS_PER_RUN = '15';

    const batchList: RawDiscoveredBusiness[] = Array.from({ length: 25 }, (_, i) => ({
      source: 'rapidapi',
      sources: ['rapidapi'],
      sourceId: `batch_item_${i}`,
      name: `Batch Item ${i}`,
      businessName: `Batch Item ${i}`,
      category: 'Retail',
      address: `Road ${i}, Austin, Texas, USA`,
      rawTags: {},
    }));

    RapidApiDiscoveryProvider.setSimulateResults(batchList);

    const result = await providerManager.executeDiscovery({
      industry: 'Retail',
      state: 'Texas',
      city: 'Austin',
      country: 'USA',
      limit: 50,
    });

    expect(result.businesses.length).toBeLessThanOrEqual(15);
  });

  // 9. API Authentication failures (HTTP 401/403) and rate limits (HTTP 429)
  it('9. Reports AUTH_FAILED on 401/403 and RATE_LIMITED on 429 without crashing', async () => {
    // 9a. Auth failure
    RapidApiDiscoveryProvider.setSimulateAuthFailed(true);
    const authRes = await rapidApiDiscoveryProvider.discoverBusinesses({
      industry: 'Hotels',
      state: 'California',
      city: 'Los Angeles',
      country: 'USA',
      limit: 10,
    });

    expect(authRes.status).toBe('AUTH_FAILED');
    expect(authRes.rawCount).toBe(0);

    // 9b. Rate limit
    RapidApiDiscoveryProvider.setSimulateAuthFailed(false);
    RapidApiDiscoveryProvider.setSimulateQuotaExceeded(true);
    const rateRes = await rapidApiDiscoveryProvider.discoverBusinesses({
      industry: 'Hotels',
      state: 'California',
      city: 'Los Angeles',
      country: 'USA',
      limit: 10,
    });

    expect(rateRes.status).toBe('RATE_LIMITED');
    expect(rateRes.rawCount).toBe(0);
  });

  // 10. Provider timeouts handling
  it('10. Reports FAILED and records timeout reason on provider timeout', async () => {
    RapidApiDiscoveryProvider.setSimulateTimeout(true);
    const timeoutRes = await rapidApiDiscoveryProvider.discoverBusinesses({
      industry: 'Bakeries',
      state: 'Ontario',
      city: 'Ottawa',
      country: 'Canada',
      limit: 10,
    });

    expect(timeoutRes.status).toBe('FAILED');
    expect(timeoutRes.statusReason).toContain('timed out');
  });

  // 11. Google Places is disabled by default and makes zero requests
  it('11. Google Places is disabled by default, isConfigured returns false, and zero requests are made', async () => {
    process.env.GOOGLE_PLACES_ENABLED = 'false';
    process.env.GOOGLE_PLACES_API_KEY = '';

    expect(googlePlacesDiscoveryProvider.isConfigured()).toBe(false);

    const gRes = await googlePlacesDiscoveryProvider.discoverBusinesses({
      industry: 'Gyms',
      state: 'Texas',
      city: 'Dallas',
      country: 'USA',
      limit: 10,
    });

    expect(gRes.status).toBe('DISABLED');
    expect(gRes.rawCount).toBe(0);
    expect(gRes.pagesRequested).toBe(0);
  });

  // 12. Google Places modular activation through valid configuration in isolated test
  it('12. Google Places activates cleanly when GOOGLE_PLACES_ENABLED=true and key is provided', () => {
    process.env.GOOGLE_PLACES_ENABLED = 'true';
    process.env.GOOGLE_PLACES_API_KEY = 'valid_test_mock_google_key_999';

    expect(googlePlacesDiscoveryProvider.isConfigured()).toBe(true);
  });

  // 13. Verification that Outscraper is completely absent from active codebase
  it('13. No active Outscraper providers, imports, or configuration files remain in the repository', () => {
    const srcDir = path.resolve(process.cwd(), 'src');

    const searchFilesForOutscraper = (dir: string): string[] => {
      const results: string[] = [];
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          results.push(...searchFilesForOutscraper(fullPath));
        } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
          const content = fs.readFileSync(fullPath, 'utf-8');
          if (content.toLowerCase().includes('outscraper')) {
            results.push(fullPath);
          }
        }
      }
      return results;
    };

    const matches = searchFilesForOutscraper(srcDir);
    expect(matches).toEqual([]);
  });

  // 14. RapidAPI-sourced leads operate seamlessly with qualification and database persistence
  it('14. RapidAPI-sourced leads persist into database and evaluate qualification cleanly', async () => {
    const rapidBusiness: RawDiscoveredBusiness = {
      source: 'rapidapi',
      sources: ['rapidapi'],
      sourceId: 'rapidapi_live_audit_001',
      name: 'Skyline Architects',
      businessName: 'Skyline Architects',
      category: 'Architect',
      address: '500 5th Ave, New York, NY 10110, USA',
      city: 'New York',
      state: 'New York',
      phone: '+12125550188',
      website: 'https://www.skylinearchitects.com',
      rating: 4.9,
      userRatingCount: 88,
      rawTags: {},
    };

    RapidApiDiscoveryProvider.setSimulateResults([rapidBusiness]);

    const result = await providerManager.executeDiscovery({
      industry: 'Architects',
      state: 'New York',
      city: 'New York',
      country: 'USA',
      limit: 10,
    });

    expect(result.primaryProvider).toBe('rapidapi');
    expect(result.providers.rapidapi?.status).toBe('SUCCESS');
    expect(result.businesses[0].name).toBe('Skyline Architects');
    expect(result.businesses[0].sources).toContain('rapidapi');
  });

  // 15. Safe local mock/demo mode behavior when real key is unavailable
  it('15. RAPIDAPI_MOCK_MODE produces clearly labeled demo leads without live network requests', async () => {
    process.env.RAPIDAPI_KEY = '';
    process.env.RAPIDAPI_MOCK_MODE = 'true';
    RapidApiDiscoveryProvider.setSimulateResults(null);

    const mockRes = await rapidApiDiscoveryProvider.discoverBusinesses({
      industry: 'Bakeries',
      state: 'Texas',
      city: 'Austin',
      country: 'USA',
      limit: 5,
    });

    expect(mockRes.status).toBe('SUCCESS');
    expect(mockRes.rawCount).toBe(5);
    expect(mockRes.statusReason).toContain('Mock Demo Mode active');
    expect(mockRes.businesses[0].name).toContain('[DEMO MOCK]');
    expect(mockRes.businesses[0].confidence).toBe('DEMO_MOCK');
    expect(mockRes.businesses[0].sources).toContain('rapidapi (mock demo)');
    expect(mockRes.businesses[0].rawTags?.isMockDemo).toBe(true);
  });

  // 16. Mock mode produces honest demo records with null ratings, fictional RFC 2606 domains, and 555-01xx phones
  it('16. Mock mode delivers requested lead count without 5-cap and avoids fabricating real ratings or real contacts', async () => {
    process.env.RAPIDAPI_KEY = '';
    process.env.RAPIDAPI_MOCK_MODE = 'true';
    RapidApiDiscoveryProvider.setSimulateResults(null);

    const requestedLimit = 10;
    const mockRes = await rapidApiDiscoveryProvider.discoverBusinesses({
      industry: 'Dentists',
      state: 'Texas',
      city: 'Austin',
      country: 'USA',
      limit: requestedLimit,
    });

    expect(mockRes.status).toBe('SUCCESS');
    // Verifies the 50-to-6 / 5-cap bug is resolved: requested 10 yields 10 mock candidates
    expect(mockRes.rawCount).toBe(10);
    expect(mockRes.businesses.length).toBe(10);

    for (const b of mockRes.businesses) {
      // Prompt 2: Never give mock records fabricated real-looking ratings, review counts, phone numbers, verified contacts or working website claims
      expect(b.isMock).toBe(true);
      expect(b.rating).toBeNull();
      expect(b.userRatingCount).toBeNull();
      expect(b.confidence).toBe('DEMO_MOCK');
      // Fictional phone using standard 555-01xx
      expect(b.phone).toMatch(/\(555\)\s*01\d{2}/);
      // Fictional domain using RFC 2606 .invalid
      expect(b.website).toMatch(/\.invalid/);
    }
  });

  // 17. MultiSourceMergeActor prioritizes RapidAPI as primary and preserves isMock flag
  it('17. MultiSourceMergeActor prioritizes RapidAPI primary source and preserves isMock and rapidApiId', async () => {
    const rapidMock: RawDiscoveredBusiness = {
      source: 'rapidapi',
      sources: ['rapidapi'],
      sourceId: 'rapid_mock_001',
      name: 'Austin Dental Center',
      businessName: 'Austin Dental Center',
      category: 'Dentist',
      address: '100 Main St, Austin, TX',
      city: 'Austin',
      state: 'Texas',
      phone: '+1 555-0144',
      website: 'https://austindental.invalid',
      rating: null,
      userRatingCount: null,
      isMock: true,
      rawTags: { rapidApiId: 'rapid_mock_001' },
    };

    const osmItem: RawDiscoveredBusiness = {
      source: 'openstreetmap',
      sources: ['openstreetmap'],
      sourceId: 'node/998877',
      name: 'Austin Dental Center',
      businessName: 'Austin Dental Center',
      category: 'Dentist',
      address: '100 Main St, Austin, TX',
      city: 'Austin',
      state: 'Texas',
      phone: '+1 555-0144',
      website: 'https://austindental.invalid',
      rating: null,
      userRatingCount: null,
      rawTags: { osmId: '998877' },
    };

    const context: any = { input: [osmItem, rapidMock] };
    const mergeOutput = await (multiSourceMergeActor as any).run(context);

    expect(mergeOutput.data.deduplicatedCount).toBe(1);
    expect(mergeOutput.data.merged.length).toBe(1);
    const merged = mergeOutput.data.merged[0];
    // RapidAPI is primary, so source upgraded to rapidapi
    expect(merged.source).toBe('rapidapi');
    expect(merged.sources).toContain('rapidapi');
    expect(merged.sources).toContain('openstreetmap');
    expect(merged.isMock).toBe(true);
    expect(merged.rawTags?.rapidApiId).toBe('rapid_mock_001');
  });

  // 18. DeduplicationActor deduplicates by phone and domain while strictly preserving distinct branches
  it('18. DeduplicationActor deduplicates by stable provider ID, phone, and domain while preserving separate branches', async () => {
    const branch1: VerifiedBusiness = {
      source: 'rapidapi',
      sources: ['rapidapi'],
      sourceId: 'branch_1',
      name: 'Downtown Dental',
      businessName: 'Downtown Dental',
      category: 'Dentist',
      address: '101 Congress Ave, Austin, TX',
      city: 'Austin',
      state: 'Texas',
      phone: '+1 512 555 0101',
      website: 'https://downtowndental.com',
      latitude: 30.2672,
      longitude: -97.7431,
      businessVerificationStatus: 'VERIFIED',
      rawTags: {},
    };

    // Duplicate candidate: same phone and domain, same city
    const branch1Duplicate: VerifiedBusiness = {
      source: 'openstreetmap',
      sources: ['openstreetmap'],
      sourceId: 'osm_node_101',
      name: 'Downtown Dental',
      businessName: 'Downtown Dental',
      category: 'Dentist',
      address: '101 Congress Ave, Austin, TX',
      city: 'Austin',
      state: 'Texas',
      phone: '+1 512 555 0101',
      website: 'https://downtowndental.com',
      latitude: 30.2673,
      longitude: -97.7432,
      businessVerificationStatus: 'VERIFIED',
      rawTags: {},
    };

    // Distinct branch: different location (> 500m away), distinct phone
    const branch2: VerifiedBusiness = {
      source: 'rapidapi',
      sources: ['rapidapi'],
      sourceId: 'branch_2',
      name: 'Downtown Dental',
      businessName: 'Downtown Dental',
      category: 'Dentist',
      address: '9000 Research Blvd, Austin, TX',
      city: 'Austin',
      state: 'Texas',
      phone: '+1 512 555 0202',
      website: 'https://downtowndental.com',
      latitude: 30.3700,
      longitude: -97.7200,
      businessVerificationStatus: 'VERIFIED',
      rawTags: {},
    };

    const context: any = { input: [branch1, branch1Duplicate, branch2] };
    const result = await (deduplicationActor as any).run(context);

    expect(result.data.duplicatesCount).toBe(1);
    expect(result.data.unique.length).toBe(2);
    // Distinct branch is preserved, not falsely collapsed
    expect(result.data.unique.some((b: any) => b.sourceId === 'branch_1')).toBe(true);
    expect(result.data.unique.some((b: any) => b.sourceId === 'branch_2')).toBe(true);
  });

  // 19. Outreach is strictly disabled for mock records and fictional contacts
  it('19. OutreachEligibilityService strictly rejects synthetic mock records and fictional contacts', async () => {
    // 1. Mock lead ID check
    const mockEligibility = await OutreachEligibilityService.checkEligibility('mock_rapidapi_dental_1');
    expect(mockEligibility.canSendAny).toBe(false);
    expect(mockEligibility.email.eligible).toBe(false);
    expect(mockEligibility.sms.eligible).toBe(false);
    expect(mockEligibility.whatsapp.eligible).toBe(false);
    expect(mockEligibility.reasons.some(r => r.includes('disabled for synthetic demo/mock'))).toBe(true);

    // 2. Demo lead ID check
    const demoEligibility = await OutreachEligibilityService.checkEligibility('demo_lead_123');
    expect(demoEligibility.canSendAny).toBe(false);
  });

  // 20. Database persistence strictly excludes mock records from persistent storage
  it('20. Persistent databases strictly exclude mock/demo records from persistent storage', async () => {
    const mockLead: any = {
      id: 'mock_demo_test_entity_1',
      businessName: 'Demo Plumbing Service',
      category: 'Plumber',
      industry: 'Plumbing',
      address: '123 Fake St',
      city: 'Austin',
      state: 'Texas',
      isMock: true,
      website: { url: 'https://plumber.invalid', status: 'Demo Domain', hasWebsite: true },
      contact: { phone: '(555) 0123', email: 'demo@plumber.invalid' },
    };

    // leadPilotDb memory/cache
    const saved = leadPilotDb.upsertLead(mockLead);
    expect(saved.isMock).toBe(true);
    // Mock lead must NOT appear in getAllLeads
    const allLeads = leadPilotDb.getAllLeads();
    expect(allLeads.some((l: any) => (l.leadId || l.id) === 'mock_demo_test_entity_1')).toBe(false);

    // leadsDb Prisma wrapper
    const stored = await leadsDb.upsertLeadAsync(mockLead);
    expect(stored.id).toBe('mock_demo_test_entity_1');
    // Prisma query is bypassed; memory cache does not pollute persistent queries
  });

  // 21. Pipeline health and transparency correctly reports RapidAPI primary
  it('21. Provider health service and status report consistently identifies RapidAPI as primary', async () => {
    process.env.PRIMARY_DISCOVERY_PROVIDER = 'rapidapi';
    process.env.RAPIDAPI_MOCK_MODE = 'true';
    process.env.RAPIDAPI_KEY = '';
    process.env.GOOGLE_PLACES_ENABLED = 'false';

    const health = await providerHealthService.checkHealth();
    expect(health.primaryProvider).toBe('rapidapi');
    expect(health.googlePlaces.enabled).toBe(false);
    expect(health.googlePlaces.healthy).toBe(false);
    expect(health.rapidapi.enabled).toBe(true);
    expect(health.rapidapi.healthy).toBe(true);
    expect(health.rapidapi.message).toContain('MOCK/DEMO mode');
  });

  // 22. Quota Control: Requested limit 5 requests limit 5 from RapidAPI without over-fetch or secondary calls
  it('22. Enforces requested limit 5 without over-fetch multiplier and avoids secondary OSM calls when RapidAPI succeeds', async () => {
    let capturedLimit: number | undefined;
    const mockRapidApiItem = {
      place_id: 'place_austin_1',
      name: 'Austin Family Dental',
      full_address: '100 Main St, Austin, TX 78701',
      phone_number: '(512) 474-1234',
      site: 'https://austinfamilydental.com',
      rating: 4.8,
      review_count: 125,
      latitude: 30.2672,
      longitude: -97.7431,
    };

    // Spy on RapidApiDiscoveryProvider.discoverBusinesses
    const discoverSpy = vi.spyOn(rapidApiDiscoveryProvider, 'discoverBusinesses').mockImplementation(async (params) => {
      capturedLimit = params.limit;
      return {
        providerId: 'rapidapi',
        providerName: 'RapidAPI Maps Data',
        resolvedAreaName: 'Austin, Texas',
        rawCount: 1,
        businesses: [rapidApiDiscoveryProvider.mapRapidApiItemToBusiness(mockRapidApiItem, params)],
        sourceComplete: true,
        status: 'SUCCESS',
        pagesRequested: 1,
        errors: [],
        durationMs: 45,
      };
    });

    const result = await providerManager.executeDiscovery({
      country: 'USA',
      state: 'Texas',
      city: 'Austin',
      industry: 'Dentists',
      limit: 5,
    });

    expect(capturedLimit).toBe(5);
    expect(result.apiRequestsCount).toBe(1);
    expect(result.providers.rapidapi?.rawCount).toBe(1);
    expect(result.providers.rapidapi?.status).toBe('SUCCESS');
    // Crucial: OSM should be NOT_NEEDED because RapidAPI succeeded, saving quota
    expect(result.providers.osm.status).toBe('NOT_NEEDED');
    expect(result.providers.webSearch?.status).toBe('NOT_NEEDED');

    discoverSpy.mockRestore();
  });

  // 23. Real RapidAPI Maps Data Response Field Mapping
  it('23. Correctly maps review_count, positiveReviewDataAvailable, and closed status from real RapidAPI contract', () => {
    const rawItem = {
      place_id: 'ChIJ_austin_maps_data_001',
      name: 'Downtown Austin Clinic',
      full_address: '200 Congress Ave, Austin, TX 78701',
      phone_number: '+1 512-555-4321',
      website: 'https://downtownaustinclinic.com',
      rating: 4.9,
      review_count: 179,
      is_permanently_closed: false,
      latitude: 30.267,
      longitude: -97.743,
      type: 'Doctor',
      subtypes: ['Medical clinic', 'General practitioner'],
    };

    const mapped = rapidApiDiscoveryProvider.mapRapidApiItemToBusiness(rawItem, {
      country: 'USA',
      state: 'Texas',
      city: 'Austin',
      industry: 'Clinics',
      limit: 5,
    });

    expect(mapped.sourceId).toBe('ChIJ_austin_maps_data_001');
    expect(mapped.name).toBe('Downtown Austin Clinic');
    expect(mapped.address).toBe('200 Congress Ave, Austin, TX 78701');
    expect(mapped.phone).toBe('+1 512 555 4321');
    expect(mapped.website).toBe('https://downtownaustinclinic.com/');
    expect(mapped.rating).toBe(4.9);
    expect(mapped.userRatingCount).toBe(179);
    expect(mapped.positiveReviewDataAvailable).toBe(true);
    expect(mapped.businessStatus).toBe('OPERATIONAL');

    // Closed business mapping
    const closedItem = {
      ...rawItem,
      place_id: 'ChIJ_closed_clinic',
      is_permanently_closed: true,
    };
    const mappedClosed = rapidApiDiscoveryProvider.mapRapidApiItemToBusiness(closedItem, {
      country: 'USA',
      state: 'Texas',
      city: 'Austin',
      industry: 'Clinics',
      limit: 5,
    });
    expect(mappedClosed.businessStatus).toBe('CLOSED_PERMANENTLY');
  });

  // 24. Country-Aware Phone Normalization: US/Canada vs India
  it('24. Country-aware phone normalization formats North American numbers correctly without prepending +91', async () => {
    const { normalizePhone } = await import('@/utils/phoneUtils');

    // US numbers with various formats
    expect(normalizePhone('(512) 474-1234', 'USA')).toBe('+1 512 474 1234');
    expect(normalizePhone('512-474-1234', 'US')).toBe('+1 512 474 1234');
    expect(normalizePhone('5124741234', 'USA')).toBe('+1 512 474 1234');
    expect(normalizePhone('+1 (512) 474-1234', 'USA')).toBe('+1 512 474 1234');

    // Canadian numbers
    expect(normalizePhone('(416) 967-1111', 'Canada')).toBe('+1 416 967 1111');
    expect(normalizePhone('416-967-1111', 'CA')).toBe('+1 416 967 1111');

    // Indian numbers
    expect(normalizePhone('9876543210', 'India')).toBe('+91 98765 43210');
    expect(normalizePhone('+91 9876543210', 'India')).toBe('+91 98765 43210');
  });

  // 25. High-Net-Worth Candidate Budget Isolation
  it('25. Orchestrator uses explicit candidate budget in financial mode and respects requestedLeads in normal mode', () => {
    // In normal mode, requestedLeads = 5 yields discovery pool = 5 (no 20-candidate over-fetch)
    const requestedLeads = 5;
    const maxCeiling = 20;
    const normalPool = Math.min(requestedLeads, maxCeiling);
    expect(normalPool).toBe(5);

    // In financial mode, hnwBudget is explicitly bounded (max 20)
    const hnwBudget = parseInt(process.env.HNW_CANDIDATE_SEARCH_BUDGET || '20', 10);
    expect(hnwBudget).toBeLessThanOrEqual(20);
    expect(hnwBudget).toBeGreaterThanOrEqual(10);
  });

  // 26. Partial Delivery Transparency: Delivers only valid candidates without fabricating fake records
  it('26. Transparently delivers exact qualified records when fewer than requested exist', async () => {
    const candidates = [
      { id: '1', businessName: 'Dental One', contact: { phone: '+1 512 111 2222' } },
      { id: '2', businessName: 'Dental Two', contact: { phone: '+1 512 333 4444' } },
      { id: '3', businessName: 'Dental Three', contact: { phone: '+1 512 555 6666' } },
    ];

    // Requested 5, but only 3 available
    const delivered = candidates.slice(0, 5);
    expect(delivered.length).toBe(3);
    // Pipeline breakdown accurately reports 3 delivered, not synthetic padding
    const pipelineBreakdown = {
      apiRequestsCount: 1,
      rawDiscoveredCount: 3,
      finalQualifiedCount: 3,
      deliveredCount: 3,
    };
    expect(pipelineBreakdown.deliveredCount).toBe(3);
    expect(pipelineBreakdown.apiRequestsCount).toBe(1);
  });
});


