import crypto from "crypto";

function generateSessionToken() {
  return crypto.randomBytes(32).toString("hex");
}

const SESSION_DAYS = 30;

export default async function handler(req, res) {
  const allowedOrigin = "https://verify.thereadymarkgroup.com";

  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { email, code } = req.body || {};

    if (!email || !code) {
      return res.status(400).json({ error: "Email and verification code are required." });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return res.status(500).json({ error: "Missing server environment variables" });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const normalizedCode = String(code).trim();

    const headers = {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Accept: "application/json",
      "Content-Type": "application/json"
    };

    const userRes = await fetch(
      `${supabaseUrl}/rest/v1/guest_users?email=eq.${encodeURIComponent(normalizedEmail)}&select=id,first_name,last_name,email,email_verified,email_verification_code,email_verification_expires_at&limit=1`,
      { headers }
    );

    const userData = await userRes.json().catch(() => null);

    if (!userRes.ok) {
      return res.status(500).json({
        error: "Verification lookup failed",
        details: userData
      });
    }

    const user = Array.isArray(userData) && userData.length ? userData[0] : null;

    if (!user) {
      return res.status(400).json({ error: "Invalid verification request." });
    }

    if (user.email_verified) {
      return res.status(200).json({
        success: true,
        already_verified: true,
        guest: {
          id: user.id,
          first_name: user.first_name,
          last_name: user.last_name,
          email: user.email,
          email_verified: true
        },
        message: "Email is already verified."
      });
    }

    if (!user.email_verification_code || !user.email_verification_expires_at) {
      return res.status(400).json({ error: "No active verification code found. Please request a new code." });
    }

    const expiresAtMs = new Date(user.email_verification_expires_at).getTime();

    if (Number.isNaN(expiresAtMs) || Date.now() > expiresAtMs) {
      return res.status(400).json({ error: "Verification code has expired. Please request a new code." });
    }

    if (String(user.email_verification_code).trim() !== normalizedCode) {
      return res.status(400).json({ error: "Invalid verification code." });
    }

    const patchRes = await fetch(
      `${supabaseUrl}/rest/v1/guest_users?id=eq.${encodeURIComponent(user.id)}`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          email_verified: true,
          email_verification_code: null,
          email_verification_expires_at: null,
          failed_login_attempts: 0,
          login_locked_until: null
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
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const sessionRes = await fetch(`${supabaseUrl}/rest/v1/guest_sessions`, {
      method: "POST",
      headers: {
        ...headers,
        Prefer: "return=representation"
      },
      body: JSON.stringify({
        guest_user_id: user.id,
        session_token: sessionToken,
        expires_at: expiresAt
      })
    });

    const sessionData = await sessionRes.json().catch(() => null);

    if (!sessionRes.ok) {
      return res.status(500).json({
        error: "Email verified, but session creation failed.",
        details: sessionData
      });
    }

    return res.status(200).json({
      success: true,
      token: sessionToken,
      expires_at: expiresAt,
      guest: {
        id: user.id,
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
        email_verified: true
      },
      message: "Email verified successfully."
    });
  } catch (error) {
    return res.status(500).json({
      error: `Server error: ${error.message}`
    });
  }
}
