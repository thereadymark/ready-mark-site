import crypto from "crypto";

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
    const { email, code } = req.body || {};

    if (!email || !code) {
      return res.status(400).json({ error: "Missing email or code" });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    const headers = {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Accept: "application/json"
    };

    const normalizedEmail = String(email).trim().toLowerCase();

    const userRes = await fetch(
      `${supabaseUrl}/rest/v1/guest_users?email=eq.${encodeURIComponent(normalizedEmail)}&select=*&limit=1`,
      { headers }
    );

    const userData = await userRes.json();

    if (!userRes.ok) {
      return res.status(500).json({ error: "User lookup failed", details: userData });
    }

    const user = Array.isArray(userData) && userData.length > 0 ? userData[0] : null;

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (String(user.email_verification_code || "").trim() !== String(code).trim()) {
      return res.status(400).json({ error: "Invalid verification code" });
    }

    if (!user.email_verification_expires_at || new Date(user.email_verification_expires_at) < new Date()) {
      return res.status(400).json({ error: "Verification code expired" });
    }

    const patchRes = await fetch(
      `${supabaseUrl}/rest/v1/guest_users?id=eq.${encodeURIComponent(user.id)}`,
      {
        method: "PATCH",
        headers: {
          ...headers,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email_verified: true,
          email_verification_code: null,
          email_verification_expires_at: null
        })
      }
    );

    const patchText = await patchRes.text();

    if (!patchRes.ok) {
      return res.status(500).json({
        error: "Failed to verify email",
        details: patchText
      });
    }

    const sessionToken = generateSessionToken();
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString();

    const sessionRes = await fetch(`${supabaseUrl}/rest/v1/guest_sessions`, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json"
      },
      body: JSON.stringify([{
        guest_user_id: user.id,
        session_token: sessionToken,
        expires_at: expiresAt
      }])
    });

    const sessionText = await sessionRes.text();

    if (!sessionRes.ok) {
      return res.status(500).json({
        error: "Failed to create guest session",
        details: sessionText
      });
    }

    return res.status(200).json({
      success: true,
      token: sessionToken,
      guest: {
        id: user.id,
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
        email_verified: true
      }
    });
  } catch (error) {
    return res.status(500).json({
      error: `Server error: ${error.message}`
    });
  }
}
