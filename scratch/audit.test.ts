import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// Load .env.local
const envPath = path.resolve('.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  }
}

import { googlePlacesDiscoveryProvider } from '../src/providers/GooglePlacesDiscoveryProvider';
import { osmOverpassProvider } from '../src/providers/OSMOverpassProvider';
import { isCoordinateInLocation, resolveIndiaLocation, MAJOR_CITIES_BOUNDS } from '../src/lib/geoResolver';
import { normalizeWebsiteFilter, classifyCandidateWebsite } from '../src/lib/audit/WebsiteStatusClassifier';
import { OSM_INDUSTRY_MAPPINGS, getOsmTagsForIndustry } from '../src/lib/osmIndustryMapper';
import { validateStateAndCity, getCitiesForState } from '../src/data/indiaLocations';
import { searchService } from '../src/services/SearchService';

describe('LEADPILOT COMPLETE AUDIT', () => {

  describe('PHASE 2 & 17 — State/City Cascading and Boundaries', () => {
    it('verifies Maharashtra and Thane in location taxonomy', () => {
      const maharashtraCities = getCitiesForState('Maharashtra');
      console.log('Maharashtra Cities count:', maharashtraCities.length);
      console.log('Includes Thane:', maharashtraCities.includes('Thane'));
      expect(maharashtraCities.includes('Thane')).toBe(true);

      const validation = validateStateAndCity('Maharashtra', 'Thane');
      console.log('Validation result for Maharashtra / Thane:', validation);
      expect(validation.valid).toBe(true);
    });

    it('inspects Thane bounding box and locality coordinates', () => {
      const bbox = MAJOR_CITIES_BOUNDS['Thane'];
      console.log('Configured Thane Bbox:', bbox);
      const naupadaInside = isCoordinateInLocation(19.188, 72.972, 'Thane', 'Maharashtra');
      const majiwadaInside = isCoordinateInLocation(19.215, 72.980, 'Thane', 'Maharashtra');
      const wagleInside = isCoordinateInLocation(19.196, 72.959, 'Thane', 'Maharashtra');
      const ghodbunderInside = isCoordinateInLocation(19.278, 72.955, 'Thane', 'Maharashtra');
      const kasarvadavaliInside = isCoordinateInLocation(19.268, 72.973, 'Thane', 'Maharashtra');
      
      console.log('Naupada Inside:', naupadaInside);
      console.log('Majiwada Inside:', majiwadaInside);
      console.log('Wagle Estate Inside:', wagleInside);
      console.log('Ghodbunder Inside:', ghodbunderInside);
      console.log('Kasarvadavali Inside:', kasarvadavaliInside);

      // What if coordinates are missing (undefined / null)?
      const missingLat = isCoordinateInLocation(undefined as any, 72.97, 'Thane', 'Maharashtra');
      console.log('Missing lat inside:', missingLat);
      expect(missingLat).toBe(false);
    });
  });

  describe('PHASE 3 — Industry Mapping & Taxonomy', () => {
    it('inspects Education mapping in OSM and Google Places', () => {
      const osmEduTags = getOsmTagsForIndustry('Education');
      console.log('OSM tags for "Education":', osmEduTags);
      const osmSchoolsTags = getOsmTagsForIndustry('School');
      console.log('OSM tags for "School":', osmSchoolsTags);

      const hasCoaching = osmEduTags.some(t => t.value?.includes('coaching'));
      const hasKindergarten = osmEduTags.some(t => t.value === 'kindergarten');
      const hasLanguageSchool = osmEduTags.some(t => t.value === 'language_school');
      const hasTraining = osmEduTags.some(t => t.value?.includes('training'));
      console.log('OSM has coaching:', hasCoaching, '| kindergarten:', hasKindergarten, '| languageSchool:', hasLanguageSchool, '| training:', hasTraining);
    });
  });

  describe('PHASE 6 — Contact Filtering Logic', () => {
    it('evaluates Phone or Email truth table', () => {
      const cases = [
        { phone: '9820012345', email: 'test@school.com', expected: true },
        { phone: '9820012345', email: undefined, expected: true },
        { phone: undefined, email: 'test@school.com', expected: true },
        { phone: undefined, email: undefined, expected: false },
        { phone: '', email: '', expected: false },
      ];

      const normContact = 'PHONE_OR_EMAIL';
      for (const c of cases) {
        const hasPhone = Boolean(c.phone && c.phone.trim().length > 0);
        const hasEmail = Boolean(c.email && c.email.trim().length > 0);
        let matchesContact = true;
        if (normContact === 'PHONE_OR_EMAIL' || normContact === 'HAS_PHONE_OR_EMAIL') {
          matchesContact = hasPhone || hasEmail;
        }
        console.log(`Phone: ${c.phone ? 'YES' : 'NO'}, Email: ${c.email ? 'YES' : 'NO'} -> Result: ${matchesContact}, Expected: ${c.expected}`);
        expect(matchesContact).toBe(c.expected);
      }
    });
  });

  describe('PHASE 7 — Website Filter Normalization & Semantics', () => {
    it('tests normalizeWebsiteFilter for all UI options', () => {
      console.log('normalize("Any Website"):', normalizeWebsiteFilter('Any Website'));
      console.log('normalize("Has Website"):', normalizeWebsiteFilter('Has Website'));
      console.log('normalize("Website Available"):', normalizeWebsiteFilter('Website Available'));
      console.log('normalize("Working"):', normalizeWebsiteFilter('Working'));
      console.log('normalize("No Website"):', normalizeWebsiteFilter('No Website'));
      console.log('normalize("Unreachable"):', normalizeWebsiteFilter('Unreachable'));
      console.log('normalize("Needs Improvement"):', normalizeWebsiteFilter('Needs Improvement'));

      const hasWebNorm = normalizeWebsiteFilter('Has Website');
      console.log('Does "Has Website" return "HAS_WEBSITE"?', hasWebNorm);
      // Notice: "Has Website" correctly maps to "HAS_WEBSITE".

      expect(hasWebNorm).toBe('HAS_WEBSITE');
    });

    it('tests classifyCandidateWebsite behavior when website is null', () => {
      const resAny = classifyCandidateWebsite(undefined, 'ANY');
      console.log('classify(null, "ANY"):', resAny.status, '| matches:', resAny.matchesFilter);
      expect(resAny.matchesFilter).toBe(true);

      const resNoWeb = classifyCandidateWebsite(undefined, 'NO_WEBSITE');
      console.log('classify(null, "NO_WEBSITE"):', resNoWeb.status, '| matches:', resNoWeb.matchesFilter);
      expect(resNoWeb.matchesFilter).toBe(true);

      const resWorking = classifyCandidateWebsite(undefined, 'WORKING');
      console.log('classify(null, "WORKING"):', resWorking.status, '| matches:', resWorking.matchesFilter, '| rejection:', resWorking.rejectionReason);
      expect(resWorking.matchesFilter).toBe(false);

      const resUnreachable = classifyCandidateWebsite(undefined, 'UNREACHABLE');
      console.log('classify(null, "UNREACHABLE"):', resUnreachable.status, '| matches:', resUnreachable.matchesFilter, '| rejection:', resUnreachable.rejectionReason);
      expect(resUnreachable.matchesFilter).toBe(false);
    });
  });

  describe('PHASE 10 — Accounting Math & Counter Discrepancy', () => {
    it('reproduces the exact negative counter math in SearchService', () => {
      const job: any = {
        discovered: 0,
        deduplicated: 0,
        enriched: 0,
        audited: 0,
        qualified: 0,
        rejectionReasons: {
          OUTSIDE_LOCATION: 4,
          MISSING_NAME: 0,
          INVALID_CATEGORY: 0,
          DUPLICATE: 0,
          NO_CONTACT: 0,
        },
        providerStats: {
          osm: { rawCount: 0 },
        },
        leads: [],
      };

      const inCityBoundsCount = job.discovered - job.rejectionReasons.OUTSIDE_LOCATION;
      console.log('Calculation inCityBoundsCount (0 - 4):', inCityBoundsCount);
      expect(inCityBoundsCount).toBe(-4);
    });
  });

  describe('PHASE 13 & 14 — Live Provider Checks', () => {
    it('checks Google Places discovery for Thane Education', async () => {
      const gRes = await googlePlacesDiscoveryProvider.discoverBusinesses({
        industry: 'Education',
        state: 'Maharashtra',
        city: 'Thane',
        country: 'India',
        limit: 10,
      });
      console.log('Live Google Places Status:', gRes.status);
      console.log('Live Google Places Raw Count:', gRes.rawCount);
      console.log('Live Google Places Errors:', gRes.errors);
      if (gRes.businesses.length > 0) {
        console.log('First Live Google Place:', gRes.businesses[0].businessName, '|', gRes.businesses[0].address);
      }
      expect(gRes.status).toBe('SUCCESS');
      expect(gRes.rawCount).toBeGreaterThan(0);
    }, 15000);

    it('checks OSM discovery for Thane Education', async () => {
      const osmRes = await osmOverpassProvider.discoverBusinesses({
        industry: 'Education',
        state: 'Maharashtra',
        city: 'Thane',
        country: 'India',
        limit: 10,
      });
      console.log('Live OSM Status:', osmRes.status);
      console.log('Live OSM Raw Count:', osmRes.rawCount);
      console.log('Live OSM Errors:', osmRes.errors);
      if (osmRes.businesses.length > 0) {
        console.log('First Live OSM Venue:', osmRes.businesses[0].businessName, '|', osmRes.businesses[0].address);
      }
      expect(['SUCCESS', 'PARTIAL', 'NO_RESULTS']).toContain(osmRes.status);
    }, 15000);
  });

  describe('PHASE 8 — End-to-End Pipeline Combinations Audit', () => {
    it('executes Test B: Education + Maharashtra + Thane + Phone OR Email + Any Website', async () => {
      const criteria = {
        country: 'India' as const,
        state: 'Maharashtra',
        city: 'Thane',
        industry: 'Education',
        contactFilter: 'Has Phone or Email' as const,
        websiteFilter: 'Any Website' as const,
        limit: 10 as const,
      };

      const res = (await searchService.startSearch(criteria, true)) as any;
      console.log('Test B Pipeline Result:');
      console.log('- Success:', res.success, '| Status:', res.status, '| SourceStatus:', res.searchStatus);
      console.log('- Leads count:', res.leads?.length);
      console.log('- Raw Discovered:', res.pipelineBreakdown?.rawDiscoveredCount, '| PipelineStats rawOsmCount:', res.pipelineStats?.rawOsmCount);
      console.log('- Normalized:', res.pipelineBreakdown?.normalizedCount);
      console.log('- Location Verified (Breakdown):', res.pipelineBreakdown?.locationVerifiedCount);
      console.log('- Location Verified (pipelineStats.inCityBoundsCount):', res.pipelineStats?.inCityBoundsCount);
      console.log('- Outside Location:', res.rejectionReasons?.OUTSIDE_LOCATION);
      console.log('- Deduplicated:', res.pipelineBreakdown?.deduplicatedCount);
      console.log('- Phone Available:', res.summary?.withPhone);
      console.log('- Email Available:', res.summary?.withEmail);
      console.log('- Phone OR Email:', res.summary?.hasPhoneOrEmail);
      console.log('- Final Qualified:', res.pipelineBreakdown?.finalQualifiedCount);
      console.log('- Google Places Status in report:', res.providers?.googlePlaces?.status);
      console.log('- OSM Status in report:', res.providers?.osm?.status);
      console.log('- Rejection Breakdown:', JSON.stringify(res.rejectionReasons));
    }, 30000);
  });
});
