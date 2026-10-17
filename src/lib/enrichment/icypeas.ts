import { normalizePhone } from '@/utils/phoneUtils';

export async function icypeasFindPhone(input: { first_name: string; last_name?: string; company_domain?: string; company_name?: string; company_country?: string }) {
  console.log('[Enrichment] Calling Icypeas for:', input.first_name, input.company_name);
  const apiKey = process.env.ICYPEAS_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch('https://app.icypeas.com/api/phone/find', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        first_name: input.first_name,
        last_name: input.last_name || '',
        domain: input.company_domain,
        company: input.company_name,
        country: input.company_country,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const rawPhone = data.phone || data.data?.phone;
    const phone = normalizePhone(rawPhone, input.company_country);
    if (!phone) return null;
    return { phone, provider: 'icypeas' };
  } catch (err) {
    console.warn('[Icypeas] Error:', err);
    return null;
  }
}
