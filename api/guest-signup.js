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

  await resend.emails.send({
    from: `Ready Mark <${fromEmail}>`,
    to: email,
    subject: "Your Ready Mark Verification Code",
html: `
 <div style="font-family: Georgia, serif; background:#121416; color:#f3eee5; padding:40px 20px;">
  <div style="max-width:520px; margin:0 auto; background:#0f1216; border:2px solid #d8bb7a; border-radius:18px; padding:30px; text-align:center;">
    
    <img src="https://verify.thereadymarkgroup.com/readymarkseal(best)nobackground.PNG" style="width:90px; margin-bottom:14px;" />

    <div style="width:140px; height:2px; margin:0 auto 18px; background:#d8bb7a;"></div>

    <h2 style="margin:0 0 10px; font-size:26px; letter-spacing:1px; color:#e6d39a;">
      The Ready Mark
    </h2>

    <p style="color:#d8bb7a; font-size:13px; letter-spacing:3px; text-transform:uppercase; margin-bottom:22px;">
      Secure Verification
    </p>

    <p style="font-size:16px; line-height:1.7; margin-bottom:20px; color:#f3eee5;">
      Use the secure code below to continue your verification.
    </p>

    <div style="font-size:38px; font-weight:700; letter-spacing:10px; margin-bottom:18px; color:#ffffff;">
      ${code}
    </div>

    <p style="margin-top:8px; font-size:13px; color:#958d82;">
      This code expires in 10 minutes.
    </p>

    <p style="margin-top:18px; font-size:11px; color:#7a7263;">
      The Ready Mark · Cleanliness Certification System
    </p>

  </div>
</div>
` 
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
    const password_hash = hashPassword(password);
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

    const existingData = await existingRes.json();

    if (!existingRes.ok) {
      return res.status(500).json({ error: "User lookup failed", details: existingData });
    }

    if (Array.isArray(existingData) && existingData.length > 0) {
      return res.status(400).json({ error: "An account with this email already exists." });
    }

    const createRes = await fetch(`${supabaseUrl}/rest/v1/guest_users`, {
      method: "POST",
      headers,
      body: JSON.stringify([{
        first_name: String(first_name).trim(),
        last_name: String(last_name).trim(),
        email: normalizedEmail,
        password_hash,
        email_verified: false,
        email_verification_code: verificationCode,
        email_verification_expires_at: verificationExpiresAt
      }])
    });

    const createData = await createRes.json();

    if (!createRes.ok) {
      return res.status(500).json({ error: "Guest signup failed", details: createData });
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
