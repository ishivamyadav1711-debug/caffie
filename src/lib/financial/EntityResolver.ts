/**
 * EntityResolver.ts
 * 
 * Parent Company & Corporate Group Resolution for LeadPilot Financial Intelligence.
 * Resolves commercial operating establishments, hotels, hospitals, and retail chains
 * to their ultimate legal registrants and corporate parent entities on official registries (MCA, SEC, SEDAR+).
 * 
 * Prevents false negatives where premium venues (e.g. "The Oberoi, Mumbai", "ITC Grand Central")
 * are erroneously rejected because their operating establishment name differs from their
 * corporate registry filing name (e.g. "EIH Limited", "ITC Hotels Limited").
 */

export interface ResolvedParentEntity {
  matchedBrand: string;
  parentName: string;
  aliases: string[];
  cinOrCik?: string;
  bseScripCode?: string;
  industry: 'Hospitality' | 'Healthcare' | 'Dining' | 'Automotive' | 'Retail' | 'General';
  notes: string;
}

// Common geographical terms in Indian & global listings
const LOCATION_PATTERNS = [
  /\b(mumbai|bombay|navi mumbai|thane|pune|delhi|new delhi|noida|gurgaon|gurugram|faridabad|ghaziabad|bengaluru|bangalore|chennai|madras|hyderabad|secunderabad|kolkata|calcutta|ahmedabad|jaipur|lucknow|chandigarh|kochi|cochin|goa)\b/gi,
  /\b(colaba|nariman point|marine lines|bandra|bandra kurla complex|bkc|andheri|juhu|worli|powai|vashi|lower parel|aerocity|saket|connaught place|whitefield|indiranagar|koramangala|hitec city|guindy)\b/gi,
  /\b(sector\s*\d+|phase\s*\d+|road|marg|street|avenue|blvd|lane)\b/gi,
  /\b(india|usa|united states|canada|uk|united kingdom)\b/gi,
];

// Common descriptor affixes for establishments
const DESCRIPTOR_PATTERNS = [
  /\b(luxury collection hotel|palace hotel|boutique hotel|hotel & resorts?|resorts? & spa|hotels?|resorts?|palace|suites?|inn|lodge)\b/gi,
  /\b(super speciality hospital|multispeciality hospital|speciality hospital|general hospital|hospital|clinic|healthcare|institute of medical sciences|medical centre|medical center)\b/gi,
  /\b(restaurant|diner|bistro|cafe|bar & grill|lounge|outlet|branch)\b/gi,
];

// Legal structure terms
const LEGAL_TERMS = [
  /\b(private limited|pvt\.?\s*ltd\.?|limited|ltd\.?|incorporated|inc\.?|corporation|corp\.?|llc|co\.?|llp)\b/gi,
];

export class EntityResolver {
  private static readonly CURATED_PARENT_MAPPINGS: ResolvedParentEntity[] = [
    // ─── HOSPITALITY / HOTELS ─────────────────────────────────────────────
    {
      matchedBrand: 'oberoi',
      parentName: 'EIH Limited',
      aliases: [
        'EIH Limited (The Oberoi Group)',
        'EIH Limited',
        'EIH Associated Hotels Limited',
        'The Oberoi Group',
        'Oberoi Hotels & Resorts',
        'Oberoi Hotels',
      ],
      bseScripCode: '500840',
      industry: 'Hospitality',
      notes: 'EIH Limited is the flagship company of The Oberoi Group (owns & operates The Oberoi and Trident properties).',
    },
    {
      matchedBrand: 'trident',
      parentName: 'EIH Limited',
      aliases: [
        'EIH Limited (The Oberoi Group)',
        'EIH Limited',
        'EIH Associated Hotels Limited',
        'The Oberoi Group',
        'Trident Hotels',
      ],
      bseScripCode: '500840',
      industry: 'Hospitality',
      notes: 'Trident brand properties are owned and operated by EIH Limited.',
    },
    {
      matchedBrand: 'itc',
      parentName: 'ITC Hotels Limited / ITC Limited',
      aliases: [
        'ITC Hotels Limited / ITC Limited',
        'ITC Hotels Limited',
        'ITC Limited',
        'ITC Hotels',
        'ITC Grand Central',
        'ITC Maratha',
        'ITC Maurya',
        'ITC Grand Chola',
        'Welcomhotel',
        'Fortune Hotels',
      ],
      bseScripCode: '500875',
      industry: 'Hospitality',
      notes: 'ITC Hotels / ITC Limited is one of India\'s largest hospitality enterprises (ITC Grand, Welcomhotel, Fortune).',
    },
    {
      matchedBrand: 'taj',
      parentName: 'The Indian Hotels Company Limited (IHCL - Taj Hotels)',
      aliases: [
        'The Indian Hotels Company Limited (IHCL - Taj Hotels)',
        'The Indian Hotels Company Limited',
        'Indian Hotels Company Limited',
        'IHCL',
        'Taj Hotels',
        'Taj Group',
        'Vivanta',
        'Ginger Hotels',
        'SeleQtions',
      ],
      bseScripCode: '500850',
      industry: 'Hospitality',
      notes: 'The Indian Hotels Company Limited (IHCL) is South Asia\'s largest hospitality company (Tata Group enterprise).',
    },
    {
      matchedBrand: 'vivanta',
      parentName: 'The Indian Hotels Company Limited (IHCL - Taj Hotels)',
      aliases: [
        'The Indian Hotels Company Limited (IHCL - Taj Hotels)',
        'IHCL',
        'Vivanta by Taj',
      ],
      bseScripCode: '500850',
      industry: 'Hospitality',
      notes: 'Vivanta is a premium brand of The Indian Hotels Company Limited (IHCL).',
    },
    {
      matchedBrand: 'ginger',
      parentName: 'The Indian Hotels Company Limited (IHCL - Taj Hotels)',
      aliases: [
        'The Indian Hotels Company Limited (IHCL - Taj Hotels)',
        'IHCL',
        'Roots Corporation Limited',
      ],
      bseScripCode: '500850',
      industry: 'Hospitality',
      notes: 'Ginger Hotels operates under Roots Corporation Limited, a wholly owned subsidiary of IHCL.',
    },
    {
      matchedBrand: 'leela',
      parentName: 'The Leela Palaces, Hotels and Resorts (Schloss Bangalore Limited)',
      aliases: [
        'The Leela Palaces, Hotels and Resorts (Schloss Bangalore Limited)',
        'Schloss Bangalore Limited',
        'The Leela Palaces Hotels and Resorts',
        'The Leela',
        'Hotel Leelaventure Limited',
      ],
      industry: 'Hospitality',
      notes: 'The Leela Palaces, Hotels and Resorts is owned by Brookfield via Schloss Bangalore Limited.',
    },
    {
      matchedBrand: 'marriott',
      parentName: 'Marriott International Inc',
      aliases: [
        'MARRIOTT INTERNATIONAL INC',
        'Marriott Hotels India Private Limited',
        'Chalet Hotels Limited',
        'JW Marriott',
        'Westin',
        'Sheraton',
        'St. Regis',
        'The Ritz-Carlton',
        'Courtyard by Marriott',
      ],
      cinOrCik: '0001048286',
      industry: 'Hospitality',
      notes: 'Global hospitality leader; major Indian assets held through Chalet Hotels Ltd or Marriott International.',
    },
    {
      matchedBrand: 'chalet',
      parentName: 'Chalet Hotels Limited (JW Marriott & Westin Owner)',
      aliases: [
        'Chalet Hotels Limited (JW Marriott & Westin Owner)',
        'Chalet Hotels Limited',
        'Chalet Hotels',
      ],
      bseScripCode: '542399',
      industry: 'Hospitality',
      notes: 'Chalet Hotels Limited (K Raheja Corp) owns major marquee Marriott & Westin properties in Mumbai & India.',
    },
    {
      matchedBrand: 'hyatt',
      parentName: 'Hyatt Hotels Corp / Juniper Hotels Limited',
      aliases: [
        'HYATT HOTELS CORP',
        'Juniper Hotels Limited',
        'Grand Hyatt',
        'Hyatt Regency',
        'Andaz',
      ],
      cinOrCik: '0001468174',
      bseScripCode: '544129',
      industry: 'Hospitality',
      notes: 'Hyatt properties in India operate under Hyatt Hotels Corp / Juniper Hotels Limited.',
    },
    {
      matchedBrand: 'lemon tree',
      parentName: 'Lemon Tree Hotels Limited',
      aliases: [
        'Lemon Tree Hotels Limited',
        'Lemon Tree Premier',
        'Red Fox Hotels',
      ],
      bseScripCode: '541233',
      industry: 'Hospitality',
      notes: 'Lemon Tree Hotels Limited is one of India\'s largest mid-priced and upscale hotel chains.',
    },
    {
      matchedBrand: 'radisson',
      parentName: 'Radisson Hotel Group',
      aliases: [
        'Radisson Hotel Group',
        'Radisson Blu',
        'Country Inn & Suites',
        'Park Plaza',
      ],
      industry: 'Hospitality',
      notes: 'Radisson Hotel Group operates extensive full-service properties across India.',
    },

    // ─── HEALTHCARE / HOSPITALS ───────────────────────────────────────────
    {
      matchedBrand: 'apollo',
      parentName: 'Apollo Hospitals Enterprise Limited (Apollo Hospital)',
      aliases: [
        'Apollo Hospitals Enterprise Limited (Apollo Hospital)',
        'Apollo Hospitals Enterprise Limited',
        'Apollo Hospital',
        'Apollo Clinic',
        'Apollo Spectra',
      ],
      bseScripCode: '508869',
      industry: 'Healthcare',
      notes: 'Apollo Hospitals Enterprise Limited is India\'s pioneer private healthcare provider.',
    },
    {
      matchedBrand: 'fortis',
      parentName: 'Fortis Healthcare Limited (Fortis Hospital)',
      aliases: [
        'Fortis Healthcare Limited (Fortis Hospital)',
        'Fortis Healthcare Limited',
        'Fortis Hospital',
        'Fortis Escorts',
        'Fortis Malar',
      ],
      bseScripCode: '532848',
      industry: 'Healthcare',
      notes: 'Fortis Healthcare Limited is a top-tier hospital chain (IHH Healthcare Group).',
    },
    {
      matchedBrand: 'max',
      parentName: 'Max Healthcare Institute Limited (Max Hospital)',
      aliases: [
        'Max Healthcare Institute Limited (Max Hospital)',
        'Max Healthcare Institute Limited',
        'Max Hospital',
        'Max Super Speciality Hospital',
      ],
      bseScripCode: '543220',
      industry: 'Healthcare',
      notes: 'Max Healthcare Institute Limited is a premier corporate healthcare provider in India.',
    },
    {
      matchedBrand: 'narayana',
      parentName: 'Narayana Hrudayalaya Limited (Narayana Health)',
      aliases: [
        'Narayana Hrudayalaya Limited (Narayana Health)',
        'Narayana Hrudayalaya Limited',
        'Narayana Health',
      ],
      bseScripCode: '539551',
      industry: 'Healthcare',
      notes: 'Narayana Hrudayalaya Limited operates extensive multispeciality hospitals.',
    },
    {
      matchedBrand: 'medanta',
      parentName: 'Global Health Limited (Medanta Hospital)',
      aliases: [
        'Global Health Limited (Medanta Hospital)',
        'Global Health Limited',
        'Medanta Hospital',
        'Medanta The Medicity',
      ],
      bseScripCode: '543654',
      industry: 'Healthcare',
      notes: 'Global Health Limited owns and operates the Medanta hospital network.',
    },
    {
      matchedBrand: 'aster',
      parentName: 'Aster DM Healthcare Limited (Aster Hospital)',
      aliases: [
        'Aster DM Healthcare Limited (Aster Hospital)',
        'Aster DM Healthcare Limited',
        'Aster Hospital',
      ],
      bseScripCode: '540975',
      industry: 'Healthcare',
      notes: 'Aster DM Healthcare Limited operates hospitals and clinics across India & GCC.',
    },
    {
      matchedBrand: 'manipal',
      parentName: 'Manipal Health Enterprises Private Limited (Manipal Hospitals)',
      aliases: [
        'Manipal Health Enterprises Private Limited (Manipal Hospitals)',
        'Manipal Health Enterprises Private Limited',
        'Manipal Hospitals',
        'Manipal Hospital',
      ],
      industry: 'Healthcare',
      notes: 'Manipal Health Enterprises is one of India\'s largest private hospital networks.',
    },

    // ─── FOOD & DINING CHAINS ─────────────────────────────────────────────
    {
      matchedBrand: 'domino',
      parentName: 'Jubilant FoodWorks Limited (Domino\'s Pizza)',
      aliases: [
        'Jubilant FoodWorks Limited (Domino\'s Pizza)',
        'Jubilant FoodWorks Limited',
        'Domino\'s Pizza India',
      ],
      bseScripCode: '533155',
      industry: 'Dining',
      notes: 'Jubilant FoodWorks Limited holds exclusive master franchise rights for Domino\'s in India.',
    },
    {
      matchedBrand: 'kfc',
      parentName: 'Devyani International Limited (KFC / Pizza Hut)',
      aliases: [
        'Devyani International Limited (KFC / Pizza Hut)',
        'Devyani International Limited',
        'Sapphire Foods India Limited',
      ],
      bseScripCode: '543330',
      industry: 'Dining',
      notes: 'Devyani International & Sapphire Foods are the major Indian franchisees of Yum! Brands.',
    },
    {
      matchedBrand: 'pizza hut',
      parentName: 'Devyani International Limited (KFC / Pizza Hut)',
      aliases: [
        'Devyani International Limited (KFC / Pizza Hut)',
        'Devyani International Limited',
      ],
      bseScripCode: '543330',
      industry: 'Dining',
      notes: 'Devyani International operates Pizza Hut in India.',
    },
    {
      matchedBrand: 'mcdonald',
      parentName: 'Westlife Foodworld Limited (McDonald\'s)',
      aliases: [
        'Westlife Foodworld Limited (McDonald\'s)',
        'Westlife Foodworld Limited',
        'Hardcastle Restaurants Private Limited',
      ],
      bseScripCode: '505533',
      industry: 'Dining',
      notes: 'Westlife Foodworld (Hardcastle Restaurants) owns and operates McDonald\'s across West and South India.',
    },

    // ─── AUTOMOTIVE ───────────────────────────────────────────────────────
    {
      matchedBrand: 'maruti',
      parentName: 'MARUTI SUZUKI INDIA LIMITED',
      aliases: [
        'MARUTI SUZUKI INDIA LIMITED',
        'Maruti Suzuki',
        'Nexa',
      ],
      bseScripCode: '532500',
      industry: 'Automotive',
      notes: 'Maruti Suzuki India Limited is India\'s leading passenger vehicle manufacturer.',
    },
    {
      matchedBrand: 'tata motors',
      parentName: 'TATA MOTORS LIMITED',
      aliases: [
        'TATA MOTORS LIMITED',
        'Tata Motors',
      ],
      bseScripCode: '500570',
      industry: 'Automotive',
      notes: 'Tata Motors Limited is a global automotive manufacturer (Tata Group).',
    },
    {
      matchedBrand: 'mahindra',
      parentName: 'MAHINDRA & MAHINDRA LIMITED',
      aliases: [
        'MAHINDRA & MAHINDRA LIMITED',
        'Mahindra and Mahindra',
      ],
      bseScripCode: '500520',
      industry: 'Automotive',
      notes: 'Mahindra & Mahindra Limited is a leading Indian multinational conglomerate.',
    },
  ];

  /**
   * Cleans a raw establishment name to extract the core brand or operating identity.
   * Strips city names, location prefixes/suffixes, and generic descriptors.
   */
  public cleanEntityName(rawName: string): string {
    if (!rawName || typeof rawName !== 'string') return '';

    let cleaned = rawName.trim();

    // 1. Strip commas and clauses with locations or subsidiary descriptions
    // e.g. "The Oberoi, Mumbai" -> "The Oberoi"
    // e.g. "ITC Grand Central, A Luxury Collection Hotel, Mumbai" -> "ITC Grand Central"
    const commaParts = cleaned.split(/[,–—|:]+/).map((p) => p.trim()).filter(Boolean);
    if (commaParts.length > 1) {
      // Retain the first component if it contains substantial letters
      if (commaParts[0].length >= 3) {
        cleaned = commaParts[0];
      }
    }

    // 2. Remove parentheticals (e.g. "(Apollo Hospital)", "(Domino's)")
    cleaned = cleaned.replace(/\s*\([^)]*\)/g, ' ').trim();

    // 3. Remove leading "The "
    cleaned = cleaned.replace(/^The\s+/i, '').trim();

    // 4. Remove location patterns
    for (const pattern of LOCATION_PATTERNS) {
      cleaned = cleaned.replace(pattern, ' ');
    }

    // 5. Remove generic descriptor patterns
    for (const pattern of DESCRIPTOR_PATTERNS) {
      cleaned = cleaned.replace(pattern, ' ');
    }

    // 6. Remove legal entity forms if present
    for (const pattern of LEGAL_TERMS) {
      cleaned = cleaned.replace(pattern, ' ');
    }

    // Normalize multiple spaces
    cleaned = cleaned.replace(/\s+/g, ' ').trim();

    // If cleaning was overly aggressive, return the trimmed raw name
    if (cleaned.length < 2) {
      return rawName.trim();
    }

    return cleaned;
  }

  /**
   * Calculates Levenshtein Distance between two strings.
   */
  public levenshteinDistance(a: string, b: string): number {
    const s1 = a.toLowerCase().trim();
    const s2 = b.toLowerCase().trim();

    if (s1 === s2) return 0;
    if (s1.length === 0) return s2.length;
    if (s2.length === 0) return s1.length;

    const matrix: number[][] = [];

    for (let i = 0; i <= s1.length; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= s2.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= s1.length; i++) {
      for (let j = 1; j <= s2.length; j++) {
        const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,       // deletion
          matrix[i][j - 1] + 1,       // insertion
          matrix[i - 1][j - 1] + cost // substitution
        );
      }
    }

    return matrix[s1.length][s2.length];
  }

  /**
   * Calculates normalized Levenshtein similarity score between 0.0 and 1.0.
   */
  public levenshteinSimilarity(a: string, b: string): number {
    const s1 = a.toLowerCase().trim();
    const s2 = b.toLowerCase().trim();
    const maxLen = Math.max(s1.length, s2.length);
    if (maxLen === 0) return 1.0;
    const distance = this.levenshteinDistance(s1, s2);
    return Math.max(0, 1 - distance / maxLen);
  }

  /**
   * Calculates Token Set Overlap Similarity (Dice Coefficient) between words.
   */
  public tokenSimilarity(a: string, b: string): number {
    const tokenize = (str: string) =>
      str
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .split(/\s+/)
        .filter((t) => t.length > 1 && !['the', 'and', 'hotel', 'resort', 'hospital'].includes(t));

    const tokensA = tokenize(a);
    const tokensB = tokenize(b);

    if (tokensA.length === 0 || tokensB.length === 0) return 0;

    const intersection = tokensA.filter((t) => tokensB.includes(t));
    return (2 * intersection.length) / (tokensA.length + tokensB.length);
  }

  /**
   * Resolves a commercial operating business name to its legal parent company.
   * Matches against curated corporate parent registry mappings using:
   * 1. Direct brand token inclusion
   * 2. Cleaned establishment name inspection
   * 3. Fuzzy Levenshtein and token similarity
   */
  public resolveParentCompany(rawBusinessName: string): ResolvedParentEntity | null {
    if (!rawBusinessName || typeof rawBusinessName !== 'string') return null;

    const cleanInput = rawBusinessName.toLowerCase().trim();
    const cleanedName = this.cleanEntityName(rawBusinessName).toLowerCase();

    // 1. Direct Brand Token Match
    for (const mapping of EntityResolver.CURATED_PARENT_MAPPINGS) {
      const brand = mapping.matchedBrand.toLowerCase();

      // Check for standalone word or boundary match in raw input or cleaned name
      const regex = new RegExp(`(^|\\b|\\s)${brand}(\\b|\\s|$)`, 'i');
      if (regex.test(cleanInput) || regex.test(cleanedName)) {
        return mapping;
      }

      // Check if any alias has high token similarity
      for (const alias of mapping.aliases) {
        if (cleanInput.includes(alias.toLowerCase())) {
          return mapping;
        }
      }
    }

    // 2. Fuzzy similarity check against parent aliases
    for (const mapping of EntityResolver.CURATED_PARENT_MAPPINGS) {
      for (const alias of mapping.aliases) {
        const tokenSim = this.tokenSimilarity(cleanedName, alias);
        const levSim = this.levenshteinSimilarity(cleanedName, alias);
        if (tokenSim >= 0.70 || levSim >= 0.75) {
          return mapping;
        }
      }
    }

    // 3. Fallback: Parse "by <Brand>" or "<Brand> Hotel" patterns
    // e.g., "Vivanta by Taj", "Courtyard by Marriott", "DoubleTree by Hilton"
    const byMatch = cleanInput.match(/\bby\s+([a-z0-9\s]+)/i);
    if (byMatch && byMatch[1]) {
      const brandCandidate = byMatch[1].trim().toLowerCase();
      for (const mapping of EntityResolver.CURATED_PARENT_MAPPINGS) {
        if (brandCandidate.includes(mapping.matchedBrand.toLowerCase())) {
          return mapping;
        }
      }
    }

    return null;
  }
}

export const entityResolver = new EntityResolver();
