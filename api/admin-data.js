export default async function handler(req, res) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  };

  Object.entries(corsHeaders).forEach(([key, value]) => {
    res.setHeader(key, value);
  });

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return res.status(500).json({ error: "Missing server environment variables" });
    }

    const headers = {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Accept: "application/json"
    };

    const propertiesUrl =
      `${supabaseUrl}/rest/v1/properties` +
      `?select=id,property_name,property_slug,city,state,property_type` +
      `&order=property_name.asc`;

    const propertiesRes = await fetch(propertiesUrl, { headers });
    const propertiesData = await propertiesRes.json();

    if (!propertiesRes.ok) {
      return res.status(500).json({
        error: "Property lookup failed",
        details: propertiesData
      });
    }

    return res.status(200).json({
      properties: Array.isArray(propertiesData) ? propertiesData : []
    });
  } catch (error) {
    return res.status(500).json({
      error: "Server error",
      details: error.message
    });
  }
}
