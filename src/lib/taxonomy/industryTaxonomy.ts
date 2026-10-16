/**
 * Canonical Industry Taxonomy & Multi-Provider Category Normalizer
 * 
 * LeadPilot is an India-wide lead discovery platform.
 * This taxonomy provides generalized, strict mapping and validation across:
 * - Google Places (New & Legacy API types)
 * - OpenStreetMap (OSM tags & values)
 * - Business name keyword signals & disambiguation
 * 
 * Guarantees that searches for one industry (e.g. "Real Estate") NEVER
 * deliver unrelated businesses (e.g. "vegetarian_restaurant", "farm", "finance").
 */

export type CanonicalIndustryId =
  | 'real_estate'
  | 'restaurant'
  | 'cafe'
  | 'hotel'
  | 'hospital'
  | 'clinic'
  | 'school'
  | 'gym'
  | 'salon'
  | 'retail'
  | 'automotive'
  | 'travel'
  | 'construction'
  | 'finance'
  | 'law_firm'
  | 'pharmacy'
  | 'it_software'
  | 'other';

export interface CanonicalIndustryDefinition {
  id: CanonicalIndustryId;
  displayName: string;
  aliases: string[];
  allowedGoogleTypes: string[];
  forbiddenGoogleTypes: string[];
  osmTags: { key: string; value?: string }[];
  positiveNameKeywords: string[];
  negativeNameKeywords: string[];
  discoveryQueryExpansions: string[];
  defaultCategoryLabel: string;
}

export const CANONICAL_INDUSTRIES: Record<CanonicalIndustryId, CanonicalIndustryDefinition> = {
  real_estate: {
    id: 'real_estate',
    displayName: 'Real Estate',
    aliases: [
      'real estate',
      'realestate',
      'real_estate',
      'property',
      'properties',
      'realtor',
      'realtors',
      'property dealer',
      'property dealers',
      'estate agent',
      'estate agents',
      'property consultant',
      'property consultants',
      'real estate consultant',
      'real estate consultants',
      'real estate developer',
      'real estate developers',
      'property management',
      'real estate broker',
      'real estate brokers',
    ],
    allowedGoogleTypes: [
      'real_estate_agency',
      'estate_agent',
      'real_estate',
      'property_management',
      'housing_complex',
      'apartment_building',
      'apartment_complex',
      'condominium_complex',
      'housing_development',
      'real_estate_developer',
      'property_consultant',
      'property_dealer',
      'real_estate_consultant',
      'real_estate_broker',
      'builder',
      'developer',
      'real_estate_appraiser',
      'mortgage_broker',
    ],
    forbiddenGoogleTypes: [
      'restaurant',
      'vegetarian_restaurant',
      'indian_restaurant',
      'fast_food_restaurant',
      'cafe',
      'bar',
      'food',
      'bakery',
      'meal_takeaway',
      'meal_delivery',
      'hotel',
      'motel',
      'lodging',
      'resort_hotel',
      'guest_house',
      'hostel',
      'hospital',
      'medical_clinic',
      'doctor',
      'pharmacy',
      'dentist',
      'physiotherapist',
      'gym',
      'fitness_center',
      'beauty_salon',
      'hair_salon',
      'spa',
      'school',
      'primary_school',
      'secondary_school',
      'university',
      'preschool',
      'clothing_store',
      'supermarket',
      'grocery_store',
      'shopping_mall',
      'car_dealer',
      'car_repair',
      'auto_parts_store',
      'gas_station',
      'travel_agency',
      'tourist_attraction',
      'farm',
      'association_or_organization',
      'place_of_worship',
      'church',
      'mosque',
      'hindu_temple',
      'bank',
      'atm',
    ],
    osmTags: [
      { key: 'office', value: 'estate_agent' },
      { key: 'office', value: 'real_estate' },
      { key: 'shop', value: 'estate_agent' },
    ],
    positiveNameKeywords: [
      'real estate',
      'properties',
      'property',
      'realty',
      'realtor',
      'realtors',
      'housing',
      'developers',
      'developer',
      'buildcon',
      'infratech',
      'infra',
      'estates',
      'estate',
      'villas',
      'flats',
      'apartments',
      'plots',
      'colonizers',
      'township',
      'lands',
      'promoters',
      'homes',
      'group housing',
      'realcon',
      'spaces',
      'land developers',
    ],
    negativeNameKeywords: [
      'restaurant',
      'dhaba',
      'cafe',
      'hotel',
      'hospital',
      'clinic',
      'school',
      'salon',
      'motors',
      'bhojanalaya',
      'sweets',
      'jewellers',
      'pharmacy',
      'bakery',
      'bar',
      'pub',
      'resort',
      'lodge',
      'gym',
      'fitness',
    ],
    discoveryQueryExpansions: [
      'Real Estate in',
      'Real Estate Agents in',
      'Property Dealers in',
      'Real Estate Developers in',
      'Builders and Developers in',
      'Real Estate Consultants in',
      'Property Management in',
      'Commercial Real Estate in',
    ],
    defaultCategoryLabel: 'Real Estate Agency',
  },

  restaurant: {
    id: 'restaurant',
    displayName: 'Restaurants',
    aliases: ['restaurant', 'restaurants', 'food', 'dining', 'eatery', 'eateries', 'dhaba'],
    allowedGoogleTypes: [
      'restaurant',
      'cafe',
      'food',
      'bakery',
      'bar',
      'meal_delivery',
      'meal_takeaway',
      'fast_food_restaurant',
      'indian_restaurant',
      'vegetarian_restaurant',
      'pizza_restaurant',
      'chinese_restaurant',
      'seafood_restaurant',
      'ice_cream_shop',
      'diner',
      'bistro',
      'tea_house',
    ],
    forbiddenGoogleTypes: [
      'real_estate_agency',
      'hospital',
      'doctor',
      'pharmacy',
      'school',
      'university',
      'car_dealer',
      'car_repair',
      'gym',
      'lawyer',
      'bank',
      'hardware_store',
      'construction_company',
    ],
    osmTags: [
      { key: 'amenity', value: 'restaurant' },
      { key: 'amenity', value: 'fast_food' },
      { key: 'amenity', value: 'food_court' },
    ],
    positiveNameKeywords: [
      'restaurant',
      'dhaba',
      'cafe',
      'bhojanalaya',
      'kitchen',
      'dining',
      'food',
      'bistro',
      'pizzeria',
      'bakery',
      'sweets',
      'fast food',
      'caterers',
      'rasoi',
      'tandoor',
      'biryani',
      'grill',
      'treat',
    ],
    negativeNameKeywords: ['hospital', 'clinic', 'school', 'real estate', 'properties', 'motors', 'hardware'],
    discoveryQueryExpansions: [
      'Restaurants in',
      'Family Dining Restaurants in',
      'Vegetarian Restaurants in',
      'Cafes and Restaurants in',
      'Fast Food and Eateries in',
    ],
    defaultCategoryLabel: 'Restaurant',
  },

  cafe: {
    id: 'cafe',
    displayName: 'Cafes',
    aliases: ['cafe', 'cafes', 'coffee shop', 'coffee'],
    allowedGoogleTypes: ['cafe', 'coffee_shop', 'bakery', 'tea_house', 'restaurant'],
    forbiddenGoogleTypes: ['hospital', 'real_estate_agency', 'school', 'car_repair', 'gym'],
    osmTags: [
      { key: 'amenity', value: 'cafe' },
      { key: 'shop', value: 'coffee' },
    ],
    positiveNameKeywords: ['cafe', 'coffee', 'espresso', 'bakery', 'tea', 'brew', 'roastery'],
    negativeNameKeywords: ['hospital', 'clinic', 'school', 'real estate', 'properties', 'motors'],
    discoveryQueryExpansions: ['Cafes in', 'Coffee Shops in', 'Bakeries and Cafes in'],
    defaultCategoryLabel: 'Cafe',
  },

  hotel: {
    id: 'hotel',
    displayName: 'Hotels',
    aliases: ['hotel', 'hotels', 'resort', 'resorts', 'lodging', 'guest house', 'inn'],
    allowedGoogleTypes: [
      'hotel',
      'motel',
      'lodging',
      'resort_hotel',
      'guest_house',
      'hostel',
      'bed_and_breakfast',
      'inn',
    ],
    forbiddenGoogleTypes: ['hospital', 'doctor', 'school', 'car_repair', 'real_estate_agency'],
    osmTags: [
      { key: 'tourism', value: 'hotel' },
      { key: 'tourism', value: 'guest_house' },
      { key: 'tourism', value: 'hostel' },
      { key: 'tourism', value: 'resort' },
      { key: 'tourism', value: 'motel' },
      { key: 'building', value: 'hotel' },
    ],
    positiveNameKeywords: ['hotel', 'resort', 'palace', 'inn', 'guest house', 'homestay', 'motel', 'hostel', 'suites', 'haveli', 'residency'],
    negativeNameKeywords: ['hospital', 'clinic', 'school', 'real estate', 'properties'],
    discoveryQueryExpansions: ['Hotels in', 'Resorts and Hotels in', 'Guest Houses in', 'Boutique Hotels in'],
    defaultCategoryLabel: 'Hotel',
  },

  hospital: {
    id: 'hospital',
    displayName: 'Hospitals',
    aliases: ['hospital', 'hospitals', 'healthcare', 'medical center'],
    allowedGoogleTypes: [
      'hospital',
      'medical_clinic',
      'doctor',
      'health',
      'general_hospital',
      'private_hospital',
      'nursing_home',
      'medical_center',
    ],
    forbiddenGoogleTypes: [
      'restaurant',
      'cafe',
      'bar',
      'real_estate_agency',
      'hotel',
      'car_dealer',
      'clothing_store',
      'supermarket',
    ],
    osmTags: [
      { key: 'amenity', value: 'hospital' },
      { key: 'healthcare', value: 'hospital' },
    ],
    positiveNameKeywords: [
      'hospital',
      'multispeciality',
      'nursing home',
      'medical center',
      'medical centre',
      'healthcare',
      'care hospital',
      'maternity home',
      'eye hospital',
      'trauma centre',
      'heart institute',
      'research institute',
    ],
    negativeNameKeywords: ['restaurant', 'cafe', 'hotel', 'dhaba', 'resort', 'real estate', 'properties'],
    discoveryQueryExpansions: [
      'Hospitals in',
      'Multi Speciality Hospitals in',
      'Nursing Homes in',
      'Medical Centers in',
      'Clinics and Hospitals in',
    ],
    defaultCategoryLabel: 'Hospital',
  },

  clinic: {
    id: 'clinic',
    displayName: 'Clinics',
    aliases: ['clinic', 'clinics', 'doctors', 'doctor', 'polyclinic', 'dentist', 'dentists', 'dental'],
    allowedGoogleTypes: ['clinic', 'medical_clinic', 'doctor', 'dentist', 'dentists', 'dental_clinic', 'physiotherapist', 'hospital', 'health'],
    forbiddenGoogleTypes: ['restaurant', 'cafe', 'real_estate_agency', 'hotel', 'car_repair', 'clothing_store'],
    osmTags: [
      { key: 'amenity', value: 'clinic' },
      { key: 'amenity', value: 'doctors' },
      { key: 'healthcare', value: 'clinic' },
      { key: 'healthcare', value: 'doctor' },
    ],
    positiveNameKeywords: ['clinic', 'polyclinic', 'dental', 'dentist', 'dentists', 'dispensary', 'doctor', 'physician', 'homeopathy', 'ayurvedic clinic', 'orthopedic', 'eye clinic', 'skin clinic', 'care clinic'],
    negativeNameKeywords: ['restaurant', 'dhaba', 'hotel', 'real estate', 'properties'],
    discoveryQueryExpansions: ['Clinics in', 'Dental Clinics in', 'Doctors and Clinics in', 'Polyclinics in'],
    defaultCategoryLabel: 'Medical Clinic',
  },

  school: {
    id: 'school',
    displayName: 'Education',
    aliases: ['school', 'schools', 'education', 'college', 'colleges', 'academy', 'institute'],
    allowedGoogleTypes: [
      'school',
      'primary_school',
      'secondary_school',
      'high_school',
      'university',
      'college',
      'preschool',
      'educational_institution',
    ],
    forbiddenGoogleTypes: ['restaurant', 'bar', 'hotel', 'real_estate_agency', 'car_dealer', 'hospital'],
    osmTags: [
      { key: 'amenity', value: 'school' },
      { key: 'amenity', value: 'college' },
      { key: 'amenity', value: 'university' },
      { key: 'building', value: 'school' },
    ],
    positiveNameKeywords: ['school', 'academy', 'college', 'vidyalaya', 'public school', 'international school', 'high school', 'institute', 'university', 'coaching', 'classes', 'gurukul'],
    negativeNameKeywords: ['restaurant', 'hotel', 'real estate', 'properties', 'hospital'],
    discoveryQueryExpansions: ['Schools in', 'Colleges and Institutes in', 'Coaching Institutes in', 'International Schools in'],
    defaultCategoryLabel: 'Educational Institution',
  },

  gym: {
    id: 'gym',
    displayName: 'Gyms',
    aliases: ['gym', 'gyms', 'fitness', 'fitness centre', 'health club'],
    allowedGoogleTypes: ['gym', 'fitness_center', 'sports_complex', 'health_club'],
    forbiddenGoogleTypes: ['restaurant', 'hospital', 'real_estate_agency', 'hotel'],
    osmTags: [
      { key: 'leisure', value: 'fitness_centre' },
      { key: 'leisure', value: 'sports_centre' },
    ],
    positiveNameKeywords: ['gym', 'fitness', 'crossfit', 'workout', 'bodybuilding', 'aerobics', 'iron gym', 'fitness club', 'wellness centre'],
    negativeNameKeywords: ['restaurant', 'hospital', 'real estate'],
    discoveryQueryExpansions: ['Gyms in', 'Fitness Centers in', 'Health Clubs in'],
    defaultCategoryLabel: 'Fitness Center / Gym',
  },

  salon: {
    id: 'salon',
    displayName: 'Salons',
    aliases: ['salon', 'salons', 'beauty parlour', 'spa', 'hairdresser'],
    allowedGoogleTypes: ['beauty_salon', 'hair_salon', 'spa', 'hairdresser'],
    forbiddenGoogleTypes: ['hospital', 'school', 'real_estate_agency', 'restaurant'],
    osmTags: [
      { key: 'shop', value: 'hairdresser' },
      { key: 'shop', value: 'beauty' },
    ],
    positiveNameKeywords: ['salon', 'saloon', 'parlour', 'parlor', 'makeover', 'hair studio', 'spa', 'unisex salon', 'barber'],
    negativeNameKeywords: ['hospital', 'restaurant', 'real estate'],
    discoveryQueryExpansions: ['Beauty Salons in', 'Hair Studios in', 'Spas and Salons in'],
    defaultCategoryLabel: 'Beauty Salon / Spa',
  },

  retail: {
    id: 'retail',
    displayName: 'Retail',
    aliases: ['retail', 'store', 'stores', 'supermarket', 'supermarkets', 'shopping'],
    allowedGoogleTypes: ['store', 'shopping_mall', 'clothing_store', 'supermarket', 'grocery_store', 'department_store'],
    forbiddenGoogleTypes: ['hospital', 'school', 'real_estate_agency'],
    osmTags: [
      { key: 'shop', value: 'supermarket' },
      { key: 'shop', value: 'convenience' },
      { key: 'shop', value: 'department_store' },
      { key: 'shop', value: 'clothes' },
    ],
    positiveNameKeywords: ['store', 'supermarket', 'mart', 'bazaar', 'retail', 'emporium', 'shopping center', 'mall', 'general store', 'provision store'],
    negativeNameKeywords: ['hospital', 'school', 'real estate'],
    discoveryQueryExpansions: ['Supermarkets in', 'Department Stores in', 'Retail Stores in', 'Shopping Centers in'],
    defaultCategoryLabel: 'Retail Store',
  },

  automotive: {
    id: 'automotive',
    displayName: 'Automotive',
    aliases: ['automotive', 'car dealer', 'car repair', 'auto', 'garage'],
    allowedGoogleTypes: ['car_dealer', 'car_repair', 'auto_parts_store', 'gas_station', 'motorcycle_dealer'],
    forbiddenGoogleTypes: ['restaurant', 'hospital', 'school', 'real_estate_agency'],
    osmTags: [
      { key: 'shop', value: 'car' },
      { key: 'shop', value: 'car_repair' },
    ],
    positiveNameKeywords: ['motors', 'automotive', 'auto service', 'car care', 'garage', 'auto repair', 'motorcycle', 'service station'],
    negativeNameKeywords: ['restaurant', 'hospital', 'school', 'real estate'],
    discoveryQueryExpansions: ['Car Dealers in', 'Auto Repair Workshops in', 'Automotive Services in'],
    defaultCategoryLabel: 'Automotive Service',
  },

  travel: {
    id: 'travel',
    displayName: 'Travel',
    aliases: ['travel', 'travel agency', 'tour operator', 'tours', 'tourism'],
    allowedGoogleTypes: ['travel_agency', 'tourist_attraction', 'tour_operator'],
    forbiddenGoogleTypes: ['hospital', 'school', 'real_estate_agency'],
    osmTags: [
      { key: 'shop', value: 'travel_agency' },
      { key: 'office', value: 'travel_agent' },
      { key: 'tourism', value: 'information' },
    ],
    positiveNameKeywords: ['travels', 'travel agency', 'tours', 'tour & travels', 'holidays', 'tourism', 'vacations', 'ticketing'],
    negativeNameKeywords: ['hospital', 'school', 'real estate'],
    discoveryQueryExpansions: ['Travel Agencies in', 'Tour Operators in', 'Tours and Travels in'],
    defaultCategoryLabel: 'Travel Agency',
  },

  construction: {
    id: 'construction',
    displayName: 'Construction',
    aliases: ['construction', 'builder', 'builders', 'contractor', 'contractors', 'civil engineer'],
    allowedGoogleTypes: ['construction_company', 'roofing_contractor', 'general_contractor', 'builder', 'civil_engineer'],
    forbiddenGoogleTypes: ['restaurant', 'hospital', 'school'],
    osmTags: [
      { key: 'craft', value: 'builder' },
      { key: 'office', value: 'architect' },
    ],
    positiveNameKeywords: ['construction', 'builders', 'infra', 'infratech', 'civil contractor', 'engineers & contractors', 'projects'],
    negativeNameKeywords: ['restaurant', 'hospital', 'school'],
    discoveryQueryExpansions: ['Construction Companies in', 'Builders and Contractors in', 'Civil Contractors in'],
    defaultCategoryLabel: 'Construction Company',
  },

  finance: {
    id: 'finance',
    displayName: 'Finance',
    aliases: ['finance', 'bank', 'banks', 'accounting', 'accountant'],
    allowedGoogleTypes: ['bank', 'atm', 'accounting', 'finance', 'financial_planner'],
    forbiddenGoogleTypes: ['restaurant', 'hospital', 'school'],
    osmTags: [
      { key: 'amenity', value: 'bank' },
      { key: 'office', value: 'accountant' },
      { key: 'office', value: 'financial' },
    ],
    positiveNameKeywords: ['bank', 'finance', 'finserve', 'capital', 'securities', 'investments', 'chit funds', 'credits'],
    negativeNameKeywords: ['restaurant', 'hospital', 'school'],
    discoveryQueryExpansions: ['Banks in', 'Financial Services in', 'Accounting Firms in'],
    defaultCategoryLabel: 'Financial Services',
  },

  law_firm: {
    id: 'law_firm',
    displayName: 'Law Firm',
    aliases: ['law firm', 'lawyer', 'legal', 'advocate'],
    allowedGoogleTypes: ['lawyer', 'legal_services'],
    forbiddenGoogleTypes: ['restaurant', 'hospital', 'school', 'real_estate_agency'],
    osmTags: [
      { key: 'office', value: 'lawyer' },
      { key: 'office', value: 'legal' },
    ],
    positiveNameKeywords: ['advocate', 'law firm', 'legal associates', 'law chambers', 'attorneys', 'solicitors'],
    negativeNameKeywords: ['restaurant', 'hospital', 'school'],
    discoveryQueryExpansions: ['Law Firms in', 'Advocates and Legal Services in'],
    defaultCategoryLabel: 'Legal Services / Law Firm',
  },

  pharmacy: {
    id: 'pharmacy',
    displayName: 'Pharmacy',
    aliases: ['pharmacy', 'chemist', 'drugstore', 'medical store'],
    allowedGoogleTypes: ['pharmacy', 'drugstore'],
    forbiddenGoogleTypes: ['restaurant', 'real_estate_agency', 'school'],
    osmTags: [
      { key: 'amenity', value: 'pharmacy' },
      { key: 'healthcare', value: 'pharmacy' },
      { key: 'shop', value: 'chemist' },
    ],
    positiveNameKeywords: ['pharmacy', 'chemist', 'medical store', 'medicos', 'druggist', 'dawa khana'],
    negativeNameKeywords: ['restaurant', 'real estate', 'hotel'],
    discoveryQueryExpansions: ['Pharmacies in', 'Chemist and Medical Stores in'],
    defaultCategoryLabel: 'Pharmacy / Chemist',
  },

  it_software: {
    id: 'it_software',
    displayName: 'IT & Software',
    aliases: ['it company', 'it companies', 'software', 'technology', 'web development'],
    allowedGoogleTypes: ['software_company', 'corporate_office', 'consultant'],
    forbiddenGoogleTypes: ['restaurant', 'hospital', 'school', 'real_estate_agency'],
    osmTags: [
      { key: 'office', value: 'it' },
      { key: 'office', value: 'software' },
    ],
    positiveNameKeywords: ['technologies', 'infotech', 'software', 'solutions', 'tech', 'digital', 'systems', 'consulting'],
    negativeNameKeywords: ['restaurant', 'hospital', 'hotel'],
    discoveryQueryExpansions: ['IT Companies in', 'Software Companies in', 'Tech Solutions in'],
    defaultCategoryLabel: 'IT & Software Services',
  },

  other: {
    id: 'other',
    displayName: 'Other',
    aliases: ['other', 'general', 'business'],
    allowedGoogleTypes: ['establishment', 'point_of_interest'],
    forbiddenGoogleTypes: [],
    osmTags: [],
    positiveNameKeywords: [],
    negativeNameKeywords: [],
    discoveryQueryExpansions: [],
    defaultCategoryLabel: 'Business',
  },
};

/**
 * Resolves any user or system industry string to its CanonicalIndustryDefinition.
 */
export function resolveCanonicalIndustry(industryString?: string): CanonicalIndustryDefinition {
  if (!industryString || typeof industryString !== 'string') {
    return CANONICAL_INDUSTRIES.other;
  }

  const clean = industryString.trim().toLowerCase();

  // 1. Direct match on ID
  if (CANONICAL_INDUSTRIES[clean as CanonicalIndustryId]) {
    return CANONICAL_INDUSTRIES[clean as CanonicalIndustryId];
  }

  // 2. Match against aliases
  for (const def of Object.values(CANONICAL_INDUSTRIES)) {
    if (def.aliases.some((a) => clean === a || clean.includes(a) || a.includes(clean))) {
      return def;
    }
  }

  // 3. Singular / plural fallback
  const singular = clean.endsWith('s') ? clean.slice(0, -1) : clean;
  for (const def of Object.values(CANONICAL_INDUSTRIES)) {
    if (def.aliases.some((a) => singular === a || singular.includes(a) || a.includes(singular))) {
      return def;
    }
  }

  // Default to Other with the custom industry name preserved
  return {
    ...CANONICAL_INDUSTRIES.other,
    displayName: industryString.trim(),
    discoveryQueryExpansions: [`${industryString.trim()} in`],
  };
}

export interface IndustryValidationResult {
  isValid: boolean;
  canonicalIndustry: string;
  normalizedCategory: string;
  rejectionReason?: string;
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Validates whether a candidate business genuinely belongs to the requested industry.
 * Strictly filters out false-positives (e.g. restaurants or farms returned for Real Estate).
 */
export function validateIndustryRelevance(
  candidate: {
    businessName?: string;
    category?: string;
    types?: string[];
    rawTags?: any;
  },
  requestedIndustry: string
): IndustryValidationResult {
  const canonicalDef = resolveCanonicalIndustry(requestedIndustry);
  const name = (candidate.businessName || '').toLowerCase().trim();
  const rawCategory = (candidate.category || '').toLowerCase().trim();
  const types: string[] = Array.isArray(candidate.types)
    ? candidate.types.map((t) => t.toLowerCase().trim())
    : [];

  if (rawCategory && !types.includes(rawCategory)) {
    types.push(rawCategory);
  }

  // Add OSM raw tags values
  if (candidate.rawTags) {
    if (candidate.rawTags.amenity) types.push(candidate.rawTags.amenity.toLowerCase());
    if (candidate.rawTags.office) types.push(candidate.rawTags.office.toLowerCase());
    if (candidate.rawTags.shop) types.push(candidate.rawTags.shop.toLowerCase());
    if (candidate.rawTags.tourism) types.push(candidate.rawTags.tourism.toLowerCase());
    if (candidate.rawTags.primaryType) types.push(candidate.rawTags.primaryType.toLowerCase());
  }

  // If custom/other industry requested without forbidden list, perform basic name/category sanity
  if (canonicalDef.id === 'other') {
    return {
      isValid: true,
      canonicalIndustry: canonicalDef.displayName,
      normalizedCategory: candidate.category || canonicalDef.displayName,
      confidence: 'medium',
    };
  }

  // --- STEP 1: STRICT FORBIDDEN TYPES REJECTION ---
  // If ANY type matches a forbidden category for this industry
  const matchingForbidden = types.find((t) => canonicalDef.forbiddenGoogleTypes.includes(t));
  if (matchingForbidden) {
    // Check if business name has strong positive signals overriding generic tags
    const hasStrongNameOverride = canonicalDef.positiveNameKeywords.some((kw) => name.includes(kw));
    if (!hasStrongNameOverride) {
      return {
        isValid: false,
        canonicalIndustry: canonicalDef.displayName,
        normalizedCategory: matchingForbidden.replace(/_/g, ' '),
        rejectionReason: `Category "${matchingForbidden}" strictly contradicts requested industry "${canonicalDef.displayName}".`,
        confidence: 'high',
      };
    }
  }

  // --- STEP 2: POSITIVE ALLOWED TYPES MATCH ---
  const matchingAllowed = types.find((t) => canonicalDef.allowedGoogleTypes.includes(t));
  if (matchingAllowed) {
    // Check if negative name keywords disqualify this candidate
    const hasNegativeName = canonicalDef.negativeNameKeywords.some((kw) => name.includes(kw));
    if (hasNegativeName) {
      return {
        isValid: false,
        canonicalIndustry: canonicalDef.displayName,
        normalizedCategory: matchingAllowed.replace(/_/g, ' '),
        rejectionReason: `Business name "${candidate.businessName}" matches negative signals for "${canonicalDef.displayName}".`,
        confidence: 'medium',
      };
    }

    return {
      isValid: true,
      canonicalIndustry: canonicalDef.displayName,
      normalizedCategory: formatCategoryTitle(matchingAllowed, canonicalDef.defaultCategoryLabel),
      confidence: 'high',
    };
  }

  // --- STEP 3: DISAMBIGUATION VIA NAME KEYWORDS ---
  const hasPositiveName = canonicalDef.positiveNameKeywords.some((kw) => name.includes(kw));
  const hasNegativeName = canonicalDef.negativeNameKeywords.some((kw) => name.includes(kw));

  if (hasPositiveName && !hasNegativeName) {
    return {
      isValid: true,
      canonicalIndustry: canonicalDef.displayName,
      normalizedCategory: canonicalDef.defaultCategoryLabel,
      confidence: 'medium',
    };
  }

  // --- STEP 4: AMBIGUOUS OR UNRELATED REJECTION ---
  return {
    isValid: false,
    canonicalIndustry: canonicalDef.displayName,
    normalizedCategory: rawCategory || 'unknown',
    rejectionReason: `Business "${candidate.businessName}" (category: ${rawCategory || 'generic'}) does not match requested industry "${canonicalDef.displayName}".`,
    confidence: 'medium',
  };
}

/**
 * Returns formatted human-readable category title
 */
function formatCategoryTitle(rawType: string, defaultTitle: string): string {
  if (!rawType || rawType === 'establishment' || rawType === 'point_of_interest') {
    return defaultTitle;
  }
  return rawType
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Returns targeted discovery queries for high-volume provider expansion.
 */
export function getIndustryDiscoveryQueries(
  industryString: string,
  resolvedArea: string,
  country: string = 'India'
): string[] {
  const canonical = resolveCanonicalIndustry(industryString);
  const expansions = canonical.discoveryQueryExpansions;

  if (expansions && expansions.length > 0) {
    return expansions.map((prefix) => `${prefix} ${resolvedArea}, ${country}`);
  }

  return [
    `${industryString} in ${resolvedArea}, ${country}`,
    `${industryString} in ${resolvedArea}`,
    `${industryString} near ${resolvedArea}`,
  ];
}
