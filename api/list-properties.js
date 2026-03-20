export default async function handler(req, res) {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return res.status(500).json({ error: "Missing server environment variables" });
    }

    const headers = {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    };

    const propertyRes = await fetch(
      `${supabaseUrl}/rest/v1/properties?select=*&order=property_name.asc`,
      { headers }
    );

    const propertyData = await propertyRes.json();

    if (!propertyRes.ok) {
      return res.status(500).json({ error: "Property lookup failed", details: propertyData });
    }

    return res.status(200).json({ properties: propertyData });
  } catch (error) {
    return res.status(500).json({
      error: "Server error",
      details: error.message,
    });
  }
}
