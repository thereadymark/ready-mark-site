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

  try {
    const adminToken = req.headers["x-admin-token"];
    const expectedAdminToken = process.env.ADMIN_TOKEN;

    if (!expectedAdminToken) {
      return res.status(500).json({ error: "Missing ADMIN_TOKEN" });
    }

    if (!adminToken || adminToken !== expectedAdminToken) {
      return res.status(401).json({ error: "Unauthorized" });
    }

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

    const reportUrl =
      `${supabaseUrl}/rest/v1/guest_reports` +
      `?id=eq.${encodeURIComponent(report_id)}` +
      `&select=id,verification_id,confirmation_number,property_slug,property_name,room_number,issue_types,guest_note,details,photo_url,status,priority,reported_at,guest_email,guest_first_name,guest_last_name`;

    const reportRes = await fetch(reportUrl, { headers });
    const reportData = await reportRes.json().catch(() => []);

    if (!reportRes.ok) {
      return res.status(500).json({
        error: "Failed to load guest report",
        details: reportData
      });
    }

    const report = Array.isArray(reportData) ? reportData[0] : reportData;

    if (!report) {
      return res.status(404).json({ error: "Guest report not found" });
    }

    if (!report.property_slug) {
      return res.status(400).json({ error: "Guest report is missing property_slug" });
    }

    const propertyUrl =
      `${supabaseUrl}/rest/v1/properties` +
      `?property_slug=eq.${encodeURIComponent(report.property_slug)}` +
      `&select=id,property_name,property_slug,city,state,property_type` +
      `&limit=1`;

    const propertyRes = await fetch(propertyUrl, { headers });
    const propertyData = await propertyRes.json().catch(() => []);

    if (!propertyRes.ok) {
      return res.status(500).json({
        error: "Failed to load property",
        details: propertyData
      });
    }

    const property = Array.isArray(propertyData) ? propertyData[0] : propertyData;

    if (!property) {
      return res.status(404).json({ error: "Property not found for this report" });
    }

    const contactUrl =
      `${supabaseUrl}/rest/v1/property_contacts` +
      `?property_id=eq.${encodeURIComponent(property.id)}` +
      `&active=eq.true` +
      `&select=id,name,email,role,is_primary,active,created_at` +
      `&order=is_primary.desc,created_at.asc`;

    const contactRes = await fetch(contactUrl, { headers });
    const contactData = await contactRes.json().catch(() => []);

    if (!contactRes.ok) {
      return res.status(500).json({
        error: "Failed to load property contacts",
        details: contactData
      });
    }

    const contact = Array.isArray(contactData) ? contactData[0] : contactData;

    if (!contact || !contact.email) {
      return res.status(404).json({
        error: "No active property contact with an email was found"
      });
    }

    const issueText =
      Array.isArray(report.issue_types) && report.issue_types.length
        ? report.issue_types.join(", ")
        : "Not provided";

    const detailText = report.guest_note || report.details || "No additional notes provided.";
    const reportReference = report.confirmation_number || "Not available";
    const verificationId = report.verification_id || "Not available";
    const submittedAt = report.reported_at
      ? new Date(report.reported_at).toLocaleString()
      : "Not available";

    let signedPhotoUrl = null;
    const photoPath = report.photo_url ? String(report.photo_url).trim() : "";

    if (photoPath) {
      const { data: signedData, error: signedError } = await supabase.storage
        .from(GUEST_REPORTS_BUCKET)
        .createSignedUrl(photoPath, SIGNED_URL_EXPIRES_IN);

      if (!signedError && signedData?.signedUrl) {
        signedPhotoUrl = signedData.signedUrl;
      }
    }

    const photoSection = signedPhotoUrl
      ? `
        <div style="grid-column:1 / -1;background:#fbf9f4;border:1px solid rgba(220,195,138,0.55);border-radius:18px;padding:18px 18px 16px;text-align:center;">
          <div style="color:#9f7d33;font-size:12px;letter-spacing:2px;text-transform:uppercase;margin-bottom:10px;">
            Supporting Evidence
          </div>
          <a href="${escapeHtml(signedPhotoUrl)}" style="display:inline-block;padding:12px 18px;border-radius:12px;background:linear-gradient(180deg,#d8ba73,#b8934c);color:#111315;font-weight:700;text-decoration:none;">
            View Attached Photo
          </a>
        </div>
      `
      : "";

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
            Operational Notice
          </h1>

          <p style="max-width:540px;margin:18px auto 0;color:#5e584d;font-size:17px;line-height:1.75;">
            A guest-submitted issue has been formally recorded and forwarded for review.
          </p>
        </div>

        <div style="padding:28px 24px 18px;">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">

            <div style="background:#fbf9f4;border:1px solid rgba(220,195,138,0.55);border-radius:18px;padding:18px 18px 16px;">
              <div style="color:#9f7d33;font-size:12px;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px;">
                Reference #
              </div>
              <div style="color:#1c1c1c;font-size:18px;line-height:1.5;font-weight:700;">
                ${escapeHtml(reportReference)}
              </div>
            </div>

            <div style="background:#fbf9f4;border:1px solid rgba(220,195,138,0.55);border-radius:18px;padding:18px 18px 16px;">
              <div style="color:#9f7d33;font-size:12px;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px;">
                Verification ID
              </div>
              <div style="color:#1c1c1c;font-size:18px;line-height:1.5;font-weight:700;">
                ${escapeHtml(verificationId)}
              </div>
            </div>

            <div style="background:#fbf9f4;border:1px solid rgba(220,195,138,0.55);border-radius:18px;padding:18px 18px 16px;">
              <div style="color:#9f7d33;font-size:12px;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px;">
                Property
              </div>
              <div style="color:#1c1c1c;font-size:18px;line-height:1.6;font-weight:700;">
                ${escapeHtml(property.property_name || report.property_name || "Not available")}
              </div>
            </div>

            <div style="background:#fbf9f4;border:1px solid rgba(220,195,138,0.55);border-radius:18px;padding:18px 18px 16px;">
              <div style="color:#9f7d33;font-size:12px;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px;">
                Room
              </div>
              <div style="color:#1c1c1c;font-size:18px;line-height:1.5;font-weight:700;">
                ${escapeHtml(report.room_number || "Not available")}
              </div>
            </div>

            <div style="background:#fbf9f4;border:1px solid rgba(220,195,138,0.55);border-radius:18px;padding:18px 18px 16px;">
              <div style="color:#9f7d33;font-size:12px;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px;">
                Submitted
              </div>
              <div style="color:#2b2b2b;font-size:16px;line-height:1.7;">
                ${escapeHtml(submittedAt)}
              </div>
            </div>

            <div style="background:#fbf9f4;border:1px solid rgba(220,195,138,0.55);border-radius:18px;padding:18px 18px 16px;">
              <div style="color:#9f7d33;font-size:12px;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px;">
                Priority
              </div>
              <div style="color:#2b2b2b;font-size:16px;line-height:1.7;">
                ${escapeHtml(report.priority || "Normal")}
              </div>
            </div>

            <div style="grid-column:1 / -1;background:#fbf9f4;border:1px solid rgba(220,195,138,0.55);border-radius:18px;padding:18px 18px 16px;">
              <div style="color:#9f7d33;font-size:12px;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px;">
                Reported Issue
              </div>
              <div style="color:#2b2b2b;font-size:17px;line-height:1.8;">
                ${escapeHtml(issueText)}
              </div>
            </div>

            <div style="grid-column:1 / -1;background:#fbf9f4;border:1px solid rgba(220,195,138,0.55);border-radius:18px;padding:18px 18px 16px;">
              <div style="color:#9f7d33;font-size:12px;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px;">
                Guest Statement
              </div>
              <div style="color:#2b2b2b;font-size:17px;line-height:1.85;">
                ${escapeHtml(detailText)}
              </div>
            </div>

            ${photoSection}

          </div>

          <div style="padding:24px 6px 8px;">
            <p style="margin:0;color:#676052;font-size:15px;line-height:1.8;">
              This notice was generated by The Ready Mark and forwarded for operational awareness and resolution tracking.
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

    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: resendFromEmail,
        to: contact.email,
        subject: `Ready Mark Guest Issue Report – ${reportReference}`,
        html: emailHtml
      })
    });

    const emailData = await emailRes.json().catch(() => null);

    if (!emailRes.ok) {
      return res.status(500).json({
        error: "Failed to send property email",
        details: emailData
      });
    }

    const patchRes = await fetch(
      `${supabaseUrl}/rest/v1/guest_reports?id=eq.${encodeURIComponent(report.id)}`,
      {
        method: "PATCH",
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          "Content-Type": "application/json",
          Prefer: "return=representation"
        },
        body: JSON.stringify({
          status: "Sent to Property"
        })
      }
    );

    const patchData = await patchRes.json().catch(() => null);

    if (!patchRes.ok) {
      return res.status(500).json({
        error: "Email sent, but failed to update report status",
        details: patchData
      });
    }

    const updatedReport = Array.isArray(patchData) ? patchData[0] : patchData;

    return res.status(200).json({
      success: true,
      message: "Report sent to property successfully.",
      sent_to: {
        name: contact.name || null,
        email: contact.email,
        role: contact.role || null
      },
      report: updatedReport
    });
  } catch (error) {
    return res.status(500).json({
      error: "Server error",
      details: error.message
    });
  }
}
