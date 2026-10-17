import { normalizeEmail } from '@/utils/emailUtils';

export async function tombaFindEmail(input: { first_name: string; last_name?: string; company_domain?: string; company_name?: string }) {
  console.log('[Enrichment] Calling Tomba for:', input.first_name, input.company_domain || input.company_name);
  const apiKey = process.env.TOMBA_API_KEY;
  if (!apiKey) return null;
  try {
    const params = new URLSearchParams({
      first_name: input.first_name,
      last_name: input.last_name || '',
      ...(input.company_domain ? { domain: input.company_domain } : {}),
      ...(input.company_name ? { company: input.company_name } : {}),
    });
    const res = await fetch(`https://api.tomba.io/v1/email-finder?${params.toString()}`, {
      headers: { 'X-Tomba-Key': apiKey },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const rawEmail = data.data?.email || data.email;
    const email = normalizeEmail(rawEmail);
    if (!email) return null;
    return { email, provider: 'tomba', confidence: data.data?.score ? data.data.score / 100 : 0.85 };
  } catch (err) {
    console.warn('[Tomba] Error:', err);
    return null;
  }
}
