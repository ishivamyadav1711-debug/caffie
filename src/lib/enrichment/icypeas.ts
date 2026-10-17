import { normalizePhone } from '@/utils/phoneUtils';
import { ProviderPhoneResult } from './types';

/**
 * Find mobile/direct phone number via Icypeas API
 */
export async function icypeasFindPhone(
  domain?: string | null,
  firstName?: string | null,
  lastName?: string | null,
  country?: string | null
): Promise<ProviderPhoneResult | null> {
  console.log('[Icypeas] Phone Search for:', { firstName, lastName, domain, country });
  const apiKey = process.env.ICYPEAS_API_KEY;
  if (!apiKey) {
    console.warn('[Icypeas] ICYPEAS_API_KEY not configured in environment');
    return null;
  }

  try {
    const res = await fetch('https://app.icypeas.com/api/phone/find', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'X-API-KEY': apiKey,
      },
      body: JSON.stringify({
        first_name: firstName || '',
        last_name: lastName || '',
        domain: domain || '',
        country: country || 'US',
      }),
    });

    if (!res.ok) {
      console.warn(`[Icypeas] Phone search HTTP ${res.status} for ${firstName} @ ${domain}`);
      return null;
    }

    const data = await res.json();
    const rawPhone = data.phone || data.data?.phone || data.mobile || data.data?.mobile;
    const phone = normalizePhone(rawPhone, country || undefined);
    if (!phone) return null;

    return {
      phone,
      provider: 'icypeas',
      type: 'MOBILE',
      confidence: 0.85,
    };
  } catch (err) {
    console.warn('[Icypeas] Phone search exception:', err);
    return null;
  }
}
