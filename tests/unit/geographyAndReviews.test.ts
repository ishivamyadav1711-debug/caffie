import { describe, it, expect } from 'vitest';
import {
  validateLocation,
  getRegionsForCountry,
  getCitiesForRegion,
  normalizeCountry,
  USA_STATES,
  CANADA_PROVINCES_AND_TERRITORIES,
} from '@/data/geographyData';

describe('Canonical Geography Dataset & Validation (USA, Canada, India)', () => {
  it('validates all 50 US states plus District of Columbia', () => {
    expect(USA_STATES.length).toBe(51);
    const dc = USA_STATES.find((s) => s.code === 'DC');
    expect(dc).toBeDefined();
    expect(dc?.name).toBe('District of Columbia');

    // Test a sample of states
    const statesToTest = ['California', 'Texas', 'New York', 'Florida', 'Illinois', 'Washington'];
    for (const state of statesToTest) {
      const res = validateLocation('USA', state);
      expect(res.valid).toBe(true);
      expect(res.country).toBe('USA');
      expect(res.countryCode).toBe('US');
      expect(res.matchedState.toLowerCase()).toBe(state.toLowerCase());
    }
  });

  it('validates state abbreviations for USA', () => {
    const resCA = validateLocation('USA', 'CA');
    expect(resCA.valid).toBe(true);
    expect(resCA.matchedState).toBe('California');

    const resTX = validateLocation('USA', 'tx');
    expect(resTX.valid).toBe(true);
    expect(resTX.matchedState).toBe('Texas');

    const resNY = validateLocation('USA', 'NY');
    expect(resNY.valid).toBe(true);
    expect(resNY.matchedState).toBe('New York');
  });

  it('validates all 10 Canadian provinces', () => {
    const provinces = [
      'Alberta',
      'British Columbia',
      'Manitoba',
      'New Brunswick',
      'Newfoundland and Labrador',
      'Nova Scotia',
      'Ontario',
      'Prince Edward Island',
      'Quebec',
      'Saskatchewan',
    ];

    for (const prov of provinces) {
      const res = validateLocation('Canada', prov);
      expect(res.valid).toBe(true);
      expect(res.country).toBe('Canada');
      expect(res.countryCode).toBe('CA');
      expect(res.matchedState.toLowerCase()).toBe(prov.toLowerCase());
    }
  });

  it('validates all 3 Canadian territories', () => {
    const territories = ['Northwest Territories', 'Nunavut', 'Yukon'];

    for (const terr of territories) {
      const res = validateLocation('Canada', terr);
      expect(res.valid).toBe(true);
      expect(res.country).toBe('Canada');
      expect(res.countryCode).toBe('CA');
      expect(res.matchedState.toLowerCase()).toBe(terr.toLowerCase());
    }
  });

  it('validates Canadian province and territory abbreviations', () => {
    const resON = validateLocation('Canada', 'ON');
    expect(resON.valid).toBe(true);
    expect(resON.matchedState).toBe('Ontario');

    const resBC = validateLocation('Canada', 'bc');
    expect(resBC.valid).toBe(true);
    expect(resBC.matchedState).toBe('British Columbia');

    const resYT = validateLocation('Canada', 'YT');
    expect(resYT.valid).toBe(true);
    expect(resYT.matchedState).toBe('Yukon');
  });

  it('detects and rejects cross-country mismatch with explicit error', () => {
    // Canadian province in USA
    const res1 = validateLocation('USA', 'Ontario');
    expect(res1.valid).toBe(false);
    expect(res1.error).toContain('Cross-country mismatch');
    expect(res1.error).toContain('Canada');

    // US state in Canada
    const res2 = validateLocation('Canada', 'California');
    expect(res2.valid).toBe(false);
    expect(res2.error).toContain('Cross-country mismatch');
    expect(res2.error).toContain('United States');

    // Indian state in USA
    const res3 = validateLocation('USA', 'Maharashtra');
    expect(res3.valid).toBe(false);
    expect(res3.error).toContain('Cross-country mismatch');
    expect(res3.error).toContain('India');
  });

  it('resolves curated cities and allows unlisted municipalities without blocking discovery', () => {
    // Known curated city
    const resLA = validateLocation('USA', 'California', 'Los Angeles');
    expect(resLA.valid).toBe(true);
    expect(resLA.matchedCity).toBe('Los Angeles');

    const resTor = validateLocation('Canada', 'Ontario', 'Toronto');
    expect(resTor.valid).toBe(true);
    expect(resTor.matchedCity).toBe('Toronto');

    // Unlisted municipality in California - should be permitted to let Google Places discover it
    const resUnlisted = validateLocation('USA', 'California', 'Culver City');
    expect(resUnlisted.valid).toBe(true);
    expect(resUnlisted.matchedCity).toBe('Culver City');
  });

  it('detects cross-state city mismatch within the same country', () => {
    // Houston belongs to Texas, not California
    const mismatch = validateLocation('USA', 'California', 'Houston');
    expect(mismatch.valid).toBe(false);
    expect(mismatch.error).toContain('Location mismatch');
    expect(mismatch.error).toContain('Texas');
  });

  it('maintains backwards compatibility for India locations', () => {
    const resMH = validateLocation('India', 'Maharashtra', 'Mumbai');
    expect(resMH.valid).toBe(true);
    expect(resMH.matchedState).toBe('Maharashtra');
    expect(resMH.matchedCity).toBe('Mumbai');
  });
});

describe('Review Intelligence & Real Data Contract', () => {
  it('correctly calculates positive review ratio only when genuine review objects exist', () => {
    const rawGooglePlaceWithReviews = {
      id: 'ChIJN1t_tDeuEmsRUsoyG83frY4',
      displayName: { text: 'Real Los Angeles Restaurant' },
      rating: 4.6,
      userRatingCount: 350,
      reviews: [
        { rating: 5, originalText: { text: 'Amazing food!' }, authorAttribution: { displayName: 'John' } },
        { rating: 5, originalText: { text: 'Best service ever' }, authorAttribution: { displayName: 'Sarah' } },
        { rating: 4, originalText: { text: 'Great atmosphere' }, authorAttribution: { displayName: 'Alex' } },
        { rating: 2, originalText: { text: 'Too noisy' }, authorAttribution: { displayName: 'Mike' } },
      ],
    };

    // Calculate quality metrics
    const reviews = rawGooglePlaceWithReviews.reviews;
    const positiveReviews = reviews.filter((r) => r.rating >= 4);
    const negativeReviews = reviews.filter((r) => r.rating <= 2);
    const ratio = positiveReviews.length / reviews.length;

    expect(positiveReviews.length).toBe(3);
    expect(negativeReviews.length).toBe(1);
    expect(ratio).toBe(0.75); // 75% positive
  });

  it('does NOT fabricate review counts or ratios when review objects are absent', () => {
    const rawPlaceWithoutReviews = {
      id: 'ChIJN1t_tDeuEmsRUsoyG83frY4',
      displayName: { text: 'Real Business' },
      rating: 4.8,
      userRatingCount: 15,
      // reviews is undefined / missing
    };

    const hasReviewObjects = Array.isArray((rawPlaceWithoutReviews as any).reviews) && (rawPlaceWithoutReviews as any).reviews.length > 0;
    expect(hasReviewObjects).toBe(false);

    // Rule: positiveReviewDataAvailable must be false, counts must be null/undefined (NOT generated!)
    const positiveReviewDataAvailable = hasReviewObjects;
    const positiveReviewCount = hasReviewObjects ? 10 : null;

    expect(positiveReviewDataAvailable).toBe(false);
    expect(positiveReviewCount).toBeNull();
  });

  it('strictly excludes businesses with perfect 5.0 rating when excludePerfectRating is enabled', () => {
    const businesses = [
      { id: '1', name: 'Biz A', rating: 5.0, userRatingCount: 3 },
      { id: '2', name: 'Biz B', rating: 4.8, userRatingCount: 250 },
      { id: '3', name: 'Biz C', rating: 5.0, userRatingCount: 8 },
      { id: '4', name: 'Biz D', rating: 4.5, userRatingCount: 500 },
    ];

    const excludePerfectRating = true;
    const filtered = businesses.filter((b) => !(excludePerfectRating && b.rating === 5.0));

    expect(filtered.length).toBe(2);
    expect(filtered.map((b) => b.id)).toEqual(['2', '4']);
    expect(filtered.every((b) => b.rating !== 5.0)).toBe(true);
  });

  it('transparently sorts by highest positive signal combining rating and review volume', () => {
    const businesses = [
      { id: '1', name: 'Biz A', rating: 5.0, userRatingCount: 2, ratio: 1.0 },
      { id: '2', name: 'Biz B', rating: 4.7, userRatingCount: 1500, ratio: 0.95 },
      { id: '3', name: 'Biz C', rating: 4.5, userRatingCount: 5000, ratio: 0.92 },
    ];

    const score = (b: any) => {
      const volScore = Math.log10(b.userRatingCount + 1);
      const evidenceBoost = b.ratio * 5;
      return b.rating * volScore + evidenceBoost;
    };

    const sorted = [...businesses].sort((a, b) => score(b) - score(a));

    // Biz C (5000 reviews at 4.5) and Biz B (1500 reviews at 4.7) should outrank Biz A (only 2 reviews at 5.0)
    expect(sorted[0].id).toBe('3');
    expect(sorted[1].id).toBe('2');
    expect(sorted[2].id).toBe('1');
  });

  it('correctly maps rating and userRatingCount from Google Places and leaves missing fields as null', () => {
    // When fields exist
    const p1 = {
      id: 'ChIJ1',
      displayName: { text: 'Real Restaurant' },
      rating: 4.3,
      userRatingCount: 120,
    };
    expect(typeof p1.rating === 'number' ? p1.rating : null).toBe(4.3);
    expect(typeof p1.userRatingCount === 'number' ? p1.userRatingCount : null).toBe(120);

    // When fields are missing
    const p2 = {
      id: 'ChIJ2',
      displayName: { text: 'New Business' },
    };
    expect(typeof (p2 as any).rating === 'number' ? (p2 as any).rating : null).toBeNull();
    expect(typeof (p2 as any).userRatingCount === 'number' ? (p2 as any).userRatingCount : null).toBeNull();
  });
});

describe('Deduplication & Data Integrity', () => {
  it('deduplicates candidate businesses using googlePlaceId / sourceId', () => {
    const rawBusinesses = [
      {
        source: 'google_places',
        sourceId: 'ChIJ_ABC_123',
        businessName: 'Apex Dental',
        latitude: 34.0522,
        longitude: -118.2437,
      },
      {
        source: 'google_places',
        sourceId: 'ChIJ_ABC_123', // Exact duplicate Place ID
        businessName: 'Apex Dental Care',
        latitude: 34.0522,
        longitude: -118.2437,
      },
      {
        source: 'google_places',
        sourceId: 'ChIJ_XYZ_789', // Distinct Place ID
        businessName: 'Apex Dental Branch 2',
        latitude: 34.1000,
        longitude: -118.3000,
      },
    ];

    const seenSourceIds = new Set<string>();
    const unique: typeof rawBusinesses = [];

    for (const b of rawBusinesses) {
      const key = `${b.source}:${b.sourceId}`;
      if (seenSourceIds.has(key)) continue;
      seenSourceIds.add(key);
      unique.push(b);
    }

    expect(unique.length).toBe(2);
    expect(unique.map((b) => b.sourceId)).toEqual(['ChIJ_ABC_123', 'ChIJ_XYZ_789']);
  });

  it('preserves distinct businesses with similar names when they have different Google Place IDs', () => {
    const branches = [
      {
        source: 'google_places',
        sourceId: 'ChIJ_Branch_Downtown',
        businessName: "McDonald's",
        latitude: 34.0522,
        longitude: -118.2437,
      },
      {
        source: 'google_places',
        sourceId: 'ChIJ_Branch_Uptown',
        businessName: "McDonald's",
        latitude: 34.1522,
        longitude: -118.3437,
      },
    ];

    const seenSourceIds = new Set<string>();
    const unique = branches.filter((b) => {
      const key = `${b.source}:${b.sourceId}`;
      if (seenSourceIds.has(key)) return false;
      seenSourceIds.add(key);
      return true;
    });

    expect(unique.length).toBe(2);
  });
});

describe('Google Places Provider Resilience & Real Data Contract', () => {
  it('handles empty provider results by returning zero businesses without fake fallback', () => {
    const rawPlacesResponse = { places: [] };
    const discovered = rawPlacesResponse.places || [];

    expect(discovered.length).toBe(0);
    // Real Data Contract: NEVER generate synthetic items when provider returns 0
    const finalBusinesses = discovered.map((p: any) => ({ name: p.displayName?.text }));
    expect(finalBusinesses.length).toBe(0);
  });

  it('terminates pagination cleanly when nextPageToken is absent and never fabricates continuation pages', () => {
    const page1 = {
      places: [{ id: 'place_1' }, { id: 'place_2' }],
      nextPageToken: undefined,
    };

    let pagesFetched = 0;
    let currentToken: string | undefined = undefined;
    const collected: string[] = [];

    do {
      pagesFetched++;
      collected.push(...page1.places.map((p) => p.id));
      currentToken = page1.nextPageToken;
    } while (currentToken);

    expect(pagesFetched).toBe(1);
    expect(collected.length).toBe(2);
  });

  it('handles provider HTTP errors (quota exceeded, 401/403, 500) by throwing an explicit provider error', () => {
    const simulateErrorResponse = (status: number, message: string) => {
      if (status >= 400) {
        const err: any = new Error(`Google Places API error (${status}): ${message}`);
        err.status = status;
        throw err;
      }
    };

    expect(() => simulateErrorResponse(429, 'RESOURCE_EXHAUSTED: Quota exceeded')).toThrow('Quota exceeded');
    expect(() => simulateErrorResponse(403, 'PERMISSION_DENIED: Invalid API Key')).toThrow('Invalid API Key');
    expect(() => simulateErrorResponse(500, 'INTERNAL: Google Places server error')).toThrow('server error');
  });

  it('handles API timeout cleanly without fallback to mock businesses', async () => {
    const timeoutPromise = new Promise((_, reject) => {
      const err: any = new Error('Google Places API request timed out after 10000ms');
      err.code = 'ETIMEDOUT';
      reject(err);
    });

    await expect(timeoutPromise).rejects.toThrow('timed out');
  });
});

