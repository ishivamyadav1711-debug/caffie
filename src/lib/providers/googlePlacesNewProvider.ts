import { RawDiscoveredBusiness, SearchDiscoveryParams, DiscoveryResult } from '@/providers/BusinessDiscoveryProvider';
import { googleUsageTracker } from '../billing/GoogleUsageTracker';
import { googlePlacesCircuitBreaker } from '../resilience/CircuitBreaker';
import { googleDiscoveryCache } from '../cache/GoogleDiscoveryCache';
import { semaphores, getTimeoutConfig } from '../config/concurrencyConfig';
import { executeWithRetry } from '../utils/retryUtils';

export class GooglePlacesNewProvider {
  readonly providerId = 'google_places';
  readonly name = 'Google Places API (New)';

  /**
   * Configurable field mask: only requesting discovery essentials.
   * Excluding expensive SKUs like photos, reviews, and atmosphere.
   */
  private getFieldMask(): string {
    return (
      process.env.GOOGLE_PLACES_FIELD_MASK ||
      'places.id,places.displayName,places.formattedAddress,places.location,places.types,places.nationalPhoneNumber,places.internationalPhoneNumber,places.websiteUri,places.googleMapsUri'
    );
  }

  public isConfigured(): boolean {
    const rawKey = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
    const key = rawKey ? rawKey.trim().replace(/^["']|["']$/g, '').trim() : '';
    return Boolean(key && key.length > 0 && process.env.GOOGLE_PLACES_ENABLED !== 'false');
  }

  /**
   * Executes official Google Places Text Search (New)
   */
  public async discoverBusinesses(params: SearchDiscoveryParams): Promise<DiscoveryResult> {
    const startTime = Date.now();
    const resolvedArea = params.city ? `${params.city}, ${params.state}` : params.state;
    const country = params.country || 'India';
    const textQuery = `${params.industry} in ${resolvedArea}, ${country}`;

    // 1. Budget and Mode check
    const budgetCheck = googleUsageTracker.canExecuteGoogleRequest();
    if (!budgetCheck.allowed) {
      console.warn(`[GooglePlacesNewProvider] Request blocked by budget policy: ${budgetCheck.reason}`);
      return {
        providerId: this.providerId,
        providerName: this.name,
        resolvedAreaName: resolvedArea,
        rawCount: 0,
        businesses: [],
        sourceComplete: false,
        status: budgetCheck.effectiveAction === 'STOP' ? 'FAILED' : 'DISABLED',
        statusReason: budgetCheck.reason || 'Google Places calls disabled by budget policy.',
        errors: budgetCheck.reason ? [budgetCheck.reason] : [],
        durationMs: Date.now() - startTime,
      };
    }

    const rawApiKey = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
    const apiKey = rawApiKey ? rawApiKey.trim().replace(/^["']|["']$/g, '').trim() : '';
    if (!apiKey) {
      return {
        providerId: this.providerId,
        providerName: this.name,
        resolvedAreaName: resolvedArea,
        rawCount: 0,
        businesses: [],
        sourceComplete: false,
        status: 'DISABLED',
        statusReason: 'GOOGLE_PLACES_API_KEY is not configured on the server.',
        errors: ['Missing Google Places API key.'],
        durationMs: 0,
      };
    }

    const fieldMask = this.getFieldMask();
    const pageSize = Math.min(Math.max(params.limit || 20, 1), 20); // Google Places Text Search max pageSize is 20 per call
    const timeouts = getTimeoutConfig();

    // 2. Concurrency limiting & Circuit Breaker protection
    const releaseSemaphore = await semaphores.googlePlaces.acquire();

    try {
      const responseData = await googlePlacesCircuitBreaker.execute(async () => {
        return await executeWithRetry(
          async (signal) => {
            const url = 'https://places.googleapis.com/v1/places:searchText';
            const fetchStart = Date.now();

            const res = await fetch(url, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Goog-Api-Key': apiKey,
                'X-Goog-FieldMask': fieldMask,
              },
              body: JSON.stringify({
                textQuery,
                pageSize,
              }),
              signal,
            });

            const durationMs = Date.now() - fetchStart;
            const contentType = res.headers.get('content-type') || '';
            const raw = await res.text();

            if (!res.ok) {
              googleUsageTracker.recordOperation({
                operation: 'TEXT_SEARCH',
                success: false,
                statusCode: res.status,
                durationMs,
                query: textQuery,
                error: `HTTP ${res.status}: ${raw.slice(0, 300)}`,
              });
              const errorObj: any = new Error(`Google Places API returned HTTP ${res.status}: ${raw.slice(0, 300)}`);
              errorObj.status = res.status;
              throw errorObj;
            }

            if (!contentType.includes('application/json')) {
              googleUsageTracker.recordOperation({
                operation: 'TEXT_SEARCH',
                success: false,
                statusCode: res.status,
                durationMs,
                query: textQuery,
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
                query: textQuery,
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
              query: textQuery,
            });

            return data;
          },
          {
            maxRetries: 1, // Keep fast-path tight (1-2s target)
            timeoutMs: timeouts.googlePlacesFastMs,
          }
        );
      });

      const places = responseData.places || [];
      const businesses: RawDiscoveredBusiness[] = [];

      for (const p of places) {
        const placeId = p.id;
        const name = p.displayName?.text || 'Unnamed Business';
        const address = p.formattedAddress || '';
        const phone = p.internationalPhoneNumber || p.nationalPhoneNumber;
        const website = p.websiteUri;
        const category = p.primaryType || params.industry;
        const lat = p.location?.latitude;
        const lon = p.location?.longitude;

        // Cache place in place-level cache
        googleDiscoveryCache.setPlace({
          placeId,
          name,
          address,
          location: lat && lon ? { latitude: lat, longitude: lon } : undefined,
          category,
          phone,
          websiteUrl: website,
          lastUpdated: new Date().toISOString(),
          source: 'google_places',
        });

        businesses.push({
          source: 'google_places',
          sources: ['google_places'],
          sourceId: placeId,
          sourceUrl: `https://www.google.com/maps/place/?q=place_id:${placeId}`,
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
          // STRICT RULE: NEVER invent email from Google Places
          email: undefined,
          rawTags: {
            googlePlaceId: placeId,
            types: p.types || [],
            primaryType: p.primaryType,
          },
          sourceEvidence: [
            {
              source: 'google_places',
              sourceId: placeId,
              sourceUrl: `https://www.google.com/maps/place/?q=place_id:${placeId}`,
            },
          ],
        });
      }

      return {
        providerId: this.providerId,
        providerName: this.name,
        resolvedAreaName: resolvedArea,
        rawCount: businesses.length,
        businesses,
        sourceComplete: businesses.length > 0,
        status: businesses.length > 0 ? 'COMPLETE' : 'NO_RESULTS',
        statusReason: `Discovered ${businesses.length} verified venues from official Google Places API (New).`,
        queryUsed: textQuery,
        durationMs: Date.now() - startTime,
      };
    } catch (err: any) {
      console.warn(`[GooglePlacesNewProvider] Query failed or timed out: ${err.message}`);
      return {
        providerId: this.providerId,
        providerName: this.name,
        resolvedAreaName: resolvedArea,
        rawCount: 0,
        businesses: [],
        sourceComplete: false,
        status: 'FAILED',
        statusReason: `Google Places API failed: ${err.message}`,
        errors: [err.message],
        durationMs: Date.now() - startTime,
      };
    } finally {
      releaseSemaphore();
    }
  }
}

export const googlePlacesNewProvider = new GooglePlacesNewProvider();
