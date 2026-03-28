import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-admin-token"
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

  const adminToken = req.headers["x-admin-token"];

  if (!adminToken) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const {
      property_name,
      property_slug,
      city,
      state,
      property_type
    } = req.body || {};

    if (!property_name || !property_slug || !city || !state || !property_type) {
      return res.status(400).json({
        error: "property_name, property_slug, city, state, and property_type are required."
      });
    }

    const normalizedSlug = String(property_slug).trim().toLowerCase();

    const { data: existingProperty, error: existingError } = await supabase
      .from("properties")
      .select("id")
      .eq("property_slug", normalizedSlug)
      .maybeSingle();

    if (existingError) {
      return res.status(500).json({ error: existingError.message });
    }

    if (existingProperty) {
      return res.status(400).json({
        error: "A property with this slug already exists."
      });
    }

    const { data, error } = await supabase
      .from("properties")
      .insert([
        {
          property_name: String(property_name).trim(),
          property_slug: normalizedSlug,
          city: String(city).trim(),
          state: String(state).trim(),
          property_type: String(property_type).trim()
        }
      ])
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({
      success: true,
      property: data
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Internal server error"
    });
  }
}
