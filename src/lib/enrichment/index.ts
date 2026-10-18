import dns from 'dns';
import { extractDomain } from '@/utils/urlUtils';
import { prisma } from '@/lib/prisma';
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
import { enrichsoFindPersonalEmail, enrichsoFindPhone } from './enrichso';
import { verifyEmail, verifyPhone } from './verify';

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
 * Generates a normalized deduplication key for enrichment caching.
 */
export function generateDedupKey(
  primaryId: string,
  personId: string,
  fields: EnrichmentField[]
): string {
  const normalizedPrimary = primaryId.toLowerCase().trim();
  const normalizedPerson = personId ? personId.toLowerCase().trim() : 'company';
  return `${normalizedPrimary}:${normalizedPerson}:${[...fields].sort().join(',')}`;
}

/**
 * LeadPilot Enrichment Engine
 * Phase 4 & 5: DB Caching, Verification (ZeroBounce & Twilio), Waterfall with DB Persistence
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

  // 4. Cache Check (Layer 0 Memory Cache & Database Caching)
  const primaryId = companyDomain || companyName!;
  const personId = [firstName, lastName].filter(Boolean).join('_');
  const cacheKey = `l0:${primaryId}:${personId}:${[...activeFields].sort().join(',')}`.toLowerCase();
  const dedupKey = generateDedupKey(primaryId, personId, activeFields);

  if (enrichmentCache.has(cacheKey)) {
    const cachedEntry = enrichmentCache.get(cacheKey)!;
    console.log('[Enrichment Memory Cache Hit]:', cacheKey);
    return { ...cachedEntry, cached: true };
  }

  // STEP 3.1: Database Check First
  try {
    const cachedResult = await prisma.enrichmentResult.findFirst({
      where: {
        dedupKey,
        expiresAt: {
          gt: new Date(),
        },
      },
      include: {
        request: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (cachedResult) {
      console.log('[Enrichment DB Cache Hit]:', dedupKey);
      const prov = (cachedResult.provenance as any) || {};

      const workEmailRes: FieldEnrichmentResult | null = activeFields.includes('workEmail')
        ? prov.workEmail || {
            value: cachedResult.workEmail,
            provider: cachedResult.workEmailProvider,
            status: cachedResult.workEmail ? 'FOUND' : 'NOT_FOUND',
            confidence: cachedResult.workEmail ? 0.9 : null,
            verified: Boolean(cachedResult.workEmail),
          }
        : null;

      const personalEmailRes: FieldEnrichmentResult | null = activeFields.includes('personalEmail')
        ? prov.personalEmail || {
            value: cachedResult.personalEmail,
            provider: cachedResult.personalEmailProvider,
            status: cachedResult.personalEmail ? 'FOUND' : 'NOT_FOUND',
            confidence: cachedResult.personalEmail ? 0.9 : null,
            verified: Boolean(cachedResult.personalEmail),
          }
        : null;

      const phoneRes: FieldEnrichmentResult | null = activeFields.includes('phone')
        ? prov.phone || {
            value: cachedResult.phone,
            provider: cachedResult.phoneProvider,
            status: cachedResult.phone ? 'FOUND' : 'NOT_FOUND',
            confidence: cachedResult.phone ? 0.85 : null,
            verified: Boolean(cachedResult.phone),
          }
        : null;

      const dbOutput: EnrichmentOutput = {
        success: true,
        workEmail: workEmailRes,
        personalEmail: personalEmailRes,
        phone: phoneRes,
        cached: true,
        totalCost: cachedResult.totalCost,
        routing: prov.routing || {
          requestedFields: activeFields,
          primaryIdentifier: companyDomain ? 'domain' : 'company_name',
          hasPersonName: Boolean(firstName),
          domainMxValid: null,
          plannedWaterfall: {},
        },
      };

      enrichmentCache.set(cacheKey, dbOutput);
      return dbOutput;
    }
  } catch (dbErr) {
    console.warn('[Enrichment DB Cache Check Warning]:', dbErr);
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

    // Step 3.2: Verification Layer for Work Email
    if (workEmail?.value) {
      const isValid = await verifyEmail(workEmail.value);
      if (!isValid) {
        console.log('[Verification] Work email failed verification:', workEmail.value);
        workEmail = {
          ...workEmail,
          status: 'INVALID',
          value: null,
          verified: false,
          reason: 'Failed email verification',
        };
      } else {
        workEmail.verified = true;
      }
    }
  }

  // --- PERSONAL EMAIL EXECUTION (Free Demo: Enrich.so, cost $0.00) ---
  if (activeFields.includes('personalEmail')) {
    if (firstName) {
      plannedWaterfall.personalEmail = ['enrich.so'];
      // totalCost += 0.03; // LeadMagic cost commented out for Free Demo

      // const lmRes = await leadmagicFindPersonalEmail(companyDomain, firstName, lastName);
      const enrichRes = await enrichsoFindPersonalEmail(companyDomain, firstName, lastName);

      if (enrichRes?.email) {
        personalEmail = {
          value: enrichRes.email,
          provider: 'enrich.so',
          confidence: 0.9,
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

    // Step 3.2: Verification Layer for Personal Email
    if (personalEmail?.value) {
      const isValid = await verifyEmail(personalEmail.value);
      if (!isValid) {
        console.log('[Verification] Personal email failed verification:', personalEmail.value);
        personalEmail = {
          ...personalEmail,
          status: 'INVALID',
          value: null,
          verified: false,
          reason: 'Failed email verification',
        };
      } else {
        personalEmail.verified = true;
      }
    }
  }

  // --- PHONE EXECUTION (Free Demo: Enrich.so, cost $0.00) ---
  if (activeFields.includes('phone')) {
    if (companyDomain) {
      plannedWaterfall.phone = ['enrich.so'];
      // totalCost += 0.019; // Icypeas cost commented out for Free Demo

      // const icyRes = await icypeasFindPhone(companyDomain, firstName, lastName, companyCountry);
      const enrichRes = await enrichsoFindPhone(companyDomain, firstName, lastName);

      if (enrichRes?.phone) {
        phone = {
          value: enrichRes.phone,
          provider: 'enrich.so',
          confidence: 0.85,
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

    // Step 3.2: Verification Layer for Phone
    if (phone?.value) {
      const isValid = await verifyPhone(phone.value, companyCountry || 'IN');
      if (!isValid) {
        console.log('[Verification] Phone failed verification:', phone.value);
        phone = {
          ...phone,
          status: 'INVALID',
          value: null,
          verified: false,
          reason: 'Failed phone verification',
        };
      } else {
        phone.verified = true;
      }
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

  // 8. DB Save (TTL: 90 days)
  try {
    const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
    await prisma.enrichmentRequest.create({
      data: {
        dedupKey,
        firstName,
        lastName,
        domain: companyDomain,
        fields: activeFields,
        status: output.success ? 'COMPLETED' : 'FAILED',
        result: {
          create: {
            dedupKey,
            workEmail: workEmail?.value ?? null,
            workEmailProvider: workEmail?.provider ?? null,
            personalEmail: personalEmail?.value ?? null,
            personalEmailProvider: personalEmail?.provider ?? null,
            phone: phone?.value ?? null,
            phoneProvider: phone?.provider ?? null,
            totalCost: output.totalCost,
            provenance: output as any,
            expiresAt,
          },
        },
      },
    });
    console.log('[Enrichment DB Saved]:', dedupKey);
  } catch (dbErr) {
    console.error('[Enrichment DB Save Error]:', dbErr);
  }

  return output;
}

export * from './types';
export * from './verify';
export * from './prospeo';
export * from './tomba';
export * from './icypeas';
export * from './leadmagic';

