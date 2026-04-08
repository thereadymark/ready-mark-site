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
<div style="margin:0;padding:0;background:#f7f6f3;font-family:Georgia,serif;">
  <div style="max-width:640px;margin:0 auto;padding:40px 16px;">
    <div style="
      background:#ffffff;
      border:1px solid rgba(199,162,87,0.25);
      border-radius:20px;
      padding:32px;
      box-shadow:0 10px 30px rgba(0,0,0,0.08);
      text-align:center;
    ">
      <img
        src="https://verify.thereadymarkgroup.com/readymarkseal(best)nobackground.PNG"
        alt="The Ready Mark"
        style="width:80px;margin-bottom:12px;"
      />

      <div style="
        color:#c7a257;
        font-size:13px;
        letter-spacing:3px;
        text-transform:uppercase;
        font-weight:700;
        margin-bottom:6px;
      ">
        The Ready Mark
      </div>

      <h1 style="
        margin:8px 0 12px;
        font-size:26px;
        color:#111315;
      ">
        Verify Your Email
      </h1>

      <p style="
        font-size:15px;
        color:#6f6a61;
        line-height:1.7;
        margin-bottom:22px;
      ">
        Use the verification code below to complete your account setup.
      </p>

      <div style="
        margin:20px auto;
        padding:18px;
        border-radius:14px;
        background:#fbfaf7;
        border:1px solid rgba(199,162,87,0.20);
        font-size:26px;
        letter-spacing:6px;
        font-weight:700;
        color:#111315;
        max-width:240px;
      ">
        ${code}
      </div>

      <p style="
        margin-top:18px;
        font-size:13px;
        color:#9a958d;
        line-height:1.7;
      ">
        This code will expire in 10 minutes. Do not share it with anyone.
      </p>
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

    if (Array.isArray(existingData) && existingData.length > 0) {
      return res.status(400).json({
        error: "An account with this email already exists."
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
