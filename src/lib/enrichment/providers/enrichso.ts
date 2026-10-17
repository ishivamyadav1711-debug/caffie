import { normalizeEmail } from '@/utils/emailUtils';
import { normalizePhone } from '@/utils/phoneUtils';
import { ProviderPersonalEmailResult, ProviderPhoneResult } from '../types';

/**
 * Enrich.so API Provider Adapter
 * Free alternative for testing/demos
 */

const ENRICHSO_BASE_URL = 'https://dev.enrich.so';

/**
 * Find email (work/personal) via Enrich.so API
 */
export async function enrichsoFindPersonalEmail(
  domain?: string | null,
  firstName?: string | null,
  lastName?: string | null
): Promise<ProviderPersonalEmailResult | null> {
  console.log('[Enrich.so] Email search for:', { firstName, lastName, domain });
  const apiKey = process.env.ENRICHSO_API_KEY;
  if (!apiKey) {
    console.warn('[Enrich.so] ENRICHSO_API_KEY not configured in environment');
    return null;
  }

  try {
    // 1. Primary endpoint: POST /api/v1/enrich/email
    let res = await fetch(`${ENRICHSO_BASE_URL}/api/v1/enrich/email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        domain: domain || '',
        first_name: firstName || '',
        last_name: lastName || '',
      }),
    });

    let data: any = null;

    if (res.ok) {
      data = await res.json();
    } else {
      // 2. Fallback endpoint: POST /api/v3/email-finder
      console.log(`[Enrich.so] /api/v1/enrich/email returned ${res.status}, trying /api/v3/email-finder fallback`);
      const fallbackRes = await fetch(`${ENRICHSO_BASE_URL}/api/v3/email-finder`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          firstName: firstName || '',
          lastName: lastName || '',
          domain: domain || '',
        }),
      });

      if (fallbackRes.ok) {
        data = await fallbackRes.json();
      } else {
        console.warn(`[Enrich.so] Both endpoints failed. Fallback returned ${fallbackRes.status}`);
        return null;
      }
    }

    const rawEmail =
      data?.email ||
      data?.personal_email ||
      data?.data?.email ||
      data?.data?.personal_email ||
      (typeof data === 'string' ? data : null);

    const email = normalizeEmail(rawEmail);
    if (!email) return null;

    return {
      email,
      provider: 'enrich.so',
      type: 'PERSONAL',
      confidence: 0.9,
    };
  } catch (err) {
    console.warn('[Enrich.so] Email search exception:', err);
    return null;
  }
}

/**
 * Find mobile/direct phone via Enrich.so API
 */
export async function enrichsoFindPhone(
  domain?: string | null,
  firstName?: string | null,
  lastName?: string | null
): Promise<ProviderPhoneResult | null> {
  console.log('[Enrich.so] Phone search for:', { firstName, lastName, domain });
  const apiKey = process.env.ENRICHSO_API_KEY;
  if (!apiKey) {
    console.warn('[Enrich.so] ENRICHSO_API_KEY not configured in environment');
    return null;
  }

  try {
    const res = await fetch(`${ENRICHSO_BASE_URL}/api/v1/enrich/phone`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        domain: domain || '',
        first_name: firstName || '',
        last_name: lastName || '',
      }),
    });

    if (!res.ok) {
      console.warn(`[Enrich.so] Phone search HTTP ${res.status} for ${firstName} @ ${domain}`);
      return null;
    }

    const data = await res.json();
    const rawPhone =
      data?.phone ||
      data?.mobile ||
      data?.direct_phone ||
      data?.data?.phone ||
      data?.data?.mobile ||
      data?.data?.direct_phone;

    if (!rawPhone || typeof rawPhone !== 'string') return null;

    let phone = normalizePhone(rawPhone);
    if (!phone) {
      const sanitized = rawPhone.trim().replace(/[^\d+()\s-]/g, '');
      if (sanitized.length >= 7) {
        phone = sanitized;
      }
    }

    if (!phone) return null;

    return {
      phone,
      provider: 'enrich.so',
      type: 'MOBILE',
      confidence: 0.85,
    };
  } catch (err) {
    console.warn('[Enrich.so] Phone search exception:', err);
    return null;
  }
}
