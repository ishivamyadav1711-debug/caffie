import { ProviderEmailResult, ProviderPhoneResult, ProviderPersonalEmailResult } from '../types';
import { normalizeEmail } from '@/utils/emailUtils';

export const ALLOWED_PUBLIC_DOMAINS = [
  'gmail.com',
  'yahoo.com',
  'hotmail.com',
  'outlook.com',
  'icloud.com',
  'protonmail.com',
];

/**
 * Validates that an email is genuinely a personal email from an allowed public domain.
 * - Rejects any email that ends with the company_domain (e.g. @oyorooms.com) or matches corporate domain.
 * - Only permits emails ending with one of the allowed public domains.
 */
export function isPersonalEmail(email: string, corporateDomain?: string | null): boolean {
  if (!email || typeof email !== 'string' || !email.includes('@')) return false;
  const parts = email.toLowerCase().trim().split('@');
  if (parts.length !== 2) return false;
  const emailDomain = parts[1].trim();

  // 1. Strict check: If email ends with @${company_domain} or matches corporate domain, reject it
  if (corporateDomain) {
    const cleanCorp = corporateDomain.toLowerCase().trim().replace(/^www\./, '');
    if (
      emailDomain === cleanCorp ||
      emailDomain.endsWith(`.${cleanCorp}`) ||
      cleanCorp.endsWith(`.${emailDomain}`) ||
      email.toLowerCase().endsWith(`@${cleanCorp}`)
    ) {
      return false;
    }
  }

  // 2. Only return true if it ends with one of the allowed public domains
  return ALLOWED_PUBLIC_DOMAINS.some(
    (allowed) => emailDomain === allowed || emailDomain.endsWith(`.${allowed}`)
  );
}

/**
 * Searches for personal email via Enrich.so API (v3 linkedin-to-personal-email).
 * Strictly returns only real API data. Returns null if not found or if the email
 * returned is a corporate/work email.
 */
export async function enrichsoFindPersonalEmail(
  domain?: string | null,
  firstName?: string | null,
  lastName?: string | null,
  linkedinUrl?: string | null
): Promise<ProviderPersonalEmailResult | null> {
  const apiKey = process.env.ENRICHSO_API_KEY;
  if (!apiKey) {
    console.warn("[Enrich.so] ENRICHSO_API_KEY is not set in environment");
    return null;
  }

  // dev.enrich.so personal email requires linkedinUrl
  if (!linkedinUrl) {
    return null;
  }

  try {
    const res = await fetch("https://dev.enrich.so/api/v3/linkedin-to-personal-email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "Accept": "application/json",
      },
      body: JSON.stringify({ linkedinUrl }),
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      console.warn(`[Enrich.so] Personal email HTTP ${res.status} for linkedinUrl: ${linkedinUrl}`);
      return null;
    }

    const data = await res.json().catch(() => null);
    console.log("RAW ENRICHSO PERSONAL EMAIL RESPONSE:", JSON.stringify(data, null, 2));

    if (data?.success && data?.data?.found === true && data.data.personalEmail) {
      const email = normalizeEmail(data.data.personalEmail);
      if (email && isPersonalEmail(email, domain)) {
        return {
          email,
          provider: "enrich.so",
          type: "PERSONAL",
          confidence: 0.9,
        };
      } else if (email) {
        console.log(`[Enrich.so] Rejected non-personal or corporate domain email: ${email} for domain: ${domain}`);
      }
    }

    return null;
  } catch (error) {
    console.error("Enrich.so Personal Email Error:", error);
    return null;
  }
}

/**
 * Searches for work email via Enrich.so API (/api/v3/email-finder).
 * Strictly returns only real API data. Returns null if not found.
 */
export async function enrichsoFindWorkEmail(
  domain?: string | null,
  firstName?: string | null,
  lastName?: string | null
): Promise<ProviderEmailResult | null> {
  const apiKey = process.env.ENRICHSO_API_KEY;
  if (!apiKey) {
    console.warn("[Enrich.so] ENRICHSO_API_KEY is not set in environment");
    return null;
  }

  // v3 email-finder requires firstName and domain
  if (!domain || !firstName) {
    return null;
  }

  try {
    const res = await fetch("https://dev.enrich.so/api/v3/email-finder", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "Accept": "application/json",
      },
      body: JSON.stringify({
        firstName,
        lastName: lastName || "",
        domain,
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      console.warn(`[Enrich.so] Work email search HTTP ${res.status} for ${firstName} @ ${domain}`);
      return null;
    }

    const data = await res.json().catch(() => null);
    console.log("RAW ENRICHSO WORK EMAIL RESPONSE:", JSON.stringify(data, null, 2));

    if (data?.data?.found === true && data.data.email) {
      const email = normalizeEmail(data.data.email);
      if (email) {
        return {
          email,
          provider: "enrich.so",
          confidence: data.data.confidence === "high" ? 0.95 : 0.85,
          type: "SPECIFIC",
        };
      }
    }

    return null;
  } catch (error) {
    console.error("Enrich.so Work Email Error:", error);
    return null;
  }
}

/**
 * Searches for direct phone via Enrich.so API.
 * Strictly returns only real API data. Returns null if not found.
 */
export async function enrichsoFindPhone(
  domain?: string | null,
  firstName?: string | null,
  lastName?: string | null
): Promise<ProviderPhoneResult | null> {
  const apiKey = process.env.ENRICHSO_API_KEY;
  if (!apiKey) {
    console.warn("[Enrich.so] ENRICHSO_API_KEY is not set in environment");
    return null;
  }

  // Enrich.so does not provide an active free phone lookup endpoint.
  // Return null safely without guessing or returning fake numbers.
  return null;
}
