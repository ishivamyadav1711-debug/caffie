import {
  BusinessDiscoveryProvider,
  SearchDiscoveryParams,
  DiscoveryResult,
  RawDiscoveredBusiness,
} from './BusinessDiscoveryProvider';
import { rapidApiCircuitBreaker } from '@/lib/resilience/CircuitBreaker';
import { semaphores, getTimeoutConfig } from '@/lib/config/concurrencyConfig';
import { normalizePhone } from '@/utils/phoneUtils';
import { canonicalizeUrl } from '@/utils/urlUtils';
import { logger } from '@/utils/logger';

/**
 * RapidAPI Maps Data Provider Adapter
 *
 * Tested Request Specification (from RapidAPI Maps Data Playground):
 * - Endpoint URL: https://maps-data.p.rapidapi.com/searchmaps.php
 * - HTTP Method: GET
 * - Headers:
 *     x-rapidapi-host: maps-data.p.rapidapi.com
 *     x-rapidapi-key: [REDACTED_SERVER_SIDE_ENV]
 * - Parameters:
 *     query: string (e.g. "Dentists in Austin, Texas, USA")
 *     limit: number (1-20 for safe testing)
 *     country: string ("us", "in", "ca")
 *     lang: string ("en")
 *     offset: number (0)
 *
 * Response Structure:
 * {
 *   data: [
 *     {
 *       place_id: string,
 *       business_id?: string,
 *       name: string,
 *       title?: string,
 *       full_address?: string,
 *       address?: string,
 *       phone?: string,
 *       phone_number?: string,
 *       site?: string,
 *       website?: string,
 *       rating?: number,
 *       reviews?: number,
 *       reviews_data?: number,
 *       latitude?: number,
 *       longitude?: number,
 *       type?: string,
 *       types?: string[],
 *       subtypes?: string[],
 *       postal_code?: string,
 *       city?: string,
 *       state?: string,
 *       country?: string,
 *       business_status?: string
 *     }
 *   ],
 *   status: "OK"
 * }
 */
/**
 * Maps common industry search terms to enterprise/corporate queries to discover
 * larger commercial entities with public regulatory filings (SEC / MCA) when the
 * High-Net-Worth ₹70 Cr+ filter is active.
 */
export function optimizeQueryForHighNetWorth(industry: string): string {
  const cleanInd = industry.trim();
  const lower = cleanInd.toLowerCase();

  // If already modified or contains large/enterprise terms, keep as-is
  if (
    lower.includes('corporate') ||
    lower.includes('chains') ||
    lower.includes('chain') ||
    lower.includes('multi-specialty') ||
    lower.includes('multispecialty') ||
    lower.includes('enterprise') ||
    lower.includes('large')
  ) {
    return cleanInd;
  }

  // Healthcare / Hospitals
  if (lower === 'hospital' || lower === 'hospitals' || lower.includes('hospital')) {
    return 'Corporate Hospitals';
  }
  if (lower === 'clinic' || lower === 'clinics' || lower.includes('clinic')) {
    return 'Multi-specialty Hospitals';
  }

  // Food & Hospitality / Restaurants
  if (lower === 'restaurant' || lower === 'restaurants' || lower.includes('restaurant') || lower.includes('dining')) {
    return 'Restaurant Chains';
  }
  if (lower === 'hotel' || lower === 'hotels' || lower.includes('hotel') || lower.includes('resort')) {
    return 'Luxury Hotel Chains';
  }

  // Automotive / Dealerships
  if (
    lower === 'automotive' ||
    lower === 'car dealer' ||
    lower === 'car dealers' ||
    lower === 'car dealerships' ||
    lower === 'dealership' ||
    lower === 'dealerships' ||
    lower.includes('automobile')
  ) {
    return 'Authorized Automobile Dealerships';
  }

  // Technology / Software
  if (lower === 'software' || lower === 'it' || lower === 'tech' || lower.includes('software')) {
    return 'Enterprise Software Companies';
  }

  // Retail / Supermarkets
  if (lower === 'retail' || lower === 'supermarket' || lower === 'supermarkets' || lower.includes('store')) {
    return 'Retail Chains Supermarkets';
  }

  // Real Estate / Construction
  if (lower === 'real estate' || lower === 'builder' || lower === 'builders' || lower.includes('realtor')) {
    return 'Commercial Real Estate Developers';
  }

  // Manufacturing / Industry
  if (lower === 'manufacturing' || lower === 'factory' || lower.includes('industrial')) {
    return 'Large Manufacturing Enterprises';
  }

  // Education
  if (lower === 'school' || lower === 'schools' || lower === 'college' || lower === 'colleges') {
    return 'International Schools Colleges';
  }

  // Finance / Banking
  if (lower === 'bank' || lower === 'banks' || lower.includes('finance')) {
    return 'Commercial Banks Financial Institutions';
  }

  // Default fallback for any other industry
  return `Corporate ${cleanInd}`;
}

export class RapidApiDiscoveryProvider implements BusinessDiscoveryProvider {
  readonly providerId = 'rapidapi';
  readonly name = 'RapidAPI Maps Data';

  // Test simulation hooks — allows isolated regression testing with ZERO external credits spent
  private static simulateTimeout: boolean = false;
  private static simulateQuotaExceeded: boolean = false;
  private static simulateAuthFailed: boolean = false;
  private static simulateResults: RawDiscoveredBusiness[] | null = null;

  public static setSimulateTimeout(simulate: boolean): void {
    RapidApiDiscoveryProvider.simulateTimeout = simulate;
  }

  public static setSimulateQuotaExceeded(simulate: boolean): void {
    RapidApiDiscoveryProvider.simulateQuotaExceeded = simulate;
  }

  public static setSimulateAuthFailed(simulate: boolean): void {
    RapidApiDiscoveryProvider.simulateAuthFailed = simulate;
  }

  public static setSimulateResults(results: RawDiscoveredBusiness[] | null): void {
    RapidApiDiscoveryProvider.simulateResults = results;
  }

  public static getSimulateResults(): RawDiscoveredBusiness[] | null {
    return RapidApiDiscoveryProvider.simulateResults;
  }

  public isConfigured(): boolean {
    const rawKey = process.env.RAPIDAPI_KEY;
    const key = rawKey ? rawKey.trim().replace(/^["']|["']$/g, '').trim() : '';
    const isMock = process.env.RAPIDAPI_MOCK_MODE === 'true';
    const isEnabled = process.env.RAPIDAPI_ENABLED !== 'false';
    return Boolean((isMock || (key && key.length > 0)) && isEnabled);
  }

  /**
   * Resolves country name to 2-letter ISO lowercase code according to Maps Data API specs.
   * Returns undefined if country is unsupported.
   */
  public resolveCountryCode(country?: string): string | undefined {
    if (!country) return undefined;
    const lower = country.toLowerCase().trim();
    if (lower === 'india' || lower === 'in') return 'in';
    if (lower === 'usa' || lower === 'united states' || lower === 'us') return 'us';
    if (lower === 'canada' || lower === 'ca') return 'ca';
    return undefined;
  }

  /**
   * Safely resolves Gateway / Base URL, Host header, and Endpoint path.
   * Handles bare hostnames, base URLs, and full endpoint URLs without double-prefixing.
   */
  public resolveGatewayEndpoint(): { url: URL; hostHeader: string } {
    const rawHostOrUrl =
      process.env.RAPIDAPI_BASE_URL ||
      process.env.RAPIDAPI_GATEWAY_URL ||
      process.env.RAPIDAPI_HOST ||
      'maps-data.p.rapidapi.com';
    const rawEndpoint = process.env.RAPIDAPI_ENDPOINT_PATH || '/searchmaps.php';

    let baseStr = rawHostOrUrl.trim().replace(/^["']|["']$/g, '').trim();
    if (!baseStr.startsWith('http://') && !baseStr.startsWith('https://')) {
      baseStr = `https://${baseStr}`;
    }

    const parsedBase = new URL(baseStr);
    const hostHeader = process.env.RAPIDAPI_HOST_HEADER || parsedBase.host;

    let targetPath = rawEndpoint.startsWith('/') ? rawEndpoint : `/${rawEndpoint}`;
    if (parsedBase.pathname && parsedBase.pathname !== '/') {
      targetPath = parsedBase.pathname;
    }

    const resolvedUrl = new URL(targetPath, parsedBase.origin);
    return { url: resolvedUrl, hostHeader };
  }

  /**
   * Normalizes an individual place item from RapidAPI Maps Data into canonical RawDiscoveredBusiness schema.
   * Accurately maps real response fields (phone_number, website/site, review_count, rating, place_id).
   */
  public mapRapidApiItemToBusiness(item: any, params: SearchDiscoveryParams): RawDiscoveredBusiness {
    const name = String(item.name || item.title || item.business_name || 'Unnamed Business').trim();
    const address = String(
      item.full_address || item.address || item.formatted_address || `${params.city || ''} ${params.state}`
    ).trim();

    const rawPhone =
      item.phone_number ||
      item.phone ||
      item.telephone ||
      item.contact_phone ||
      (Array.isArray(item.phone_numbers) && item.phone_numbers.length > 0 ? item.phone_numbers[0] : undefined);
    const phone = rawPhone ? normalizePhone(String(rawPhone), params.country) : undefined;

    const rawWebsite = item.website || item.site || item.website_url || item.url;
    const website = rawWebsite ? canonicalizeUrl(String(rawWebsite)) : undefined;

    const placeId = item.place_id || item.business_id || item.google_id || item.id;
    const sourceId = placeId
      ? String(placeId)
      : `rapidapi_${name.toLowerCase().replace(/[^a-z0-9]/g, '')}_${Math.abs(address.length)}`;

    const types: string[] = Array.isArray(item.subtypes)
      ? item.subtypes.map(String)
      : Array.isArray(item.types)
      ? item.types.map(String)
      : typeof item.type === 'string'
      ? [item.type]
      : [params.industry];

    const category = item.type || (types.length > 0 ? types[0] : params.industry);

    const rawRating = item.rating ?? item.stars ?? item.score;
    const parsedRating = typeof rawRating === 'number' ? rawRating : (rawRating ? parseFloat(String(rawRating)) : null);
    const rating = typeof parsedRating === 'number' && !isNaN(parsedRating) ? parsedRating : null;

    const rawReviews =
      item.review_count ??
      item.reviews ??
      item.reviews_data ??
      item.rating_count ??
      item.user_ratings_total;
    const parsedReviews =
      typeof rawReviews === 'number'
        ? rawReviews
        : rawReviews
        ? parseInt(String(rawReviews).replace(/\D/g, ''), 10)
        : null;
    const userRatingCount = typeof parsedReviews === 'number' && !isNaN(parsedReviews) ? parsedReviews : null;

    const isClosed = item.is_permanently_closed === true || item.business_status === 'CLOSED_PERMANENTLY';
    const isTempClosed = item.is_temporarily_closed === true || item.business_status === 'CLOSED_TEMPORARILY';
    const businessStatus = isClosed
      ? 'CLOSED_PERMANENTLY'
      : isTempClosed
      ? 'CLOSED_TEMPORARILY'
      : (item.business_status || item.status || 'OPERATIONAL');

    const positiveReviewDataAvailable = Boolean(rating !== null && rating >= 4.0 && (userRatingCount || 0) > 0);

    const latitude =
      typeof item.latitude === 'number'
        ? item.latitude
        : item.latitude
        ? parseFloat(String(item.latitude))
        : typeof item.lat === 'number'
        ? item.lat
        : undefined;

    const longitude =
      typeof item.longitude === 'number'
        ? item.longitude
        : item.longitude
        ? parseFloat(String(item.longitude))
        : typeof item.lng === 'number'
        ? item.lng
        : undefined;

    const postalCode = item.postal_code || item.zip_code || item.postcode;

    const sourceUrl =
      item.location_link ||
      item.place_link ||
      item.google_maps_url ||
      (placeId ? `https://www.google.com/maps/place/?q=place_id:${placeId}` : undefined);

    // Extract genuine city/state from provider item fields or address components
    let itemCity = item.city || item.town || item.municipality;
    let itemState = item.state || item.region || item.province;
    let itemCountry = item.country;

    // Parse city from address if omitted by provider
    if (!itemCity && address) {
      const parts = address.split(',').map((s: string) => s.trim());
      if (parts.length >= 2) {
        if (parts.length >= 3) {
          itemCity = parts[parts.length - 2].replace(/\s+\b[A-Z]{2}\b.*$/i, '').trim();
        } else {
          itemCity = parts[0];
        }
      }
    }

    if (!itemCountry && address) {
      const aLower = address.toLowerCase();
      if (aLower.includes(', usa') || aLower.includes(', united states')) itemCountry = 'USA';
      else if (aLower.includes(', canada')) itemCountry = 'Canada';
      else if (aLower.includes(', india')) itemCountry = 'India';
    }

    return {
      source: 'rapidapi',
      sources: ['rapidapi'],
      sourceId,
      sourceUrl,
      confidence: 'HIGH',
      name,
      businessName: name,
      category,
      address,
      city: itemCity || item.city || (params.city && address.toLowerCase().includes(params.city.toLowerCase()) ? params.city : undefined),
      state: itemState || item.state || (params.state && address.toLowerCase().includes(params.state.toLowerCase()) ? params.state : undefined),
      country: itemCountry || (item as any).country,
      postalCode: postalCode ? String(postalCode) : undefined,
      postcode: postalCode ? String(postalCode) : undefined,
      latitude: Number.isFinite(latitude) ? latitude : undefined,
      longitude: Number.isFinite(longitude) ? longitude : undefined,
      phone,
      email: item.email || (Array.isArray(item.emails) && item.emails.length > 0 ? String(item.emails[0]) : undefined),
      website,
      types,
      googlePlaceId: placeId ? String(placeId) : undefined,
      rating,
      userRatingCount,
      businessStatus,
      positiveReviewDataAvailable,
      rawTags: {
        rapidapiPlaceId: placeId,
        types,
        rating,
        userRatingCount,
        reviewCount: userRatingCount,
        reviewsCount: userRatingCount,
        country: itemCountry || item.country,
        isPermanentlyClosed: isClosed,
      },
      sourceEvidence: [
        {
          source: 'rapidapi',
          sourceId,
          sourceUrl,
          rawTags: {
            placeId,
            rating,
            userRatingCount,
            country: itemCountry || item.country,
          },
        },
      ],
    };
  }

  public async discoverBusinesses(params: SearchDiscoveryParams): Promise<DiscoveryResult> {
    const startTime = Date.now();
    const resolvedArea = params.city ? `${params.city}, ${params.state}` : params.state;
    const countryParam = params.country || 'India';
    const isHnwActive = Boolean(params.highNetWorthFilter || params.highNetWorthOnly);
    const effectiveIndustry = isHnwActive ? optimizeQueryForHighNetWorth(params.industry) : params.industry;
    if (isHnwActive && effectiveIndustry !== params.industry) {
      console.log(`[RapidAPI Query Optimization] High-Net-Worth toggle is ON: modified query industry from "${params.industry}" to "${effectiveIndustry}"`);
    }
    const cleanQuery = `${effectiveIndustry} in ${resolvedArea}, ${countryParam}`;

    // 0. Simulation handling for automated unit testing (Zero external cost)
    if (RapidApiDiscoveryProvider.simulateTimeout) {
      return {
        providerId: this.providerId,
        providerName: this.name,
        resolvedAreaName: resolvedArea,
        rawCount: 0,
        businesses: [],
        sourceComplete: false,
        status: 'FAILED',
        statusReason: 'RapidAPI Maps Data query timed out (Simulated).',
        pagesRequested: 1,
        errors: ['RAPIDAPI_TIMEOUT'],
        durationMs: 3000,
      };
    }

    if (RapidApiDiscoveryProvider.simulateQuotaExceeded) {
      return {
        providerId: this.providerId,
        providerName: this.name,
        resolvedAreaName: resolvedArea,
        rawCount: 0,
        businesses: [],
        sourceComplete: false,
        status: 'RATE_LIMITED',
        statusReason: 'RapidAPI Maps Data quota exceeded or rate limit reached (HTTP 429 Simulated).',
        pagesRequested: 1,
        errors: ['RAPIDAPI_QUOTA_EXCEEDED'],
        durationMs: 150,
      };
    }

    if (RapidApiDiscoveryProvider.simulateAuthFailed) {
      return {
        providerId: this.providerId,
        providerName: this.name,
        resolvedAreaName: resolvedArea,
        rawCount: 0,
        businesses: [],
        sourceComplete: false,
        status: 'AUTH_FAILED',
        statusReason: 'RapidAPI authentication failed (HTTP 401/403 Invalid API Key).',
        pagesRequested: 1,
        errors: ['RAPIDAPI_AUTH_FAILED'],
        durationMs: 100,
      };
    }

    if (RapidApiDiscoveryProvider.simulateResults !== null) {
      const simList = RapidApiDiscoveryProvider.simulateResults;
      const maxLimit = isHnwActive ? 25 : parseInt(process.env.MAX_LEADS_PER_RUN || '20', 10);
      const batchLimit = params.limit ? Math.min(params.limit, maxLimit) : maxLimit;
      const offset = Math.max(Number(params.offset) || 0, 0);
      const clampedSimList = simList.slice(offset, offset + batchLimit);
      const isExhausted = clampedSimList.length === 0 && offset > 0;
      return {
        providerId: this.providerId,
        providerName: this.name,
        resolvedAreaName: resolvedArea,
        rawCount: clampedSimList.length,
        businesses: clampedSimList,
        sourceComplete: clampedSimList.length > 0,
        status: clampedSimList.length > 0 ? 'SUCCESS' : 'NO_RESULTS',
        statusReason: isExhausted
          ? 'No more businesses found in this area. Try a different location or category.'
          : `Discovered ${clampedSimList.length} places via RapidAPI Maps Data (Simulated).`,
        pagesRequested: 1,
        errors: [],
        durationMs: 120,
      };
    }

    // 1. Configuration check
    const rawApiKey = process.env.RAPIDAPI_KEY;
    const apiKey = rawApiKey ? rawApiKey.trim().replace(/^["']|["']$/g, '').trim() : '';
    const isEnabled = process.env.RAPIDAPI_ENABLED !== 'false';

    if (!isEnabled) {
      return {
        providerId: this.providerId,
        providerName: this.name,
        resolvedAreaName: resolvedArea,
        rawCount: 0,
        businesses: [],
        sourceComplete: false,
        status: 'DISABLED',
        statusReason: 'RapidAPI discovery is explicitly disabled via RAPIDAPI_ENABLED=false.',
        pagesRequested: 0,
        errors: ['RAPIDAPI_DISABLED'],
        durationMs: 0,
      };
    }

    const isMockMode = process.env.RAPIDAPI_MOCK_MODE === 'true' || apiKey === 'mock' || apiKey === 'demo';

    if (isMockMode) {
      const maxLeadsAllowed = isHnwActive ? 25 : parseInt(process.env.MAX_LEADS_PER_RUN || '20', 10);
      const demoCount = Math.min(Math.max(params.limit || (isHnwActive ? 25 : 10), 1), maxLeadsAllowed);
      const offset = Math.max(Number(params.offset) || 0, 0);
      const isIndia = countryParam.toLowerCase().includes('in') || countryParam.toLowerCase().includes('india');
      const demoBusinesses: RawDiscoveredBusiness[] = Array.from({ length: demoCount }, (_, idx) => {
        const id = offset + idx + 1;
        const name = `[DEMO MOCK] ${params.industry} Demo Company ${id}`;
        // Standard fictional phone ranges (RFC/NANP 555-01xx for US/CA, 99999 for IN)
        const demoPhone = isIndia ? `+91 99999 000${id.toString().padStart(2, '0')}` : `+1 (555) 01${id.toString().padStart(2, '0')}`;
        // .invalid TLD reserved for fictional/demo testing under RFC 2606
        const demoWebsite = `https://demo-${id}.invalid`;
        return {
          source: 'rapidapi',
          sources: ['rapidapi (mock demo)'],
          sourceId: `rapidapi_demo_${params.industry.toLowerCase().replace(/[^a-z0-9]/g, '')}_${id}`,
          rapidApiId: `rapidapi_demo_${id}`,
          isMock: true,
          confidence: 'DEMO_MOCK',
          name,
          businessName: name,
          category: params.industry,
          types: [
            params.industry.toLowerCase(),
            params.industry.toLowerCase().replace(/s$/, ''),
          ],
          address: `${id * 100} Fictional Way, Suite ${id}, ${resolvedArea}, ${countryParam}`,
          city: params.city,
          state: params.state,
          phone: demoPhone,
          email: `demo${id}@fictional-domain.invalid`,
          website: demoWebsite,
          rating: null,
          userRatingCount: null,
          businessStatus: 'DEMO_RECORD',
          rawTags: {
            isMock: true,
            isMockDemo: true,
            demoNotice: 'Synthetic record generated for localhost testing (RAPIDAPI_MOCK_MODE=true). Zero live API credits consumed.',
          },
          sourceEvidence: [{ source: 'rapidapi', sourceId: `rapidapi_demo_${id}` }],
        };
      });

      return {
        providerId: this.providerId,
        providerName: this.name,
        resolvedAreaName: resolvedArea,
        rawCount: demoBusinesses.length,
        businesses: demoBusinesses,
        sourceComplete: true,
        status: 'SUCCESS',
        statusReason: `Discovered ${demoBusinesses.length} leads via RapidAPI Maps Data (Mock Demo Mode active - zero API credits used).`,
        pagesRequested: 1,
        queryUsed: cleanQuery,
        endpointUsed: 'MOCK_DEMO_LOCAL',
        errors: [],
        durationMs: 60,
      };
    }

    if (!apiKey || apiKey.length === 0) {
      return {
        providerId: this.providerId,
        providerName: this.name,
        resolvedAreaName: resolvedArea,
        rawCount: 0,
        businesses: [],
        sourceComplete: false,
        status: 'NOT_CONFIGURED',
        statusReason: 'RAPIDAPI_NOT_CONFIGURED: Missing RAPIDAPI_KEY.',
        pagesRequested: 0,
        errors: ['RAPIDAPI_NOT_CONFIGURED'],
        durationMs: 0,
      };
    }

    // 2. Validate Country parameter against ALLOWED_DISCOVERY_COUNTRIES
    const allowedCountries = (process.env.ALLOWED_DISCOVERY_COUNTRIES || 'IN,US,CA')
      .split(',')
      .map((c) => c.trim().toLowerCase());

    const countryCode = this.resolveCountryCode(countryParam);
    if (!countryCode || !allowedCountries.includes(countryCode)) {
      return {
        providerId: this.providerId,
        providerName: this.name,
        resolvedAreaName: resolvedArea,
        rawCount: 0,
        businesses: [],
        sourceComplete: false,
        status: 'FAILED',
        statusReason: `Country "${countryParam}" is not supported. Supported discovery countries are IN, US, and CA.`,
        pagesRequested: 0,
        errors: ['UNSUPPORTED_COUNTRY'],
        durationMs: 0,
      };
    }

    // 3. Concurrency limiting & Timeout resolution
    const releaseSemaphore = await semaphores.rapidapi.acquire();
    const timeouts = getTimeoutConfig();
    const effectiveTimeoutMs = timeouts.rapidapiFastMs || 15000;

    try {
      // Hard enforce server-side MAX_LEADS_PER_RUN (or 25 for High-Net-Worth batch)
      const maxLeadsAllowed = isHnwActive ? 25 : parseInt(process.env.MAX_LEADS_PER_RUN || '20', 10);
      const targetLimit = Math.min(Math.max(params.limit || (isHnwActive ? 25 : 10), 1), maxLeadsAllowed);
      const requestedOffset = Math.max(Number(params.offset) || 0, 0);
      const requestedPage = params.page || Math.floor(requestedOffset / targetLimit) + 1;
      const apiLimit = requestedOffset > 0 ? Math.min(targetLimit + requestedOffset, 100) : targetLimit;

      const { url, hostHeader } = this.resolveGatewayEndpoint();

      url.searchParams.set('query', cleanQuery);
      url.searchParams.set('limit', String(apiLimit));
      url.searchParams.set('country', countryCode);
      url.searchParams.set('lang', 'en');
      url.searchParams.set('offset', String(requestedOffset));
      url.searchParams.set('page', String(requestedPage));

      // 4. Resilient execution under RapidAPI Circuit Breaker
      const discoveryResult = await rapidApiCircuitBreaker.execute(async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), effectiveTimeoutMs);

        try {
          let res = await fetch(url.toString(), {
            method: 'GET',
            headers: {
              'x-rapidapi-host': hostHeader,
              'x-rapidapi-key': apiKey,
              'Accept': 'application/json',
              'User-Agent': 'LeadPilot-Engine/2.1 (business-discovery-orchestrator)',
            },
            signal: controller.signal,
          });

          // Handle 429 Too Many Requests with retry
          if (res.status === 429) {
            console.warn(`[RapidApiDiscoveryProvider] HTTP 429 Rate Limit exceeded. Backing off 2000ms before retry...`);
            await new Promise((resolve) => setTimeout(resolve, 2000));
            res = await fetch(url.toString(), {
              method: 'GET',
              headers: {
                'x-rapidapi-host': hostHeader,
                'x-rapidapi-key': apiKey,
                'Accept': 'application/json',
                'User-Agent': 'LeadPilot-Engine/2.1 (business-discovery-orchestrator)',
              },
              signal: controller.signal,
            });
            console.log(`[RapidApiDiscoveryProvider] Retry response status: ${res.status}`);
          }

          clearTimeout(timeoutId);

          if (!res.ok) {
            const status = res.status;
            let errorMsg = `HTTP ${status}`;
            try {
              const errBody = await res.json();
              if (errBody?.message || errBody?.error) {
                errorMsg = `${errorMsg}: ${errBody.message || errBody.error}`;
              }
            } catch {
              const raw = await res.text();
              errorMsg = `${errorMsg}: ${raw.slice(0, 150)}`;
            }

            // Scrub API key completely from any logs or error outputs
            errorMsg = errorMsg.replace(new RegExp(apiKey, 'g'), '[REDACTED]');

            const error = new Error(errorMsg);
            (error as any).status = status;
            throw error;
          }

          const rawData = await res.json();
          return rawData;
        } finally {
          clearTimeout(timeoutId);
        }
      });

      // 5. Extract place items safely from RapidAPI response schema
      let rawItems: any[] = [];
      if (Array.isArray(discoveryResult?.data)) {
        rawItems = discoveryResult.data;
      } else if (Array.isArray(discoveryResult?.results)) {
        rawItems = discoveryResult.results;
      } else if (Array.isArray(discoveryResult)) {
        rawItems = discoveryResult;
      }

      // If the provider returned results from index 0 instead of honoring the offset directly,
      // slice based on requestedOffset to ensure paginated non-duplicate results
      if (requestedOffset > 0 && rawItems.length > targetLimit) {
        rawItems = rawItems.slice(requestedOffset, requestedOffset + targetLimit);
      }

      logger.info({
        actorId: 'rapidapi_discovery',
        message: 'RapidAPI Query Dispatched',
        extra: {
          actualProviderQuery: cleanQuery,
          countryParam: countryCode,
          limitParam: targetLimit,
        },
      });

      // 6. Normalize and perform geographic verification on returned candidates
      const businesses: RawDiscoveredBusiness[] = [];
      const seenIds = new Set<string>();

      for (const item of rawItems) {
        if (!item || (!item.name && !item.title)) continue;

        const itemAddr = String(item.full_address || item.address || item.formatted_address || '').toLowerCase();
        const itemCountryLower = String(item.country || '').toLowerCase().trim();

        // Verify returned country/location if returned by provider
        if (countryCode === 'in') {
          if (
            (itemCountryLower && !itemCountryLower.includes('in') && !itemCountryLower.includes('india')) ||
            itemAddr.includes(', usa') ||
            itemAddr.includes(', united states') ||
            itemAddr.includes(', canada') ||
            /\b(atlanta|los angeles|chicago|houston|phoenix|dallas|seattle|miami|new york)\b/i.test(itemAddr) ||
            /\b[A-Z]{2}\s+\d{5}(-\d{4})?\b/.test(item.full_address || item.address || '')
          ) {
            continue; // Geographic mismatch
          }
        } else if (countryCode === 'us') {
          if (
            (itemCountryLower && !itemCountryLower.includes('us') && !itemCountryLower.includes('united states') && !itemCountryLower.includes('usa')) ||
            itemAddr.includes(', canada') ||
            itemAddr.includes(', india') ||
            /\b(mumbai|delhi|bengaluru|bangalore|hyderabad|chennai|kolkata|pune|ahmedabad)\b/i.test(itemAddr) ||
            /\b\d{6}\b/.test(item.full_address || item.address || '')
          ) {
            continue; // Geographic mismatch
          }
        } else if (countryCode === 'ca') {
          if (
            (itemCountryLower && !itemCountryLower.includes('ca') && !itemCountryLower.includes('canada')) ||
            itemAddr.includes(', usa') ||
            itemAddr.includes(', united states') ||
            itemAddr.includes(', india')
          ) {
            continue; // Geographic mismatch
          }
        }

        const normalized = this.mapRapidApiItemToBusiness(item, params);
        if (seenIds.has(normalized.sourceId)) continue;
        seenIds.add(normalized.sourceId);

        businesses.push(normalized);

        // Strict clamp to targetLimit
        if (businesses.length >= targetLimit) {
          break;
        }
      }

      logger.info({
        actorId: 'rapidapi_discovery',
        message: 'RapidAPI Candidates Received & Filtered',
        extra: {
          apiRequestsCount: 1,
          rawCandidatesReturned: rawItems.length,
          geographicallyValidCandidates: businesses.length,
          targetLimit,
        },
      });

      const durationMs = Date.now() - startTime;
      const status = businesses.length > 0 ? 'SUCCESS' : 'NO_RESULTS';
      const statusReason =
        businesses.length > 0
          ? `Discovered ${businesses.length} verified businesses via RapidAPI Maps Data.`
          : requestedOffset > 0
          ? 'No more businesses found in this area. Try a different location or category.'
          : `RapidAPI queried successfully but returned zero results for ${params.industry} in ${resolvedArea}.`;

      return {
        providerId: this.providerId,
        providerName: this.name,
        resolvedAreaName: resolvedArea,
        rawCount: businesses.length,
        businesses,
        sourceComplete: businesses.length > 0,
        status,
        statusReason,
        pagesRequested: 1,
        queryUsed: cleanQuery,
        endpointUsed: url.origin + url.pathname,
        errors: [],
        durationMs,
      };
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      const errMsg = String(err.message || '');
      const isTimeout = err.name === 'AbortError' || errMsg.includes('timeout') || errMsg.includes('timed out');
      const isAuth =
        err.status === 401 ||
        err.status === 403 ||
        errMsg.includes('401') ||
        errMsg.includes('403') ||
        errMsg.includes('API key') ||
        errMsg.includes('Unauthorized');
      const isRate =
        err.status === 429 ||
        err.status === 402 ||
        errMsg.includes('429') ||
        errMsg.includes('402') ||
        errMsg.includes('quota') ||
        errMsg.includes('rate limit');

      const status: 'AUTH_FAILED' | 'RATE_LIMITED' | 'REQUEST_FAILED' | 'FAILED' = isAuth
        ? 'AUTH_FAILED'
        : isRate
        ? 'RATE_LIMITED'
        : 'REQUEST_FAILED';

      let reason = `RapidAPI discovery query failed (${status}): ${errMsg}`;
      if (isAuth) {
        reason = `RapidAPI authentication failed. Verify RAPIDAPI_KEY in server environment variables.`;
      } else if (isRate) {
        reason = `RapidAPI rate limit reached or quota exceeded (HTTP 429/402).`;
      } else if (isTimeout) {
        reason = `RapidAPI query timed out after ${effectiveTimeoutMs}ms.`;
      }

      return {
        providerId: this.providerId,
        providerName: this.name,
        resolvedAreaName: resolvedArea,
        rawCount: 0,
        businesses: [],
        sourceComplete: false,
        status,
        statusReason: reason,
        pagesRequested: 1,
        errors: [errMsg],
        durationMs,
      };
    } finally {
      releaseSemaphore();
    }
  }

  /**
   * Controlled Live Connectivity Diagnostic
   * Makes exactly ONE controlled real HTTP request to verify credentials & endpoint connectivity.
   * Only executed when explicitly invoked by diagnostic tooling. Never invoked in automated tests.
   */
  public async executeLiveConnectivityCheck(options?: {
    industry?: string;
    city?: string;
    state?: string;
    country?: string;
    limit?: number;
  }): Promise<{
    success: boolean;
    httpStatus?: number;
    providerStatus?: string;
    rawRecordsCount: number;
    latencyMs: number;
    endpoint: string;
    sampleVenues: Array<{
      name: string;
      address?: string;
      phone?: string;
      website?: string;
      rating?: number | null;
      userRatingCount?: number | null;
      placeId?: string;
    }>;
    error?: string;
  }> {
    const rawApiKey = process.env.RAPIDAPI_KEY;
    const apiKey = rawApiKey ? rawApiKey.trim().replace(/^["']|["']$/g, '').trim() : '';
    if (!apiKey || apiKey.length === 0 || apiKey === 'mock' || apiKey === 'demo') {
      return {
        success: false,
        rawRecordsCount: 0,
        latencyMs: 0,
        endpoint: '',
        sampleVenues: [],
        error: 'RAPIDAPI_KEY is not configured in server environment. Please set RAPIDAPI_KEY in .env.local.',
      };
    }

    const { url, hostHeader } = this.resolveGatewayEndpoint();
    const targetLimit = Math.min(Math.max(options?.limit || 2, 1), 5);
    const country = options?.country || 'USA';
    const countryCode = this.resolveCountryCode(country) || 'us';
    const industry = options?.industry || 'Dentists';
    const city = options?.city || 'Austin';
    const state = options?.state || 'Texas';
    const cleanQuery = `${industry} in ${city}, ${state}, ${country}`;

    url.searchParams.set('query', cleanQuery);
    url.searchParams.set('limit', String(targetLimit));
    url.searchParams.set('country', countryCode);
    url.searchParams.set('lang', 'en');
    url.searchParams.set('offset', '0');

    const startTime = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);

    try {
      const res = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'x-rapidapi-host': hostHeader,
          'x-rapidapi-key': apiKey,
          'Accept': 'application/json',
          'User-Agent': 'LeadPilot-Engine/2.1 (diagnostic-connectivity-check)',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const latencyMs = Date.now() - startTime;

      if (!res.ok) {
        let errorDetails = `HTTP ${res.status}`;
        try {
          const body = await res.json();
          if (body?.message || body?.error) {
            errorDetails = `${errorDetails}: ${body.message || body.error}`;
          }
        } catch {
          const raw = await res.text();
          errorDetails = `${errorDetails}: ${raw.slice(0, 150)}`;
        }
        // Scrub any accidental API key echoes
        errorDetails = errorDetails.replace(new RegExp(apiKey, 'g'), '[REDACTED]');

        return {
          success: false,
          httpStatus: res.status,
          rawRecordsCount: 0,
          latencyMs,
          endpoint: `${url.origin}${url.pathname}`,
          sampleVenues: [],
          error: errorDetails,
        };
      }

      const data = await res.json();
      let rawItems: any[] = [];
      if (Array.isArray(data?.data)) rawItems = data.data;
      else if (Array.isArray(data?.results)) rawItems = data.results;
      else if (Array.isArray(data)) rawItems = data;

      const sampleVenues = rawItems.slice(0, targetLimit).map((item) => {
        const rawReviews = item.review_count ?? item.reviews ?? item.reviews_data ?? item.rating_count;
        const parsedReviews = typeof rawReviews === 'number' ? rawReviews : (rawReviews ? parseInt(String(rawReviews).replace(/\D/g, ''), 10) : null);
        const userRatingCount = typeof parsedReviews === 'number' && !isNaN(parsedReviews) ? parsedReviews : null;
        const rawPhone = item.phone_number || item.phone || undefined;
        return {
          name: String(item.name || item.title || 'Unknown'),
          address: item.full_address || item.address || undefined,
          phone: rawPhone ? normalizePhone(String(rawPhone), country) : undefined,
          website: item.website || item.site || undefined,
          rating: typeof item.rating === 'number' ? item.rating : null,
          userRatingCount,
          placeId: item.place_id || item.business_id || undefined,
        };
      });

      return {
        success: true,
        httpStatus: res.status,
        providerStatus: data?.status || 'OK',
        rawRecordsCount: rawItems.length,
        latencyMs,
        endpoint: `${url.origin}${url.pathname}`,
        sampleVenues,
      };
    } catch (err: any) {
      clearTimeout(timeoutId);
      const latencyMs = Date.now() - startTime;
      let errMsg = String(err.message || 'Unknown network error');
      if (apiKey) errMsg = errMsg.replace(new RegExp(apiKey, 'g'), '[REDACTED]');
      return {
        success: false,
        rawRecordsCount: 0,
        latencyMs,
        endpoint: `${url.origin}${url.pathname}`,
        sampleVenues: [],
        error: errMsg,
      };
    }
  }
}

export const rapidApiDiscoveryProvider = new RapidApiDiscoveryProvider();
