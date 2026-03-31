import crypto from "crypto";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

function generateResetToken() {
  return crypto.randomBytes(32).toString("hex");
}

export default async function handler(req, res) {
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

    const normalizedEmail = String(email).trim().toLowerCase();

    const headers = {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Accept: "application/json"
    };

    // find user
    const userRes = await fetch(
      `${supabaseUrl}/rest/v1/guest_users?email=eq.${encodeURIComponent(normalizedEmail)}&select=*&limit=1`,
      { headers }
    );

    const userData = await userRes.json();
    const user = Array.isArray(userData) && userData.length ? userData[0] : null;

    // Always return success (security best practice)
    if (!user) {
      return res.status(200).json({ success: true });
    }

    const resetToken = generateResetToken();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    // store reset token
    await fetch(
      `${supabaseUrl}/rest/v1/guest_users?id=eq.${user.id}`,
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

    const resetLink = `https://verify.thereadymarkgroup.com/reset-password?token=${resetToken}`;

    await resend.emails.send({
      from: `Ready Mark <${process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev"}>`,
      to: normalizedEmail,
      subject: "Reset your Ready Mark password",
      html: `
        <div style="font-family: Arial; padding: 24px;">
          <h2>Password Reset</h2>
          <p>Click below to reset your password:</p>
          <a href="${resetLink}" style="display:inline-block;padding:12px 18px;background:#c7a257;color:#111;text-decoration:none;border-radius:6px;">
            Reset Password
          </a>
          <p style="margin-top:16px;">This link expires in 1 hour.</p>
        </div>
      `
    });

    return res.status(200).json({ success: true });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
