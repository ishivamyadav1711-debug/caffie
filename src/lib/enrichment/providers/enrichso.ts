import { ProviderEmailResult, ProviderPhoneResult, ProviderPersonalEmailResult } from '../types';
import { normalizeEmail } from '@/utils/emailUtils';

/**
 * Searches for personal email via Enrich.so API.
 * Strictly returns only real API data. Returns null if not found.
 */
export async function enrichsoFindPersonalEmail(
  domain?: string | null,
  firstName?: string | null,
  lastName?: string | null
): Promise<ProviderPersonalEmailResult | null> {
  const apiKey = process.env.ENRICHSO_API_KEY;
  if (!apiKey) {
    console.warn("[Enrich.so] ENRICHSO_API_KEY is not set in environment");
    return null;
  }

  if (!domain || !firstName) {
    return null;
  }

  try {
    // 1. Primary endpoint: POST /api/v1/enrich/email
    const res = await fetch("https://dev.enrich.so/api/v1/enrich/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        domain,
        first_name: firstName,
        last_name: lastName || "",
      }),
      signal: AbortSignal.timeout(8000),
    });

    const data = await res.json().catch(() => null);
    console.log("RAW ENRICHSO PERSONAL EMAIL RESPONSE:", JSON.stringify(data, null, 2));

    const rawEmail = data?.email || data?.personal_email || data?.data?.email || data?.data?.personal_email;
    const email = normalizeEmail(rawEmail);
    if (email) {
      return { email, provider: "enrich.so", type: "PERSONAL", confidence: 0.9 };
    }

    // 2. Active Fallback Endpoint: POST /api/v3/email-finder
    if (res.status === 404 || !data?.success) {
      console.log("[Enrich.so] Falling back to /api/v3/email-finder for personal email");
      const v3Res = await fetch("https://dev.enrich.so/api/v3/email-finder", {
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

      if (v3Res.ok) {
        const v3Data = await v3Res.json().catch(() => null);
        console.log("RAW ENRICHSO V3 PERSONAL EMAIL RESPONSE:", JSON.stringify(v3Data, null, 2));

        if (v3Data?.data?.found === true) {
          const candidate = normalizeEmail(v3Data.data.email || v3Data.data.personal_email || v3Data.email);
          if (candidate) {
            return { email: candidate, provider: "enrich.so", type: "PERSONAL", confidence: 0.9 };
          }
        }
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

    if (data?.data?.found === true) {
      const email = normalizeEmail(data.data.email || data.email);
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

  if (!domain) {
    return null;
  }

  try {
    const res = await fetch("https://dev.enrich.so/api/v1/enrich/phone", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        domain,
        first_name: firstName || "",
        last_name: lastName || "",
      }),
      signal: AbortSignal.timeout(8000),
    });

    const data = await res.json().catch(() => null);
    console.log("RAW ENRICHSO PHONE RESPONSE:", JSON.stringify(data, null, 2));

    const rawPhone =
      data?.phone ||
      data?.mobile ||
      data?.direct_phone ||
      data?.data?.phone ||
      data?.data?.mobile;

    if (rawPhone && typeof rawPhone === "string" && rawPhone.trim().length > 0) {
      return { phone: rawPhone.trim(), provider: "enrich.so", type: "MOBILE" };
    }

    return null;
  } catch (error) {
    console.error("Enrich.so Phone Error:", error);
    return null;
  }
}
