/**
 * Search Query Expansion Service
 * 
 * Expands user search phrases into high-intent procurement and buyer queries.
 * Combines domain-specific deterministic rules with configured LLM generation,
 * ensuring high recall across public discussions without relying on exact phrasing.
 */

import { LLMProviderFactory } from '@/lib/ai/llmProvider';

export interface SearchExpansionOptions {
  query: string;
  maxVariants?: number;
  industryHint?: string;
  targetBuyer?: string;
}

export interface ExpandedSearchResult {
  originalQuery: string;
  variants: string[];
  allQueries: string[]; // [originalQuery, ...variants]
  expansionMethod: 'LLM_EXPANSION' | 'DETERMINISTIC_RULES';
  llmProviderUsed?: string;
}

// Curated domain rules for common B2B product and procurement categories
const DETERMINISTIC_DOMAIN_EXPANSIONS: Record<string, string[]> = {
  // Industrial & Spare Parts
  'spare parts': [
    'spare parts supplier',
    'replacement parts',
    'sourcing components',
    'parts distributor',
    'looking for a parts supplier',
    'where to buy replacement components',
    'difficulty finding spare parts',
    'need an alternative supplier',
    'parts procurement',
    'industrial components sourcing',
  ],
  'replacement parts': [
    'spare parts supplier',
    'sourcing replacement components',
    'parts distributor',
    'OEM parts alternative',
    'need replacement parts supplier',
  ],
  'parts': [
    'spare parts supplier',
    'parts distributor',
    'sourcing replacement parts',
    'industrial components',
  ],
  // Software & B2B SaaS
  'crm': [
    'looking for CRM',
    'alternative to Salesforce',
    'alternative to HubSpot',
    'best B2B CRM software',
    'CRM recommendation for sales team',
    'switching CRMs',
  ],
  'looking for crm': [
    'CRM recommendation',
    'alternative to Salesforce',
    'alternative to HubSpot',
    'small business CRM software',
    'best B2B CRM',
  ],
  'sales intelligence': [
    'lead enrichment tool',
    'alternative to ZoomInfo',
    'B2B contact finder',
    'sales prospecting tool recommendation',
  ],
  'outreach': [
    'cold email tool recommendation',
    'sales outreach software',
    'alternative to Apollo',
    'multichannel outreach platform',
  ],
};

export class SearchExpansionService {
  /**
   * Expands query using configured LLM or robust deterministic fallback
   */
  public static async expandQuery(options: SearchExpansionOptions): Promise<ExpandedSearchResult> {
    const rawQuery = (options.query || '').trim();
    if (!rawQuery) {
      return {
        originalQuery: '',
        variants: [],
        allQueries: [],
        expansionMethod: 'DETERMINISTIC_RULES',
      };
    }

    const maxVariants = Math.min(Math.max(options.maxVariants || 4, 1), 6);
    const normalizedLower = rawQuery.toLowerCase();

    // 1. Check if LLM is configured and operational
    const llm = LLMProviderFactory.getProvider();
    if (llm.isConfigured()) {
      try {
        const prompt = `Generate ${maxVariants} realistic, high-intent B2B search phrases that a buyer or operations manager would use when seeking: "${rawQuery}".
Focus on:
1. Sourcing or supplier search (e.g., "supplier for ...", "procurement of ...")
2. Problem / replacement requests (e.g., "need alternative ...", "difficulty finding ...")
3. Recommendation questions (e.g., "looking for recommendations for ...", "best vendor for ...")

Return ONLY a JSON array of strings, without any extra text or markdown formatting.
Example format: ["query 1", "query 2", "query 3"]`;

        const res = await llm.generateText(prompt, 'You are a B2B search query expansion engine. Return ONLY a JSON string array.', {
          temperature: 0.3,
          maxTokens: 250,
          jsonMode: true,
        });

        const cleaned = res.text.replace(/```json|```/g, '').trim();
        const parsed = JSON.parse(cleaned);

        if (Array.isArray(parsed) && parsed.length > 0) {
          const validVariants = parsed
            .map((q) => String(q).trim())
            .filter((q) => q.length > 2 && q.toLowerCase() !== normalizedLower);

          const deduplicated = Array.from(new Set(validVariants)).slice(0, maxVariants);
          console.log(`[Search Expansion] LLM (${llm.name}) expanded "${rawQuery}" -> [${deduplicated.join(', ')}]`);

          return {
            originalQuery: rawQuery,
            variants: deduplicated,
            allQueries: [rawQuery, ...deduplicated],
            expansionMethod: 'LLM_EXPANSION',
            llmProviderUsed: llm.name,
          };
        }
      } catch (err: any) {
        console.warn(`[Search Expansion] LLM expansion failed (${err.message}). Using deterministic rules.`);
      }
    }

    // 2. Deterministic Expansion
    const deterministicVariants = this.getDeterministicVariants(rawQuery, maxVariants);
    console.log(`[Search Expansion] Deterministic expanded "${rawQuery}" -> [${deterministicVariants.join(', ')}]`);

    return {
      originalQuery: rawQuery,
      variants: deterministicVariants,
      allQueries: [rawQuery, ...deterministicVariants],
      expansionMethod: 'DETERMINISTIC_RULES',
    };
  }

  /**
   * Deterministic rule-based expansion
   */
  private static getDeterministicVariants(query: string, max: number): string[] {
    const lower = query.toLowerCase();

    // Exact or partial match in curated dictionary
    for (const [key, variants] of Object.entries(DETERMINISTIC_DOMAIN_EXPANSIONS)) {
      if (lower === key || lower.includes(key)) {
        return variants
          .filter((v) => v.toLowerCase() !== lower)
          .slice(0, max);
      }
    }

    // Fallback algorithmic template expansion for any term
    const cleanTerm = query.replace(/[^\w\s-]/g, '').trim();
    const algorithmic = [
      `${cleanTerm} supplier`,
      `sourcing ${cleanTerm}`,
      `looking for ${cleanTerm}`,
      `recommendations for ${cleanTerm}`,
      `alternative ${cleanTerm}`,
      `where to buy ${cleanTerm}`,
    ];

    return algorithmic
      .filter((v) => v.toLowerCase() !== lower)
      .slice(0, max);
  }
}
