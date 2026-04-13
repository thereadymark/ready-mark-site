import crypto from "crypto";
import { Resend } from "resend";

function hashPassword(password) {
  return crypto.createHash("sha256").update(password).digest("hex");
}

function generateVerificationCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function validatePassword(password) {
  const value = String(password || "");

  if (value.length < 8) {
    return "Password must be at least 8 characters.";
  }

  if (!/[A-Z]/.test(value)) {
    return "Password must include at least one uppercase letter.";
  }

  if (!/[a-z]/.test(value)) {
    return "Password must include at least one lowercase letter.";
  }

  if (!/[0-9]/.test(value)) {
    return "Password must include at least one number.";
  }

  if (!/[^A-Za-z0-9]/.test(value)) {
    return "Password must include at least one special character.";
  }

  return null;
}

async function sendVerificationEmail(resend, email, code) {
  const fromEmail = process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";

  const emailHtml = `
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

  const emailText = `The Ready Mark

Verify Your Email

Use this verification code to complete your account setup:

${code}

This code expires in 10 minutes.
Do not share this code with anyone.`;

  await resend.emails.send({
    from: `Ready Mark <${fromEmail}>`,
    to: email,
    subject: "Your Ready Mark Verification Code",
    html: emailHtml,
    text: emailText
  });
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
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required." });
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return res.status(400).json({ error: "Please enter a valid email address." });
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      return res.status(400).json({ error: passwordError });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const resendApiKey = process.env.RESEND_API_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return res.status(500).json({ error: "Missing server environment variables" });
    }

    if (!resendApiKey) {
      return res.status(500).json({ error: "Missing RESEND_API_KEY" });
    }

    const resend = new Resend(resendApiKey);
    const passwordHash = hashPassword(password);
    const verificationCode = generateVerificationCode();
    const verificationExpiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const headers = {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      Prefer: "return=representation"
    };

    const existingRes = await fetch(
      `${supabaseUrl}/rest/v1/guest_users?email=eq.${encodeURIComponent(normalizedEmail)}&select=id,email_verified&limit=1`,
      { headers }
    );

    const existingData = await existingRes.json().catch(() => null);

    if (!existingRes.ok) {
      return res.status(500).json({
        error: "User lookup failed",
        details: existingData
      });
    }

    const existingUser =
      Array.isArray(existingData) && existingData.length > 0
        ? existingData[0]
        : null;

    if (existingUser) {
      if (existingUser.email_verified) {
        return res.status(200).json({
          success: false,
          action: "login",
          message: "An account with this email already exists. Please log in."
        });
      }

      const updateRes = await fetch(
        `${supabaseUrl}/rest/v1/guest_users?id=eq.${encodeURIComponent(existingUser.id)}`,
        {
          method: "PATCH",
          headers,
          body: JSON.stringify({
            password_hash: passwordHash,
            email_verification_code: verificationCode,
            email_verification_expires_at: verificationExpiresAt
          })
        }
      );

      const updateData = await updateRes.json().catch(() => null);

      if (!updateRes.ok) {
        return res.status(500).json({
          error: "Failed to update existing unverified account",
          details: updateData
        });
      }

      await sendVerificationEmail(resend, normalizedEmail, verificationCode);

      return res.status(200).json({
        success: true,
        action: "verify",
        email: normalizedEmail,
        requires_email_verification: true,
        message: "Account exists but is not verified. A new verification code has been sent."
      });
    }

    const createRes = await fetch(`${supabaseUrl}/rest/v1/guest_users`, {
      method: "POST",
      headers,
      body: JSON.stringify([{
        first_name: "Guest",
        last_name: "User",
        email: normalizedEmail,
        password_hash: passwordHash,
        email_verified: false,
        email_verification_code: verificationCode,
        email_verification_expires_at: verificationExpiresAt
      }])
    });

    const createData = await createRes.json().catch(() => null);

    if (!createRes.ok) {
      return res.status(500).json({
        error: "Guest signup failed",
        details: createData
      });
    }

    await sendVerificationEmail(resend, normalizedEmail, verificationCode);

    return res.status(200).json({
      success: true,
      action: "verify",
      email: normalizedEmail,
      requires_email_verification: true,
      message: "Account created. Verification code sent."
    });
  } catch (error) {
    return res.status(500).json({
      error: `Server error: ${error.message}`
    });
  }
}
