import { SearchDiscoveryParams, RawDiscoveredBusiness, DiscoveryResult } from '@/providers/BusinessDiscoveryProvider';
import { googlePlacesDiscoveryProvider } from '@/providers/GooglePlacesDiscoveryProvider';
import { osmOverpassProvider } from '@/providers/OSMOverpassProvider';
import { webSearchDiscoveryProvider } from '@/providers/WebSearchDiscoveryProvider';
import { directoryDiscoveryProvider } from '@/providers/DirectoryDiscoveryProvider';
import { providerHealthService, SystemProvidersHealth } from './ProviderHealthService';
import { getTimeoutConfig } from '@/lib/config/concurrencyConfig';
import { leadPilotDb } from '@/db';
import { normalizePhone } from '@/utils/phoneUtils';
import { extractDomain } from '@/utils/urlUtils';

export interface ProviderStatItem {
  status:
    | 'SUCCESS'
    | 'COMPLETE'
    | 'PARTIAL'
    | 'FAILED'
    | 'DISABLED'
    | 'NOT_CONFIGURED'
    | 'PROVIDER_NOT_CONFIGURED'
    | 'PROVIDER_FAILURE'
    | 'NO_RESULTS'
    | 'NOT_NEEDED'
    | 'AUTH_FAILED'
    | 'RATE_LIMITED'
    | 'REQUEST_FAILED';
  rawCount: number;
  discovered?: number;
  pagesRequested?: number;
  durationMs: number;
  reason?: string;
  errors?: string[];
}

export interface ProviderManagerResult {
  businesses: RawDiscoveredBusiness[];
  totalDiscovered: number;
  sourceComplete: boolean;
  overallStatus: 'COMPLETE' | 'PARTIAL' | 'NO_RESULTS' | 'PROVIDER_FAILURE' | 'PROVIDER_NOT_CONFIGURED';
  statusReason: string;
  primaryProvider: 'google_places' | 'osm';
  providers: {
    googlePlaces: ProviderStatItem;
    osm: ProviderStatItem;
    webSearch: ProviderStatItem;
    directory: ProviderStatItem;
  };
  latencies: {
    googleMs: number;
    osmMs: number;
    webMs: number;
    directoryMs: number;
    totalMs: number;
  };
}

/**
 * Executes an async task bounded by a strict timeout.
 */
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, providerName: string): Promise<T> {
  let timeoutHandle: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(`${providerName} query timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timeoutHandle);
  });
}

export class ProviderManager {
  /**
   * Orchestrates business discovery:
   * 1. Google Places (New) as PRIMARY provider with targetPool over-collection.
   * 2. OpenStreetMap Overpass as SECONDARY / FALLBACK provider.
   * 3. Public Web Search / Directory as SUPPLEMENTAL providers if needed.
   * 4. MultiSourceMergeActor executes downstream to merge overlapping candidates.
   */
  public async executeDiscovery(
    params: SearchDiscoveryParams,
    onProgress?: (message: string, count?: number) => void
  ): Promise<ProviderManagerResult> {
    const startTime = Date.now();
    const requestedLimit = Math.max(Number(params.limit) || 20, 5);
    // Over-collect candidates: targetPool = max(requestedLimit * 3, 60)
    const targetPool = Math.max(requestedLimit * 3, 60);

    const health: SystemProvidersHealth = providerHealthService.checkHealth();

    const result: ProviderManagerResult = {
      businesses: [],
      totalDiscovered: 0,
      sourceComplete: false,
      overallStatus: 'NO_RESULTS',
      statusReason: '',
      primaryProvider: 'google_places',
      providers: {
        googlePlaces: { status: 'NOT_NEEDED', rawCount: 0, discovered: 0, pagesRequested: 0, durationMs: 0, errors: [] },
        osm: { status: 'NOT_NEEDED', rawCount: 0, discovered: 0, durationMs: 0, errors: [] },
        webSearch: { status: 'NOT_NEEDED', rawCount: 0, discovered: 0, durationMs: 0, errors: [] },
        directory: { status: 'NOT_NEEDED', rawCount: 0, discovered: 0, durationMs: 0, errors: [] },
      },
      latencies: {
        googleMs: 0,
        osmMs: 0,
        webMs: 0,
        directoryMs: 0,
        totalMs: 0,
      },
    };

    const isGoogleConfigured = health.googlePlaces.configured && health.googlePlaces.enabled;
    const seenProviderKeys = new Set<string>();

    const addCandidate = (b: RawDiscoveredBusiness) => {
      const pKey = `${b.source}:${b.sourceId}`;
      if (seenProviderKeys.has(pKey)) return;
      seenProviderKeys.add(pKey);
      result.businesses.push(b);
    };

    // --- STEP 1: GOOGLE PLACES PRIMARY EXECUTION ---
    if (isGoogleConfigured && health.googlePlaces.healthy) {
      onProgress?.('Executing Google Places API (New) as Primary discovery provider...');
      const gStart = Date.now();
      const timeouts = getTimeoutConfig();
      // Allow Google Places enough time for up to 3 pages of results from Vercel's servers.
      // googlePlacesFastMs default is now 8000ms per page; outer timeout must be higher.
      const googleTimeoutMs = Math.max((timeouts.googlePlacesFastMs || 8000) * 2, 20000);

      try {
        const googleRes = await withTimeout(
          googlePlacesDiscoveryProvider.discoverBusinesses({ ...params, limit: targetPool }),
          googleTimeoutMs,
          'Google Places API'
        );
        result.latencies.googleMs = Date.now() - gStart;
        result.providers.googlePlaces = {
          status: googleRes.status as any,
          rawCount: googleRes.rawCount,
          discovered: googleRes.rawCount,
          pagesRequested: googleRes.pagesRequested || (googleRes.rawCount > 0 ? 1 : 0),
          durationMs: result.latencies.googleMs,
          reason: googleRes.statusReason,
          errors: googleRes.errors || [],
        };

        if (googleRes.businesses.length > 0) {
          for (const b of googleRes.businesses) {
            addCandidate(b);
          }
          onProgress?.(
            `Google Places discovered ${googleRes.rawCount} venues in ${(result.latencies.googleMs / 1000).toFixed(2)}s`,
            googleRes.rawCount
          );
        }
      } catch (gErr: any) {
        result.latencies.googleMs = Date.now() - gStart;
        const errMsg = gErr.message || '';
        const isAuth = errMsg.includes('401') || errMsg.includes('403') || errMsg.includes('API key') || errMsg.includes('PERMISSION_DENIED');
        const isRate = errMsg.includes('429') || errMsg.includes('quota') || errMsg.includes('RESOURCE_EXHAUSTED');
        const status = isAuth ? 'AUTH_FAILED' : isRate ? 'RATE_LIMITED' : 'REQUEST_FAILED';
        result.providers.googlePlaces = {
          status: status as any,
          rawCount: 0,
          discovered: 0,
          pagesRequested: 1,
          durationMs: result.latencies.googleMs,
          reason: `Google Places execution failed: ${errMsg}`,
          errors: [errMsg],
        };
        onProgress?.(`Google Places encountered an error (${status}): ${errMsg}. Continuing with OpenStreetMap fallback...`);
      }
    } else {
      let disabledStatus: 'DISABLED' | 'NOT_CONFIGURED' | 'PROVIDER_NOT_CONFIGURED' | 'PROVIDER_FAILURE' | 'FAILED' = 'DISABLED';
      if (!health.googlePlaces.enabled) {
        disabledStatus = 'DISABLED';
      } else if (!health.googlePlaces.configured) {
        disabledStatus = 'NOT_CONFIGURED';
      } else {
        disabledStatus = 'PROVIDER_FAILURE';
      }

      result.providers.googlePlaces = {
        status: disabledStatus as any,
        rawCount: 0,
        discovered: 0,
        pagesRequested: 0,
        durationMs: 0,
        reason: health.googlePlaces.message || 'GOOGLE_PLACES_API_KEY is not configured on the server.',
        errors: [health.googlePlaces.reason || 'MISSING_API_KEY'],
      };
      onProgress?.(`Google Places is not active (${health.googlePlaces.reason}). Using OpenStreetMap as discovery source...`);
    }

    // --- STEP 2: OPENSTREETMAP AS SECONDARY / FALLBACK PROVIDER ---
    // Section 1 & 7: OSM remains available as fallback and secondary source.
    // Only invoke OSM if Google failed, returned zero, or returned insufficient candidates
    const isOsmEnabled = health.osm.configured && health.osm.enabled;
    const isIndia = !params.country || params.country === 'India';
    const googleFailed = ['FAILED', 'DISABLED', 'NOT_CONFIGURED', 'PROVIDER_NOT_CONFIGURED', 'PROVIDER_FAILURE', 'AUTH_FAILED', 'REQUEST_FAILED', 'RATE_LIMITED', 'NO_RESULTS'].includes(result.providers.googlePlaces.status);
    const needOsm = isIndia && (googleFailed || result.businesses.length < requestedLimit * 1.5);

    if (isOsmEnabled && needOsm) {
      onProgress?.('Executing OpenStreetMap Overpass as Secondary / Fallback discovery source...');
      const oStart = Date.now();
      const osmTimeouts = getTimeoutConfig();
      const osmTimeoutMs = Math.max(osmTimeouts.osmFastMs || 6000, 10000);

      try {
        const osmRes = await withTimeout(
          osmOverpassProvider.discoverBusinesses({ ...params, limit: targetPool }),
          osmTimeoutMs,
          'OpenStreetMap Overpass'
        );
        result.latencies.osmMs = Date.now() - oStart;
        result.providers.osm = {
          status: osmRes.status as any,
          rawCount: osmRes.rawCount,
          discovered: osmRes.rawCount,
          durationMs: result.latencies.osmMs,
          reason: osmRes.statusReason,
          errors: osmRes.errors || [],
        };

        if (osmRes.businesses.length > 0) {
          for (const b of osmRes.businesses) {
            addCandidate(b);
          }
          onProgress?.(
            `OpenStreetMap discovered ${osmRes.rawCount} venues in ${(result.latencies.osmMs / 1000).toFixed(2)}s`,
            osmRes.rawCount
          );
        }
      } catch (oErr: any) {
        result.latencies.osmMs = Date.now() - oStart;
        const errMsg = oErr.message || '';
        const isRate = errMsg.includes('429') || errMsg.includes('rate') || errMsg.includes('busy');
        result.providers.osm = {
          status: (isRate ? 'RATE_LIMITED' : 'REQUEST_FAILED') as any,
          rawCount: 0,
          discovered: 0,
          durationMs: result.latencies.osmMs,
          reason: errMsg,
          errors: [errMsg],
        };
      }
    } else if (isOsmEnabled && !needOsm) {
      result.providers.osm = {
        status: 'NOT_NEEDED',
        rawCount: 0,
        discovered: 0,
        durationMs: 0,
        reason: 'Google Places provided sufficient candidates; OSM supplemental discovery bypassed for latency.',
        errors: [],
      };
    } else {
      result.providers.osm = {
        status: 'DISABLED',
        rawCount: 0,
        discovered: 0,
        durationMs: 0,
        reason: 'OpenStreetMap provider is disabled via OSM_ENABLED=false.',
        errors: ['OSM_DISABLED'],
      };
    }

    // --- STEP 3: SUPPLEMENTAL WEB SEARCH / DIRECTORY IF NEEDED ---
    const currentCount = result.businesses.length;
    if (currentCount < requestedLimit) {
      onProgress?.('Supplementing discovery pool with public web search...');
      const wStart = Date.now();
      try {
        const webRes = await withTimeout(
          webSearchDiscoveryProvider.discoverBusinesses(params),
          5000,
          'Web Search Discovery'
        );
        result.latencies.webMs = Date.now() - wStart;
        result.providers.webSearch = {
          status: webRes.status as any,
          rawCount: webRes.rawCount,
          discovered: webRes.rawCount,
          durationMs: result.latencies.webMs,
          reason: webRes.statusReason,
          errors: webRes.errors || [],
        };
        for (const b of webRes.businesses) {
          addCandidate(b);
        }
      } catch (wErr: any) {
        result.latencies.webMs = Date.now() - wStart;
        result.providers.webSearch = {
          status: 'FAILED',
          rawCount: 0,
          discovered: 0,
          durationMs: result.latencies.webMs,
          reason: wErr.message,
          errors: [wErr.message],
        };
      }
    } else {
      result.providers.webSearch = {
        status: 'NOT_NEEDED',
        rawCount: 0,
        discovered: 0,
        durationMs: 0,
        reason: 'Primary and secondary discovery sources provided sufficient candidate volume.',
        errors: [],
      };
    }

    result.latencies.totalMs = Date.now() - startTime;
    result.totalDiscovered = result.businesses.length;
    result.sourceComplete = result.totalDiscovered > 0;

    // --- STEP 4: STRICT SEARCH STATE CLASSIFICATION ---
    const gStatus = result.providers.googlePlaces.status;
    const oStatus = result.providers.osm.status;

    if (result.totalDiscovered > 0) {
      result.overallStatus = result.totalDiscovered >= requestedLimit ? 'COMPLETE' : 'PARTIAL';
      result.statusReason = `Discovered ${result.totalDiscovered} candidates (Google Places: ${result.providers.googlePlaces.rawCount}, OSM: ${result.providers.osm.rawCount}, Web: ${result.providers.webSearch.rawCount}).`;
    } else {
      const gFailed = ['FAILED', 'PROVIDER_FAILURE', 'AUTH_FAILED', 'RATE_LIMITED', 'REQUEST_FAILED'].includes(gStatus);
      const oFailed = ['FAILED', 'PROVIDER_FAILURE', 'RATE_LIMITED', 'REQUEST_FAILED'].includes(oStatus);

      if (gFailed && oFailed) {
        result.overallStatus = 'PROVIDER_FAILURE';
        result.statusReason = `All business discovery providers encountered errors (Google Places: ${gStatus}, OSM: ${oStatus}).`;
      } else if (
        (gStatus === 'DISABLED' || gStatus === 'NOT_CONFIGURED' || gStatus === 'PROVIDER_NOT_CONFIGURED') &&
        oFailed
      ) {
        result.overallStatus = 'PROVIDER_FAILURE';
        result.statusReason = `Google Places is not configured and OpenStreetMap fallback failed (${oStatus}).`;
      } else if (
        (gStatus === 'DISABLED' || gStatus === 'NOT_CONFIGURED' || gStatus === 'PROVIDER_NOT_CONFIGURED') &&
        oStatus === 'DISABLED'
      ) {
        result.overallStatus = 'PROVIDER_NOT_CONFIGURED';
        result.statusReason = 'No business discovery providers are configured on the server.';
      } else if (gStatus === 'AUTH_FAILED' && oStatus === 'NO_RESULTS') {
        result.overallStatus = 'NO_RESULTS';
        result.statusReason = `Google Places authentication failed (HTTP 403). OpenStreetMap searched successfully but found zero business records for ${params.industry} in ${params.city || params.state}.`;
      } else {
        result.overallStatus = 'NO_RESULTS';
        result.statusReason = `No business records found for ${params.industry} in ${params.city || params.state}.`;
      }
    }

    return result;
  }

  /**
   * Executes parallel discovery if search planner specifies concurrent multi-source coverage.
   */
  public async executeParallelDiscovery(
    params: SearchDiscoveryParams,
    onProgress?: (message: string, count?: number) => void
  ): Promise<ProviderManagerResult> {
    return this.executeDiscovery(params, onProgress);
  }
}

export const providerManager = new ProviderManager();
