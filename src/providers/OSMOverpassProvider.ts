import {
  BusinessDiscoveryProvider,
  SearchDiscoveryParams,
  DiscoveryResult,
  RawDiscoveredBusiness,
} from './BusinessDiscoveryProvider';
import { queryOverpassBusinesses } from '@/lib/overpassClient';
import { resolveIndiaLocation } from '@/lib/geoResolver';
import { osmCircuitBreaker } from '@/lib/resilience/CircuitBreaker';
import { semaphores, getTimeoutConfig } from '@/lib/config/concurrencyConfig';
import { performanceTracker } from '@/lib/metrics/PerformanceTracker';

export class OSMOverpassProvider implements BusinessDiscoveryProvider {
  readonly providerId = 'osm';
  readonly name = 'OpenStreetMap Overpass Engine';
  private static sessionDeliveredOsmIds: Map<string, Set<string>> = new Map();

  public static clearSessionDeliveredOsmIds(): void {
    OSMOverpassProvider.sessionDeliveredOsmIds.clear();
  }

  public async discoverBusinesses(params: SearchDiscoveryParams): Promise<DiscoveryResult> {
    const startTime = Date.now();
    const resolvedAreaName = params.city ? `${params.city}, ${params.state}` : params.state;
    const timeouts = getTimeoutConfig();

    // 0. Configuration check
    if (process.env.OSM_ENABLED === 'false') {
      return {
        providerId: this.providerId,
        providerName: this.name,
        resolvedAreaName,
        rawCount: 0,
        businesses: [],
        sourceComplete: false,
        status: 'DISABLED',
        statusReason: 'OpenStreetMap discovery is disabled via OSM_ENABLED=false.',
        errors: ['OSM_DISABLED'],
        durationMs: 0,
      };
    }

    // 1. Acquire concurrency semaphore
    const releaseSemaphore = await semaphores.osm.acquire();

    try {
      // 2. Resolve bounding box if not provided (India pre-indexed spatial bounds)
      let bbox: any = params.bbox;
      if (!bbox && (!params.country || params.country === 'India')) {
        bbox = await resolveIndiaLocation(params.state, params.city);
      }

      // 3. Circuit breaker + bounded timeout (aligned with ProviderManager 10s budget)
      const effectiveTimeout = Math.max(timeouts.osmFastMs || 8000, 8000);
      const requestedOffset = Math.max(Number(params.offset) || 0, 0);
      const requestedLimit = params.limit || 20;

      const discovery = await osmCircuitBreaker.execute(async () => {
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => {
            performanceTracker.recordTimeout();
            reject(new Error(`OSM Overpass fast-path query timed out after ${effectiveTimeout}ms`));
          }, effectiveTimeout)
        );

        const queryPromise = queryOverpassBusinesses({
          industry: params.industry,
          state: params.state,
          city: params.city,
          bbox: bbox as any,
          limit: Math.max((params.limit || 50) + requestedOffset, 30),
        });

        return await Promise.race([queryPromise, timeoutPromise]);
      });

      const rawDiscovered: RawDiscoveredBusiness[] = (discovery?.leads || []).map((lead: any) => {
        const name = lead.businessName || lead.name || '';
        const postalCode = lead.postcode || lead.location?.postcode;
        const sourceUrl = lead.sourceUrl || (lead.osmType && lead.osmId ? `https://www.openstreetmap.org/${lead.osmType}/${lead.osmId}` : undefined);
        const sourceId = String(lead.osmId || lead.id);

        return {
          source: 'openstreetmap',
          sources: ['openstreetmap'],
          sourceId,
          osmType: lead.osmType,
          osmId: lead.osmId ? Number(lead.osmId) : undefined,
          categoryTag: lead.categoryTag || lead.category,
          name,
          businessName: name,
          category: lead.category,
          address: lead.address || lead.location?.address || `${params.city || ''} ${params.state}`.trim(),
          city: lead.city || lead.location?.city || params.city,
          state: lead.state || lead.location?.state || params.state,
          postalCode,
          postcode: postalCode,
          latitude: lead.latitude || lead.coordinates?.lat,
          longitude: lead.longitude || lead.coordinates?.lon,
          phone: lead.phone && lead.phone !== 'Not available' ? lead.phone : undefined,
          email: lead.email && lead.email !== 'Not available' ? lead.email : undefined,
          website: lead.websiteUrl || (typeof lead.website === 'string' ? lead.website : lead.website?.url),
          openingHours: lead.openingHours,
          sourceUrl,
          rawTags: lead.rawTags || {},
          sourceEvidence: [
            {
              source: 'openstreetmap',
              sourceId,
              sourceUrl,
              rawTags: {
                osmId: lead.osmId,
                osmType: lead.osmType,
                ...(lead.rawTags || {}),
              },
            },
          ],
        };
      });

      const sessionKey = `${(params.country || 'India').toLowerCase()}:${params.state.toLowerCase()}:${(params.city || '').toLowerCase()}:${params.industry.toLowerCase()}`;
      if (requestedOffset === 0) {
        OSMOverpassProvider.sessionDeliveredOsmIds.set(sessionKey, new Set<string>());
      }
      const seenOsmIds = OSMOverpassProvider.sessionDeliveredOsmIds.get(sessionKey) || new Set<string>();

      let businesses: RawDiscoveredBusiness[] = [];
      if (requestedOffset > 0) {
        const unseen = rawDiscovered.filter((b) => {
          const id = String(b.osmId || b.sourceId || b.businessName || '').toLowerCase().trim();
          return !seenOsmIds.has(id);
        });

        if (unseen.length > 0) {
          for (let i = unseen.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [unseen[i], unseen[j]] = [unseen[j], unseen[i]];
          }
          businesses = unseen.slice(0, requestedLimit);
        } else if (rawDiscovered.length > requestedOffset) {
          businesses = rawDiscovered.slice(requestedOffset, requestedOffset + requestedLimit);
        } else {
          businesses = [];
        }
      } else {
        businesses = rawDiscovered.slice(0, requestedLimit);
      }

      for (const b of businesses) {
        const id = String(b.osmId || b.sourceId || b.businessName || '').toLowerCase().trim();
        seenOsmIds.add(id);
      }
      OSMOverpassProvider.sessionDeliveredOsmIds.set(sessionKey, seenOsmIds);

      const durationMs = Date.now() - startTime;
      const rawCount = businesses.length;
      const status: 'SUCCESS' | 'PARTIAL' | 'NO_RESULTS' =
        rawCount >= requestedLimit ? 'SUCCESS' : rawCount > 0 ? 'PARTIAL' : 'NO_RESULTS';

      return {
        providerId: this.providerId,
        providerName: this.name,
        resolvedAreaName: discovery.resolvedAreaName || resolvedAreaName,
        rawCount,
        businesses,
        sourceComplete: rawCount > 0,
        status,
        statusReason:
          rawCount > 0
            ? `Discovered ${rawCount} real candidates from OpenStreetMap.`
            : requestedOffset > 0
            ? 'No more new businesses found in this area. Try expanding your search location.'
            : `OpenStreetMap found zero business records for ${params.industry} in ${resolvedAreaName}.`,
        queryUsed: discovery.queryUsed,
        endpointUsed: discovery.endpointUsed,
        durationMs,
      };
    } catch (err: any) {
      const errMsg = err.message || '';
      const isRate = errMsg.includes('429') || errMsg.includes('rate') || errMsg.includes('busy') || errMsg.includes('Too Many Requests');
      const status: 'RATE_LIMITED' | 'REQUEST_FAILED' = isRate ? 'RATE_LIMITED' : 'REQUEST_FAILED';
      console.warn(`[OSMOverpassProvider] OSM query failed (${status}): ${errMsg}`);
      return {
        providerId: this.providerId,
        providerName: this.name,
        resolvedAreaName,
        rawCount: 0,
        businesses: [],
        sourceComplete: false,
        status,
        statusReason: `OSM query failed: ${errMsg}`,
        errors: [errMsg],
        durationMs: Date.now() - startTime,
      };
    } finally {
      releaseSemaphore();
    }
  }
}

export const osmOverpassProvider = new OSMOverpassProvider();
