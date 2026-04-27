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
<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background-color:#f7f6f3;font-family:Georgia,serif;color:#111315;">
    <div style="margin:0;padding:32px 16px;background-color:#f7f6f3;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
        <tr>
          <td align="center">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:640px;">
              <tr>
                <td style="background:#ffffff;border:1px solid #e3d3aa;border-radius:18px;padding:32px 28px;text-align:center;">
                  <img
                    src="https://verify.thereadymarkgroup.com/readymarkseal(best)nobackground.PNG"
                    alt="The Ready Mark"
                    width="80"
                    style="display:block;margin:0 auto 12px auto;border:0;"
                  />

                  <div style="font-size:13px;letter-spacing:3px;text-transform:uppercase;font-weight:700;color:#c7a257;margin-bottom:8px;">
                    The Ready Mark
                  </div>

                  <h1 style="margin:0 0 12px 0;font-size:28px;line-height:1.2;font-weight:600;color:#111315;">
                    Verify Your Email
                  </h1>

                  <p style="margin:0 0 22px 0;font-size:15px;line-height:1.7;color:#6f6a61;">
                    Use the verification code below to complete your account setup.
                  </p>

                  <div style="margin:0 auto 22px auto;max-width:240px;background:#fbfaf7;border:1px solid #e7d8b4;border-radius:14px;padding:18px 16px;">
                    <div style="font-size:28px;line-height:1.2;letter-spacing:6px;font-weight:700;color:#111315;">
                      ${code}
                    </div>
                  </div>

                  <p style="margin:0 0 10px 0;font-size:13px;line-height:1.7;color:#958d82;">
                    This code expires in ${VERIFICATION_CODE_MINUTES} minutes.
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
    `
  });
}

async function createGuestSession(supabaseUrl, serviceRoleKey, user) {
  const sessionToken = generateSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const sessionRes = await fetch(`${supabaseUrl}/rest/v1/guest_sessions`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation"
    },
    body: JSON.stringify({
      guest_user_id: user.id,
      session_token: sessionToken,
      expires_at: expiresAt
    })
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

  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

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
      `${supabaseUrl}/rest/v1/guest_users?email=eq.${encodeURIComponent(normalizedEmail)}&select=id,first_name,last_name,email,email_verified,password_hash,failed_login_attempts,login_locked_until,email_verification_code,email_verification_expires_at&limit=1`,
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
      const msRemaining = lockedUntilMs - Date.now();
      const secondsRemaining = Math.max(1, Math.ceil(msRemaining / 1000));
      const minutesRemaining = Math.ceil(msRemaining / 60000);

      return res.status(429).json({
        error: `Too many failed login attempts. Try again in ${minutesRemaining} minute${minutesRemaining === 1 ? "" : "s"}.`,
        lockout_remaining_seconds: secondsRemaining,
        login_locked_until: user.login_locked_until
      });
    }

    const lockoutExpired =
      user.login_locked_until &&
      !Number.isNaN(lockedUntilMs) &&
      lockedUntilMs <= Date.now();

    if (lockoutExpired) {
      await patchGuestUser(supabaseUrl, serviceRoleKey, user.id, {
        failed_login_attempts: 0,
        login_locked_until: null
      });
    }

    const currentFailedAttempts = lockoutExpired
      ? 0
      : Number(user.failed_login_attempts || 0);

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

      return res.status(shouldLock ? 429 : 401).json({
        error: shouldLock
          ? `Too many failed login attempts. Try again in ${LOGIN_LOCK_MINUTES} minutes.`
          : "Invalid email or password",
        lockout_remaining_seconds: shouldLock ? LOGIN_LOCK_MINUTES * 60 : undefined,
        login_locked_until: shouldLock ? loginLockedUntil : undefined
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

    const existingCode = user.email_verification_code
      ? String(user.email_verification_code).trim()
      : "";

    const existingExpiryMs = user.email_verification_expires_at
      ? new Date(user.email_verification_expires_at).getTime()
      : NaN;

    const hasUsableExistingCode =
      existingCode &&
      !Number.isNaN(existingExpiryMs) &&
      existingExpiryMs > Date.now();

    if (hasUsableExistingCode) {
      const secondsRemaining = Math.max(1, Math.ceil((existingExpiryMs - Date.now()) / 1000));

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
        message: "A verification code was already sent. Please check your email.",
        verification_code_remaining_seconds: secondsRemaining
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
