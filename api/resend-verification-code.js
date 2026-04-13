import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function buildVerificationCodeEmail(code) {
  return `
<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background-color:#f7f6f3;background:#f7f6f3;font-family:Georgia,serif;color:#111315;">
    <div style="margin:0;padding:32px 16px;background-color:#f7f6f3;background:#f7f6f3;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">
        <tr>
          <td align="center">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:640px;border-collapse:collapse;">
              <tr>
                <td style="background-color:#ffffff;background:#ffffff;border:1px solid #e3d3aa;border-radius:18px;padding:32px 28px;text-align:center;">

                  <img
                    src="https://verify.thereadymarkgroup.com/readymarkseal(best)nobackground.PNG"
                    alt="The Ready Mark"
                    width="80"
                    style="display:block;margin:0 auto 12px auto;border:0;outline:none;text-decoration:none;"
                  />

                  <div style="font-size:13px;line-height:1.4;letter-spacing:3px;text-transform:uppercase;font-weight:700;color:#c7a257;margin:0 0 8px 0;">
                    The Ready Mark
                  </div>

                  <h1 style="margin:0 0 12px 0;font-size:28px;line-height:1.2;font-weight:600;color:#111315;">
                    Verify Your Email
                  </h1>

                  <p style="margin:0 0 22px 0;font-size:15px;line-height:1.7;color:#6f6a61;">
                    Use the verification code below to complete your account setup.
                  </p>

                  <div style="margin:0 auto 22px auto;max-width:240px;background-color:#fbfaf7;background:#fbfaf7;border:1px solid #e7d8b4;border-radius:14px;padding:18px 16px;">
                    <div style="font-size:28px;line-height:1.2;letter-spacing:6px;font-weight:700;color:#111315;">
                      ${code}
                    </div>
                  </div>

                  <p style="margin:0 0 10px 0;font-size:13px;line-height:1.7;color:#958d82;">
                    This code expires in 10 minutes.
                  </p>

                  <p style="margin:0;font-size:13px;line-height:1.7;color:#958d82;">
                    Do not share this code with anyone.
                  </p>

                </td>
              </tr>

              <tr>
                <td style="padding:14px 8px 0 8px;text-align:center;">
                  <p style="margin:0;font-size:12px;line-height:1.6;color:#8f887d;">
                    You are receiving this email because a Ready Mark account was created or updated using this address.
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </div>
  </body>
</html>
`;
}

function buildVerificationCodeText(code) {
  return `The Ready Mark

Verify Your Email

Use this verification code to complete your account setup:

${code}

This code expires in 10 minutes.
Do not share this code with anyone.`;
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
    const rawEmail = req.body?.email || "";
    const email = String(rawEmail).trim().toLowerCase();

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    const resendApiKey = process.env.RESEND_API_KEY;
    const resendFromEmail = process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";

    if (!resendApiKey) {
      return res.status(500).json({ error: "Missing RESEND_API_KEY" });
    }

    const resend = new Resend(resendApiKey);

    const { data: user, error } = await supabase
      .from("guest_users")
      .select("id, email, email_verified")
      .eq("email", email)
      .maybeSingle();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    if (!user) {
      return res.status(404).json({ error: "Account not found" });
    }

    if (user.email_verified) {
      return res.status(200).json({
        success: true,
        message: "Account already verified. Please log in."
      });
    }

    const code = generateCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const { error: updateError } = await supabase
      .from("guest_users")
      .update({
        email_verification_code: code,
        email_verification_expires_at: expiresAt
      })
      .eq("id", user.id);

    if (updateError) {
      return res.status(500).json({ error: updateError.message });
    }

    await resend.emails.send({
      from: `Ready Mark <${resendFromEmail}>`,
      to: email,
      subject: "Your Ready Mark Verification Code",
      html: buildVerificationCodeEmail(code),
      text: buildVerificationCodeText(code)
    });

    return res.status(200).json({
      success: true,
      message: "Verification code resent"
    });
  } catch (err) {
    return res.status(500).json({
      error: err?.message || "Server error"
    });
  }
}
