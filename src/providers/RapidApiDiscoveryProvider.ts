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
    const isEnabled = process.env.RAPIDAPI_ENABLED !== 'false';
    return Boolean(key && key.length > 0 && isEnabled);
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
   * Normalizes an individual place item from RapidAPI Maps Data into canonical RawDiscoveredBusiness schema.
   * Completely decoupled from provider-internal key names.
   */
  public mapRapidApiItemToBusiness(item: any, params: SearchDiscoveryParams): RawDiscoveredBusiness {
    const name = String(item.name || item.title || 'Unnamed Business').trim();
    const address = String(
      item.full_address || item.address || item.formatted_address || `${params.city || ''} ${params.state}`
    ).trim();

    const rawPhone = item.phone || item.phone_number || item.telephone;
    const phone = rawPhone ? normalizePhone(String(rawPhone)) : undefined;

    const rawWebsite = item.site || item.website || item.website_url;
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
    const rating = typeof item.rating === 'number' ? item.rating : null;
    const userRatingCount =
      typeof item.reviews === 'number'
        ? item.reviews
        : typeof item.reviews_data === 'number'
        ? item.reviews_data
        : typeof item.review_count === 'number'
        ? item.review_count
        : null;

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
      item.google_maps_url ||
      (placeId ? `https://www.google.com/maps/place/?q=place_id:${placeId}` : undefined);

    const businessStatus = item.business_status || item.status || 'OPERATIONAL';

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
      city: item.city || params.city,
      state: item.state || item.region || params.state,
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
      rawTags: {
        rapidapiPlaceId: placeId,
        types,
        rating,
        userRatingCount,
        reviewsCount: item.reviews,
        country: item.country,
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
            country: item.country,
          },
        },
      ],
    };
  }

  public async discoverBusinesses(params: SearchDiscoveryParams): Promise<DiscoveryResult> {
    const startTime = Date.now();
    const resolvedArea = params.city ? `${params.city}, ${params.state}` : params.state;
    const countryParam = params.country || 'India';
    const cleanQuery = `${params.industry} in ${resolvedArea}, ${countryParam}`;

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
      const maxLimit = parseInt(process.env.MAX_LEADS_PER_RUN || '20', 10);
      const clampedSimList = simList.slice(0, maxLimit);
      return {
        providerId: this.providerId,
        providerName: this.name,
        resolvedAreaName: resolvedArea,
        rawCount: clampedSimList.length,
        businesses: clampedSimList,
        sourceComplete: clampedSimList.length > 0,
        status: clampedSimList.length > 0 ? 'SUCCESS' : 'NO_RESULTS',
        statusReason: `Discovered ${clampedSimList.length} places via RapidAPI Maps Data (Simulated).`,
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
      // Hard enforce server-side MAX_LEADS_PER_RUN (max 20)
      const maxLeadsAllowed = parseInt(process.env.MAX_LEADS_PER_RUN || '20', 10);
      const targetLimit = Math.min(Math.max(params.limit || 10, 1), maxLeadsAllowed);

      const host = process.env.RAPIDAPI_HOST || 'maps-data.p.rapidapi.com';
      const endpointPath = process.env.RAPIDAPI_ENDPOINT_PATH || '/searchmaps.php';
      const url = new URL(`https://${host}${endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`}`);

      url.searchParams.set('query', cleanQuery);
      url.searchParams.set('limit', String(targetLimit));
      url.searchParams.set('country', countryCode);
      url.searchParams.set('lang', 'en');
      url.searchParams.set('offset', '0');

      // 4. Resilient execution under RapidAPI Circuit Breaker
      const discoveryResult = await rapidApiCircuitBreaker.execute(async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), effectiveTimeoutMs);

        try {
          const res = await fetch(url.toString(), {
            method: 'GET',
            headers: {
              'x-rapidapi-host': host,
              'x-rapidapi-key': apiKey,
              'Accept': 'application/json',
              'User-Agent': 'LeadPilot-Engine/2.1 (business-discovery-orchestrator)',
            },
            signal: controller.signal,
          });

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

      // 6. Normalize and perform geographic verification on returned candidates
      const businesses: RawDiscoveredBusiness[] = [];
      const seenIds = new Set<string>();

      for (const item of rawItems) {
        if (!item || (!item.name && !item.title)) continue;

        // Verify returned country/location if returned by provider
        if (item.country) {
          const itemCountryLower = String(item.country).toLowerCase().trim();
          const expectedCode = countryCode;
          // Check if item country contradicts the requested country
          if (
            (expectedCode === 'in' && !itemCountryLower.includes('in') && !itemCountryLower.includes('india')) ||
            (expectedCode === 'us' && !itemCountryLower.includes('us') && !itemCountryLower.includes('united states') && !itemCountryLower.includes('usa')) ||
            (expectedCode === 'ca' && !itemCountryLower.includes('ca') && !itemCountryLower.includes('canada'))
          ) {
            // Discard candidate: geographic mismatch
            continue;
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

      const durationMs = Date.now() - startTime;
      const status = businesses.length > 0 ? 'SUCCESS' : 'NO_RESULTS';
      const statusReason =
        businesses.length > 0
          ? `Discovered ${businesses.length} verified businesses via RapidAPI Maps Data.`
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
}

export const rapidApiDiscoveryProvider = new RapidApiDiscoveryProvider();
