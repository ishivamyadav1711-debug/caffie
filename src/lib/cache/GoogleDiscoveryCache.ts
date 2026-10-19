import { leadPilotDb } from '@/db';

export interface CachedPlace {
  placeId: string;
  name: string;
  address?: string;
  location?: { latitude: number; longitude: number };
  category?: string;
  phone?: string;
  websiteUrl?: string;
  lastUpdated: string;
  source: string;
}

export class GoogleDiscoveryCache {
  private static instance: GoogleDiscoveryCache;

  // In-memory place cache by placeId
  private placeMap = new Map<string, CachedPlace>();

  // In-flight search requests deduplication map: searchKey -> Promise
  private inFlightSearches = new Map<string, Promise<any>>();

  // Default query cache TTL: 24 hours (86,400,000 ms), configurable via env
  private defaultTtlMs: number;

  private constructor() {
    const envTtlHours = parseInt(process.env.GOOGLE_CACHE_TTL_HOURS || '24', 10);
    this.defaultTtlMs = envTtlHours * 3600 * 1000;
  }

  public static getInstance(): GoogleDiscoveryCache {
    if (!GoogleDiscoveryCache.instance) {
      GoogleDiscoveryCache.instance = new GoogleDiscoveryCache();
    }
    return GoogleDiscoveryCache.instance;
  }

  /**
   * Generates a normalized search key for query caching and in-flight deduplication.
   */
  public generateSearchKey(params: {
    industry: string;
    state: string;
    city?: string;
    country?: string;
    limit?: number;
    offset?: number;
    page?: number;
    contactFilter?: string;
    websiteFilter?: string;
    highNetWorthFilter?: boolean;
  }): string {
    const norm = (s?: string) => (s ? s.trim().toLowerCase().replace(/\s+/g, '_') : '');
    return [
      'g_disc_v4',
      norm(params.industry),
      norm(params.country || 'india'),
      norm(params.state),
      norm(params.city || 'all'),
      norm(params.contactFilter || 'all'),
      norm(params.websiteFilter || 'any'),
      params.limit || 50,
      params.offset || 0,
      params.highNetWorthFilter ? 'hnw' : 'standard',
    ].join(':');
  }

  /**
   * Gets cached discovery results for a search query.
   */
  public getSearchQueryResults<T>(key: string): T | null {
    const cached = leadPilotDb.getCache<T>(key);
    return cached || null;
  }

  /**
   * Sets cached discovery results for a search query.
   */
  public setSearchQueryResults<T>(key: string, data: T, ttlMs?: number): void {
    const ttl = ttlMs || this.defaultTtlMs;
    leadPilotDb.setCache(key, data, ttl);
  }

  /**
   * Deduplicates in-flight identical searches.
   * If a search with the same key is currently running, returns the existing Promise.
   */
  public async executeDeduplicated<T>(
    key: string,
    operation: () => Promise<T>
  ): Promise<{ result: T; wasDeduplicated: boolean }> {
    if (this.inFlightSearches.has(key)) {
      const activePromise = this.inFlightSearches.get(key) as Promise<T>;
      const result = await activePromise;
      return { result, wasDeduplicated: true };
    }

    const executionPromise = (async () => {
      try {
        return await operation();
      } finally {
        this.inFlightSearches.delete(key);
      }
    })();

    this.inFlightSearches.set(key, executionPromise);
    const result = await executionPromise;
    return { result, wasDeduplicated: false };
  }

  /**
   * Caches individual place data by Google Place ID.
   */
  public setPlace(place: CachedPlace): void {
    this.placeMap.set(place.placeId, place);
    leadPilotDb.setCache(`place:${place.placeId}`, place, this.defaultTtlMs);
  }

  /**
   * Retrieves place data by Google Place ID.
   */
  public getPlace(placeId: string): CachedPlace | null {
    if (this.placeMap.has(placeId)) {
      return this.placeMap.get(placeId)!;
    }
    const fromDb = leadPilotDb.getCache<CachedPlace>(`place:${placeId}`);
    if (fromDb) {
      this.placeMap.set(placeId, fromDb);
      return fromDb;
    }
    return null;
  }

  public getStats() {
    return {
      inMemoryPlacesCount: this.placeMap.size,
      activeInFlightCount: this.inFlightSearches.size,
      defaultTtlHours: this.defaultTtlMs / (3600 * 1000),
    };
  }
}

export const googleDiscoveryCache = GoogleDiscoveryCache.getInstance();
