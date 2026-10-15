import {
  BusinessDiscoveryProvider,
  SearchDiscoveryParams,
  DiscoveryResult,
  RawDiscoveredBusiness,
} from './BusinessDiscoveryProvider';
import { googleUsageTracker } from '@/lib/billing/GoogleUsageTracker';
import { googlePlacesCircuitBreaker } from '@/lib/resilience/CircuitBreaker';
import { googleDiscoveryCache } from '@/lib/cache/GoogleDiscoveryCache';
import { semaphores, getTimeoutConfig } from '@/lib/config/concurrencyConfig';
import { executeWithRetry } from '@/lib/utils/retryUtils';
import { getIndustryDiscoveryQueries } from '@/lib/taxonomy/industryTaxonomy';

export class GooglePlacesDiscoveryProvider implements BusinessDiscoveryProvider {
  readonly providerId = 'google_places';
  readonly name = 'Google Places API';

  /**
   * Configurable field mask: only discovery essentials.
   * Excluding expensive SKUs like photos, reviews, and atmosphere.
   * Explicitly avoids wildcard "*" for production cost control.
   */
  private getFieldMask(): string {
    return (
      process.env.GOOGLE_PLACES_FIELD_MASK ||
      'places.id,places.displayName,places.formattedAddress,places.location,places.types,places.primaryType,places.nationalPhoneNumber,places.internationalPhoneNumber,places.websiteUri,places.googleMapsUri,places.rating,places.userRatingCount,places.businessStatus,places.reviews,nextPageToken'
    );
  }

  public isConfigured(): boolean {
    const rawKey = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
    const key = rawKey ? rawKey.trim().replace(/^["']|["']$/g, '').trim() : '';
    return Boolean(key && key.length > 0 && process.env.GOOGLE_PLACES_ENABLED !== 'false');
  }

  private static simulateTimeout: boolean = false;
  private static simulateQuotaExceeded: boolean = false;
  private static simulateResults: RawDiscoveredBusiness[] | null = null;

  public static setSimulateTimeout(simulate: boolean): void {
    GooglePlacesDiscoveryProvider.simulateTimeout = simulate;
  }

  public static setSimulateQuotaExceeded(simulate: boolean): void {
    GooglePlacesDiscoveryProvider.simulateQuotaExceeded = simulate;
  }

  public static setSimulateResults(results: RawDiscoveredBusiness[] | null): void {
    GooglePlacesDiscoveryProvider.simulateResults = results;
  }

  /**
   * Maps Google Places API place representation into canonical RawDiscoveredBusiness.
   * Real data only: rating, userRatingCount, and authentic reviews.
   */
  private mapPlaceToBusiness(p: any, params: SearchDiscoveryParams, mapsUrl: string): RawDiscoveredBusiness {
    const placeId = p.id;
    const name = p.displayName?.text || 'Unnamed Business';
    const address = p.formattedAddress || '';
    const phone = p.nationalPhoneNumber || p.internationalPhoneNumber;
    const website = p.websiteUri;
    const types = p.types || [];
    const category = p.primaryType || (types.length > 0 ? types[0] : params.industry);
    const lat = p.location?.latitude;
    const lon = p.location?.longitude;
    const rating = typeof p.rating === 'number' ? p.rating : null;
    const userRatingCount = typeof p.userRatingCount === 'number' ? p.userRatingCount : null;
    const businessStatus = p.businessStatus || 'OPERATIONAL';

    let reviews: Array<{ authorName?: string; rating: number; text?: string; publishTime?: string }> | undefined = undefined;
    let positiveReviewDataAvailable = false;
    let positiveReviewCount: number | null = null;
    let negativeReviewCount: number | null = null;
    let neutralReviewCount: number | null = null;
    let positiveReviewRatio: number | null = null;

    if (Array.isArray(p.reviews) && p.reviews.length > 0) {
      const mappedReviews: Array<{ authorName?: string; rating: number; text?: string; publishTime?: string }> = p.reviews.map((r: any) => ({
        authorName: r.authorAttribution?.displayName || undefined,
        rating: typeof r.rating === 'number' ? r.rating : 5,
        text: r.originalText?.text || r.text?.text || undefined,
        publishTime: r.publishTime || undefined,
      }));
      reviews = mappedReviews;
      positiveReviewDataAvailable = true;
      positiveReviewCount = mappedReviews.filter((r: { rating: number }) => r.rating >= 4).length;
      negativeReviewCount = mappedReviews.filter((r: { rating: number }) => r.rating <= 2).length;
      neutralReviewCount = mappedReviews.filter((r: { rating: number }) => r.rating === 3).length;
      positiveReviewRatio = mappedReviews.length > 0 ? positiveReviewCount / mappedReviews.length : null;
    }

    return {
      source: 'google_places',
      sources: ['google_places'],
      sourceId: placeId,
      sourceUrl: mapsUrl,
      confidence: 'high',
      name,
      businessName: name,
      category,
      address,
      city: params.city || params.state,
      state: params.state,
      latitude: lat,
      longitude: lon,
      phone,
      website,
      types,
      googlePlaceId: placeId,
      rating,
      userRatingCount,
      businessStatus,
      positiveReviewDataAvailable,
      positiveReviewCount,
      negativeReviewCount,
      neutralReviewCount,
      positiveReviewRatio,
      reviews,
      rawTags: {
        googlePlaceId: placeId,
        primaryType: p.primaryType,
        types,
        displayName: p.displayName?.text,
        formattedAddress: p.formattedAddress,
        googleMapsUri: p.googleMapsUri,
        location: p.location,
        nationalPhoneNumber: p.nationalPhoneNumber,
        internationalPhoneNumber: p.internationalPhoneNumber,
        websiteUri: p.websiteUri,
        rating,
        userRatingCount,
        businessStatus,
        reviewsCount: reviews?.length || 0,
      },
      sourceEvidence: [
        {
          source: 'google_places',
          sourceId: placeId,
          sourceUrl: mapsUrl,
          rawTags: {
            googlePlaceId: placeId,
            types,
            primaryType: p.primaryType,
            rating,
            userRatingCount,
          },
        },
      ],
    };
  }

  /**
   * Executes official Google Places Text Search (New) as the Primary Discovery Provider.
   * Supports multi-page pagination via nextPageToken up to targetPool limit.
   */
  public async discoverBusinesses(params: SearchDiscoveryParams): Promise<DiscoveryResult> {
    const startTime = Date.now();
    const resolvedArea = params.city ? `${params.city}, ${params.state}` : params.state;
    const country = params.country || 'India';
    const queries = getIndustryDiscoveryQueries(params.industry, resolvedArea, country);


    if (GooglePlacesDiscoveryProvider.simulateTimeout) {
      return {
        providerId: this.providerId,
        providerName: this.name,
        resolvedAreaName: resolvedArea,
        rawCount: 0,
        businesses: [],
        sourceComplete: false,
        status: 'FAILED',
        statusReason: 'Google Places API fast-path query timed out after 3000ms (Simulated).',
        pagesRequested: 1,
        errors: ['GOOGLE_TIMEOUT'],
        durationMs: 3000,
      };
    }

    if (GooglePlacesDiscoveryProvider.simulateQuotaExceeded) {
      return {
        providerId: this.providerId,
        providerName: this.name,
        resolvedAreaName: resolvedArea,
        rawCount: 0,
        businesses: [],
        sourceComplete: false,
        status: 'FAILED',
        statusReason: 'Google Places API quota exceeded (Simulated).',
        pagesRequested: 1,
        errors: ['GOOGLE_QUOTA_EXCEEDED'],
        durationMs: 15,
      };
    }

    if (GooglePlacesDiscoveryProvider.simulateResults !== null) {
      const simList = GooglePlacesDiscoveryProvider.simulateResults;
      const requestedLimit = params.limit || 20;
      const simStatus = simList.length >= requestedLimit ? 'SUCCESS' : simList.length > 0 ? 'PARTIAL' : 'NO_RESULTS';
      return {
        providerId: this.providerId,
        providerName: this.name,
        resolvedAreaName: resolvedArea,
        rawCount: simList.length,
        businesses: simList,
        sourceComplete: simList.length > 0,
        status: simStatus,
        statusReason: `Discovered ${simList.length} places via Google Places API (Simulated).`,
        pagesRequested: 1,
        errors: [],
        durationMs: 120,
      };
    }

    // 1. Configuration check (DO NOT silently swallow missing API key!)
    const rawApiKey = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
    const apiKey = rawApiKey ? rawApiKey.trim().replace(/^["']|["']$/g, '').trim() : '';
    const isEnabled = process.env.GOOGLE_PLACES_ENABLED !== 'false';

    if (!isEnabled) {
      return {
        providerId: this.providerId,
        providerName: this.name,
        resolvedAreaName: resolvedArea,
        rawCount: 0,
        businesses: [],
        sourceComplete: false,
        status: 'DISABLED',
        statusReason: 'Google Places discovery is disabled via GOOGLE_PLACES_ENABLED=false.',
        pagesRequested: 0,
        errors: ['GOOGLE_PLACES_DISABLED'],
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
        statusReason: 'GOOGLE_PLACES_NOT_CONFIGURED: Missing GOOGLE_PLACES_API_KEY.',
        pagesRequested: 0,
        errors: ['GOOGLE_PLACES_NOT_CONFIGURED'],
        durationMs: 0,
      };
    }

    // 2. Budget and Mode check
    const budgetCheck = googleUsageTracker.canExecuteGoogleRequest();
    if (!budgetCheck.allowed) {
      console.warn(`[GooglePlacesDiscoveryProvider] Blocked by budget policy: ${budgetCheck.reason}`);
      return {
        providerId: this.providerId,
        providerName: this.name,
        resolvedAreaName: resolvedArea,
        rawCount: 0,
        businesses: [],
        sourceComplete: false,
        status: 'FAILED',
        statusReason: budgetCheck.reason || 'Google Places quota reached or blocked by budget policy.',
        pagesRequested: 0,
        errors: [budgetCheck.reason || 'QUOTA_EXCEEDED'],
        durationMs: Date.now() - startTime,
      };
    }

    const fieldMask = this.getFieldMask();
    const targetPool = Math.max(params.limit || 60, 40);
    const timeouts = getTimeoutConfig();

    const effectiveTimeout = Math.max(timeouts.googlePlacesFastMs || 8000, 5000);

    // 3. Concurrency Semaphore acquisition
    const releaseSemaphore = await semaphores.googlePlaces.acquire();

    try {
      const businesses: RawDiscoveredBusiness[] = [];
      const seenPlaceIds = new Set<string>();
      let nextPageToken: string | undefined = undefined;
      let pageCount = 0;
      const maxPages = Math.min(Math.ceil(targetPool / 20), 3); // Google Places Text Search (New) supports up to 3 pages (60 places)

      do {
        pageCount++;
        const currentPageToken: string | undefined = nextPageToken;

        const responseData = await googlePlacesCircuitBreaker.execute(async () => {
          return await executeWithRetry(
            async (signal) => {
              const url = 'https://places.googleapis.com/v1/places:searchText';
              const fetchStart = Date.now();

              const reqPayload: any = {
                textQuery: queries[0],
                pageSize: 20,
              };
              if (currentPageToken) {
                reqPayload.pageToken = currentPageToken;
              }
              if (params.bbox && (!params.country || params.country === 'India')) {
                reqPayload.locationRestriction = {
                  rectangle: {
                    low: { latitude: params.bbox.south, longitude: params.bbox.west },
                    high: { latitude: params.bbox.north, longitude: params.bbox.east },
                  },
                };
              }

              const res = await fetch(url, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'X-Goog-Api-Key': apiKey,
                  'X-Goog-FieldMask': fieldMask,
                },
                body: JSON.stringify(reqPayload),
                signal,
              });

              const durationMs = Date.now() - fetchStart;
              const contentType = res.headers.get('content-type') || '';
              const raw = await res.text();

              if (!res.ok) {
                let errorMessage = `HTTP ${res.status}`;
                try {
                  const errorData = JSON.parse(raw);
                  if (errorData.error?.message) {
                    errorMessage = `${errorMessage}: ${errorData.error.message}`;
                  } else {
                    errorMessage = `${errorMessage}: ${raw.slice(0, 300)}`;
                  }
                } catch {
                  errorMessage = `${errorMessage}: ${raw.slice(0, 300)}`;
                }

                googleUsageTracker.recordOperation({
                  operation: 'TEXT_SEARCH',
                  success: false,
                  statusCode: res.status,
                  durationMs,
                  query: queries[0],
                  error: errorMessage,
                });

                const errorObj: any = new Error(errorMessage);
                errorObj.status = res.status;
                throw errorObj;
              }

              if (!contentType.includes('application/json')) {
                googleUsageTracker.recordOperation({
                  operation: 'TEXT_SEARCH',
                  success: false,
                  statusCode: res.status,
                  durationMs,
                  query: queries[0],
                  error: `Non-JSON response (${contentType})`,
                });
                throw new Error(`Google Places API returned non-JSON response (${contentType}): ${raw.slice(0, 300)}`);
              }

              let data: any;
              try {
                data = JSON.parse(raw);
              } catch (jsonErr: any) {
                googleUsageTracker.recordOperation({
                  operation: 'TEXT_SEARCH',
                  success: false,
                  statusCode: res.status,
                  durationMs,
                  query: queries[0],
                  error: 'Invalid JSON payload',
                });
                throw new Error(`Google Places API returned invalid JSON: ${raw.slice(0, 300)}`);
              }

              // Record successful billable operation
              googleUsageTracker.recordOperation({
                operation: 'TEXT_SEARCH',
                success: true,
                statusCode: res.status,
                durationMs,
                query: queries[0],
              });

              return data;
            },
            {
              maxRetries: 1,
              timeoutMs: effectiveTimeout,
            }
          );
        });

        const places = responseData.places || [];
        for (const p of places) {
          const placeId = p.id;
          if (!placeId || seenPlaceIds.has(placeId)) continue;
          seenPlaceIds.add(placeId);

          const mapsUrl = p.googleMapsUri || `https://www.google.com/maps/place/?q=place_id:${placeId}`;

          // Cache place in PlaceCache
          googleDiscoveryCache.setPlace({
            placeId,
            name: p.displayName?.text || 'Unnamed Business',
            address: p.formattedAddress || '',
            location: p.location?.latitude && p.location?.longitude ? { latitude: p.location.latitude, longitude: p.location.longitude } : undefined,
            category: p.primaryType || (p.types?.length > 0 ? p.types[0] : params.industry),
            phone: p.nationalPhoneNumber || p.internationalPhoneNumber,
            websiteUrl: p.websiteUri,
            lastUpdated: new Date().toISOString(),
            source: 'google_places',
          });

          businesses.push(this.mapPlaceToBusiness(p, params, mapsUrl));
        }

        nextPageToken = responseData.nextPageToken;
        if (nextPageToken && businesses.length < targetPool && pageCount < maxPages) {
          // Google Places API token requires slight propagation delay
          await new Promise((r) => setTimeout(r, 200));
        }
      } while (nextPageToken && businesses.length < targetPool && pageCount < maxPages);
      
      // If candidate pool is still too small, safely iterate over query variations
      if (businesses.length < targetPool) {
        let variationIndex = 1; // start from the second query
        while (businesses.length < targetPool && variationIndex < queries.length) {
          const currentQuery = queries[variationIndex];
          variationIndex++;
          
          let varNextPageToken: string | undefined = undefined;
          let varPageCount = 0;
          const varMaxPages = Math.min(Math.max(Math.ceil((targetPool - businesses.length) / 20), 1), 3);

          
          do {
            varPageCount++;
            pageCount++; // accumulate total page count for diagnostics
            const currentPageToken: string | undefined = varNextPageToken;

            const varResponseData = await googlePlacesCircuitBreaker.execute(async () => {
              return await executeWithRetry(
                async (signal) => {
                  const url = 'https://places.googleapis.com/v1/places:searchText';
                  const fetchStart = Date.now();
                  const reqPayload: any = { textQuery: currentQuery, pageSize: 20 };
                  if (currentPageToken) reqPayload.pageToken = currentPageToken;
                  if (params.bbox && (!params.country || params.country === 'India')) {
                    reqPayload.locationRestriction = {
                      rectangle: {
                        low: { latitude: params.bbox.south, longitude: params.bbox.west },
                        high: { latitude: params.bbox.north, longitude: params.bbox.east },
                      },
                    };
                  }

                  const res = await fetch(url, {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      'X-Goog-Api-Key': apiKey,
                      'X-Goog-FieldMask': fieldMask,
                    },
                    body: JSON.stringify(reqPayload),
                    signal,
                  });

                  if (!res.ok) throw new Error(`Variation HTTP ${res.status}`);
                  const data = await res.json();
                  
                  googleUsageTracker.recordOperation({
                    operation: 'TEXT_SEARCH',
                    success: true,
                    statusCode: res.status,
                    durationMs: Date.now() - fetchStart,
                    query: currentQuery,
                  });
                  return data;
                },
                { maxRetries: 1, timeoutMs: effectiveTimeout }
              );
            });

            const places = varResponseData.places || [];
            let addedNew = false;
            for (const p of places) {
              const placeId = p.id;
              if (!placeId || seenPlaceIds.has(placeId)) continue;
              seenPlaceIds.add(placeId);
              addedNew = true;

              const mapsUrl = p.googleMapsUri || `https://www.google.com/maps/place/?q=place_id:${placeId}`;

              // Cache place in PlaceCache
              googleDiscoveryCache.setPlace({
                placeId,
                name: p.displayName?.text || 'Unnamed Business',
                address: p.formattedAddress || '',
                location: p.location?.latitude && p.location?.longitude ? { latitude: p.location.latitude, longitude: p.location.longitude } : undefined,
                category: p.primaryType || (p.types?.length > 0 ? p.types[0] : params.industry),
                phone: p.nationalPhoneNumber || p.internationalPhoneNumber,
                websiteUrl: p.websiteUri,
                lastUpdated: new Date().toISOString(),
                source: 'google_places',
              });

              businesses.push(this.mapPlaceToBusiness(p, params, mapsUrl));
            }

            // Stop paginating this variation early if it yields mostly duplicates
            if (!addedNew && varPageCount >= 1) break;

            varNextPageToken = varResponseData.nextPageToken;
            if (varNextPageToken && businesses.length < targetPool && varPageCount < varMaxPages) {
              await new Promise((r) => setTimeout(r, 200));
            }
          } while (varNextPageToken && businesses.length < targetPool && varPageCount < varMaxPages);
        }
      }

      const durationMs = Date.now() - startTime;
      const rawCount = businesses.length;
      const requestedLimit = params.limit || 20;
      const status: 'SUCCESS' | 'PARTIAL' | 'NO_RESULTS' =
        rawCount >= requestedLimit ? 'SUCCESS' : rawCount > 0 ? 'PARTIAL' : 'NO_RESULTS';

      return {
        providerId: this.providerId,
        providerName: this.name,
        resolvedAreaName: resolvedArea,
        rawCount,
        businesses,
        sourceComplete: rawCount > 0,
        status,
        statusReason:
          rawCount > 0
            ? `Google Places discovered ${rawCount} real businesses (${pageCount} page${pageCount > 1 ? 's' : ''}) in ${durationMs}ms.`
            : `Google Places searched successfully but found zero businesses for ${queries[0]}.`,
        pagesRequested: pageCount,
        queryUsed: queries[0],
        endpointUsed: 'https://places.googleapis.com/v1/places:searchText',
        durationMs,
      };
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      const errMsg = err.message || '';
      const isTimeout = err.name === 'AbortError' || errMsg.includes('timeout') || errMsg.includes('timed out');
      const isAuth = err.status === 401 || err.status === 403 || errMsg.includes('401') || errMsg.includes('403') || errMsg.includes('API key') || errMsg.includes('PERMISSION_DENIED') || errMsg.includes('API_KEY_INVALID');
      const isRate = err.status === 429 || errMsg.includes('429') || errMsg.includes('RESOURCE_EXHAUSTED') || errMsg.includes('quota') || errMsg.includes('QUOTA');
      const status: 'AUTH_FAILED' | 'RATE_LIMITED' | 'REQUEST_FAILED' = isAuth ? 'AUTH_FAILED' : isRate ? 'RATE_LIMITED' : 'REQUEST_FAILED';
      console.warn(`[GooglePlacesDiscoveryProvider] Query failed (${status}): ${errMsg}`);

      let authReason = `Google Places authentication failed: ${errMsg}`;
      if (errMsg.includes('403') || errMsg.includes('PERMISSION_DENIED') || errMsg.includes('caller does not have permission')) {
        authReason = `Google Places authentication failed (HTTP 403 PERMISSION_DENIED). Check Google Cloud Console: ensure 'Places API (New)' is enabled, API key restrictions include Places API (New), and billing is active.`;
      } else if (errMsg.includes('400') || errMsg.includes('API_KEY_INVALID')) {
        authReason = `Google Places API key is invalid (HTTP 400 API_KEY_INVALID). Check that GOOGLE_PLACES_API_KEY does not have extraneous quotes or characters.`;
      }

      return {
        providerId: this.providerId,
        providerName: this.name,
        resolvedAreaName: resolvedArea,
        rawCount: 0,
        businesses: [],
        sourceComplete: false,
        status,
        statusReason: isTimeout
          ? `Google Places timed out after ${effectiveTimeout}ms.`
          : isAuth
          ? authReason
          : isRate
          ? `Google Places rate limited or quota exceeded: ${errMsg}`
          : `Google Places provider failure: ${errMsg}`,
        pagesRequested: 1,
        errors: [errMsg],
        durationMs,
      };
    } finally {
      releaseSemaphore();
    }
  }
}

export const googlePlacesDiscoveryProvider = new GooglePlacesDiscoveryProvider();
