import { BaseActor, ActorContext } from '@/models/Actor';
import { RawDiscoveredBusiness } from '@/providers/BusinessDiscoveryProvider';
import { isCoordinateInLocation, MAJOR_CITIES_BOUNDS, STATE_BOUNDS } from '@/lib/geoResolver';
import { INDIAN_STATES_AND_UTS, COMMON_CITY_ALIASES } from '@/data/indiaLocations';
import { normalizeCountry, USA_STATES, CANADA_PROVINCES_AND_TERRITORIES } from '@/data/geographyData';

export interface LocationVerificationInput {
  businesses: RawDiscoveredBusiness[];
  state: string;
  city?: string;
  country?: string;
}

export interface LocationVerificationOutput {
  verified: RawDiscoveredBusiness[];
  unknown: RawDiscoveredBusiness[];
  rejected: { business: RawDiscoveredBusiness; reason: string }[];
}

const ALL_STATES_UTS: string[] = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa',
  'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala',
  'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland',
  'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura',
  'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry'
];

const ALL_STATES_UTS_SORTED = [...ALL_STATES_UTS].sort((a, b) => b.length - a.length);

const STATE_CODE_ALIASES: Record<string, string> = {
  'mh': 'maharashtra',
  'up': 'uttar pradesh',
  'dl': 'delhi',
  'ka': 'karnataka',
  'tn': 'tamil nadu',
  'gj': 'gujarat',
  'rj': 'rajasthan',
  'wb': 'west bengal',
  'tg': 'telangana',
  'ts': 'telangana',
  'kl': 'kerala',
  'mp': 'madhya pradesh',
  'hr': 'haryana',
  'pb': 'punjab',
  'br': 'bihar',
  'od': 'odisha',
  'ap': 'andhra pradesh',
  'as': 'assam',
  'jh': 'jharkhand',
  'cg': 'chhattisgarh',
  'ct': 'chhattisgarh',
  'uk': 'uttarakhand',
  'ut': 'uttarakhand',
  'hp': 'himachal pradesh',
  'jk': 'jammu and kashmir',
  'ch': 'chandigarh',
  'ga': 'goa',
};

const GENERIC_EXCLUSIONS = new Set(['industrial area', 'sector 17', 'sector 35', 'mon']);

// Build City-to-State lookup map
const cityToStateMap = new Map<string, string>();

for (const s of INDIAN_STATES_AND_UTS) {
  const sName = s.name.toLowerCase();
  for (const c of s.cities) {
    const cLow = c.toLowerCase().trim();
    if (GENERIC_EXCLUSIONS.has(cLow)) continue;
    cityToStateMap.set(cLow, sName);
  }
}

for (const [key, bbox] of Object.entries(MAJOR_CITIES_BOUNDS)) {
  const cLow = key.toLowerCase().trim();
  if (!cityToStateMap.has(cLow)) {
    for (const [st, sBounds] of Object.entries(STATE_BOUNDS)) {
      if (bbox.centerLat >= sBounds.south && bbox.centerLat <= sBounds.north &&
          bbox.centerLon >= sBounds.west && bbox.centerLon <= sBounds.east) {
        cityToStateMap.set(cLow, st.toLowerCase());
        break;
      }
    }
  }
}

for (const [alias, canonical] of Object.entries(COMMON_CITY_ALIASES)) {
  const cLow = canonical.toLowerCase().trim();
  const aLow = alias.toLowerCase().trim();
  if (cityToStateMap.has(cLow)) {
    cityToStateMap.set(aLow, cityToStateMap.get(cLow)!);
  }
}

const ALL_CITIES_SORTED = Array.from(cityToStateMap.keys()).sort((a, b) => b.length - a.length);

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function containsWord(text: string, word: string): boolean {
  if (!text || !word) return false;
  const regex = new RegExp(`(^|[^a-zA-Z0-9])${escapeRegex(word)}([^a-zA-Z0-9]|$)`, 'i');
  return regex.test(text);
}

function normalizeState(stateStr: string): string {
  const clean = stateStr.trim().toLowerCase();
  return STATE_CODE_ALIASES[clean] || clean;
}

function isKnownIndianState(stateStr: string): boolean {
  if (!stateStr) return false;
  const norm = normalizeState(stateStr);
  return ALL_STATES_UTS.some(s => s.toLowerCase() === norm);
}

function isTargetStateMatch(stateStr: string, reqState: string): boolean {
  if (!stateStr || !reqState) return false;
  const sNorm = normalizeState(stateStr);
  const rNorm = normalizeState(reqState);
  if (sNorm === rNorm) return true;
  if (rNorm.includes(sNorm) || sNorm.includes(rNorm)) return true;
  return false;
}

function isTargetCityMatch(candidateCity: string, reqCity: string): boolean {
  if (!candidateCity || !reqCity) return false;
  const c = candidateCity.trim().toLowerCase();
  const r = reqCity.trim().toLowerCase();
  if (c === r) return true;

  // Distinct city distinction
  if (r === 'mumbai' && c.includes('navi mumbai')) return false;
  if (r === 'navi mumbai' && !c.includes('navi mumbai')) return false;
  if (r === 'noida' && c.includes('greater noida')) return false;
  if (r === 'greater noida' && !c.includes('greater noida')) return false;

  // Check COMMON_CITY_ALIASES
  const rAlias = COMMON_CITY_ALIASES[r]?.toLowerCase();
  if (rAlias && (c === rAlias || c.includes(rAlias))) return true;
  const cAlias = COMMON_CITY_ALIASES[c]?.toLowerCase();
  if (cAlias && (r === cAlias || r.includes(cAlias))) return true;

  // Substring/word match (e.g. "Thane West" matches "Thane", "Bengaluru South" matches "Bengaluru")
  if (c.startsWith(r) || r.startsWith(c) || containsWord(c, r) || containsWord(r, c)) return true;
  return false;
}

function isTargetCityInAddress(addr: string, reqCity: string): boolean {
  if (!addr || !reqCity) return false;
  const a = addr.trim().toLowerCase();
  const r = reqCity.trim().toLowerCase();

  // Distinct city distinction
  if (r === 'mumbai' && containsWord(a, 'navi mumbai') && !containsWord(a.replace(/navi\s+mumbai/gi, ''), 'mumbai')) {
    return false;
  }
  if (r === 'noida' && containsWord(a, 'greater noida') && !containsWord(a.replace(/greater\s+noida/gi, ''), 'noida')) {
    return false;
  }

  // Direct word match
  if (containsWord(a, r)) return true;

  // Alias match
  const rAlias = COMMON_CITY_ALIASES[r]?.toLowerCase();
  if (rAlias && containsWord(a, rAlias)) return true;

  return false;
}

function findExternalState(text: string, targetState: string): string | null {
  if (!text) return null;
  const normTarget = normalizeState(targetState);
  for (const s of ALL_STATES_UTS_SORTED) {
    const sNorm = s.toLowerCase();
    if (sNorm === normTarget) continue;
    if (containsWord(text, sNorm)) {
      return s;
    }
  }
  return null;
}

function isKnownExternalCity(cityStr: string, reqCity: string, reqState: string): boolean {
  if (!cityStr) return false;
  const cClean = cityStr.trim().toLowerCase();
  if (isTargetCityMatch(cClean, reqCity)) return false;
  if (cityToStateMap.has(cClean)) return true;
  return false;
}

function findExternalCity(text: string, reqCity: string, reqState: string): string | null {
  if (!text) return null;
  for (const c of ALL_CITIES_SORTED) {
    if (isTargetCityMatch(c, reqCity)) continue;
    if (c.length < 4) continue;
    if (containsWord(text, c)) {
      return c;
    }
  }
  return null;
}

function findCityInState(text: string, reqState: string): string | null {
  if (!text) return null;
  const normState = normalizeState(reqState);
  for (const c of ALL_CITIES_SORTED) {
    if (c.length < 4) continue;
    const cityState = cityToStateMap.get(c);
    if (cityState === normState) {
      if (containsWord(text, c)) {
        return c;
      }
    }
  }
  return null;
}

function findExternalCityForState(text: string, reqState: string): string | null {
  if (!text) return null;
  const normState = normalizeState(reqState);
  for (const c of ALL_CITIES_SORTED) {
    if (c.length < 4) continue;
    const cityState = cityToStateMap.get(c);
    if (cityState && cityState !== normState) {
      if (containsWord(text, c)) {
        return c;
      }
    }
  }
  return null;
}

export class LocationVerificationActor extends BaseActor<LocationVerificationInput, LocationVerificationOutput> {
  readonly actorId = 'actor_location_verification';
  readonly name = 'Location Verification Actor';
  readonly priority = 'HIGH' as const;
  readonly blocking = true;
  readonly timeoutMs = 2000;
  readonly dependencies = ['actor_business_discovery'];

  protected async run(context: ActorContext<LocationVerificationInput>): Promise<{
    data: LocationVerificationOutput;
    sources: string[];
  }> {
    const { businesses, state, city, country } = context.input;
    const normCountry = normalizeCountry(country || 'India') || 'India';
    context.onProgress?.(`Verifying geographic boundaries (${normCountry}) for ${businesses.length} candidates...`);

    const verified: RawDiscoveredBusiness[] = [];
    const unknown: RawDiscoveredBusiness[] = [];
    const rejected: { business: RawDiscoveredBusiness; reason: string }[] = [];

    const targetCity = city && city.trim().toLowerCase() !== 'all cities in this state' && city.trim().toLowerCase() !== 'all cities in this province' ? city.trim() : undefined;
    const reqCityLower = targetCity ? targetCity.toLowerCase() : '';
    const reqStateLower = state ? state.trim().toLowerCase() : '';

    const US_STATE_NAMES = [
      'alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado', 'connecticut', 'delaware', 'florida',
      'georgia', 'hawaii', 'idaho', 'illinois', 'indiana', 'iowa', 'kansas', 'kentucky', 'louisiana', 'maine',
      'maryland', 'massachusetts', 'michigan', 'minnesota', 'mississippi', 'missouri', 'montana', 'nebraska',
      'nevada', 'new hampshire', 'new jersey', 'new mexico', 'new york', 'north carolina', 'north dakota',
      'ohio', 'oklahoma', 'oregon', 'pennsylvania', 'rhode island', 'south carolina', 'south dakota', 'tennessee',
      'texas', 'utah', 'vermont', 'virginia', 'washington', 'west virginia', 'wisconsin', 'wyoming'
    ];

    const US_MAJOR_CITIES = [
      'atlanta', 'los angeles', 'chicago', 'houston', 'phoenix', 'philadelphia', 'san antonio', 'san diego',
      'dallas', 'san jose', 'austin', 'seattle', 'denver', 'boston', 'san francisco', 'miami', 'las vegas'
    ];

    const CANADIAN_PROVINCES = [
      'ontario', 'quebec', 'british columbia', 'alberta', 'manitoba', 'saskatchewan', 'nova scotia',
      'new brunswick', 'newfoundland', 'prince edward island', 'northwest territories', 'yukon', 'nunavut'
    ];

    const CANADIAN_MAJOR_CITIES = [
      'toronto', 'montreal', 'vancouver', 'calgary', 'edmonton', 'ottawa', 'winnipeg', 'quebec city', 'halifax'
    ];

    const INDIAN_MAJOR_CITIES = [
      'mumbai', 'delhi', 'bengaluru', 'bangalore', 'hyderabad', 'chennai', 'kolkata', 'pune', 'ahmedabad',
      'jaipur', 'surat', 'lucknow', 'kanpur', 'nagpur', 'indore', 'thane', 'bhopal', 'visakhapatnam', 'patna',
      'vadodara', 'ghaziabad', 'ludhiana', 'agra', 'nashik', 'faridabad', 'meerut', 'rajkot', 'varanasi',
      'srinagar', 'aurangabad', 'dhanbad', 'amritsar', 'navi mumbai', 'allahabad', 'prayagraj', 'ranchi',
      'howrah', 'coimbatore', 'jabalpur', 'gwalior', 'vijayawada', 'jodhpur', 'madurai', 'raipur', 'kota',
      'chandigarh', 'guwahati', 'solapur', 'hubli', 'dharwad', 'mysore', 'mysuru', 'tiruchirappalli', 'bareilly',
      'aligarh', 'tiruppur', 'gurugram', 'gurgaon', 'moradabad', 'jalandhar', 'bhubaneswar', 'salem', 'warangal',
      'mira bhayandar', 'jalgaon', 'guntur', 'thiruvananthapuram', 'kochi', 'noida', 'greater noida'
    ];

    for (const b of businesses) {
      const addrLower = (b.address || '').toLowerCase();
      const cityTagLower = (b.city || b.rawTags?.['addr:city'] || '').toLowerCase().trim();
      const stateTagLower = (b.state || b.rawTags?.['addr:state'] || '').toLowerCase().trim();
      const countryTagLower = (b.country || (b as any).country || b.rawTags?.country || '').toLowerCase().trim();

      const hasCoords = typeof b.latitude === 'number' &&
        typeof b.longitude === 'number' &&
        !isNaN(b.latitude) &&
        !isNaN(b.longitude) &&
        (b.latitude !== 0 || b.longitude !== 0);

      // --- 1. STRICT CROSS-COUNTRY VALIDATION ---
      if (normCountry === 'India') {
        // Must reject if candidate country explicitly indicates non-India
        if (countryTagLower && !countryTagLower.includes('in') && !countryTagLower.includes('india')) {
          rejected.push({ business: b, reason: 'OUTSIDE_LOCATION' });
          continue;
        }

        // Must reject if address contains foreign indicators (USA, Canada, US states, US cities)
        if (
          addrLower.includes(', usa') ||
          addrLower.includes(', united states') ||
          addrLower.includes(', canada') ||
          addrLower.includes(', mexico') ||
          addrLower.includes(', uk') ||
          US_MAJOR_CITIES.some((uc) => containsWord(addrLower, uc)) ||
          CANADIAN_MAJOR_CITIES.some((cc) => containsWord(addrLower, cc)) ||
          US_STATE_NAMES.some((us) => containsWord(addrLower, us)) ||
          /\b[A-Z]{2}\s+\d{5}(-\d{4})?\b/i.test(b.address || '')
        ) {
          rejected.push({ business: b, reason: 'OUTSIDE_LOCATION' });
          continue;
        }

        // Coordinates check: must fall within India envelope
        if (hasCoords) {
          const inBounds = isCoordinateInLocation(b.latitude!, b.longitude!, targetCity, state, 'India');
          if (!inBounds) {
            rejected.push({ business: b, reason: 'OUTSIDE_LOCATION' });
            continue;
          }
        }
      } else if (normCountry === 'USA') {
        // Must reject if candidate country explicitly indicates non-USA
        if (countryTagLower && !countryTagLower.includes('us') && !countryTagLower.includes('united states') && !countryTagLower.includes('usa')) {
          rejected.push({ business: b, reason: 'OUTSIDE_LOCATION' });
          continue;
        }

        // Must reject if address indicates India, Canada, or Indian states/cities
        if (
          addrLower.includes(', canada') ||
          addrLower.includes(', india') ||
          addrLower.includes(', in') ||
          addrLower.includes(', mexico') ||
          CANADIAN_MAJOR_CITIES.some((cc) => containsWord(addrLower, cc)) ||
          CANADIAN_PROVINCES.some((cp) => containsWord(addrLower, cp)) ||
          INDIAN_MAJOR_CITIES.some((ic) => containsWord(addrLower, ic)) ||
          isKnownIndianState(addrLower) ||
          /\b\d{6}\b/.test(b.address || '')
        ) {
          rejected.push({ business: b, reason: 'OUTSIDE_LOCATION' });
          continue;
        }

        // Coordinates check: must fall within USA envelope
        if (hasCoords) {
          const inBounds = isCoordinateInLocation(b.latitude!, b.longitude!, targetCity, state, 'USA');
          if (!inBounds) {
            rejected.push({ business: b, reason: 'OUTSIDE_LOCATION' });
            continue;
          }
        }
      } else if (normCountry === 'Canada') {
        // Must reject if candidate country explicitly indicates non-Canada
        if (countryTagLower && !countryTagLower.includes('ca') && !countryTagLower.includes('canada')) {
          rejected.push({ business: b, reason: 'OUTSIDE_LOCATION' });
          continue;
        }

        // Must reject if address indicates USA or India
        if (
          addrLower.includes(', usa') ||
          addrLower.includes(', united states') ||
          addrLower.includes(', india') ||
          US_MAJOR_CITIES.some((uc) => containsWord(addrLower, uc)) ||
          US_STATE_NAMES.some((us) => containsWord(addrLower, us)) ||
          INDIAN_MAJOR_CITIES.some((ic) => containsWord(addrLower, ic)) ||
          isKnownIndianState(addrLower)
        ) {
          rejected.push({ business: b, reason: 'OUTSIDE_LOCATION' });
          continue;
        }

        // Coordinates check: must fall within Canada envelope
        if (hasCoords) {
          const inBounds = isCoordinateInLocation(b.latitude!, b.longitude!, targetCity, state, 'Canada');
          if (!inBounds) {
            rejected.push({ business: b, reason: 'OUTSIDE_LOCATION' });
            continue;
          }
        }
      }

      // --- 2. STRICT CROSS-STATE / REGION VALIDATION ---
      if (normCountry === 'USA' || normCountry === 'Canada') {
        const regions = normCountry === 'USA' ? USA_STATES : CANADA_PROVINCES_AND_TERRITORIES;
        const targetRegion = regions.find(
          (r) => r.name.toLowerCase() === reqStateLower || r.code.toLowerCase() === reqStateLower
        );
        const targetStateName = targetRegion ? targetRegion.name.toLowerCase() : reqStateLower;
        const targetStateCode = targetRegion ? targetRegion.code.toLowerCase() : '';

        // Check if address or state tag indicates a different US state or Canadian province
        let conflictingStateFound = false;
        for (const other of regions) {
          if (other.name.toLowerCase() === targetStateName || other.code.toLowerCase() === targetStateCode) continue;
          const otherName = other.name.toLowerCase();
          const otherCodeComma = `, ${other.code.toLowerCase()}`;
          const otherCodeZip = new RegExp(`\\b${other.code.toLowerCase()}\\s+\\d{5}`, 'i');
          if (containsWord(addrLower, otherName) || addrLower.includes(otherCodeComma) || otherCodeZip.test(addrLower) || stateTagLower === otherName || stateTagLower === other.code.toLowerCase()) {
            conflictingStateFound = true;
            break;
          }
        }

        if (conflictingStateFound) {
          rejected.push({ business: b, reason: 'OUTSIDE_LOCATION' });
          continue;
        }

        // --- 3. STRICT CITY VALIDATION FOR USA / CANADA ---
        if (targetCity) {
          const isCityInAddr = containsWord(addrLower, reqCityLower) || addrLower.includes(reqCityLower);
          const isCityTag = cityTagLower === reqCityLower || isTargetCityMatch(cityTagLower, reqCityLower);

          if (isCityInAddr || isCityTag) {
            verified.push(b);
          } else {
            // Check if address specifies another known city in the same region
            const otherCity = targetRegion?.cities.find((c) => {
              const cLow = c.toLowerCase();
              return cLow !== reqCityLower && containsWord(addrLower, cLow);
            });
            if (otherCity) {
              rejected.push({ business: b, reason: 'OUTSIDE_LOCATION' });
            } else if (hasCoords && isCoordinateInLocation(b.latitude!, b.longitude!, targetCity, state, normCountry)) {
              // Valid coordinates within target city bounds
              verified.push(b);
            } else {
              // Target city not verified in address or coordinates
              rejected.push({ business: b, reason: 'OUTSIDE_LOCATION' });
            }
          }
        } else {
          // Region-wide search
          verified.push(b);
        }
      } else {
        // --- 4. INDIA STATE & CITY VALIDATION ---
        if (targetCity) {
          const isCityTagMatch = isTargetCityMatch(cityTagLower, reqCityLower);
          const isAddrCityMatch = isTargetCityInAddress(addrLower, reqCityLower);

          const candStateStr = (b.state || b.rawTags?.['addr:state'] || '').trim().toLowerCase();
          const hasExternalStateTag = Boolean(candStateStr && !isTargetStateMatch(candStateStr, reqStateLower) && isKnownIndianState(candStateStr));
          const externalStateInAddr = findExternalState(addrLower, reqStateLower);

          if (hasExternalStateTag || externalStateInAddr) {
            rejected.push({ business: b, reason: 'OUTSIDE_LOCATION' });
            continue;
          }

          if (isKnownExternalCity(cityTagLower, reqCityLower, state)) {
            rejected.push({ business: b, reason: 'OUTSIDE_LOCATION' });
            continue;
          }

          const externalCityInAddr = findExternalCity(addrLower, reqCityLower, reqStateLower);
          if (externalCityInAddr) {
            rejected.push({ business: b, reason: 'OUTSIDE_LOCATION' });
            continue;
          }

          if (isCityTagMatch || isAddrCityMatch) {
            verified.push(b);
          } else if (hasCoords && isCoordinateInLocation(b.latitude!, b.longitude!, targetCity, state, 'India')) {
            verified.push(b);
          } else {
            // Target city evidence missing or not matching
            rejected.push({ business: b, reason: 'OUTSIDE_LOCATION' });
          }
        } else {
          // State-only search in India
          const candStateStr = (b.state || b.rawTags?.['addr:state'] || '').trim().toLowerCase();
          const isStateTagMatch = candStateStr ? isTargetStateMatch(candStateStr, reqStateLower) : false;
          const isAddrStateMatch = containsWord(addrLower, reqStateLower);
          const cityInTargetState = findCityInState(cityTagLower || addrLower, reqStateLower);

          const hasExternalStateTag = Boolean(candStateStr && !isTargetStateMatch(candStateStr, reqStateLower) && isKnownIndianState(candStateStr));
          const externalStateInAddr = findExternalState(addrLower, reqStateLower);

          if (hasExternalStateTag || externalStateInAddr) {
            rejected.push({ business: b, reason: 'OUTSIDE_LOCATION' });
            continue;
          }

          const externalCityOtherState = findExternalCityForState(cityTagLower || addrLower, reqStateLower);
          if (externalCityOtherState) {
            rejected.push({ business: b, reason: 'OUTSIDE_LOCATION' });
            continue;
          }

          if (isStateTagMatch || isAddrStateMatch || cityInTargetState) {
            verified.push(b);
          } else if (hasCoords && isCoordinateInLocation(b.latitude!, b.longitude!, undefined, state, 'India')) {
            verified.push(b);
          } else {
            unknown.push(b);
          }
        }
      }
    }

    context.onProgress?.(`Location verification complete (${normCountry}): ${verified.length} verified, ${unknown.length} unknown, ${rejected.length} outside bounds.`);

    return {
      data: { verified, unknown, rejected },
      sources: ['Municipal Boundary Verifier'],
    };
  }
}

export const locationVerificationActor = new LocationVerificationActor();
