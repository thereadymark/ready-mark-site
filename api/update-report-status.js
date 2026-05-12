function generateResolutionToken() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function sendEmail({ resendApiKey, from, to, subject, html }) {
  const emailRes = await fetch("https://api.resend.com/emails", {
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

  const emailData = await emailRes.json().catch(() => null);

  if (!emailRes.ok) {
    throw new Error(
      emailData?.message ||
      emailData?.error ||
      emailData?.name ||
      "Email send failed."
    );
  }

  return emailData;
}

function buildGuestFollowUpEmail({
  confirmationNumber,
  propertyName,
  roomNumber,
  followUpUrl
}) {
  return `
<div style="margin:0;padding:0;background:#f7f6f3;font-family:Georgia,serif;color:#111315;">
  <div style="max-width:720px;margin:0 auto;padding:32px 16px;">
    <div style="background:#ffffff;border:1px solid #e6e1d8;border-radius:18px;overflow:hidden;">
      <div style="padding:28px 24px;text-align:center;border-bottom:1px solid #eee;">
        <img src="https://verify.thereadymarkgroup.com/readymarkseal(best)nobackground.PNG"
             style="width:80px;margin-bottom:10px;" />

        <div style="color:#c7a257;font-size:12px;letter-spacing:3px;text-transform:uppercase;font-weight:700;">
          The Ready Mark
        </div>

        <h1 style="margin:12px 0 6px;font-size:28px;color:#111315;">
          Was Your Issue Resolved?
        </h1>

        <p style="margin:0;color:#5f5a52;font-size:15px;line-height:1.6;">
          The property has submitted remediation for your room cleanliness concern. Please confirm whether the issue has been fully resolved.
        </p>
      </div>

      <div style="padding:24px;">
        <div style="margin-bottom:16px;">
          <div style="color:#c7a257;font-size:12px;text-transform:uppercase;font-weight:700;margin-bottom:4px;">Reference</div>
          <div style="font-size:17px;color:#111315;font-weight:600;">${escapeHtml(confirmationNumber || "Not available")}</div>
        </div>

        <div style="margin-bottom:16px;">
          <div style="color:#c7a257;font-size:12px;text-transform:uppercase;font-weight:700;margin-bottom:4px;">Property</div>
          <div style="font-size:17px;color:#111315;font-weight:600;">${escapeHtml(propertyName || "Not available")}</div>
        </div>

        <div style="margin-bottom:20px;">
          <div style="color:#c7a257;font-size:12px;text-transform:uppercase;font-weight:700;margin-bottom:4px;">Room</div>
          <div style="font-size:17px;color:#111315;font-weight:600;">${escapeHtml(roomNumber || "Not available")}</div>
        </div>

        <div style="margin-top:24px;text-align:center;">
          <a href="${escapeHtml(followUpUrl)}"
             style="display:inline-block;padding:14px 22px;border-radius:14px;background:#c7a257;color:#111315;font-weight:800;text-decoration:none;">
            Confirm Resolution
          </a>
        </div>

        <p style="margin-top:24px;font-size:13px;color:#7a7368;line-height:1.6;text-align:center;">
          If the issue was not resolved, this link lets you reopen the report so The Ready Mark can follow up.
        </p>
      </div>
    </div>
  </div>
</div>
`;
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
  const expectedAdminToken = process.env.ADMIN_TOKEN;

  if (!expectedAdminToken) {
    return res.status(500).json({ error: "Missing ADMIN_TOKEN" });
  }

  if (!adminToken || adminToken !== expectedAdminToken) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const { report_id, status, admin_name } = req.body || {};

    if (!report_id || !status) {
      return res.status(400).json({ error: "Missing report_id or status" });
    }

    const allowedStatuses = [
      "New",
      "Sent to Property",
      "Under Review",
      "Escalated",
      "Remediation Submitted",
      "Still Needs Attention",
      "Confirmed with Guest",
      "Resolved"
    ];

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        error: "Invalid status",
        allowed_statuses: allowedStatuses
      });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return res.status(500).json({ error: "Missing server environment variables" });
    }

    const headers = {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Accept: "application/json"
    };

    const existingRes = await fetch(
      `${supabaseUrl}/rest/v1/guest_reports?id=eq.${encodeURIComponent(report_id)}&select=id,status,verification_status,resolved_at,verified_at,verified_by,guest_confirmation_status,guest_confirmed_at,remediation_submitted_at,under_review_at,escalated_at,hotel_notified_at,guest_email,resolution_token,confirmation_number,property_name,property_slug,room_number&limit=1`,
      { headers }
    );

    const existingData = await existingRes.json().catch(() => null);

    if (!existingRes.ok) {
      return res.status(500).json({
        error: "Failed to load guest report",
        details: existingData
      });
    }

    const existingReport = Array.isArray(existingData) ? existingData[0] : null;

    if (!existingReport) {
      return res.status(404).json({ error: "Guest report not found" });
    }

    const now = new Date().toISOString();
    const verifiedBy = String(admin_name || "Ready Mark").trim();
    const emailWarnings = [];

    let updatePayload = { status };

    if (status === "New") {
      updatePayload = {
        ...updatePayload,
        verification_status: "new",
        guest_confirmation_status: null,
        resolved_at: null,
        verified_at: null,
        verified_by: null
      };
    }

    if (status === "Sent to Property") {
      updatePayload = {
        ...updatePayload,
        verification_status: "sent_to_property",
        hotel_notified_at: existingReport.hotel_notified_at || now,
        resolved_at: null,
        verified_at: null,
        verified_by: null
      };
    }

    if (status === "Under Review") {
      updatePayload = {
        ...updatePayload,
        verification_status: "under_review",
        under_review_at: existingReport.under_review_at || now,
        resolved_at: null,
        verified_at: null,
        verified_by: null
      };
    }

    if (status === "Escalated") {
      updatePayload = {
        ...updatePayload,
        verification_status: "escalated",
        escalated_at: existingReport.escalated_at || now,
        resolved_at: null,
        verified_at: null,
        verified_by: null
      };
    }

    if (status === "Remediation Submitted") {
      updatePayload = {
        ...updatePayload,
        verification_status: "pending_guest_confirmation",
        remediation_submitted_at: existingReport.remediation_submitted_at || now,
        guest_confirmation_status: null,
        resolution_token: existingReport.resolution_token || generateResolutionToken(),
        resolved_at: null,
        verified_at: null,
        verified_by: null
      };
    }

   if (status === "Still Needs Attention") {
  updatePayload = {
    ...updatePayload,

    status: "Escalated",

    verification_status: "escalated",

    guest_confirmation_status: "not_satisfied",

    escalation_required: true,
    escalation_level: 1,

    escalated_at: now,

    under_review_at: now,

    resolved_at: null,
    verified_at: null,
    verified_by: null
  };
}
    if (status === "Confirmed with Guest") {
      updatePayload = {
        ...updatePayload,
        verification_status: "guest_confirmed",
        guest_confirmation_status: "satisfied",
        guest_confirmed_at: now,
        resolved_at: null,
        verified_at: null,
        verified_by: null
      };
    }

    if (status === "Resolved") {
      updatePayload = {
        ...updatePayload,
        verification_status: "approved",
        guest_confirmation_status: existingReport.guest_confirmation_status || "satisfied",
        guest_confirmed_at: existingReport.guest_confirmed_at || now,
        verified_at: now,
        verified_by: verifiedBy,
        resolved_at: now
      };
    }

    const patchRes = await fetch(
      `${supabaseUrl}/rest/v1/guest_reports?id=eq.${encodeURIComponent(report_id)}`,
      {
        method: "PATCH",
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          "Content-Type": "application/json",
          Prefer: "return=representation"
        },
        body: JSON.stringify(updatePayload)
      }
    );

    const patchData = await patchRes.json().catch(() => null);

    if (!patchRes.ok) {
      return res.status(500).json({
        error: "Failed to update report status",
        details: patchData
      });
    }

    const updatedReport = Array.isArray(patchData) ? patchData[0] : patchData;

    if (status === "Remediation Submitted") {
      const resendApiKey = process.env.RESEND_API_KEY;
      const resendFromEmail = process.env.RESEND_FROM_EMAIL;

      if (!resendApiKey || !resendFromEmail) {
        emailWarnings.push("Guest follow-up email not sent. RESEND_API_KEY or RESEND_FROM_EMAIL is missing.");
      } else if (!updatedReport?.guest_email) {
        emailWarnings.push("Guest follow-up email not sent. guest_email is missing on this report.");
      } else if (!updatedReport?.resolution_token) {
        emailWarnings.push("Guest follow-up email not sent. resolution_token is missing on this report.");
      } else {
        const followUpUrl =
          `https://verify.thereadymarkgroup.com/guest-follow-up.html?report_id=${encodeURIComponent(updatedReport.id)}` +
          `&token=${encodeURIComponent(updatedReport.resolution_token)}`;

        try {
          await sendEmail({
            resendApiKey,
            from: `Ready Mark <${resendFromEmail}>`,
            to: updatedReport.guest_email,
            subject: `Please Confirm Your Ready Mark Issue Resolution – ${updatedReport.confirmation_number || "Report"}`,
            html: buildGuestFollowUpEmail({
              confirmationNumber: updatedReport.confirmation_number,
              propertyName: updatedReport.property_name || updatedReport.property_slug,
              roomNumber: updatedReport.room_number,
              followUpUrl
            })
          });
        } catch (emailError) {
          emailWarnings.push(`Guest follow-up email failed: ${emailError.message}`);
        }
      }
    }

    return res.status(200).json({
      success: true,
      report: updatedReport,
      applied_status: status,
      stored_status: updatedReport?.status || status,
      warnings: emailWarnings.length ? emailWarnings : undefined
    });
  } catch (error) {
    return res.status(500).json({
      error: "Server error",
      details: error.message
    });
  }
}
