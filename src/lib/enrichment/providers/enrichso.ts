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
      })
    });

    const data = await res.json().catch(() => null);
    console.log("RAW ENRICHSO RESPONSE:", JSON.stringify(data, null, 2)); // CRITICAL FOR DEBUGGING

    // Try parsing flexibly (adjust based on actual response)
    const email = data?.email || data?.personal_email || data?.data?.email || data?.data?.personal_email;
    if (email && typeof email === "string") {
      return { email, provider: "enrich.so" as const };
    }

    // 2. Active Fallback Endpoint: POST /api/v3/email-finder (known active dev.enrich.so route)
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
          firstName: firstName || "",
          lastName: lastName || "",
          domain: domain || ""
        })
      });

      const v3Data = await v3Res.json().catch(() => null);
      console.log("RAW ENRICHSO V3 RESPONSE:", JSON.stringify(v3Data, null, 2));

      const v3Email = v3Data?.data?.email || v3Data?.email || v3Data?.data?.personal_email;
      if (v3Email && typeof v3Email === "string") {
        return { email: v3Email, provider: "enrich.so" as const };
      }
    }

    return null;
  } catch (error) {
    console.error("Enrich.so Email Error:", error);
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
      })
    });

    const data = await res.json().catch(() => null);
    console.log("RAW ENRICHSO PHONE RESPONSE:", JSON.stringify(data, null, 2)); // CRITICAL FOR DEBUGGING

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

    return null;
  } catch (error) {
    console.error("Enrich.so Phone Error:", error);
    return null;
  }
}
