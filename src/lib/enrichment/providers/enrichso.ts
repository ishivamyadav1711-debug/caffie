export async function enrichsoFindPersonalEmail(
  domain?: string | null,
  firstName?: string | null,
  lastName?: string | null
) {
  try {
    const res = await fetch("https://dev.enrich.so/api/v1/enrich/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.ENRICHSO_API_KEY}`
      },
      body: JSON.stringify({
        domain: domain || "",
        first_name: firstName || "",
        last_name: lastName || ""
      })
    });
    const data = await res.json();
    if (data && data.email) return { email: data.email as string, provider: "enrich.so" as const };
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
  try {
    const res = await fetch("https://dev.enrich.so/api/v1/enrich/phone", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.ENRICHSO_API_KEY}`
      },
      body: JSON.stringify({
        domain: domain || "",
        first_name: firstName || "",
        last_name: lastName || ""
      })
    });
    const data = await res.json();
    if (data && data.phone) return { phone: data.phone as string, provider: "enrich.so" as const };
    return null;
  } catch (error) {
    console.error("Enrich.so Phone Error:", error);
    return null;
  }
}
