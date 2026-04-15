import crypto from "crypto";
import { Resend } from "resend";

const MAX_FAILED_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCK_MINUTES = 15;
const VERIFICATION_CODE_MINUTES = 10;
const SESSION_DAYS = 30;

function hashPassword(password) {
  return crypto.createHash("sha256").update(password).digest("hex");
}

function generateVerificationCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function generateSessionToken() {
  return crypto.randomBytes(32).toString("hex");
}

async function sendVerificationEmail(resend, email, code) {
  const fromEmail = process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";

  await resend.emails.send({
    from: `Ready Mark <${fromEmail}>`,
    to: email,
    subject: "Your Ready Mark Verification Code",
    html: `
      <div style="font-family: Georgia, serif; background:#121416; color:#f3eee5; padding:40px 20px;">
        <div style="max-width:520px; margin:0 auto; background:linear-gradient(180deg,#1b1f23,#15181b); border:1px solid rgba(199,162,87,0.28); border-radius:18px; padding:30px; text-align:center; box-shadow:0 14px 34px rgba(0,0,0,0.35);">
          <img src="https://verify.thereadymarkgroup.com/readymarkseal(best)nobackground.PNG"
               style="width:90px;margin-bottom:14px;" />

          <div style="width:140px; height:2px; margin:0 auto 18px; background:linear-gradient(90deg, rgba(199,162,87,0), rgba(216,187,122,0.98), rgba(199,162,87,0)); border-radius:999px;"></div>

          <h2 style="margin:0 0 10px; font-size:26px; letter-spacing:1px; color:#e6d39a;">
            The Ready Mark
          </h2>

          <p style="color:#d8bb7a; font-size:13px; letter-spacing:3px; text-transform:uppercase; margin-bottom:22px;">
            Email Verification
          </p>

          <p style="font-size:16px; line-height:1.7; margin-bottom:20px; color:#f3eee5;">
            Enter this verification code to continue:
          </p>

          <div style="font-size:36px; font-weight:700; letter-spacing:8px; margin-bottom:18px; color:#f3eee5;">
            ${code}
          </div>

          <p style="margin-top:10px; font-size:13px; color:#958d82;">
            This code expires in ${VERIFICATION_CODE_MINUTES} minutes.
          </p>
        </div>
      </div>
    `
  });
}

async function createGuestSession(supabaseUrl, serviceRoleKey, user) {
  const sessionToken = generateSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();

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

async function patchGuestUser(supabaseUrl, serviceRoleKey, userId, payload) {
  const patchRes = await fetch(
    `${supabaseUrl}/rest/v1/guest_users?id=eq.${encodeURIComponent(userId)}`,
    {
      method: "PATCH",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        Prefer: "return=representation"
      },
      body: JSON.stringify(payload)
    }
  );

  const patchData = await patchRes.json().catch(() => null);

  if (!patchRes.ok) {
    throw new Error(
      patchData?.message ||
      patchData?.error ||
      patchData?.details ||
      "Failed to update guest user"
    );
  }

  return Array.isArray(patchData) ? patchData[0] : patchData;
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
      return res.status(400).json({ error: "Missing email or password" });
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
    const normalizedEmail = String(email).trim().toLowerCase();
    const passwordHash = hashPassword(password);

    const headers = {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Accept: "application/json"
    };

    const userRes = await fetch(
      `${supabaseUrl}/rest/v1/guest_users?email=eq.${encodeURIComponent(normalizedEmail)}&select=id,first_name,last_name,email,email_verified,password_hash,failed_login_attempts,login_locked_until&limit=1`,
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

    if (!user) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const lockedUntilMs = user.login_locked_until
      ? new Date(user.login_locked_until).getTime()
      : NaN;

    const isLocked =
      user.login_locked_until &&
      !Number.isNaN(lockedUntilMs) &&
      lockedUntilMs > Date.now();

    if (isLocked) {
      return res.status(429).json({
        error: "Too many failed login attempts. Please try again later."
      });
    }

    const currentFailedAttempts = Number(user.failed_login_attempts || 0);
    const passwordMatches = user.password_hash === passwordHash;

    if (!passwordMatches) {
      const nextFailedAttempts = currentFailedAttempts + 1;
      const shouldLock = nextFailedAttempts >= MAX_FAILED_LOGIN_ATTEMPTS;
      const loginLockedUntil = shouldLock
        ? new Date(Date.now() + LOGIN_LOCK_MINUTES * 60 * 1000).toISOString()
        : null;

      await patchGuestUser(supabaseUrl, serviceRoleKey, user.id, {
        failed_login_attempts: nextFailedAttempts,
        login_locked_until: loginLockedUntil
      });

      return res.status(401).json({
        error: shouldLock
          ? "Too many failed login attempts. Please try again later."
          : "Invalid email or password"
      });
    }

    await patchGuestUser(supabaseUrl, serviceRoleKey, user.id, {
      failed_login_attempts: 0,
      login_locked_until: null
    });

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
    const verificationExpiresAt = new Date(
      Date.now() + VERIFICATION_CODE_MINUTES * 60 * 1000
    ).toISOString();

    await patchGuestUser(supabaseUrl, serviceRoleKey, user.id, {
      email_verification_code: verificationCode,
      email_verification_expires_at: verificationExpiresAt
    });

    await sendVerificationEmail(resend, normalizedEmail, verificationCode);

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
