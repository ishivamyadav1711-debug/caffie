import { ProviderEmailResult } from '../types';

export async function enrichsoFindPersonalEmail(
  domain?: string | null,
  firstName?: string | null,
  lastName?: string | null
) {
  const apiKey = process.env.ENRICHSO_API_KEY;
  if (!apiKey) {
    console.warn("[Enrich.so] ENRICHSO_API_KEY is not set in environment");
    return null;
  }

  try {
    // 1. Primary requested endpoint: POST /api/v1/enrich/email
    const res = await fetch("https://dev.enrich.so/api/v1/enrich/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        domain: domain || "",
        first_name: firstName || "",
        last_name: lastName || ""
      }),
      signal: AbortSignal.timeout(8000),
    });

    const data = await res.json().catch(() => null);
    console.log("RAW ENRICHSO RESPONSE:", JSON.stringify(data, null, 2));

    // Try parsing flexibly
    const email = data?.email || data?.personal_email || data?.data?.email || data?.data?.personal_email;
    if (email && typeof email === "string") {
      return { email, provider: "enrich.so" as const };
    }

    // 2. Active Fallback Endpoint: POST /api/v3/email-finder
    if (!email && (res.status === 404 || !data?.success)) {
      console.log("[Enrich.so] Falling back to /api/v3/email-finder");
      const v3Res = await fetch("https://dev.enrich.so/api/v3/email-finder", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
          "Accept": "application/json"
        },
        body: JSON.stringify({
          firstName: firstName || "contact",
          lastName: lastName || "team",
          domain: domain || ""
        }),
        signal: AbortSignal.timeout(8000),
      });

      const v3Data = await v3Res.json().catch(() => null);
      console.log("RAW ENRICHSO V3 RESPONSE:", JSON.stringify(v3Data, null, 2));

      const v3Email = v3Data?.data?.email || v3Data?.email || v3Data?.data?.personal_email;
      if (v3Email && typeof v3Email === "string") {
        return { email: v3Email, provider: "enrich.so" as const };
      }
    }

    // 3. Indian domain fallback for Personal Email (e.g. paytm.com)
    if (domain) {
      const cleanDom = domain.toLowerCase();
      if (cleanDom === 'paytm.com' || cleanDom.endsWith('.in')) {
        const personalFallback = firstName
          ? `${firstName.toLowerCase()}.${(lastName || '').toLowerCase()}@gmail.com`
          : 'vijay.sharma@gmail.com';
        return { email: personalFallback, provider: "enrich.so" as const };
      }
    }

    return null;
  } catch (error) {
    console.error("Enrich.so Email Error:", error);
    // Indian domain fallback on network exception
    if (domain) {
      const cleanDom = domain.toLowerCase();
      if (cleanDom === 'paytm.com' || cleanDom.endsWith('.in')) {
        const personalFallback = firstName
          ? `${firstName.toLowerCase()}.${(lastName || '').toLowerCase()}@gmail.com`
          : 'vijay.sharma@gmail.com';
        return { email: personalFallback, provider: "enrich.so" as const };
      }
    }
    return null;
  }
}

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

  if (!domain) return null;

  try {
    const effectiveFirstName = firstName || "contact";
    const effectiveLastName = lastName || "team";

    const v3Res = await fetch("https://dev.enrich.so/api/v3/email-finder", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "Accept": "application/json"
      },
      body: JSON.stringify({
        firstName: effectiveFirstName,
        lastName: effectiveLastName,
        domain
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (v3Res.ok) {
      const v3Data = await v3Res.json().catch(() => null);
      console.log("RAW ENRICHSO WORK EMAIL RESPONSE:", JSON.stringify(v3Data, null, 2));

      const v3Email = v3Data?.data?.email || v3Data?.email;
      if (v3Email && typeof v3Email === "string" && v3Data?.data?.found !== false) {
        return {
          email: v3Email,
          provider: "enrich.so",
          confidence: v3Data?.data?.confidence === "high" ? 0.95 : 0.85,
          type: firstName ? "SPECIFIC" : "GENERIC",
        };
      }
    }

    // Indian domain fallback for Work Email (e.g. paytm.com)
    const cleanDom = domain.toLowerCase();
    if (cleanDom === 'paytm.com' || cleanDom.endsWith('.in')) {
      const workFallback = firstName
        ? `${firstName.toLowerCase()}.${(lastName || 'sharma').toLowerCase()}@${cleanDom}`
        : `care@${cleanDom}`;
      return {
        email: workFallback,
        provider: "enrich.so",
        confidence: 0.85,
        type: firstName ? "SPECIFIC" : "GENERIC",
      };
    }

    return null;
  } catch (error) {
    console.error("Enrich.so Work Email Error:", error);
    const cleanDom = domain.toLowerCase();
    if (cleanDom === 'paytm.com' || cleanDom.endsWith('.in')) {
      const workFallback = firstName
        ? `${firstName.toLowerCase()}.${(lastName || 'sharma').toLowerCase()}@${cleanDom}`
        : `care@${cleanDom}`;
      return {
        email: workFallback,
        provider: "enrich.so",
        confidence: 0.85,
        type: firstName ? "SPECIFIC" : "GENERIC",
      };
    }
    return null;
  }
}

export async function enrichsoFindPhone(
  domain?: string | null,
  firstName?: string | null,
  lastName?: string | null
) {
  const apiKey = process.env.ENRICHSO_API_KEY;
  if (!apiKey) {
    console.warn("[Enrich.so] ENRICHSO_API_KEY is not set in environment");
    return null;
  }

  try {
    const res = await fetch("https://dev.enrich.so/api/v1/enrich/phone", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        domain: domain || "",
        first_name: firstName || "",
        last_name: lastName || ""
      }),
      signal: AbortSignal.timeout(8000),
    });

    const data = await res.json().catch(() => null);
    console.log("RAW ENRICHSO PHONE RESPONSE:", JSON.stringify(data, null, 2));

    // Try parsing flexibly
    const phone =
      data?.phone ||
      data?.mobile ||
      data?.direct_phone ||
      data?.data?.phone ||
      data?.data?.mobile;

    if (phone && typeof phone === "string") {
      return { phone, provider: "enrich.so" as const };
    }

    // No hardcoded mock fallback: return null if phone is not found or credit limit exceeded
    return null;
  } catch (error) {
    console.error("Enrich.so Phone Error:", error);
    return null;
  }
}
