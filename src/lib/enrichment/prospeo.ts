import { normalizeEmail } from '@/utils/emailUtils';
import { ProviderEmailResult, ProviderPhoneResult } from './types';

const GENERIC_PREFIXES = [
  'info@',
  'contact@',
  'hello@',
  'sales@',
  'support@',
  'office@',
  'admin@',
  'team@',
  'general@',
  'inquiries@',
];

/**
 * Selects the best generic email from a list of candidate strings,
 * prioritizing standard generic aliases like info@, contact@, hello@, etc.
 */
export function selectBestGenericEmail(emails: (string | null | undefined)[]): string | null {
  if (!emails || !Array.isArray(emails) || emails.length === 0) return null;
  const cleanedList = emails
    .map((e) => (typeof e === 'string' ? normalizeEmail(e) : null))
    .filter((e): e is string => Boolean(e));

  if (cleanedList.length === 0) return null;

  for (const prefix of GENERIC_PREFIXES) {
    const found = cleanedList.find((e) => e.startsWith(prefix));
    if (found) return found;
  }

  // Return the first valid cleaned email if no prefix match
  return cleanedList[0];
}

export interface ProspeoPersonEnrichResult {
  email?: ProviderEmailResult | null;
  phone?: ProviderPhoneResult | null;
  linkedinUrl?: string | null;
}

function maskKey(key?: string | null): string {
  if (!key) return '(not set)';
  if (key.length <= 8) return '***';
  return `${key.substring(0, 5)}...${key.substring(key.length - 3)}`;
}

/**
 * Mode A: Person Enrichment via Prospeo Enrich Person API
 * Strictly adheres to official Prospeo documentation:
 * POST https://api.prospeo.io/enrich-person
 * Headers: X-KEY: <PROSPEO_API_KEY>, Content-Type: application/json
 */
export async function prospeoEnrichPerson(
  domain: string,
  firstName: string,
  lastName?: string | null,
  enrichMobile: boolean = false
): Promise<ProspeoPersonEnrichResult | null> {
  console.log('[Prospeo] Enrich Person for:', { firstName, lastName, domain, enrichMobile });
  const apiKey = process.env.PROSPEO_API_KEY;
  if (!apiKey) {
    console.warn('[Prospeo] PROSPEO_API_KEY not configured in environment');
    return null;
  }

  const payload = {
    only_verified_email: true,
    enrich_mobile: enrichMobile,
    data: {
      first_name: firstName,
      last_name: lastName || '',
      company_website: domain,
    },
  };
  const url = 'https://api.prospeo.io/enrich-person';

  console.log(`[Prospeo] Key: ${maskKey(apiKey)}`);
  console.log(`[Prospeo] URL: ${url}`);
  console.log(`[Prospeo] Payload:`, JSON.stringify(payload));

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-KEY': apiKey,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });

    console.log(`[Prospeo] Status:`, res.status);
    let data: any = null;
    let rawResponse: string = '';
    if (typeof res.text === 'function') {
      try {
        rawResponse = await res.text();
        try {
          data = JSON.parse(rawResponse);
        } catch {
          data = rawResponse;
        }
      } catch {
        if (typeof res.json === 'function') {
          data = await res.json().catch(() => null);
          rawResponse = JSON.stringify(data);
        }
      }
    } else if (typeof res.json === 'function') {
      data = await res.json().catch(() => null);
      rawResponse = JSON.stringify(data);
    }
    console.log(`[Prospeo] Response:`, typeof data === 'object' ? JSON.stringify(data) : rawResponse);

    if (!res.ok || data?.error === true) {
      console.warn(`[Prospeo] Person enrich ${data?.error_code || res.status} for ${firstName} @ ${domain}. Details:`, JSON.stringify(data?.message || data?.error_details || rawResponse));
      return null;
    }

    const person = data?.person;
    if (!person) {
      return null;
    }

    let emailResult: ProviderEmailResult | null = null;
    const rawEmail = person?.email?.email;
    const email = normalizeEmail(rawEmail);
    if (email) {
      const isVerified = person?.email?.status === 'VERIFIED';
      const score = person?.email?.score;
      const confidence = typeof score === 'number' ? score / 100 : (isVerified ? 0.98 : 0.85);

      emailResult = {
        email,
        provider: 'prospeo',
        confidence,
        type: 'SPECIFIC',
      };
    }

    let phoneResult: ProviderPhoneResult | null = null;
    if (enrichMobile) {
      const rawPhone = person?.mobile?.mobile;
      if (rawPhone && typeof rawPhone === 'string' && rawPhone.trim().length > 0) {
        phoneResult = {
          phone: rawPhone.trim(),
          provider: 'prospeo',
          type: 'MOBILE',
          confidence: person?.mobile?.status === 'VERIFIED' ? 0.95 : 0.85,
        };
      }
    }

    const linkedinUrl = person?.linkedin_url || null;

    return {
      email: emailResult,
      phone: phoneResult,
      linkedinUrl,
    };
  } catch (err: any) {
    console.warn('[Prospeo] Person enrich exception:', err?.message || err);
    return null;
  }
}

/**
 * Mode A: Person Search via Prospeo (convenience wrapper returning work email)
 */
export async function prospeoFindPersonEmail(
  domain: string,
  firstName: string,
  lastName?: string | null
): Promise<ProviderEmailResult | null> {
  const result = await prospeoEnrichPerson(domain, firstName, lastName, false);
  return result?.email ?? null;
}

/**
 * Mode B: Domain Search via Prospeo Enrich Company API
 * Strictly queries official POST https://api.prospeo.io/enrich-company
 */
export async function prospeoFindDomainEmail(
  domain: string
): Promise<ProviderEmailResult | null> {
  console.log('[Prospeo] Domain Search for:', domain);
  const apiKey = process.env.PROSPEO_API_KEY;
  if (!apiKey) {
    console.warn('[Prospeo] PROSPEO_API_KEY not configured in environment');
    return null;
  }

  const payload = {
    data: { company_website: domain },
  };
  const url = 'https://api.prospeo.io/enrich-company';

  console.log(`[Prospeo] Key: ${maskKey(apiKey)}`);
  console.log(`[Prospeo] URL: ${url}`);
  console.log(`[Prospeo] Payload:`, JSON.stringify(payload));

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-KEY': apiKey,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });

    console.log(`[Prospeo] Status:`, res.status);
    let data: any = null;
    let rawResponse: string = '';
    if (typeof res.text === 'function') {
      try {
        rawResponse = await res.text();
        try {
          data = JSON.parse(rawResponse);
        } catch {
          data = rawResponse;
        }
      } catch {
        if (typeof res.json === 'function') {
          data = await res.json().catch(() => null);
          rawResponse = JSON.stringify(data);
        }
      }
    } else if (typeof res.json === 'function') {
      data = await res.json().catch(() => null);
      rawResponse = JSON.stringify(data);
    }
    console.log(`[Prospeo] Response:`, typeof data === 'object' ? JSON.stringify(data) : rawResponse);

    if (!res.ok || data?.error === true || !data?.company) {
      console.warn(`[Prospeo] Company enrich error: HTTP ${res.status}, error_code: ${data?.error_code || 'none'} for domain ${domain}. Details:`, JSON.stringify(data?.message || data?.error_details || rawResponse));
      return null;
    }

    const comp = data.company;
    const candidates: string[] = [];
    if (comp?.email) candidates.push(comp.email);
    if (Array.isArray(comp?.generic_emails)) candidates.push(...comp.generic_emails);

    const bestEmail = selectBestGenericEmail(candidates);
    if (bestEmail) {
      return {
        email: bestEmail,
        provider: 'prospeo',
        confidence: 0.85,
        type: 'GENERIC',
      };
    }

    return null;
  } catch (err: any) {
    console.warn('[Prospeo] Domain search exception:', err?.message || err);
    return null;
  }
}

/**
 * Backward compatibility helper
 */
export async function prospeoFindEmail(input: {
  first_name: string;
  last_name?: string;
  company_domain?: string;
  company_name?: string;
}) {
  if (input.company_domain) {
    return prospeoFindPersonEmail(input.company_domain, input.first_name, input.last_name);
  }
  return null;
}
