import crypto from "crypto";

function generateSessionToken() {
  return crypto.randomBytes(32).toString("hex");
}

export default async function handler(req, res) {
  const allowedOrigin = "https://verify.thereadymarkgroup.com";

  const corsHeaders = {
    "Access-Control-Allow-Origin": allowedOrigin,
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

    const normalizedEmail = String(email).trim().toLowerCase();
    const normalizedCode = String(code).trim();

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return res.status(500).json({ error: "Missing server configuration" });
    }

    const headers = {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    };

    const userRes = await fetch(
      `${supabaseUrl}/rest/v1/guest_users?email=eq.${encodeURIComponent(normalizedEmail)}&select=id,first_name,last_name,email,email_verified,email_verification_code,email_verification_expires_at&limit=1`,
      { headers }
    );

    const userData = await userRes.json().catch(() => null);

    if (!userRes.ok) {
      return res.status(500).json({
        error: "User lookup failed",
        details: userData
      });
    }

    const user = Array.isArray(userData) ? userData[0] : null;

    if (!user) {
      return res.status(400).json({ error: "Invalid or expired verification code" });
    }

    if (user.email_verified === true) {
      const sessionToken = generateSessionToken();
      const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString();

      const sessionRes = await fetch(`${supabaseUrl}/rest/v1/guest_sessions`, {
        method: "POST",
        headers: {
          ...headers,
          Prefer: "return=representation"
        },
        body: JSON.stringify([
          {
            guest_user_id: user.id,
            session_token: sessionToken,
            expires_at: expiresAt
          }
        ])
      });

      const sessionData = await sessionRes.json().catch(() => null);

      if (!sessionRes.ok) {
        return res.status(500).json({
          error: "Failed to create session",
          details: sessionData
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
    }

    const codeMatches =
      user.email_verification_code &&
      String(user.email_verification_code) === normalizedCode;

    const expiresAtMs = user.email_verification_expires_at
      ? new Date(user.email_verification_expires_at).getTime()
      : NaN;

    const codeExpired =
      !user.email_verification_expires_at ||
      Number.isNaN(expiresAtMs) ||
      expiresAtMs < Date.now();

    if (!codeMatches || codeExpired) {
      return res.status(400).json({ error: "Invalid or expired verification code" });
    }

    const verifyRes = await fetch(
      `${supabaseUrl}/rest/v1/guest_users?id=eq.${encodeURIComponent(user.id)}`,
      {
        method: "PATCH",
        headers: {
          ...headers,
          Prefer: "return=representation"
        },
        body: JSON.stringify({
          email_verified: true,
          email_verification_code: null,
          email_verification_expires_at: null
        })
      }
    );

    const verifyData = await verifyRes.json().catch(() => null);

    if (!verifyRes.ok) {
      return res.status(500).json({
        error: "Failed to verify email",
        details: verifyData
      });
    }

    const sessionToken = generateSessionToken();
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString();

    const sessionRes = await fetch(`${supabaseUrl}/rest/v1/guest_sessions`, {
      method: "POST",
      headers: {
        ...headers,
        Prefer: "return=representation"
      },
      body: JSON.stringify([
        {
          guest_user_id: user.id,
          session_token: sessionToken,
          expires_at: expiresAt
        }
      ])
    });

    const sessionData = await sessionRes.json().catch(() => null);

    if (!sessionRes.ok) {
      return res.status(500).json({
        error: "Failed to create session",
        details: sessionData
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
