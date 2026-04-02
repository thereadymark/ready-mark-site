import crypto from "crypto";
import { Resend } from "resend";

function generateResetToken() {
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

    const resend = new Resend(resendApiKey);
    const normalizedEmail = String(email).trim().toLowerCase();

    const headers = {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Accept: "application/json"
    };

    const userRes = await fetch(
      `${supabaseUrl}/rest/v1/guest_users?email=eq.${encodeURIComponent(normalizedEmail)}&select=id&limit=1`,
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

    // Do not reveal whether the account exists
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
        <div style="font-family: Georgia, serif; background:#121416; color:#f3eee5; padding:40px 20px;">
          <div style="max-width:520px; margin:0 auto; background:#0f1216; border:2px solid #d8bb7a; border-radius:18px; padding:30px; text-align:center;">
            <img src="https://verify.thereadymarkgroup.com/readymarkseal(best)nobackground.PNG" style="width:90px; margin-bottom:14px;" />

            <div style="width:140px; height:2px; margin:0 auto 18px; background:#d8bb7a;"></div>

            <h2 style="margin:0 0 10px; font-size:26px; letter-spacing:1px; color:#e6d39a;">
              The Ready Mark
            </h2>

            <p style="color:#d8bb7a; font-size:13px; letter-spacing:3px; text-transform:uppercase; margin-bottom:22px;">
              Password Reset
            </p>

            <p style="font-size:16px; line-height:1.7; margin-bottom:20px; color:#f3eee5;">
              We received a request to reset your Ready Mark password.
            </p>

            <p style="font-size:16px; line-height:1.7; margin-bottom:24px; color:#f3eee5;">
              Click the button below to create a new password:
            </p>

            <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin:0 auto 20px;">
              <tr>
                <td align="center" bgcolor="#c7a257" style="border-radius:10px;">
                  <a href="${resetLink}" style="display:inline-block; padding:14px 28px; font-size:18px; font-weight:700; font-family:Georgia, serif; color:#111315; text-decoration:none; background:#c7a257; border-radius:10px;">
                    Reset Password
                  </a>
                </td>
              </tr>
            </table>

            <p style="margin-top:8px; font-size:13px; color:#958d82;">
              This link expires in 1 hour.
            </p>
          </div>
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
