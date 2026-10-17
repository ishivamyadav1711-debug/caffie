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
import { prospeoFindPersonEmail, prospeoFindDomainEmail } from './prospeo';
import { tombaFindPersonEmail, tombaFindDomainEmail } from './tomba';
import { icypeasFindPhone } from './icypeas';
import { leadmagicFindPersonalEmail } from './leadmagic';

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
 * LeadPilot Enrichment Engine
 * Phase 3: Work Email (Prospeo + Tomba), Personal Email (LeadMagic), Phone (Icypeas)
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
    console.log('[Enrichment Cache Hit]:', cacheKey);
    return { ...cachedEntry, cached: true };
  }

  console.log('[Enrichment Start]', {
    primaryId,
    person: personId || 'COMPANY_LEVEL',
    fields: activeFields,
    mode: firstName ? 'PERSON_SEARCH' : 'DOMAIN_SEARCH',
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

  // 6. Waterfall Execution & Cost Tracking
  const plannedWaterfall: PlannedWaterfall = {};
  const skippedFields: { field: EnrichmentField; reason: string }[] = [];
  let workEmail: FieldEnrichmentResult | null = null;
  let personalEmail: FieldEnrichmentResult | null = null;
  let phone: FieldEnrichmentResult | null = null;
  let totalCost = 0;

  // --- WORK EMAIL EXECUTION (Wave 1 & Wave 2: Prospeo -> Tomba) ---
  if (activeFields.includes('workEmail')) {
    if (!companyDomain) {
      // Domain required for real API work email search
      plannedWaterfall.workEmail = ['skipped_no_domain'];
      workEmail = {
        value: null,
        provider: null,
        confidence: null,
        status: 'FAILED',
        type: null,
        reason: 'Domain required',
      };
    } else if (firstName) {
      // Mode A (Person Search): first_name is provided
      plannedWaterfall.workEmail = ['prospeo', 'tomba'];

      // Step 1: Try Prospeo person search first ($0.01)
      totalCost += 0.01;
      const prospeoRes = await prospeoFindPersonEmail(companyDomain, firstName, lastName);

      if (prospeoRes?.email) {
        workEmail = {
          value: prospeoRes.email,
          provider: 'prospeo',
          confidence: prospeoRes.confidence,
          type: 'SPECIFIC',
          status: 'FOUND',
        };
      } else {
        // Step 2: Try Tomba person search if Prospeo fails ($0.0078)
        totalCost += 0.0078;
        const tombaRes = await tombaFindPersonEmail(companyDomain, firstName, lastName);

        if (tombaRes?.email) {
          workEmail = {
            value: tombaRes.email,
            provider: 'tomba',
            confidence: tombaRes.confidence,
            type: 'SPECIFIC',
            status: 'FOUND',
          };
        } else {
          // Both failed
          workEmail = {
            value: null,
            provider: null,
            confidence: null,
            type: 'SPECIFIC',
            status: 'NOT_FOUND',
            reason: 'No work email found across providers',
          };
        }
      }
    } else {
      // Mode B (Domain Search): first_name is missing
      plannedWaterfall.workEmail = ['prospeo_domain_search', 'tomba_domain_search'];

      // Step 1: Try Prospeo domain search first ($0.01)
      totalCost += 0.01;
      const prospeoRes = await prospeoFindDomainEmail(companyDomain);

      if (prospeoRes?.email) {
        workEmail = {
          value: prospeoRes.email,
          provider: 'prospeo',
          confidence: prospeoRes.confidence,
          type: 'GENERIC',
          status: 'FOUND',
        };
      } else {
        // Step 2: Try Tomba domain search if Prospeo fails ($0.0078)
        totalCost += 0.0078;
        const tombaRes = await tombaFindDomainEmail(companyDomain);

        if (tombaRes?.email) {
          workEmail = {
            value: tombaRes.email,
            provider: 'tomba',
            confidence: tombaRes.confidence,
            type: 'GENERIC',
            status: 'FOUND',
          };
        } else {
          // Both failed
          workEmail = {
            value: null,
            provider: null,
            confidence: null,
            type: 'GENERIC',
            status: 'NOT_FOUND',
            reason: 'No generic email found across providers',
          };
        }
      }
    }
  }

  // --- PERSONAL EMAIL EXECUTION (Phase 3: LeadMagic, cost +$0.03) ---
  if (activeFields.includes('personalEmail')) {
    if (firstName) {
      plannedWaterfall.personalEmail = ['leadmagic'];
      totalCost += 0.03;

      const lmRes = await leadmagicFindPersonalEmail(companyDomain, firstName, lastName);

      if (lmRes?.email) {
        personalEmail = {
          value: lmRes.email,
          provider: 'leadmagic',
          confidence: lmRes.confidence || 0.85,
          type: 'PERSONAL',
          status: 'FOUND',
        };
      } else {
        personalEmail = {
          value: null,
          provider: null,
          confidence: null,
          type: 'PERSONAL',
          status: 'NOT_FOUND',
          reason: 'No personal email found',
        };
      }
    } else {
      skippedFields.push({ field: 'personalEmail', reason: 'Personal email enrichment requires first_name' });
      personalEmail = {
        value: null,
        provider: null,
        confidence: null,
        type: 'PERSONAL',
        status: 'SKIPPED',
        reason: 'Requires first_name',
      };
    }
  }

  // --- PHONE EXECUTION (Phase 3: Icypeas, cost +$0.019) ---
  if (activeFields.includes('phone')) {
    if (companyDomain) {
      plannedWaterfall.phone = ['icypeas'];
      totalCost += 0.019;

      const icyRes = await icypeasFindPhone(companyDomain, firstName, lastName, companyCountry);

      if (icyRes?.phone) {
        phone = {
          value: icyRes.phone,
          provider: 'icypeas',
          confidence: icyRes.confidence || 0.85,
          type: 'MOBILE',
          status: 'FOUND',
        };
      } else {
        phone = {
          value: null,
          provider: null,
          confidence: null,
          type: 'MOBILE',
          status: 'NOT_FOUND',
          reason: 'No direct phone found',
        };
      }
    } else {
      phone = {
        value: null,
        provider: null,
        confidence: null,
        status: 'FAILED',
        type: null,
        reason: 'Domain required',
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
    totalCost: Number(totalCost.toFixed(4)),
    routing,
  };

  enrichmentCache.set(cacheKey, output);
  return output;
}

export * from './types';
export * from './prospeo';
export * from './tomba';
export * from './icypeas';
export * from './leadmagic';
