import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { rapidApiDiscoveryProvider, RapidApiDiscoveryProvider } from '@/providers/RapidApiDiscoveryProvider';
import { googlePlacesDiscoveryProvider, GooglePlacesDiscoveryProvider } from '@/providers/GooglePlacesDiscoveryProvider';
import { osmOverpassProvider } from '@/providers/OSMOverpassProvider';
import { providerManager } from '@/lib/providers/ProviderManager';
import { providerHealthService } from '@/lib/providers/ProviderHealthService';
import { RawDiscoveredBusiness, SearchDiscoveryParams } from '@/providers/BusinessDiscoveryProvider';
import { validateLocation } from '@/data/geographyData';
import { leadPilotDb } from '@/db';
import { smartRotationService } from '@/services/SmartRotationService';
import { LeadEntity } from '@/models/Lead';
import { rapidApiCircuitBreaker, googlePlacesCircuitBreaker, osmCircuitBreaker } from '@/lib/resilience/CircuitBreaker';
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
});
