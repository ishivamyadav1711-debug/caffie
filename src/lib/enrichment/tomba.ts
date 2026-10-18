import { normalizeEmail } from '@/utils/emailUtils';
import { ProviderEmailResult } from './types';
import { selectBestGenericEmail } from './prospeo';

/**
 * Mode A: Person Search via Tomba Email Finder
 */
export async function tombaFindPersonEmail(
  domain: string,
  firstName: string,
  lastName?: string | null
): Promise<ProviderEmailResult | null> {
  console.log('[Tomba] Person Search for:', { firstName, lastName, domain });
  const apiKey = process.env.TOMBA_API_KEY;
  const secretKey = process.env.TOMBA_SECRET_KEY;
  if (!apiKey) {
    console.warn('[Tomba] TOMBA_API_KEY not configured in environment');
    return null;
  }

  try {
    const params = new URLSearchParams({
      domain,
      first_name: firstName,
      last_name: lastName || '',
    });

    const headers: Record<string, string> = {
      'X-Tomba-Key': apiKey,
    };
    if (secretKey) {
      headers['X-Tomba-Secret'] = secretKey;
    }

    const res = await fetch(`https://api.tomba.io/v1/email-finder?${params.toString()}`, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(6000),
    });

    if (!res.ok) {
      console.warn(`[Tomba] Person search HTTP ${res.status} for ${firstName} @ ${domain}`);
      return null;
    }

    const data = await res.json();
    const rawEmail = data?.data?.email || data?.email;
    const email = normalizeEmail(rawEmail);
    if (!email) return null;

    const confidence = typeof data?.data?.score === 'number'
      ? data.data.score / 100
      : 0.85;

    return {
      email,
      provider: 'tomba',
      confidence,
      type: 'SPECIFIC',
    };
  } catch (err) {
    console.warn('[Tomba] Person search exception:', err);
    return null;
  }
}

/**
 * Mode B: Domain Search via Tomba Domain Search
 */
export async function tombaFindDomainEmail(
  domain: string
): Promise<ProviderEmailResult | null> {
  console.log('[Tomba] Domain Search for:', domain);
  const apiKey = process.env.TOMBA_API_KEY;
  const secretKey = process.env.TOMBA_SECRET_KEY;
  if (!apiKey) {
    console.warn('[Tomba] TOMBA_API_KEY not configured in environment');
    return null;
  }

  try {
    const headers: Record<string, string> = {
      'X-Tomba-Key': apiKey,
    };
    if (secretKey) {
      headers['X-Tomba-Secret'] = secretKey;
    }

    const res = await fetch(`https://api.tomba.io/v1/domain-search?domain=${encodeURIComponent(domain)}`, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(6000),
    });

    if (!res.ok) {
      console.warn(`[Tomba] Domain search HTTP ${res.status} for domain ${domain}`);
      return null;
    }

    const data = await res.json();
    const emailsList = data?.data?.emails || data?.emails || [];
    if (!Array.isArray(emailsList) || emailsList.length === 0) {
      return null;
    }

    const genericEmails: string[] = [];
    const otherEmails: string[] = [];

    for (const item of emailsList) {
      const emailStr = typeof item === 'string' ? item : item?.email;
      if (!emailStr) continue;

      const isGeneric = item?.type === 'generic' || (!item?.first_name && !item?.last_name);
      if (isGeneric) {
        genericEmails.push(emailStr);
      } else {
        otherEmails.push(emailStr);
      }
    }

    // Pick first valid generic email (e.g., info@, contact@, sales@)
    const bestEmail = selectBestGenericEmail(genericEmails.length > 0 ? genericEmails : otherEmails);
    if (!bestEmail) return null;

    return {
      email: bestEmail,
      provider: 'tomba',
      confidence: 0.85,
      type: 'GENERIC',
    };
  } catch (err) {
    console.warn('[Tomba] Domain search exception:', err);
    return null;
  }
}

/**
 * Backward compatibility helper
 */
export async function tombaFindEmail(input: {
  first_name: string;
  last_name?: string;
  company_domain?: string;
  company_name?: string;
}) {
  if (input.company_domain) {
    return tombaFindPersonEmail(input.company_domain, input.first_name, input.last_name);
  }
  return null;
}
