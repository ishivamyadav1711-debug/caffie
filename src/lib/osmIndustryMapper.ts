/**
 * Maps LeadPilot industry categories to OpenStreetMap (OSM) key/value tags.
 * Designed to strictly adhere to official OSM tagging conventions.
 * Includes complete variant tags (e.g. tourism=hotel, guest_house, hostel, motel, resort, building=hotel)
 * to ensure no valid businesses are omitted.
 */

export interface OsmTagCondition {
  key: string;
  value?: string; // If undefined, matches any existence of the key (e.g. shop=*)
}

export interface IndustryMapping {
  industry: string;
  osmTags: OsmTagCondition[];
  description: string;
}

export const OSM_INDUSTRY_MAPPINGS: Record<string, OsmTagCondition[]> = {
  // 1. Food & Hospitality
  'restaurant': [
    { key: 'amenity', value: 'restaurant' },
    { key: 'amenity', value: 'fast_food' }
  ],
  'restaurants': [
    { key: 'amenity', value: 'restaurant' },
    { key: 'amenity', value: 'fast_food' }
  ],
  'cafe': [
    { key: 'amenity', value: 'cafe' },
    { key: 'shop', value: 'coffee' }
  ],
  'cafes': [
    { key: 'amenity', value: 'cafe' },
    { key: 'shop', value: 'coffee' }
  ],
  'hotel': [
    { key: 'tourism', value: 'hotel' },
    { key: 'tourism', value: 'guest_house' },
    { key: 'tourism', value: 'hostel' },
    { key: 'tourism', value: 'motel' },
    { key: 'tourism', value: 'resort' },
    { key: 'building', value: 'hotel' },
    { key: 'amenity', value: 'hotel' }
  ],
  'hotels': [
    { key: 'tourism', value: 'hotel' },
    { key: 'tourism', value: 'guest_house' },
    { key: 'tourism', value: 'hostel' },
    { key: 'tourism', value: 'motel' },
    { key: 'tourism', value: 'resort' },
    { key: 'building', value: 'hotel' },
    { key: 'amenity', value: 'hotel' }
  ],

  // 2. Health & Wellness
  'hospital': [
    { key: 'amenity', value: 'hospital' },
    { key: 'healthcare', value: 'hospital' }
  ],
  'hospitals': [
    { key: 'amenity', value: 'hospital' },
    { key: 'healthcare', value: 'hospital' }
  ],
  'clinic': [
    { key: 'amenity', value: 'clinic' },
    { key: 'amenity', value: 'doctors' },
    { key: 'healthcare', value: 'clinic' }
  ],
  'clinics': [
    { key: 'amenity', value: 'clinic' },
    { key: 'amenity', value: 'doctors' },
    { key: 'healthcare', value: 'clinic' }
  ],
  'pharmacy': [
    { key: 'amenity', value: 'pharmacy' },
    { key: 'healthcare', value: 'pharmacy' },
    { key: 'shop', value: 'chemist' }
  ],
  'pharmacies': [
    { key: 'amenity', value: 'pharmacy' },
    { key: 'healthcare', value: 'pharmacy' },
    { key: 'shop', value: 'chemist' }
  ],
  'gym': [
    { key: 'leisure', value: 'fitness_centre' },
    { key: 'leisure', value: 'sports_centre' }
  ],
  'gyms': [
    { key: 'leisure', value: 'fitness_centre' },
    { key: 'leisure', value: 'sports_centre' }
  ],
  'salon': [
    { key: 'shop', value: 'hairdresser' },
    { key: 'shop', value: 'beauty' }
  ],
  'salons': [
    { key: 'shop', value: 'hairdresser' },
    { key: 'shop', value: 'beauty' }
  ],

  // 3. Education
  'school': [
    { key: 'amenity', value: 'school' },
    { key: 'building', value: 'school' }
  ],
  'schools': [
    { key: 'amenity', value: 'school' },
    { key: 'building', value: 'school' }
  ],
  'college': [
    { key: 'amenity', value: 'college' },
    { key: 'amenity', value: 'university' },
    { key: 'building', value: 'college' },
    { key: 'building', value: 'university' }
  ],
  'colleges': [
    { key: 'amenity', value: 'college' },
    { key: 'amenity', value: 'university' },
    { key: 'building', value: 'college' },
    { key: 'building', value: 'university' }
  ],
  'education': [
    { key: 'amenity', value: 'school' },
    { key: 'amenity', value: 'college' },
    { key: 'amenity', value: 'university' },
    { key: 'amenity', value: 'kindergarten' },
    { key: 'amenity', value: 'language_school' },
    { key: 'amenity', value: 'music_school' },
    { key: 'amenity', value: 'prep_school' },
    { key: 'amenity', value: 'training' },
    { key: 'amenity', value: 'research_institute' },
    { key: 'building', value: 'school' },
    { key: 'building', value: 'college' },
    { key: 'building', value: 'university' },
    { key: 'building', value: 'kindergarten' },
    { key: 'office', value: 'educational_institution' },
    { key: 'education', value: 'coaching' },
    { key: 'education', value: 'tuition' },
    { key: 'education', value: 'centre' },
    { key: 'training', value: 'vocational' }
  ],
  'coaching': [
    { key: 'amenity', value: 'prep_school' },
    { key: 'education', value: 'coaching' },
    { key: 'education', value: 'tuition' },
    { key: 'office', value: 'educational_institution' }
  ],
  'training': [
    { key: 'amenity', value: 'training' },
    { key: 'training', value: 'vocational' },
    { key: 'amenity', value: 'language_school' }
  ],
  'kindergarten': [
    { key: 'amenity', value: 'kindergarten' },
    { key: 'building', value: 'kindergarten' }
  ],

  // 4. Finance & Utilities
  'bank': [
    { key: 'amenity', value: 'bank' }
  ],
  'banks': [
    { key: 'amenity', value: 'bank' }
  ],
  'petrol pump': [
    { key: 'amenity', value: 'fuel' }
  ],
  'fuel': [
    { key: 'amenity', value: 'fuel' }
  ],

  // 5. Commerce & Retail
  'supermarket': [
    { key: 'shop', value: 'supermarket' },
    { key: 'shop', value: 'convenience' }
  ],
  'supermarkets': [
    { key: 'shop', value: 'supermarket' },
    { key: 'shop', value: 'convenience' }
  ],
  'retail': [
    { key: 'shop', value: 'supermarket' },
    { key: 'shop', value: 'convenience' },
    { key: 'shop', value: 'department_store' },
    { key: 'shop', value: 'clothes' }
  ],
  'travel agency': [
    { key: 'shop', value: 'travel_agency' },
    { key: 'office', value: 'travel_agent' }
  ],
  'travel': [
    { key: 'shop', value: 'travel_agency' },
    { key: 'office', value: 'travel_agent' },
    { key: 'tourism', value: 'information' }
  ],
  'real estate': [
    { key: 'office', value: 'estate_agent' },
    { key: 'office', value: 'real_estate' }
  ],
  'automotive': [
    { key: 'shop', value: 'car' },
    { key: 'shop', value: 'car_repair' }
  ],
  'automobile dealer': [
    { key: 'shop', value: 'car' },
    { key: 'shop', value: 'motorcycle' }
  ],
  'car dealer': [
    { key: 'shop', value: 'car' }
  ],
  'repair service': [
    { key: 'shop', value: 'car_repair' },
    { key: 'craft', value: 'electronics_repair' },
    { key: 'craft', value: 'handyman' }
  ],
  'plumber': [
    { key: 'craft', value: 'plumber' },
    { key: 'shop', value: 'plumbing' },
    { key: 'shop', value: 'trade' },
    { key: 'craft', value: 'handyman' },
    { key: 'craft', value: 'pipefitter' }
  ],
  'plumbers': [
    { key: 'craft', value: 'plumber' },
    { key: 'shop', value: 'plumbing' },
    { key: 'shop', value: 'trade' },
    { key: 'craft', value: 'handyman' },
    { key: 'craft', value: 'pipefitter' }
  ],
  'plumbing': [
    { key: 'craft', value: 'plumber' },
    { key: 'shop', value: 'plumbing' },
    { key: 'shop', value: 'trade' }
  ],
  'electrician': [
    { key: 'craft', value: 'electrician' },
    { key: 'shop', value: 'electrical' }
  ],
  'electricians': [
    { key: 'craft', value: 'electrician' },
    { key: 'shop', value: 'electrical' }
  ],
  'carpenter': [
    { key: 'craft', value: 'carpenter' }
  ],
  'carpenters': [
    { key: 'craft', value: 'carpenter' }
  ],
  'painter': [
    { key: 'craft', value: 'painter' }
  ],
  'painters': [
    { key: 'craft', value: 'painter' }
  ],
  'locksmith': [
    { key: 'craft', value: 'locksmith' }
  ],
  'locksmiths': [
    { key: 'craft', value: 'locksmith' }
  ],
  'hvac': [
    { key: 'craft', value: 'hvac' },
    { key: 'craft', value: 'air_conditioning' }
  ],
  'construction': [
    { key: 'craft', value: 'builder' },
    { key: 'office', value: 'architect' }
  ],
  'manufacturing': [
    { key: 'man_made', value: 'works' },
    { key: 'landuse', value: 'industrial' },
    { key: 'industrial', value: 'factory' },
    { key: 'craft' }
  ],
  'manufacturer': [
    { key: 'man_made', value: 'works' },
    { key: 'landuse', value: 'industrial' },
    { key: 'craft' }
  ],
  'wholesaler': [
    { key: 'shop', value: 'wholesale' },
    { key: 'wholesale', value: 'yes' },
    { key: 'office', value: 'company' }
  ],
  'wholesale': [
    { key: 'shop', value: 'wholesale' },
    { key: 'wholesale', value: 'yes' }
  ],
  'law firm': [
    { key: 'office', value: 'lawyer' },
    { key: 'office', value: 'legal' }
  ],
  'lawyer': [
    { key: 'office', value: 'lawyer' }
  ],
  'accounting': [
    { key: 'office', value: 'accountant' },
    { key: 'office', value: 'financial' }
  ],
  'accountant': [
    { key: 'office', value: 'accountant' }
  ],
  'it company': [
    { key: 'office', value: 'it' },
    { key: 'office', value: 'software' },
    { key: 'office', value: 'company' }
  ],
  'it companies': [
    { key: 'office', value: 'it' },
    { key: 'office', value: 'software' },
    { key: 'office', value: 'company' }
  ],
  'software': [
    { key: 'office', value: 'software' },
    { key: 'office', value: 'it' }
  ],
  'marketing agency': [
    { key: 'office', value: 'advertising' },
    { key: 'office', value: 'marketing' }
  ],
  'marketing': [
    { key: 'office', value: 'advertising' },
    { key: 'office', value: 'marketing' }
  ],
  'other': [
    { key: 'office', value: 'company' },
    { key: 'shop' }
  ]
};

/**
 * Returns OSM tag conditions for a given industry name (case-insensitive with exact mapping).
 */
export function getOsmTagsForIndustry(industry: string): OsmTagCondition[] {
  const normalized = industry.trim().toLowerCase();

  if (OSM_INDUSTRY_MAPPINGS[normalized]) {
    return OSM_INDUSTRY_MAPPINGS[normalized];
  }

  // Plural / singular fallback
  const singular = normalized.endsWith('s') ? normalized.slice(0, -1) : normalized;
  const plural = `${normalized}s`;

  if (OSM_INDUSTRY_MAPPINGS[singular]) {
    return OSM_INDUSTRY_MAPPINGS[singular];
  }
  if (OSM_INDUSTRY_MAPPINGS[plural]) {
    return OSM_INDUSTRY_MAPPINGS[plural];
  }

  // Comprehensive fallback for custom / unmapped industries
  const formatted = normalized.replace(/\s+/g, '_');
  return [
    { key: 'craft', value: formatted },
    { key: 'shop', value: formatted },
    { key: 'amenity', value: formatted },
    { key: 'office', value: formatted },
    { key: 'tourism', value: formatted }
  ];
}

/**
 * Builds Overpass QL filter statements for an area or bounding box.
 * Uses targeted `nwr` statements.
 */
export function buildOverpassFilters(
  tags: OsmTagCondition[],
  scope: { areaVariable?: string; bbox?: { south: number; west: number; north: number; east: number } }
): string {
  const { areaVariable, bbox } = scope;
  const targetScope = areaVariable
    ? `(area.${areaVariable})`
    : bbox
    ? `(${bbox.south.toFixed(4)},${bbox.west.toFixed(4)},${bbox.north.toFixed(4)},${bbox.east.toFixed(4)})`
    : '';

  const statements: string[] = [];
  for (const tag of tags) {
    const tagFilter = tag.value ? `["${tag.key}"="${tag.value}"]` : `["${tag.key}"]`;
    statements.push(`nwr${tagFilter}${targetScope};`);
  }

  return statements.join('\n  ');
}
