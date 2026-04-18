import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const allowedOrigin = "https://verify.thereadymarkgroup.com";

    const corsHeaders = {
      "Access-Control-Allow-Origin": allowedOrigin,
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

    const { email } = req.query || {};

    if (!email || typeof email !== "string") {
      return res.status(400).json({ error: "Missing email" });
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    const { data, error } = await supabase
      .from("client_users")
      .select("email, property_slug, full_name, role, is_active")
      .eq("email", normalizedEmail)
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    if (!data || !data.is_active) {
      return res.status(404).json({ error: "Client user not found or inactive" });
    }

    return res.status(200).json({
      success: true,
      client_user: data
    });
  } catch (err) {
    return res.status(500).json({
      error: err.message || "Internal server error"
    });
  }
}
