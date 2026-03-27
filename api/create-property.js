export default async function handler(req, res) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  };

  Object.entries(corsHeaders).forEach(([key, value]) => {
    res.setHeader(key, value);
  });

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { property_name, property_slug, city, state, property_type } = req.body || {};

    if (!property_name || !property_slug || !city || !state || !property_type) {
      return res.status(400).json({
        error: "Missing one or more required fields: property_name, property_slug, city, state, property_type"
      });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !key) {
      return res.status(500).json({ error: "Missing server environment variables" });
    }

    const response = await fetch(`${supabaseUrl}/rest/v1/properties`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "return=representation"
      },
      body: JSON.stringify([{
        property_name,
        property_slug,
        city,
        state,
        property_type
      }])
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(500).json({
        error: typeof data === "string" ? data : JSON.stringify(data)
      });
    }

    return res.status(200).json({
      success: true,
      property: Array.isArray(data) && data.length ? data[0] : null
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
