import { ProviderEmailResult, ProviderPhoneResult, ProviderPersonalEmailResult } from '../types';
import { normalizeEmail } from '@/utils/emailUtils';

export const PUBLIC_PERSONAL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.co.in',
  'yahoo.co.uk',
  'yahoo.ca',
  'yahoo.fr',
  'yahoo.de',
  'ymail.com',
  'rocketmail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'protonmail.com',
  'proton.me',
  'zoho.com',
  'yandex.com',
  'mail.com',
  'gmx.com',
  'gmx.net',
  'fastmail.com',
  'tutanota.com',
  'tuta.com',
  'rediffmail.com',
]);

/**
 * Validates that an email is genuinely a personal email (gmail, yahoo, outlook, etc.)
 * and NOT a corporate/work email.
 * - If email ends with @${domain} or matches corporate domain, returns false.
 * - If domain is not in the recognized public personal email domains, returns false.
 */
export function isPersonalEmail(email: string, corporateDomain?: string | null): boolean {
  if (!email || typeof email !== 'string' || !email.includes('@')) return false;
  const parts = email.toLowerCase().trim().split('@');
  if (parts.length !== 2) return false;
  const emailDomain = parts[1].trim();

  // 1. Strict check: If the email ends with @${domain} or domain part matches corporate domain, reject it
  if (corporateDomain) {
    const cleanCorp = corporateDomain.toLowerCase().trim().replace(/^www\./, '');
    if (emailDomain === cleanCorp || emailDomain.endsWith(`.${cleanCorp}`) || cleanCorp.endsWith(`.${emailDomain}`)) {
      return false;
    }
  }

  // 2. Strict check: Must belong to a recognized public personal provider
  return PUBLIC_PERSONAL_DOMAINS.has(emailDomain);
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
