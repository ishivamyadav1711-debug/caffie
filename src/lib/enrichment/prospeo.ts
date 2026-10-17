import { normalizeEmail } from '@/utils/emailUtils';
import { ProviderEmailResult } from './types';

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

/**
 * Mode A: Person Search via Prospeo Email Finder
 */
export async function prospeoFindPersonEmail(
  domain: string,
  firstName: string,
  lastName?: string | null
): Promise<ProviderEmailResult | null> {
  console.log('[Prospeo] Person Search for:', { firstName, lastName, domain });
  const apiKey = process.env.PROSPEO_API_KEY;
  if (!apiKey) {
    console.warn('[Prospeo] PROSPEO_API_KEY not configured in environment');
    return null;
  }

  try {
    let res = await fetch('https://api.prospeo.io/enrich-person', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-KEY': apiKey,
      },
      body: JSON.stringify({
        only_verified_email: true,
        enrich_mobile: false,
        data: {
          first_name: firstName,
          last_name: lastName || '',
          company_website: domain,
        },
      }),
    });

    if (!res.ok) {
      // Fallback to legacy endpoint if needed
      res = await fetch('https://api.prospeo.io/email-finder', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-KEY': apiKey,
        },
        body: JSON.stringify({
          first_name: firstName,
          last_name: lastName || '',
          company: { domain },
          domain,
        }),
      });
    }

    if (!res.ok) {
      console.warn(`[Prospeo] Person search HTTP ${res.status} for ${firstName} @ ${domain}`);
      return null;
    }

    const data = await res.json();
    const rawEmail =
      data?.response?.person?.email?.email ||
      data?.person?.email?.email ||
      data?.response?.email ||
      data?.email;

    const email = normalizeEmail(rawEmail);
    if (!email) return null;

    const score =
      data?.response?.person?.email?.score ||
      data?.person?.email?.score ||
      data?.response?.score;

    const confidence = typeof score === 'number' ? score / 100 : 0.9;

    return {
      email,
      provider: 'prospeo',
      confidence,
      type: 'SPECIFIC',
    };
  } catch (err) {
    console.warn('[Prospeo] Person search exception:', err);
    return null;
  }
}

/**
 * Mode B: Domain Search via Prospeo (domain-search or enrich-company fallback)
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

  try {
    // 1. Try domain-search endpoint
    const res = await fetch('https://api.prospeo.io/domain-search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-KEY': apiKey,
      },
      body: JSON.stringify({
        domain,
        company: { domain },
      }),
    });

    if (res.ok) {
      const data = await res.json();
      const candidateEmails: string[] = [];

      // Extract from generic_emails
      const genericList = data?.response?.generic_emails || data?.generic_emails || [];
      if (Array.isArray(genericList)) {
        for (const item of genericList) {
          if (typeof item === 'string') candidateEmails.push(item);
          else if (item && typeof item.email === 'string') candidateEmails.push(item.email);
        }
      }

      // Extract from emails list
      const emailsList = data?.response?.emails || data?.emails || [];
      if (Array.isArray(emailsList)) {
        for (const item of emailsList) {
          if (typeof item === 'string') candidateEmails.push(item);
          else if (item && typeof item.email === 'string') {
            if (item.type === 'generic' || !item.first_name) {
              candidateEmails.unshift(item.email);
            } else {
              candidateEmails.push(item.email);
            }
          }
        }
      }

      const bestEmail = selectBestGenericEmail(candidateEmails);
      if (bestEmail) {
        return {
          email: bestEmail,
          provider: 'prospeo',
          confidence: 0.85,
          type: 'GENERIC',
        };
      }
    }

    // 2. Fallback: Try enrich-company endpoint
    const fallbackRes = await fetch('https://api.prospeo.io/enrich-company', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-KEY': apiKey,
      },
      body: JSON.stringify({
        data: { company_website: domain },
      }),
    }).catch(() => null);

    if (fallbackRes && fallbackRes.ok) {
      const fallbackData = await fallbackRes.json();
      const comp = fallbackData?.company || fallbackData?.response?.company;
      const candidates: string[] = [];
      if (comp?.email) candidates.push(comp.email);
      if (Array.isArray(comp?.generic_emails)) candidates.push(...comp.generic_emails);
      const bestFallback = selectBestGenericEmail(candidates);
      if (bestFallback) {
        return {
          email: bestFallback,
          provider: 'prospeo',
          confidence: 0.85,
          type: 'GENERIC',
        };
      }
    }

    return null;
  } catch (err) {
    console.warn('[Prospeo] Domain search exception:', err);
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
