import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  const allowedOrigin = "https://verify.thereadymarkgroup.com";

  const corsHeaders = {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-admin-password"
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
    const adminPassword = process.env.ADMIN_PORTAL_PASSWORD;
    const providedPassword = req.headers["x-admin-password"];

    if (!adminPassword) {
      return res.status(500).json({ error: "Missing ADMIN_PORTAL_PASSWORD" });
    }

    if (!providedPassword || providedPassword !== adminPassword) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return res.status(500).json({
        error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
      });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const {
      email,
      property_slug,
      full_name,
      role,
      is_active
    } = req.body || {};

    if (!email || typeof email !== "string") {
      return res.status(400).json({ error: "Valid email is required" });
    }

    if (!property_slug || typeof property_slug !== "string") {
      return res.status(400).json({ error: "property_slug is required" });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const normalizedSlug = String(property_slug).trim().toLowerCase();
    const cleanedName = full_name ? String(full_name).trim() : null;
    const cleanedRole = role ? String(role).trim().toLowerCase() : "manager";
    const activeFlag = typeof is_active === "boolean" ? is_active : true;

    const { data, error } = await supabase
      .from("client_users")
      .insert({
        email: normalizedEmail,
        property_slug: normalizedSlug,
        full_name: cleanedName,
        role: cleanedRole,
        is_active: activeFlag
      })
      .select()
      .maybeSingle();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({
      success: true,
      message: "Client user created successfully.",
      client_user: data
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Server error"
    });
  }
}
