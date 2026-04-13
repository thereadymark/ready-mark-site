import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function sendEmail({ resendApiKey, from, to, subject, html }) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from,
      to,
      subject,
      html
    })
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      data?.message ||
      data?.error ||
      data?.name ||
      "Email failed"
    );
  }

  return data;
}

function buildVerificationCodeEmail(code) {
  return `
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
          Verify Your Email
        </h1>

        <p style="
          margin:0;
          color:#5f5a52;
          font-size:15px;
          line-height:1.75;
          max-width:540px;
          margin-left:auto;
          margin-right:auto;
        ">
          Use the verification code below to complete your account setup.
        </p>
      </div>

      <div style="padding:26px 30px;text-align:center;">
        <div style="
          margin:0 auto 22px;
          max-width:320px;
          padding:18px 22px;
          border-radius:16px;
          background:#111315;
          border:1px solid rgba(199,162,87,0.28);
          box-shadow:0 8px 20px rgba(0,0,0,0.08);
        ">
          <div style="
            font-size:12px;
            line-height:1.5;
            letter-spacing:2px;
            text-transform:uppercase;
            color:#c7a257;
            font-weight:700;
            margin-bottom:10px;
          ">
            Verification Code
          </div>

          <div style="
            font-size:34px;
            line-height:1.1;
            letter-spacing:8px;
            font-weight:700;
            color:#ffffff;
          ">
            ${code}
          </div>
        </div>

        <div style="
          margin-top:8px;
          font-size:14px;
          color:#6f6a61;
          line-height:1.8;
        ">
          This code expires in 10 minutes.
        </div>

        <div style="
          margin-top:8px;
          font-size:14px;
          color:#6f6a61;
          line-height:1.8;
        ">
          Do not share this code with anyone.
        </div>
      </div>
    </div>

    <div style="
      text-align:center;
      margin-top:18px;
      font-size:13px;
      color:#8f8775;
      line-height:1.8;
    ">
      You are receiving this email because a Ready Mark account was created or updated using this address.
    </div>
  </div>
</div>
`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const rawEmail = req.body?.email || "";
    const email = String(rawEmail).trim().toLowerCase();

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

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
        verification_code: code,
        verification_expires_at: expiresAt
      })
      .eq("id", user.id);

    if (updateError) {
      return res.status(500).json({ error: updateError.message });
    }

    const resendApiKey = process.env.RESEND_API_KEY;
    const resendFromEmail = process.env.RESEND_FROM_EMAIL;

    if (!resendApiKey || !resendFromEmail) {
      return res.status(500).json({
        error: "Email configuration missing"
      });
    }

    await sendEmail({
      resendApiKey,
      from: `Ready Mark <${resendFromEmail}>`,
      to: email,
      subject: "Your Ready Mark Verification Code",
      html: buildVerificationCodeEmail(code)
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
