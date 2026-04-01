import crypto from "crypto";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

function hashPassword(password) {
  return crypto.createHash("sha256").update(password).digest("hex");
}

function generateVerificationCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function sendVerificationEmail(email, code) {
  const fromEmail = process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";

  const emailHtml = `
  <div style="margin:0;padding:0;background:#f6f3ed;font-family:Georgia,serif;color:#1b1b1b;">
    <div style="max-width:720px;margin:0 auto;padding:36px 20px;">
      <div style="background:#ffffff;border:1px solid #dcc38a;border-radius:24px;overflow:hidden;box-shadow:0 10px 30px rgba(0,0,0,0.08);">

        <div style="padding:36px 30px 26px;text-align:center;border-bottom:1px solid rgba(220,195,138,0.45);">
          <img
            src="https://verify.thereadymarkgroup.com/readymarkseal(best)nobackground.PNG"
            alt="The Ready Mark"
            style="width:92px;display:block;margin:0 auto 16px;"
          />

          <div style="color:#9f7d33;font-size:13px;letter-spacing:4px;text-transform:uppercase;font-weight:700;margin-bottom:14px;">
            The Ready Mark
          </div>

          <h1 style="margin:0;font-size:44px;line-height:1.08;color:#1c1c1c;font-weight:700;">
            Secure Verification
          </h1>

          <p style="max-width:540px;margin:18px auto 0;color:#5e584d;font-size:17px;line-height:1.75;">
            Use the secure code below to continue your verification.
          </p>
        </div>

        <div style="padding:28px 24px 18px;">
          <div style="display:grid;grid-template-columns:1fr;gap:16px;max-width:560px;margin:0 auto;">

            <div style="background:#fbf9f4;border:1px solid rgba(220,195,138,0.55);border-radius:18px;padding:22px 18px 20px;text-align:center;">
              <div style="color:#9f7d33;font-size:12px;letter-spacing:2px;text-transform:uppercase;margin-bottom:12px;">
                Verification Code
              </div>
              <div style="color:#1c1c1c;font-size:40px;line-height:1.2;font-weight:700;letter-spacing:10px;">
                ${code}
              </div>
            </div>

            <div style="background:#fbf9f4;border:1px solid rgba(220,195,138,0.55);border-radius:18px;padding:18px 18px 16px;text-align:center;">
              <div style="color:#2b2b2b;font-size:16px;line-height:1.8;">
                This code expires in 10 minutes.
              </div>
            </div>

          </div>

          <div style="padding:24px 6px 8px;text-align:center;">
            <p style="margin:0;color:#676052;font-size:15px;line-height:1.8;">
              If you did not request this verification, you can safely ignore this email.
            </p>
          </div>
        </div>

        <div style="padding:0 30px 26px;text-align:center;">
          <div style="color:#8a7b5b;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;">
            The Ready Mark · Cleanliness Certification System
          </div>
        </div>
      </div>
    </div>
  </div>
  `;

  await resend.emails.send({
    from: `Ready Mark <${fromEmail}>`,
    to: email,
    subject: "Your Ready Mark Verification Code",
    html: emailHtml
  });
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
    const { first_name, last_name, email, password } = req.body || {};

    if (!first_name || !last_name || !email || !password) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return res.status(500).json({ error: "Missing server environment variables" });
    }

    if (!process.env.RESEND_API_KEY) {
      return res.status(500).json({ error: "Missing RESEND_API_KEY" });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
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

    if (Array.isArray(existingData) && existingData.length > 0) {
      return res.status(400).json({
        error: "An account with this email already exists."
      });
    }

    const createRes = await fetch(`${supabaseUrl}/rest/v1/guest_users`, {
      method: "POST",
      headers,
      body: JSON.stringify([{
        first_name: String(first_name).trim(),
        last_name: String(last_name).trim(),
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

    await sendVerificationEmail(normalizedEmail, verificationCode);

    return res.status(200).json({
      success: true,
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
