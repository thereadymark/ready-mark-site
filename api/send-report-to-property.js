import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const GUEST_REPORTS_BUCKET = "guest-reports";
const SIGNED_URL_EXPIRES_IN = 60 * 60; // 1 hour

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export default async function handler(req, res) {
  const allowedOrigin = "https://verify.thereadymarkgroup.com";

  const corsHeaders = {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-admin-token"
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

  const adminToken = req.headers["x-admin-token"];
  const expectedToken = process.env.ADMIN_TOKEN;

  if (!adminToken || !expectedToken || adminToken !== expectedToken) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const { report_id } = req.body || {};

    if (!report_id) {
      return res.status(400).json({ error: "Missing report_id" });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const resendApiKey = process.env.RESEND_API_KEY;
    const resendFromEmail = process.env.RESEND_FROM_EMAIL;

    if (!supabaseUrl || !serviceRoleKey) {
      return res.status(500).json({ error: "Missing server environment variables" });
    }

    if (!resendApiKey || !resendFromEmail) {
      return res.status(500).json({ error: "Missing Resend configuration" });
    }

    const headers = {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Accept: "application/json"
    };

    // 🔍 FETCH REPORT
    const reportRes = await fetch(
      `${supabaseUrl}/rest/v1/guest_reports?id=eq.${encodeURIComponent(report_id)}&select=*`,
      { headers }
    );

    const reportData = await reportRes.json().catch(() => null);

    if (!reportRes.ok) {
      return res.status(500).json({
        error: "Failed to load guest report",
        details: reportData
      });
    }

    const report = Array.isArray(reportData) ? reportData[0] : null;

    if (!report) {
      return res.status(404).json({ error: "Guest report not found" });
    }

    if (String(report.status || "").trim() === "Sent to Property") {
      return res.status(409).json({
        error: "This report has already been sent to the property."
      });
    }

    if (!report.property_slug) {
      return res.status(400).json({ error: "Missing property_slug on report" });
    }

    // 🔍 FETCH PROPERTY
    const propertyRes = await fetch(
      `${supabaseUrl}/rest/v1/properties?property_slug=eq.${encodeURIComponent(report.property_slug)}&select=id,property_name,property_slug,city,state,property_type&limit=1`,
      { headers }
    );

    const propertyData = await propertyRes.json().catch(() => null);

    if (!propertyRes.ok) {
      return res.status(500).json({
        error: "Failed to load property",
        details: propertyData
      });
    }

    const property = Array.isArray(propertyData) ? propertyData[0] : null;

    if (!property) {
      return res.status(404).json({ error: "Property not found" });
    }

    // 🔍 FETCH CONTACT
    const contactRes = await fetch(
      `${supabaseUrl}/rest/v1/property_contacts?property_id=eq.${encodeURIComponent(property.id)}&active=eq.true&select=id,name,email,role,is_primary,created_at&order=is_primary.desc,created_at.asc`,
      { headers }
    );

    const contactData = await contactRes.json().catch(() => null);

    if (!contactRes.ok) {
      return res.status(500).json({
        error: "Failed to load property contacts",
        details: contactData
      });
    }

    const contact = Array.isArray(contactData) ? contactData[0] : null;

    if (!contact?.email) {
      return res.status(404).json({
        error: "No valid contact email found for property"
      });
    }

    // 🖼️ SIGNED PHOTO URL
    let signedPhotoUrl = null;

    if (report.photo_url) {
      const { data, error } = await supabase.storage
        .from(GUEST_REPORTS_BUCKET)
        .createSignedUrl(String(report.photo_url).trim(), SIGNED_URL_EXPIRES_IN);

      if (!error && data?.signedUrl) {
        signedPhotoUrl = data.signedUrl;
      }
    }

    // 🧠 PREP DATA
    const issueText = Array.isArray(report.issue_types)
      ? report.issue_types.join(", ")
      : "Not provided";

    const detailText = report.guest_note || report.details || "No additional notes provided.";
    const reportReference = report.confirmation_number || "N/A";
    const verificationId = report.verification_id || "N/A";
    const submittedAt = report.reported_at
      ? new Date(report.reported_at).toLocaleString()
      : "N/A";

    // ✉️ EMAIL HTML
    const emailHtml = `
      <div style="font-family:Georgia,serif;padding:24px;">
        <h2>Guest Issue Report</h2>
        <p><strong>Reference:</strong> ${escapeHtml(reportReference)}</p>
        <p><strong>Property:</strong> ${escapeHtml(property.property_name)}</p>
        <p><strong>Room:</strong> ${escapeHtml(report.room_number)}</p>
        <p><strong>Issue:</strong> ${escapeHtml(issueText)}</p>
        <p><strong>Details:</strong> ${escapeHtml(detailText)}</p>
        <p><strong>Submitted:</strong> ${escapeHtml(submittedAt)}</p>
        ${
          signedPhotoUrl
            ? `<p><a href="${escapeHtml(signedPhotoUrl)}">View Photo Evidence</a></p>`
            : ""
        }
      </div>
    `;

    // 📤 SEND EMAIL
    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: resendFromEmail,
        to: contact.email,
        subject: `Guest Issue Report – ${reportReference}`,
        html: emailHtml
      })
    });

    const emailData = await emailRes.json().catch(() => null);

    if (!emailRes.ok) {
      return res.status(500).json({
        error: "Failed to send email",
        details: emailData
      });
    }

    // 📝 UPDATE STATUS
    const patchRes = await fetch(
      `${supabaseUrl}/rest/v1/guest_reports?id=eq.${encodeURIComponent(report.id)}`,
      {
        method: "PATCH",
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          status: "Sent to Property"
        })
      }
    );

    if (!patchRes.ok) {
      return res.status(500).json({
        error: "Email sent but failed to update report status"
      });
    }

    return res.status(200).json({
      success: true,
      message: "Report sent successfully",
      sent_to: contact.email
    });

  } catch (error) {
    return res.status(500).json({
      error: "Server error",
      details: error.message
    });
  }
}
