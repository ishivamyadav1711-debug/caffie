import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { googlePlacesDiscoveryProvider, GooglePlacesDiscoveryProvider } from '@/providers/GooglePlacesDiscoveryProvider';
import { osmOverpassProvider } from '@/providers/OSMOverpassProvider';
import { providerManager } from '@/lib/providers/ProviderManager';
import { multiSourceMergeActor } from '@/actors/MultiSourceMergeActor';
import { locationVerificationActor } from '@/actors/LocationVerificationActor';
import { businessVerificationActor } from '@/actors/BusinessVerificationActor';
import { deduplicationActor } from '@/actors/DeduplicationActor';
import { getOsmTagsForIndustry } from '@/lib/osmIndustryMapper';
import { classifyCandidateWebsite, normalizeWebsiteFilter } from '@/lib/audit/WebsiteStatusClassifier';
import { evaluateContactFilter, normalizeContactFilter } from '@/lib/providers/contactTypes';
import { RawDiscoveredBusiness } from '@/providers/BusinessDiscoveryProvider';
import { googlePlacesCircuitBreaker, osmCircuitBreaker } from '@/lib/resilience/CircuitBreaker';
import { clearOverpassCache } from '@/lib/overpassClient';

function createJsonResponse(data: any, status = 200, ok = true) {
  const body = typeof data === 'string' ? data : JSON.stringify(data);
  return {
    ok,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    text: async () => body,
    json: async () => JSON.parse(body),
  } as any;
}

describe('P0 Lead Discovery & Qualification Regression Suite', () => {
  const originalApiKey = process.env.GOOGLE_PLACES_API_KEY;
  const originalEnabled = process.env.GOOGLE_PLACES_ENABLED;
  const originalPrimary = process.env.PRIMARY_DISCOVERY_PROVIDER;

  beforeEach(() => {
    process.env.PRIMARY_DISCOVERY_PROVIDER = 'google_places';
    process.env.GOOGLE_PLACES_ENABLED = 'true';
    process.env.GOOGLE_PLACES_API_KEY = 'AIzaSyDummyTestKeyForUnitTests123456789';
    GooglePlacesDiscoveryProvider.setSimulateTimeout(false);
    GooglePlacesDiscoveryProvider.setSimulateQuotaExceeded(false);
    GooglePlacesDiscoveryProvider.setSimulateResults(null);
    googlePlacesCircuitBreaker.reset();
    osmCircuitBreaker.reset();
    clearOverpassCache();
  });

  afterEach(() => {
    process.env.GOOGLE_PLACES_API_KEY = originalApiKey;
    process.env.GOOGLE_PLACES_ENABLED = originalEnabled;
    process.env.PRIMARY_DISCOVERY_PROVIDER = originalPrimary;
    GooglePlacesDiscoveryProvider.setSimulateTimeout(false);
    GooglePlacesDiscoveryProvider.setSimulateQuotaExceeded(false);
    GooglePlacesDiscoveryProvider.setSimulateResults(null);
    googlePlacesCircuitBreaker.reset();
    osmCircuitBreaker.reset();
    clearOverpassCache();
  });

  // 1. Google authentication failure with a useful diagnostic
  it('1. Reports Google authentication failure with a useful, sanitized diagnostic', async () => {
    const originalFetch = global.fetch;
    global.fetch = async (url: any) => {
      if (String(url).includes('places.googleapis.com')) {
        return createJsonResponse({
          error: {
            code: 403,
            message: 'The caller does not have permission',
            status: 'PERMISSION_DENIED',
          },
        }, 403, false);
      }
      return originalFetch(url);
    };

    try {
      const res = await googlePlacesDiscoveryProvider.discoverBusinesses({
        industry: 'Plumbers',
        city: 'Mumbai',
        state: 'Maharashtra',
        limit: 10,
      });

      expect(res.status).toBe('AUTH_FAILED');
      expect(res.rawCount).toBe(0);
      expect(res.statusReason).toContain('Google Places authentication failed');
      expect(res.statusReason).toContain('PERMISSION_DENIED');
      expect(res.errors[0]).toContain('HTTP 403: The caller does not have permission');
    } finally {
      global.fetch = originalFetch;
    }
  });

  // 2. OSM failure while Google succeeds
  it('2. Google discovery succeeds while OSM is bypassed or handles failure gracefully', async () => {
    const originalFetch = global.fetch;
    global.fetch = async (url: any, init?: any) => {
      const urlStr = String(url);
      if (urlStr.includes('overpass') || urlStr.includes('nominatim')) {
        return createJsonResponse({ elements: [] });
      }
      return originalFetch(url, init);
    };

    const mockGoogleVenues: RawDiscoveredBusiness[] = [
      {
        source: 'google_places',
        sources: ['google_places'],
        sourceId: 'ChIJ_mock_google_1',
        name: 'Alpha Plumbing Works',
        businessName: 'Alpha Plumbing Works',
        category: 'plumber',
        address: 'Bandra West, Mumbai, Maharashtra',
        city: 'Mumbai',
        state: 'Maharashtra',
        latitude: 19.0596,
        longitude: 72.8295,
        phone: '+91 98200 11111',
        rawTags: {},
      },
      {
        source: 'google_places',
        sources: ['google_places'],
        sourceId: 'ChIJ_mock_google_2',
        name: 'Beta Plumbers Services',
        businessName: 'Beta Plumbers Services',
        category: 'plumber',
        address: 'Andheri East, Mumbai, Maharashtra',
        city: 'Mumbai',
        state: 'Maharashtra',
        latitude: 19.1136,
        longitude: 72.8697,
        phone: '+91 98200 22222',
        rawTags: {},
      },
    ];

    GooglePlacesDiscoveryProvider.setSimulateResults(mockGoogleVenues);

    try {
      const discovery = await providerManager.executeDiscovery({
        industry: 'Plumbers',
        city: 'Mumbai',
        state: 'Maharashtra',
        limit: 2,
      });

      expect(['SUCCESS', 'PARTIAL']).toContain(discovery.providers.googlePlaces.status);
      expect(discovery.providers.googlePlaces.rawCount).toBe(2);
      expect(discovery.totalDiscovered).toBeGreaterThanOrEqual(2);
      expect(['COMPLETE', 'PARTIAL']).toContain(discovery.overallStatus);
    } finally {
      global.fetch = originalFetch;
    }
  });

  // 3. Google failure while OSM succeeds
  it('3. Google authentication failure does not suppress valid OSM fallback results', async () => {
    const originalFetch = global.fetch;
    global.fetch = async (url: any, init?: any) => {
      const urlStr = String(url);
      if (urlStr.includes('places.googleapis.com')) {
        return createJsonResponse({
          error: { code: 403, message: 'The caller does not have permission' },
        }, 403, false);
      }
      if (urlStr.includes('nominatim')) {
        return createJsonResponse([
          {
            osm_type: 'node',
            osm_id: 101010,
            name: 'Mumbai City Plumbers Co',
            lat: '19.0760',
            lon: '72.8777',
            address: {
              city: 'Mumbai',
              state: 'Maharashtra',
            },
            extratags: {
              craft: 'plumber',
              phone: '+91 98200 33333',
            },
          },
        ]);
      }
      if (urlStr.includes('overpass')) {
        return createJsonResponse({
          elements: [
            {
              type: 'node',
              id: 101010,
              lat: 19.0760,
              lon: 72.8777,
              tags: {
                name: 'Mumbai City Plumbers Co',
                craft: 'plumber',
                'addr:city': 'Mumbai',
                'addr:state': 'Maharashtra',
                phone: '+91 98200 33333',
              },
            },
          ],
        });
      }
      return originalFetch(url, init);
    };

    try {
      const discovery = await providerManager.executeDiscovery({
        industry: 'Plumbers',
        city: 'Mumbai',
        state: 'Maharashtra',
        limit: 10,
      });

      expect(discovery.providers.googlePlaces.status).toBe('AUTH_FAILED');
      expect(discovery.providers.osm.status).toBe('PARTIAL');
      expect(discovery.totalDiscovered).toBe(1);
      expect(discovery.businesses[0].name).toBe('Mumbai City Plumbers Co');
      expect(discovery.overallStatus).toBe('PARTIAL');
    } finally {
      global.fetch = originalFetch;
    }
  });

  // 4. Both providers failing records PROVIDER_FAILURE distinctly from zero results
  it('4. Both providers failing records PROVIDER_FAILURE distinctly from legitimate zero results', async () => {
    const originalFetch = global.fetch;
    global.fetch = async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes('places.googleapis.com')) {
        return createJsonResponse({
          error: { code: 403, message: 'The caller does not have permission' },
        }, 403, false);
      }
      if (urlStr.includes('overpass') || urlStr.includes('nominatim')) {
        throw new Error('All Overpass endpoints timed out');
      }
      return originalFetch(url);
    };

    try {
      const discovery = await providerManager.executeDiscovery({
        industry: 'Plumbers',
        city: 'Mumbai',
        state: 'Maharashtra',
        limit: 10,
      });

      expect(discovery.providers.googlePlaces.status).toBe('AUTH_FAILED');
      expect(['REQUEST_FAILED', 'FAILED', 'RATE_LIMITED']).toContain(discovery.providers.osm.status);
      expect(discovery.totalDiscovered).toBe(0);
      expect(discovery.overallStatus).toBe('PROVIDER_FAILURE');
      expect(discovery.statusReason).toContain('All business discovery providers encountered errors');
    } finally {
      global.fetch = originalFetch;
    }
  });

  // 5. Valid zero-result responses
  it('5. Valid zero-result responses are recognized without fabricating fake candidates', async () => {
    const originalFetch = global.fetch;
    global.fetch = async (url: any, init?: any) => {
      const urlStr = String(url);
      if (urlStr.includes('places.googleapis.com')) {
        return createJsonResponse({ places: [] });
      }
      if (urlStr.includes('nominatim')) {
        return createJsonResponse([]);
      }
      if (urlStr.includes('overpass')) {
        return createJsonResponse({ elements: [] });
      }
      return originalFetch(url, init);
    };

    try {
      const discovery = await providerManager.executeDiscovery({
        industry: 'NonexistentNicheService',
        city: 'Mumbai',
        state: 'Maharashtra',
        limit: 10,
      });

      expect(discovery.providers.googlePlaces.status).toBe('NO_RESULTS');
      expect(discovery.providers.osm.status).toBe('NO_RESULTS');
      expect(discovery.totalDiscovered).toBe(0);
      expect(discovery.businesses).toHaveLength(0);
      expect(discovery.overallStatus).toBe('NO_RESULTS');
    } finally {
      global.fetch = originalFetch;
    }
  });

  // 6. Provider results being merged and deduplicated
  it('6. Merges and deduplicates overlapping candidates by Place ID and geographic proximity', async () => {
    const overlappingCandidates: RawDiscoveredBusiness[] = [
      {
        source: 'google_places',
        sources: ['google_places'],
        sourceId: 'ChIJ_duplicate_1',
        googlePlaceId: 'ChIJ_duplicate_1',
        name: 'Apex Plumbing Works',
        businessName: 'Apex Plumbing Works',
        category: 'plumber',
        address: 'Bandra, Mumbai',
        city: 'Mumbai',
        state: 'Maharashtra',
        latitude: 19.0596,
        longitude: 72.8295,
        phone: '+91 98200 44444',
        rawTags: {},
      },
      {
        source: 'openstreetmap',
        sources: ['openstreetmap'],
        sourceId: 'node_555',
        osmId: 555,
        name: 'Apex Plumbing Works',
        businessName: 'Apex Plumbing Works',
        category: 'craft=plumber',
        address: 'Bandra, Mumbai',
        city: 'Mumbai',
        state: 'Maharashtra',
        latitude: 19.05962,
        longitude: 72.82951,
        phone: '+91 98200 44444',
        website: 'https://apexplumbing.in',
        rawTags: {},
      },
      {
        source: 'google_places',
        sources: ['google_places'],
        sourceId: 'ChIJ_distinct_2',
        googlePlaceId: 'ChIJ_distinct_2',
        name: 'Western Pipe Repair',
        businessName: 'Western Pipe Repair',
        category: 'plumber',
        address: 'Andheri, Mumbai',
        city: 'Mumbai',
        state: 'Maharashtra',
        latitude: 19.1136,
        longitude: 72.8697,
        phone: '+91 98200 55555',
        rawTags: {},
      },
    ];

    const mergeResult = await multiSourceMergeActor.execute({
      jobId: 'test_merge',
      input: overlappingCandidates,
    });

    expect(mergeResult.data.deduplicatedCount).toBe(1);
    expect(mergeResult.data.merged).toHaveLength(2);

    const mergedApex = mergeResult.data.merged.find(b => b.businessName.includes('Apex'));
    expect(mergedApex).toBeDefined();
    // Sources merged from both Google Places and OSM
    expect(mergedApex?.sources).toContain('google_places');
    expect(mergedApex?.sources).toContain('openstreetmap');
    // Contact enrichment preserved (phone from Google, website from OSM)
    expect(mergedApex?.phone).toBe('+91 98200 44444');
    expect(mergedApex?.website).toBe('https://apexplumbing.in');
  });

  // 7. Contact filtering qualification
  it('7. Contact filtering correctly rejects businesses missing contact when required, and admits when All Contacts', () => {
    const contactQualityNone = {
      level: 'NONE' as const,
      hasPhone: false,
      hasEmail: false,
      hasVerifiedPhone: false,
      hasVerifiedEmail: false,
      hasContact: false,
      hasVerifiedContact: false,
      phoneCount: 0,
      emailCount: 0,
      verifiedPhoneCount: 0,
      verifiedEmailCount: 0,
      explanation: 'No contacts',
    };

    const contactQualityPhone = {
      level: 'LOW' as const,
      hasPhone: true,
      hasEmail: false,
      hasVerifiedPhone: false,
      hasVerifiedEmail: false,
      hasContact: true,
      hasVerifiedContact: false,
      phoneCount: 1,
      emailCount: 0,
      verifiedPhoneCount: 0,
      verifiedEmailCount: 0,
      explanation: 'Phone available',
    };

    // All Contacts filter admits candidate with no contact
    expect(evaluateContactFilter('ALL_CONTACTS', contactQualityNone).match).toBe(true);

    // Phone or Email filter rejects candidate with no contact
    expect(evaluateContactFilter('PHONE_OR_EMAIL', contactQualityNone).match).toBe(false);

    // Phone or Email filter admits candidate with phone
    expect(evaluateContactFilter('PHONE_OR_EMAIL', contactQualityPhone).match).toBe(true);

    // Email Only filter rejects candidate with only phone
    expect(evaluateContactFilter('EMAIL_ONLY', contactQualityPhone).match).toBe(false);
  });

  // 8. Businesses with working websites
  it('8. Website filter correctly evaluates Working websites', () => {
    const workingClassification = classifyCandidateWebsite(
      'https://reliableplumbing.in',
      'WORKING',
      {
        url: 'https://reliableplumbing.in',
        isReachable: true,
        statusCode: 200,
        responseTimeMs: 250,
        isHttps: true,
        flaws: [],
      }
    );

    expect(workingClassification.matchesFilter).toBe(true);
    expect(workingClassification.status).toBe('Working');
    expect(workingClassification.rejectionReason).toBeUndefined();
  });

  // 9. Businesses with no website
  it('9. Website filter correctly handles No Website filter vs Any Website filter', () => {
    // Under 'Any Website', candidate with no website is ADMITTED (website is merely informative)
    const anyClassification = classifyCandidateWebsite(undefined, 'ANY');
    expect(anyClassification.matchesFilter).toBe(true);
    expect(anyClassification.status).toBe('No Website');

    // Under 'No Website', candidate with no website is ADMITTED
    const noWebClassification = classifyCandidateWebsite(undefined, 'NO_WEBSITE');
    expect(noWebClassification.matchesFilter).toBe(true);
    expect(noWebClassification.status).toBe('No Website');

    // Under 'No Website', candidate with active website is REJECTED
    const hasWebClassification = classifyCandidateWebsite('https://haswebsite.com', 'NO_WEBSITE');
    expect(hasWebClassification.matchesFilter).toBe(false);
    expect(hasWebClassification.rejectionReason).toBe('HAS_WEBSITE');
  });

  // 10. Unreachable websites
  it('10. Website filter correctly identifies Unreachable websites', () => {
    const unreachableClassification = classifyCandidateWebsite(
      'https://deadsite12345.com',
      'UNREACHABLE',
      {
        url: 'https://deadsite12345.com',
        isReachable: false,
        statusCode: 502,
        responseTimeMs: 3000,
        isHttps: true,
        error: 'Bad Gateway (502)',
        flaws: ['Website unreachable or server down'],
      }
    );

    expect(unreachableClassification.matchesFilter).toBe(true);
    expect(unreachableClassification.status).toBe('Unreachable');
    expect(unreachableClassification.canonicalStatus).toBe('UNREACHABLE');
  });

  // 11. Industry mapper for Plumbers
  it('11. OSM Industry mapper maps Plumbers to craft=plumber and shop=plumbing tags', () => {
    const tags = getOsmTagsForIndustry('Plumbers');
    expect(tags).toBeDefined();
    expect(tags.some(t => t.key === 'craft' && t.value === 'plumber')).toBe(true);
    expect(tags.some(t => t.key === 'shop' && t.value === 'plumbing')).toBe(true);

    const singularTags = getOsmTagsForIndustry('plumber');
    expect(singularTags.some(t => t.key === 'craft' && t.value === 'plumber')).toBe(true);
  });
});
