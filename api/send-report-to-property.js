import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function sendPortalNotificationEmail({
  resendApiKey,
  resendFromEmail,
  to,
  contactName,
  propertyName,
  roomNumber,
  referenceNumber,
  propertySlug
})
{
  const portalUrl = `https://verify.thereadymarkgroup.com/dashboard.html?property_slug=${encodeURIComponent(propertySlug)}`;
  
  const html = `
<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background:#f7f6f3;font-family:Georgia,serif;color:#111315;">
    <div style="padding:32px 16px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">
        <tr>
          <td align="center">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:640px;border-collapse:collapse;">
              <tr>
                <td style="background:#ffffff;border:1px solid #e3d3aa;border-radius:18px;padding:32px 28px;text-align:center;">

                  <img
                    src="https://verify.thereadymarkgroup.com/readymarkseal(best)nobackground.PNG"
                    alt="The Ready Mark"
                    width="80"
                    style="display:block;margin:0 auto 12px auto;border:0;outline:none;text-decoration:none;"
                  />

                  <div style="font-size:13px;line-height:1.4;letter-spacing:3px;text-transform:uppercase;font-weight:700;color:#c7a257;margin:0 0 8px 0;">
                    The Ready Mark
                  </div>

                  <h1 style="margin:0 0 12px 0;font-size:28px;line-height:1.2;font-weight:600;color:#111315;">
                    New Property Issue Available
                  </h1>

                  <p style="margin:0 0 18px 0;font-size:15px;line-height:1.7;color:#6f6a61;">
                    ${escapeHtml(contactName || "Hello")}, a guest issue report has been made available for your review in the Ready Mark client portal.
                  </p>

                  <div style="margin:0 auto 22px auto;max-width:440px;background:#fbfaf7;border:1px solid #e7d8b4;border-radius:14px;padding:18px 16px;text-align:left;">
                    <p style="margin:0 0 10px 0;font-size:15px;color:#111315;"><strong>Property:</strong> ${escapeHtml(propertyName)}</p>
                    <p style="margin:0 0 10px 0;font-size:15px;color:#111315;"><strong>Room:</strong> ${escapeHtml(roomNumber || "N/A")}</p>
                    <p style="margin:0;font-size:15px;color:#111315;"><strong>Reference:</strong> ${escapeHtml(referenceNumber || "N/A")}</p>
                  </div>

                  <a
                    href="${portalUrl}"
                    style="display:inline-block;padding:14px 24px;background:#c7a257;color:#111315;text-decoration:none;border-radius:12px;font-weight:700;"
                  >
                    Open Client Portal
                  </a>

                  <p style="margin:18px 0 0 0;font-size:13px;line-height:1.7;color:#958d82;">
                    Please log in to review the issue and submit remediation details.
                  </p>

                </td>
              </tr>

              <tr>
                <td style="padding:14px 8px 0 8px;text-align:center;">
                  <p style="margin:0;font-size:12px;line-height:1.6;color:#8f887d;">
                    This is a notification from The Ready Mark. The client portal is the official record for issue handling and remediation updates.
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
  `;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: `Ready Mark <${resendFromEmail}>`,
      to,
      subject: `New Ready Mark Issue Available – ${referenceNumber || "Property Alert"}`,
      html
    })
  });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    throw new Error(data?.message || data?.error || "Failed to send portal notification email");
  }

  return data;
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
    const { report_id, send_email_notification = true } = req.body || {};

    if (!report_id) {
      return res.status(400).json({ error: "Missing report_id" });
    }

    const resendApiKey = process.env.RESEND_API_KEY;
    const resendFromEmail = process.env.RESEND_FROM_EMAIL;

    const headers = {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      Accept: "application/json"
    };

    const reportRes = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/guest_reports?id=eq.${encodeURIComponent(report_id)}&select=*`,
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

    if (!report.property_slug) {
      return res.status(400).json({ error: "Missing property_slug on report" });
    }

    const propertyRes = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/properties?property_slug=eq.${encodeURIComponent(report.property_slug)}&select=id,property_name,property_slug,city,state,property_type&limit=1`,
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

    const alreadySent =
      String(report.status || "").trim() === "Sent to Property" &&
      !!report.hotel_notified_at;

    if (alreadySent) {
      return res.status(409).json({
        error: "This report has already been sent to the property."
      });
    }

    const sentAt = new Date().toISOString();

    const patchRes = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/guest_reports?id=eq.${encodeURIComponent(report.id)}`,
      {
        method: "PATCH",
        headers: {
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=representation"
        },
        body: JSON.stringify({
          status: "Sent to Property",
          hotel_notified_at: sentAt
        })
      }
    );

    const patchData = await patchRes.json().catch(() => null);

    if (!patchRes.ok) {
      return res.status(500).json({
        error: "Failed to update guest report for property visibility",
        details: patchData
      });
    }

    let notifiedEmail = null;

    if (send_email_notification) {
      if (!resendApiKey || !resendFromEmail) {
        return res.status(500).json({
          error: "Report was routed to the client portal, but email notification configuration is missing."
        });
      }

      const contactRes = await fetch(
        `${process.env.SUPABASE_URL}/rest/v1/property_contacts?property_id=eq.${encodeURIComponent(property.id)}&active=eq.true&select=id,name,email,role,is_primary,created_at&order=is_primary.desc,created_at.asc`,
        { headers }
      );

      const contactData = await contactRes.json().catch(() => null);

      if (!contactRes.ok) {
        return res.status(500).json({
          error: "Report was routed to the client portal, but property contact lookup failed",
          details: contactData
        });
      }

      const contact = Array.isArray(contactData) ? contactData[0] : null;

      if (contact?.email) {
        await sendPortalNotificationEmail({
          resendApiKey,
          resendFromEmail,
          to: contact.email,
          contactName: contact.name || "",
          propertyName: property.property_name || report.property_name || "",
          roomNumber: report.room_number || "",
          referenceNumber: report.confirmation_number || ""
          propertySlug: report.property_slug
        });

        notifiedEmail = contact.email;
      }
    }

    return res.status(200).json({
      success: true,
      message: notifiedEmail
        ? "Report routed to client portal and notification email sent."
        : "Report routed to client portal successfully.",
      property_slug: report.property_slug,
      report_id: report.id,
      status: "Sent to Property",
      hotel_notified_at: sentAt,
      notified_email: notifiedEmail
    });
  } catch (error) {
    return res.status(500).json({
      error: "Server error",
      details: error.message
    });
  }
}
