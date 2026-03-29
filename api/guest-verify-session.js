import crypto from "crypto";

function generateSessionToken() {
  return crypto.randomBytes(32).toString("hex");
}

export default async function handler(req, res) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-guest-token"
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
    const token = req.headers["x-guest-token"];

    if (!token) {
      return res.status(401).json({ error: "Missing guest token" });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    const headers = {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Accept: "application/json"
    };

    const sessionRes = await fetch(
      `${supabaseUrl}/rest/v1/guest_sessions?session_token=eq.${encodeURIComponent(token)}&select=*&limit=1`,
      { headers }
    );

    const sessionData = await sessionRes.json();

    if (!sessionRes.ok) {
      return res.status(500).json({ error: "Session lookup failed", details: sessionData });
    }

    const session = Array.isArray(sessionData) && sessionData.length > 0 ? sessionData[0] : null;

    if (!session || new Date(session.expires_at) <= new Date()) {
      return res.status(401).json({ error: "Invalid or expired session" });
    }

    const userRes = await fetch(
      `${supabaseUrl}/rest/v1/guest_users?id=eq.${encodeURIComponent(session.guest_user_id)}&select=id,first_name,last_name,email,email_verified&limit=1`,
      { headers }
    );

    const userData = await userRes.json();

    if (!userRes.ok) {
      return res.status(500).json({ error: "Guest lookup failed", details: userData });
    }

    const user = Array.isArray(userData) && userData.length > 0 ? userData[0] : null;

    if (!user) {
      return res.status(401).json({ error: "Guest not found" });
    }

    return res.status(200).json({
      success: true,
      guest: user
    });
  } catch (error) {
    return res.status(500).json({
      error: `Server error: ${error.message}`
    });
  }
}
