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
      <div style="font-family: Arial, sans-serif; padding: 24px; color: #111;">
        <h2 style="margin-bottom: 12px;">Verify your email</h2>
        <p style="margin-bottom: 18px;">Enter this code to continue with Ready Mark:</p>
        <div style="font-size: 34px; font-weight: 700; letter-spacing: 6px; margin-bottom: 18px;">
          ${code}
        </div>
        <p style="margin-bottom: 0;">This code expires in 10 minutes.</p>
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
