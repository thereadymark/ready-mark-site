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
<div style="margin:0;padding:0;background:#f7f6f3;font-family:Georgia,serif;color:#111315;">
  <div style="max-width:720px;margin:0 auto;padding:36px 20px;">
    <div style="
      background:linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(251,249,244,0.96) 100%);
      border:1px solid rgba(199,162,87,0.25);
      border-radius:22px;
      overflow:hidden;
      box-shadow:
        0 0 0 1px rgba(199,162,87,0.08),
        0 12px 32px rgba(0,0,0,0.08),
        0 2px 0 rgba(255,255,255,0.85) inset;
    ">

      <div style="
        padding:34px 30px 24px;
        text-align:center;
        border-bottom:1px solid rgba(199,162,87,0.18);
        background:
          radial-gradient(circle at 50% -10%, rgba(199,162,87,0.16) 0%, rgba(199,162,87,0.06) 18%, rgba(199,162,87,0) 44%),
          linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(251,249,244,0.90) 100%);
      ">
        <img
          src="https://verify.thereadymarkgroup.com/readymarkseal(best)nobackground.PNG"
          alt="The Ready Mark"
          style="width:90px;margin-bottom:12px;display:block;margin-left:auto;margin-right:auto;"
        />

        <div style="
          color:#c7a257;
          font-size:13px;
          letter-spacing:3px;
          text-transform:uppercase;
          font-weight:700;
          margin-bottom:8px;
        ">
          The Ready Mark
        </div>

        <h1 style="
          margin:10px 0 6px;
          font-size:32px;
          line-height:1.15;
          color:#111315;
          font-weight:600;
        ">
          Password Reset
        </h1>

        <p style="
          margin:0;
          color:#6f6a61;
          font-size:15px;
          line-height:1.75;
          max-width:540px;
          margin-left:auto;
          margin-right:auto;
        ">
          We received a request to reset your Ready Mark password.
        </p>
      </div>

      <div style="padding:26px 30px;text-align:center;">
        <div style="
          margin:0 auto 22px;
          max-width:460px;
          padding:18px;
          border-radius:14px;
          background:#fbfaf7;
          border:1px solid rgba(199,162,87,0.15);
        ">
          <div style="
            font-size:16px;
            line-height:1.7;
            color:#111315;
          ">
            Click the button below to securely create a new password for your account.
          </div>
        </div>

        <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin:0 auto 20px;">
          <tr>
            <td align="center" bgcolor="#c7a257" style="border-radius:12px;">
              <a
                href="${resetLink}"
                style="
                  display:inline-block;
                  padding:14px 28px;
                  font-size:16px;
                  font-weight:700;
                  font-family:Arial, sans-serif;
                  color:#111315;
                  text-decoration:none;
                  background:#c7a257;
                  border-radius:12px;
                "
              >
                Reset Password
              </a>
            </td>
          </tr>
        </table>

        <div style="
          margin-top:8px;
          font-size:13px;
          color:#958d82;
          line-height:1.7;
        ">
          This link expires in 1 hour for security purposes.
        </div>
      </div>

    </div>
  </div>
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
