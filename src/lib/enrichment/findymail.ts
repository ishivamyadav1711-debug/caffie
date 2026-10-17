import { normalizeEmail } from '@/utils/emailUtils';

export async function findymailFindEmail(input: { first_name: string; last_name?: string; company_domain?: string; company_name?: string }) {
  console.log('[Enrichment] Calling Findymail for:', input.first_name, input.company_domain || input.company_name);
  const apiKey = process.env.FINDYMAIL_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch('https://app.findymail.com/api/search/name', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        name: [input.first_name, input.last_name].filter(Boolean).join(' '),
        domain: input.company_domain,
        company: input.company_name,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const rawEmail = data.contact?.email || data.email;
    const email = normalizeEmail(rawEmail);
    if (!email) return null;
    return { email, provider: 'findymail', confidence: 0.9 };
  } catch (err) {
    console.warn('[Findymail] Error:', err);
    return null;
  }
}
