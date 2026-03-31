import crypto from "crypto";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

function hashPassword(password) {
  return crypto.createHash("sha256").update(password).digest("hex");
}

function generateVerificationCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function generateSessionToken() {
  return crypto.randomBytes(32).toString("hex");
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

async function createGuestSession(supabaseUrl, serviceRoleKey, user) {
  const sessionToken = generateSessionToken();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  const sessionPayload = {
    guest_user_id: user.id,
    session_token: sessionToken,
    expires_at: expiresAt
  };

  const sessionRes = await fetch(`${supabaseUrl}/rest/v1/guest_sessions`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation"
    },
    body: JSON.stringify(sessionPayload)
  });

  const sessionData = await sessionRes.json().catch(() => null);

  if (!sessionRes.ok) {
    throw new Error(
      sessionData?.message ||
      sessionData?.error ||
      sessionData?.details ||
      "Failed to create guest session"
    );
  }

  return {
    token: sessionToken,
    expires_at: expiresAt,
    session: Array.isArray(sessionData) ? sessionData[0] : sessionData
  };
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
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({ error: "Missing email or password" });
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

    const headers = {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Accept: "application/json"
    };

    const userRes = await fetch(
      `${supabaseUrl}/rest/v1/guest_users?email=eq.${encodeURIComponent(normalizedEmail)}&select=*&limit=1`,
      { headers }
    );

    const userData = await userRes.json().catch(() => null);

    if (!userRes.ok) {
      return res.status(500).json({
        error: "Guest login lookup failed",
        details: userData
      });
    }

    const user = Array.isArray(userData) && userData.length > 0 ? userData[0] : null;

    if (!user || user.password_hash !== password_hash) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    if (user.email_verified) {
      const guestSession = await createGuestSession(supabaseUrl, serviceRoleKey, user);

      return res.status(200).json({
        success: true,
        email_verified: true,
        token: guestSession.token, 
        expires_at: guestSession.expires_at,
        guest: {
          id: user.id,
          first_name: user.first_name,
          last_name: user.last_name,
          email: user.email,
          email_verified: true
        },
        message: "Login successful."
      });
    }

    const verificationCode = generateVerificationCode();
    const verificationExpiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const patchRes = await fetch(
      `${supabaseUrl}/rest/v1/guest_users?id=eq.${encodeURIComponent(user.id)}`,
      {
        method: "PATCH",
        headers: {
          ...headers,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email_verification_code: verificationCode,
          email_verification_expires_at: verificationExpiresAt
        })
      }
    );

    const patchText = await patchRes.text();

    if (!patchRes.ok) {
      return res.status(500).json({
        error: "Failed to prepare verification code",
        details: patchText
      });
    }

    await sendVerificationEmail(normalizedEmail, verificationCode);

    return res.status(200).json({
      success: true,
      email_verified: false,
      email: normalizedEmail,
      guest: {
        id: user.id,
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
        email_verified: false
      },
      message: "Verification code sent."
    });
  } catch (error) {
    return res.status(500).json({
      error: `Server error: ${error.message}`
    });
  }
}
