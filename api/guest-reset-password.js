import crypto from "crypto";

function hashPassword(password) {
  return crypto.createHash("sha256").update(password).digest("hex");
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
    const { token, password } = req.body || {};

    if (!token || !password) {
      return res.status(400).json({ error: "Missing token or password" });
    }

    if (String(password).length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters." });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return res.status(500).json({ error: "Missing server environment variables" });
    }

    const headers = {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Accept: "application/json"
    };

    const userRes = await fetch(
      `${supabaseUrl}/rest/v1/guest_users?password_reset_token=eq.${encodeURIComponent(token)}&select=*&limit=1`,
      { headers }
    );

    const userData = await userRes.json().catch(() => null);

    if (!userRes.ok) {
      return res.status(500).json({
        error: "Password reset lookup failed",
        details: userData
      });
    }

    const user = Array.isArray(userData) && userData.length ? userData[0] : null;

    if (!user) {
      return res.status(400).json({ error: "Invalid or expired reset link." });
    }

    if (!user.password_reset_expires_at) {
      return res.status(400).json({ error: "Invalid or expired reset link." });
    }

    const expiresAtMs = new Date(user.password_reset_expires_at).getTime();
    if (Number.isNaN(expiresAtMs) || Date.now() > expiresAtMs) {
      return res.status(400).json({ error: "This reset link has expired." });
    }

    const newPasswordHash = hashPassword(String(password));

    const patchRes = await fetch(
      `${supabaseUrl}/rest/v1/guest_users?id=eq.${encodeURIComponent(user.id)}`,
      {
        method: "PATCH",
        headers: {
          ...headers,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          password_hash: newPasswordHash,
          password_reset_token: null,
          password_reset_expires_at: null
        })
      }
    );

    const patchText = await patchRes.text();

    if (!patchRes.ok) {
      return res.status(500).json({
        error: "Failed to reset password",
        details: patchText
      });
    }

    return res.status(200).json({
      success: true,
      message: "Password updated successfully."
    });
  } catch (error) {
    return res.status(500).json({
      error: `Server error: ${error.message}`
    });
  }
}
