export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const {
      propertyName,
      propertyType,
      city,
      state,
      status
    } = req.body;

    if (!propertyName || !propertyType || !city || !state || !status) {
      return res.status(400).json({
        error: "Missing propertyName, propertyType, city, state, or status"
      });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return res.status(500).json({ error: "Missing server environment variables" });
    }

    const headers = {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    };

    function slugify(text) {
      return String(text)
        .toLowerCase()
        .trim()
        .replace(/&/g, "and")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .replace(/-{2,}/g, "-");
    }

    const baseSlug = slugify(propertyName);

    // Check for existing slugs
    const existingRes = await fetch(
      `${supabaseUrl}/rest/v1/properties?property_slug=like.${encodeURIComponent(baseSlug)}*&select=property_slug`,
      { headers }
    );

    const existingData = await existingRes.json();

    if (!existingRes.ok) {
      return res.status(500).json({
        error: "Property slug lookup failed",
        details: existingData
      });
    }

    const existingSlugs = new Set((existingData || []).map((p) => p.property_slug));
    let finalSlug = baseSlug;

    if (existingSlugs.has(finalSlug)) {
      let counter = 2;
      while (existingSlugs.has(`${baseSlug}-${counter}`)) {
        counter += 1;
      }
      finalSlug = `${baseSlug}-${counter}`;
    }

    const insertRes = await fetch(`${supabaseUrl}/rest/v1/properties`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        property_name: propertyName,
        property_slug: finalSlug,
        property_type: propertyType,
        city,
        state,
        status,
      }),
    });

    const insertData = await insertRes.json();

    if (!insertRes.ok) {
      return res.status(500).json({
        error: "Property insert failed",
        details: insertData
      });
    }

    return res.status(200).json({
      message: "Property created successfully",
      property: insertData[0],
    });
  } catch (error) {
    return res.status(500).json({
      error: "Server error",
      details: error.message,
    });
  }
}
