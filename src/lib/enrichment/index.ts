import dns from 'dns';
import { extractDomain } from '@/utils/urlUtils';
import {
  EnrichmentInput,
  EnrichmentOutput,
  EnrichmentField,
  FieldEnrichmentResult,
  Layer0RoutingMetadata,
  PlannedWaterfall,
} from './types';

// In-memory Layer 0 cache
const enrichmentCache = new Map<string, EnrichmentOutput>();

/**
 * Normalizes an optional string property: trims whitespace and maps empty strings to null.
 */
function cleanString(val?: string | null): string | null {
  if (!val || typeof val !== 'string') return null;
  const trimmed = val.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Normalizes a company domain: removes http/https schemes, www prefixes, and paths.
 */
function cleanDomain(val?: string | null): string | null {
  const cleaned = cleanString(val);
  if (!cleaned) return null;
  const extracted = extractDomain(cleaned);
  return extracted ? extracted.toLowerCase() : cleaned.toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0];
}

/**
 * Phase 1 - Layer 0 Enrichment Engine (Overloaded Input & Field Routing)
 * Company (domain or name) is the primary identifier.
 * Person names (first_name, last_name) are secondary.
 */
export async function enrichContact(input: EnrichmentInput): Promise<EnrichmentOutput> {
  // 1. Layer 0 Input Normalization
  const firstName = cleanString(input.first_name);
  const lastName = cleanString(input.last_name);
  const companyName = cleanString(input.company_name);
  const companyDomain = cleanDomain(input.company_domain);
  const companyCity = cleanString(input.company_city);
  const companyCountry = cleanString(input.company_country);

  // 2. Company Primary Identifier Validation
  if (!companyDomain && !companyName) {
    throw new Error('Missing primary company identifier: either company_name or company_domain must be provided');
  }

  // 3. Requested Fields Resolution
  const rawFields = Array.isArray(input.fields) ? input.fields : [];
  const validFields: EnrichmentField[] = ['workEmail', 'personalEmail', 'phone'];
  const requestedFields: EnrichmentField[] = rawFields.filter((f): f is EnrichmentField => validFields.includes(f));
  const activeFields: EnrichmentField[] = requestedFields.length > 0 ? requestedFields : validFields;

  // 4. Cache Check (Layer 0 Cache)
  const primaryId = companyDomain || companyName!;
  const personId = [firstName, lastName].filter(Boolean).join('_');
  const cacheKey = `l0:${primaryId}:${personId}:${[...activeFields].sort().join(',')}`.toLowerCase();

  if (enrichmentCache.has(cacheKey)) {
    const cachedEntry = enrichmentCache.get(cacheKey)!;
    console.log('[Layer 0 Cache Hit]:', cacheKey);
    return { ...cachedEntry, cached: true };
  }

  console.log('[Layer 0 Normalization & Routing]', {
    primaryId,
    person: personId || 'COMPANY_LEVEL',
    fields: activeFields,
  });

  // 5. MX Check for Company Domain
  let domainMxValid: boolean | null = null;
  if (companyDomain) {
    try {
      const records = await dns.promises.resolveMx(companyDomain);
      domainMxValid = Array.isArray(records) && records.length > 0;
      if (!domainMxValid) {
        console.log('[Layer 0 MX Check] Domain has no MX records:', companyDomain);
      }
    } catch {
      domainMxValid = false;
      console.log('[Layer 0 MX Check] Failed to resolve MX for:', companyDomain);
    }
  }

  // 6. Field Routing & Waterfall Planning (Architecture Setup - No real API burn)
  const plannedWaterfall: PlannedWaterfall = {};
  const skippedFields: { field: EnrichmentField; reason: string }[] = [];
  let workEmail: FieldEnrichmentResult | null = null;
  let personalEmail: FieldEnrichmentResult | null = null;
  let phone: FieldEnrichmentResult | null = null;

  for (const field of activeFields) {
    if (field === 'workEmail') {
      if (firstName && companyDomain) {
        plannedWaterfall.workEmail = ['prospeo', 'tomba', 'findymail'];
        workEmail = {
          value: null,
          provider: null,
          confidence: null,
          status: 'ROUTED',
          reason: `Routed to Name+Domain waterfall (${plannedWaterfall.workEmail.join(' -> ')})`,
        };
      } else if (companyDomain) {
        plannedWaterfall.workEmail = ['tomba_domain_search', 'internal_crawler'];
        workEmail = {
          value: null,
          provider: null,
          confidence: null,
          status: 'ROUTED',
          reason: 'Company-level domain search (no person name provided)',
        };
      } else {
        plannedWaterfall.workEmail = ['google_search_enricher', 'company_finder'];
        workEmail = {
          value: null,
          provider: null,
          confidence: null,
          status: 'ROUTED',
          reason: 'Company-name fallback email waterfall',
        };
      }
    }

    if (field === 'personalEmail') {
      if (firstName) {
        plannedWaterfall.personalEmail = ['leadmagic_personal', 'bettercontact_personal'];
        personalEmail = {
          value: null,
          provider: null,
          confidence: null,
          status: 'ROUTED',
          reason: `Routed to Personal Email waterfall for ${firstName} ${lastName || ''}`.trim(),
        };
      } else {
        skippedFields.push({ field: 'personalEmail', reason: 'Personal email enrichment requires first_name' });
        personalEmail = {
          value: null,
          provider: null,
          confidence: null,
          status: 'SKIPPED',
          reason: 'Requires first_name',
        };
      }
    }

    if (field === 'phone') {
      plannedWaterfall.phone = ['icypeas', 'twilio_lookup'];
      phone = {
        value: null,
        provider: null,
        confidence: null,
        status: 'ROUTED',
        reason: `Routed to Phone waterfall for ${companyName || companyDomain}`,
      };
    }
  }

  // 7. Layer 0 Routing Metadata & Output Assembly
  const routing: Layer0RoutingMetadata = {
    requestedFields: activeFields,
    primaryIdentifier: companyDomain ? 'domain' : 'company_name',
    hasPersonName: Boolean(firstName),
    domainMxValid,
    plannedWaterfall,
    ...(skippedFields.length > 0 ? { skippedFields } : {}),
  };

  const output: EnrichmentOutput = {
    success: true,
    workEmail,
    personalEmail,
    phone,
    cached: false,
    totalCost: 0,
    routing,
  };

  enrichmentCache.set(cacheKey, output);
  return output;
}

export * from './types';
