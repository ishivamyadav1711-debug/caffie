import { normalizeEmail } from '@/utils/emailUtils';
import { ProviderPersonalEmailResult } from './types';

/**
 * Find personal email (gmail, yahoo, etc.) via LeadMagic API
 */
export async function leadmagicFindPersonalEmail(
  domain?: string | null,
  firstName?: string | null,
  lastName?: string | null
): Promise<ProviderPersonalEmailResult | null> {
  console.log('[LeadMagic] Personal Email Search for:', { firstName, lastName, domain });
  const apiKey = process.env.LEADMAGIC_API_KEY;
  if (!apiKey) {
    console.warn('[LeadMagic] LEADMAGIC_API_KEY not configured in environment');
    return null;
  }

  try {
    const res = await fetch('https://api.leadmagic.io/v1/people/personal-email-finder', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        first_name: firstName || '',
        last_name: lastName || '',
        domain: domain || '',
      }),
    });

    if (!res.ok) {
      console.warn(`[LeadMagic] Personal email search HTTP ${res.status} for ${firstName} @ ${domain}`);
      return null;
    }

    const data = await res.json();
    const rawEmail =
      data.personal_email ||
      data.email ||
      data['personal-email'] ||
      data.data?.personal_email ||
      data.data?.email;

    const email = normalizeEmail(rawEmail);
    if (!email) return null;

    return {
      email,
      provider: 'leadmagic',
      type: 'PERSONAL',
      confidence: 0.85,
    };
  } catch (err) {
    console.warn('[LeadMagic] Personal email search exception:', err);
    return null;
  }
}
