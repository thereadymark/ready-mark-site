import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function hashPassword(password) {
  return crypto.createHash("sha256").update(password).digest("hex");
}

function generateSessionToken() {
  return crypto.randomBytes(32).toString("hex");
}

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
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({ error: "Missing email or password" });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const password_hash = hashPassword(password);

    const { data: user, error: userError } = await supabase
      .from("guest_users")
      .select("*")
      .eq("email", normalizedEmail)
      .maybeSingle();

    if (userError) {
      return res.status(500).json({ error: userError.message });
    }

    if (!user || user.password_hash !== password_hash) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const session_token = generateSessionToken();
    const expires_at = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString();

    const { error: sessionError } = await supabase
      .from("guest_sessions")
      .insert([{
        guest_user_id: user.id,
        session_token,
        expires_at
      }]);

    if (sessionError) {
      return res.status(500).json({ error: sessionError.message });
    }

    return res.status(200).json({
      success: true,
      token: session_token,
      guest: {
        id: user.id,
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email
      }
    });
  } catch (error) {
    return res.status(500).json({
      error: `Server error: ${error.message}`
    });
  }
}
