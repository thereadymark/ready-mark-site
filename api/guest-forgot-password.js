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
    const now = Date.now();
const expiresAt = new Date(now + 60 * 60 * 1000).toISOString();
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
      headers: { "Content-Type": "text/html" },    
      from: `Ready Mark <${resendFromEmail}>`,
      to: normalizedEmail,
      subject: "Reset your Ready Mark password",
      html: `
  <div style="margin:0; padding:0; background:#f7f6f3;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f6f3; padding:40px 16px;">
      <tr>
        <td align="center">

          <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px; background:#ffffff; border-radius:18px; border:1px solid rgba(199,162,87,0.25); box-shadow:0 10px 30px rgba(0,0,0,0.08); padding:32px;">

            <!-- LOGO -->
            <tr>
              <td align="center" style="padding-bottom:10px;">
                <img src="https://verify.thereadymarkgroup.com/readymarkseal(best)nobackground.PNG" width="80" style="display:block;" />
              </td>
            </tr>

            <!-- BRAND -->
            <tr>
              <td align="center" style="font-family:Georgia, serif; font-size:22px; color:#111315; letter-spacing:1px;">
                The Ready Mark
              </td>
            </tr>

            <!-- DIVIDER -->
            <tr>
              <td align="center" style="padding:14px 0;">
                <div style="width:120px; height:2px; background:linear-gradient(90deg, transparent, #c7a257, transparent);"></div>
              </td>
            </tr>

            <!-- TITLE -->
            <tr>
              <td align="center" style="font-family:Georgia, serif; font-size:24px; color:#111315; padding-bottom:10px;">
                Password Reset
              </td>
            </tr>

            <!-- TEXT -->
            <tr>
              <td align="center" style="font-family:Arial, sans-serif; font-size:15px; color:#6f6a61; line-height:1.7; padding-bottom:18px;">
                We received a request to reset your Ready Mark password.
              </td>
            </tr>

            <tr>
              <td align="center" style="font-family:Arial, sans-serif; font-size:15px; color:#6f6a61; line-height:1.7; padding-bottom:26px;">
                Click below to create a new password.
              </td>
            </tr>

            <!-- BUTTON -->
            <tr>
              <td align="center">
                <table cellpadding="0" cellspacing="0">
                  <tr>
                    <td align="center" style="border-radius:10px; background:#c7a257;">
                      <a href="${resetLink}" style="
                        display:inline-block;
                        padding:14px 28px;
                        font-size:16px;
                        font-weight:700;
                        color:#111315;
                        text-decoration:none;
                        border-radius:10px;
                        font-family:Arial, sans-serif;
                      ">
                        Reset Password
                      </a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- FOOTER -->
            <tr>
              <td align="center" style="padding-top:26px; font-size:13px; color:#9a958d; font-family:Arial, sans-serif;">
                This link expires in 1 hour.
              </td>
            </tr>

          </table>

        </td>
      </tr>
    </table>
  </div>
`
    });

    return res.status(200).json({
      success: true,
      message: "If an account exists for this email, a reset link has been sent."
    });
  } catch (error) {
    return res.status(500).json({
      error: `Server error: ${error.message}`
    });
  }
}
