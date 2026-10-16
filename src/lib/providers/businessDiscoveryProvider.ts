import { BusinessDiscoveryProvider, DiscoveredBusiness, DiscoveryCriteria } from './types';
import { queryOverpassBusinesses } from '../overpassClient';
import { resolveIndiaLocation } from '../geoResolver';
import { googlePlacesNewProvider } from './googlePlacesNewProvider';
import { googlePlacesCircuitBreaker, osmCircuitBreaker } from '../resilience/CircuitBreaker';
import { googleUsageTracker } from '../billing/GoogleUsageTracker';
import { googleDiscoveryCache } from '../cache/GoogleDiscoveryCache';

export interface ProviderReportItem {
  status: 'SUCCESS' | 'FAILED' | 'DISABLED' | 'NOT_NEEDED';
  discovered: number;
  error?: string;
  durationMs?: number;
}

export interface ProvidersStatusReport {
  rapidapi?: ProviderReportItem;
  osm: ProviderReportItem;
  googlePlaces: ProviderReportItem;
}

/**
 * Production Business Discovery using Google Places API (New)
 */
export class GooglePlacesDiscoveryProvider implements BusinessDiscoveryProvider {
  readonly name = 'google_places';

  isConfigured(): boolean {
    return googlePlacesNewProvider.isConfigured();
  }

  async searchBusinesses(criteria: DiscoveryCriteria): Promise<DiscoveredBusiness[]> {
    const rawResult = await googlePlacesNewProvider.discoverBusinesses({
      industry: criteria.industry,
      state: criteria.state,
      city: criteria.city,
      country: criteria.country,
      limit: criteria.limit,
    });

    const now = new Date().toISOString();

    return rawResult.businesses.map((b) => ({
      provider: this.name,
      sourceId: b.sourceId,
      name: b.name,
      category: b.category,
      industry: criteria.industry,
      address: b.address,
      city: criteria.city || criteria.state,
      state: criteria.state,
      country: criteria.country || 'India',
      latitude: b.latitude,
      longitude: b.longitude,
      phone: b.phone,
      websiteUrl: b.website,
      businessStatus: 'OPERATIONAL',
      rawPayload: b.rawTags,
      sourceUrl: b.sourceUrl || `https://www.google.com/maps/place/?q=place_id:${b.sourceId}`,
      collectedAt: now,
    }));
  }
}

/**
 * Secondary Discovery Provider using OpenStreetMap Overpass API
 */
export class OpenStreetMapDiscoveryProvider implements BusinessDiscoveryProvider {
  readonly name = 'openstreetmap';

  isConfigured(): boolean {
    return true; // Uses public mirrors
  }

  async searchBusinesses(criteria: DiscoveryCriteria): Promise<DiscoveredBusiness[]> {
    const bbox = await resolveIndiaLocation(criteria.state, criteria.city);
    const discoveryResult = await osmCircuitBreaker.execute(async () => {
      return await queryOverpassBusinesses({
        industry: criteria.industry,
        state: criteria.state,
        city: criteria.city,
        bbox,
        limit: criteria.limit,
      });
    });

    const leads = discoveryResult?.leads || [];
    const now = new Date().toISOString();

    return leads.map((l: any) => ({
      provider: this.name,
      sourceId: l.sourceId || l.id,
      name: l.businessName || l.name,
      category: l.category || criteria.industry,
      industry: l.industry || criteria.industry,
      address: l.address || '',
      city: l.city || criteria.city || criteria.state,
      state: l.state || criteria.state,
      country: criteria.country || 'India',
      postcode: l.postcode || l.postalCode,
      latitude: l.latitude,
      longitude: l.longitude,
      phone: l.phone,
      websiteUrl: l.websiteUrl || l.website,
      businessStatus: l.businessStatus || 'OPERATIONAL',
      sourceUrl: l.sourceUrl || `https://www.openstreetmap.org/${(l.sourceId || '').replace('osm:', '').replace(':', '/')}`,
      collectedAt: now,
    }));
  }
}

/**
 * Production Composite Discovery Provider
 * RapidAPI Maps Data is PRIMARY.
 * OpenStreetMap is SECONDARY / FALLBACK.
 * Google Places API (New) is MODULAR & DISABLED by default.
 */
export class CompositeBusinessDiscoveryProvider implements BusinessDiscoveryProvider {
  readonly name = 'composite_discovery';
  public googlePlaces = new GooglePlacesDiscoveryProvider();
  public osm = new OpenStreetMapDiscoveryProvider();

  private lastProvidersReport: ProvidersStatusReport = {
    rapidapi: { status: 'SUCCESS', discovered: 0 },
    osm: { status: 'SUCCESS', discovered: 0 },
    googlePlaces: { status: 'DISABLED', discovered: 0 },
  };

  private lastSourceStatus: 'COMPLETE' | 'PARTIAL' | 'FAILED' = 'COMPLETE';

  public getLastProvidersReport(): ProvidersStatusReport {
    return { ...this.lastProvidersReport };
  }

  public getLastSourceStatus(): 'COMPLETE' | 'PARTIAL' | 'FAILED' {
    return this.lastSourceStatus;
  }

  isConfigured(): boolean {
    return true;
  }

  async searchBusinesses(criteria: DiscoveryCriteria): Promise<DiscoveredBusiness[]> {
    const { providerManager } = await import('./ProviderManager');
    const requestedLimit = criteria.limit || 20;

    const managerResult = await providerManager.executeDiscovery({
      industry: criteria.industry,
      state: criteria.state,
      city: criteria.city,
      country: criteria.country || 'India',
      limit: requestedLimit,
    });

    const rStats = managerResult.providers.rapidapi;
    const gStats = managerResult.providers.googlePlaces;
    const oStats = managerResult.providers.osm;

    this.lastProvidersReport = {
      rapidapi: {
        status: (rStats?.status === 'SUCCESS' || rStats?.status === 'COMPLETE') ? 'SUCCESS' : (rStats?.status === 'DISABLED' ? 'DISABLED' : (rStats?.status === 'NOT_CONFIGURED' ? 'FAILED' : 'FAILED')),
        discovered: rStats?.rawCount || 0,
        durationMs: managerResult.latencies.rapidapiMs,
        error: rStats?.reason,
      },
      googlePlaces: {
        status: gStats?.status === 'DISABLED' ? 'DISABLED' : (gStats?.status === 'SUCCESS' ? 'SUCCESS' : 'FAILED'),
        discovered: gStats?.rawCount || 0,
        durationMs: managerResult.latencies.googleMs,
        error: gStats?.reason,
      },
      osm: {
        status: oStats?.status === 'SUCCESS' ? 'SUCCESS' : (oStats?.status === 'DISABLED' ? 'DISABLED' : 'FAILED'),
        discovered: oStats?.rawCount || 0,
        durationMs: managerResult.latencies.osmMs,
        error: oStats?.reason,
      },
    };

    this.lastSourceStatus = managerResult.overallStatus === 'COMPLETE' ? 'COMPLETE' : managerResult.overallStatus === 'PARTIAL' ? 'PARTIAL' : 'FAILED';

    const now = new Date().toISOString();
    return managerResult.businesses.map((b) => ({
      provider: b.source,
      sourceId: b.sourceId,
      name: b.name || b.businessName,
      category: b.category,
      industry: criteria.industry,
      address: b.address,
      city: criteria.city || criteria.state,
      state: criteria.state,
      country: criteria.country || 'India',
      latitude: b.latitude,
      longitude: b.longitude,
      phone: b.phone,
      websiteUrl: b.website,
      rating: typeof b.rating === 'number' ? b.rating : undefined,
      reviewCount: typeof b.userRatingCount === 'number' ? b.userRatingCount : undefined,
      businessStatus: b.businessStatus || 'OPERATIONAL',
      rawPayload: b.rawTags,
      sourceUrl: b.sourceUrl,
      collectedAt: now,
      isMock: b.isMock,
    } as DiscoveredBusiness));
  }
}

export const businessDiscovery = new CompositeBusinessDiscoveryProvider();
