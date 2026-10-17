import { normalizeEmail } from '@/utils/emailUtils';

export async function prospeoFindEmail(input: { first_name: string; last_name?: string; company_domain?: string; company_name?: string }) {
  console.log('[Enrichment] Calling Prospeo for:', input.first_name, input.company_domain || input.company_name);
  const apiKey = process.env.PROSPEO_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch('https://api.prospeo.io/email-finder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-KEY': apiKey },
      body: JSON.stringify({
        first_name: input.first_name,
        last_name: input.last_name || '',
        company: { name: input.company_name, domain: input.company_domain },
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const rawEmail = data.response?.email || data.email;
    const email = normalizeEmail(rawEmail);
    if (!email) return null;
    return { email, provider: 'prospeo', confidence: data.response?.score ? data.response.score / 100 : 0.9 };
  } catch (err) {
    console.warn('[Prospeo] Error:', err);
    return null;
  }
}
