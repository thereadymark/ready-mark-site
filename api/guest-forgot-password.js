import crypto from "crypto";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

function generateResetToken() {
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
    const { email } = req.body || {};

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const resendApiKey = process.env.RESEND_API_KEY;
    const resendFromEmail = process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";

    if (!supabaseUrl || !serviceRoleKey) {
      return res.status(500).json({ error: "Missing server environment variables" });
    }

    if (!resendApiKey) {
      return res.status(500).json({ error: "Missing RESEND_API_KEY" });
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    const headers = {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Accept: "application/json"
    };

    const userRes = await fetch(
      `${supabaseUrl}/rest/v1/guest_users?email=eq.${encodeURIComponent(normalizedEmail)}&select=*&limit=1`,
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

    // Security best practice: do not reveal whether an account exists
    if (!user) {
      return res.status(200).json({
        success: true,
        message: "If that email exists in our system, reset instructions have been sent."
      });
    }

    const resetToken = generateResetToken();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    const patchRes = await fetch(
      `${supabaseUrl}/rest/v1/guest_users?id=eq.${encodeURIComponent(user.id)}`,
      {
        method: "PATCH",
        headers: {
          ...headers,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          password_reset_token: resetToken,
          password_reset_expires_at: expiresAt
        })
      }
    );

    const patchText = await patchRes.text();

    if (!patchRes.ok) {
      return res.status(500).json({
        error: "Failed to save password reset token",
        details: patchText
      });
    }

    const resetLink = `https://verify.thereadymarkgroup.com/reset-password.html?token=${encodeURIComponent(resetToken)}`;

    await resend.emails.send({
      from: `Ready Mark <${resendFromEmail}>`,
      to: normalizedEmail,
      subject: "Reset your Ready Mark password",
      html: `
        <div style="font-family: Arial, sans-serif; padding: 24px; color: #111;">
          <h2 style="margin-bottom: 12px;">Reset your password</h2>
          <p style="margin-bottom: 18px;">
            We received a request to reset your Ready Mark password.
          </p>
          <p style="margin-bottom: 18px;">
            Click the button below to create a new password:
          </p>
          <a
            href="${resetLink}"
            style="display:inline-block;padding:12px 18px;background:#c7a257;color:#111;text-decoration:none;border-radius:6px;font-weight:700;"
          >
            Reset Password
          </a>
          <p style="margin-top:18px; margin-bottom: 0;">
            This link expires in 1 hour.
          </p>
        </div>
      `
    });

    return res.status(200).json({
      success: true,
      message: "If that email exists in our system, reset instructions have been sent."
    });
  } catch (error) {
    return res.status(500).json({
      error: `Server error: ${error.message}`
    });
  }
}
