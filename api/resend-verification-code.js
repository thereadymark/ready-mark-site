import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function sendEmail({ resendApiKey, from, to, subject, html }) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ from, to, subject, html })
  });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    throw new Error(data?.message || "Email failed");
  }

  return data;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { email } = req.body || {};

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    const { data: user, error } = await supabase
      .from("guest_users")
      .select("*")
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

    if (resendApiKey && resendFromEmail) {
      await sendEmail({
        resendApiKey,
        from: `Ready Mark <${resendFromEmail}>`,
        to: email,
        subject: "Your Ready Mark Verification Code",
        html: `
          <div style="font-family:Arial;padding:20px;">
            <h2>Your Verification Code</h2>
            <p style="font-size:24px;font-weight:bold;">${code}</p>
            <p>This code expires in 10 minutes.</p>
          </div>
        `
      });
    }

    return res.status(200).json({
      success: true,
      message: "Verification code resent"
    });

  } catch (err) {
    return res.status(500).json({
      error: err.message
    });
  }
}
