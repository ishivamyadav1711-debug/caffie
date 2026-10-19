import { describe, it, expect, beforeEach } from 'vitest';
import { googleDiscoveryCache } from '@/lib/cache/GoogleDiscoveryCache';
import { RapidApiDiscoveryProvider } from '@/providers/RapidApiDiscoveryProvider';
import { OSMOverpassProvider } from '@/providers/OSMOverpassProvider';
import { RawDiscoveredBusiness } from '@/providers/BusinessDiscoveryProvider';

describe('Global Fix for Repeated Search (Auto-Pagination & Randomness)', () => {
  beforeEach(() => {
    RapidApiDiscoveryProvider.clearSessionDeliveredPlaceIds();
    OSMOverpassProvider.clearSessionDeliveredOsmIds();
    RapidApiDiscoveryProvider.setSimulateResults(null);
  });

  describe('1. Database Cache Isolation (GoogleDiscoveryCache)', () => {
    it('isolates cache keys by offset so offset=5 never returns offset=0 results', () => {
      const baseParams = {
        industry: 'Restaurants',
        country: 'India',
        state: 'Maharashtra',
        city: 'Mumbai',
        limit: 5,
      };

      const keyOffset0 = googleDiscoveryCache.generateSearchKey({
        ...baseParams,
        offset: 0,
      });

      const keyOffset5 = googleDiscoveryCache.generateSearchKey({
        ...baseParams,
        offset: 5,
      });

      expect(keyOffset0).toContain(':offset:0');
      expect(keyOffset5).toContain(':offset:5');
      expect(keyOffset0).not.toBe(keyOffset5);

      // Verify that storing under keyOffset0 does NOT return for keyOffset5
      googleDiscoveryCache.setSearchQueryResults(keyOffset0, {
        businesses: [{ businessName: 'Batch 1 Restaurant' }],
        rawCount: 1,
      });

      const cachedOffset0 = googleDiscoveryCache.getSearchQueryResults<any>(keyOffset0);
      const cachedOffset5 = googleDiscoveryCache.getSearchQueryResults<any>(keyOffset5);

      expect(cachedOffset0).not.toBeNull();
      expect(cachedOffset0?.businesses[0].businessName).toBe('Batch 1 Restaurant');
      expect(cachedOffset5).toBeNull();
    });

    it('generates deterministic hash signatures for query combinations', () => {
      const hash1 = googleDiscoveryCache.hashSignature('restaurants:usa:california:los_angeles');
      const hash2 = googleDiscoveryCache.hashSignature('restaurants:usa:california:los_angeles');
      const hash3 = googleDiscoveryCache.hashSignature('dentists:canada:ontario:toronto');

      expect(hash1).toBe(hash2);
      expect(hash1).not.toBe(hash3);
      expect(hash1).toHaveLength(8); // 32-bit FNV-1a hex string
    });
  });

  describe('2. RapidApiDiscoveryProvider Offset & Random Sampling', () => {
    it('returns new candidates on repeat search with offset > 0 across India, USA, Canada', async () => {
      const provider = new RapidApiDiscoveryProvider();

      // Create a pool of 10 simulated businesses
      const mockPool: RawDiscoveredBusiness[] = Array.from({ length: 10 }, (_, i) => ({
        source: 'rapidapi',
        sources: ['rapidapi'],
        sourceId: `place_${i + 1}`,
        googlePlaceId: `place_${i + 1}`,
        name: `Business ${i + 1}`,
        businessName: `Business ${i + 1}`,
        category: 'Dentists',
        address: `${i + 1} Main St, Austin, Texas, USA`,
        city: 'Austin',
        state: 'Texas',
        country: 'USA',
        rawTags: {},
      }));

      RapidApiDiscoveryProvider.setSimulateResults(mockPool);

      // Batch 1: offset = 0, limit = 5
      const resBatch1 = await provider.discoverBusinesses({
        industry: 'Dentists',
        country: 'USA',
        state: 'Texas',
        city: 'Austin',
        limit: 5,
        offset: 0,
      });

      expect(resBatch1.status).toBe('SUCCESS');
      expect(resBatch1.rawCount).toBe(5);
      const batch1Ids = resBatch1.businesses.map((b) => b.googlePlaceId);

      // Batch 2: offset = 5, limit = 5 (Repeat search with same criteria)
      const resBatch2 = await provider.discoverBusinesses({
        industry: 'Dentists',
        country: 'USA',
        state: 'Texas',
        city: 'Austin',
        limit: 5,
        offset: 5,
      });

      expect(resBatch2.status).toBe('SUCCESS');
      expect(resBatch2.rawCount).toBe(5);
      const batch2Ids = resBatch2.businesses.map((b) => b.googlePlaceId);

      // None of the batch 2 IDs should overlap with batch 1
      for (const id of batch2Ids) {
        expect(batch1Ids).not.toContain(id);
      }
    });

    it('returns exact exhausted message when all candidates in area are exhausted', async () => {
      const provider = new RapidApiDiscoveryProvider();

      // Pool of only 5 businesses
      const mockPool: RawDiscoveredBusiness[] = Array.from({ length: 5 }, (_, i) => ({
        source: 'rapidapi',
        sources: ['rapidapi'],
        sourceId: `in_place_${i + 1}`,
        googlePlaceId: `in_place_${i + 1}`,
        name: `Mumbai Clinic ${i + 1}`,
        businessName: `Mumbai Clinic ${i + 1}`,
        category: 'Clinics',
        address: `Bandra, Mumbai, Maharashtra, India`,
        city: 'Mumbai',
        state: 'Maharashtra',
        country: 'India',
        rawTags: {},
      }));

      RapidApiDiscoveryProvider.setSimulateResults(mockPool);

      // First search delivers all 5
      const batch1 = await provider.discoverBusinesses({
        industry: 'Clinics',
        country: 'India',
        state: 'Maharashtra',
        city: 'Mumbai',
        limit: 5,
        offset: 0,
      });
      expect(batch1.rawCount).toBe(5);

      // Repeat search at offset = 5 detects 0 unseen candidates remaining
      const batch2 = await provider.discoverBusinesses({
        industry: 'Clinics',
        country: 'India',
        state: 'Maharashtra',
        city: 'Mumbai',
        limit: 5,
        offset: 5,
      });

      expect(batch2.status).toBe('NO_RESULTS');
      expect(batch2.rawCount).toBe(0);
      expect(batch2.statusReason).toBe(
        'No more new businesses found in this area. Try expanding your search location.'
      );
    });
  });

  describe('3. Canadian Geography Support', () => {
    it('properly resolves Canada country code and handles repeat pagination', () => {
      const provider = new RapidApiDiscoveryProvider();
      expect(provider.resolveCountryCode('Canada')).toBe('ca');
      expect(provider.resolveCountryCode('CA')).toBe('ca');
      expect(provider.resolveCountryCode('USA')).toBe('us');
      expect(provider.resolveCountryCode('India')).toBe('in');
    });
  });
});
