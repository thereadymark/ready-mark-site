import { getAuthorizedClientUser } from "./_clientAuth.js";
import { createClient } from "@supabase/supabase-js";

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
    body: JSON.stringify({ from, to, subject, html })
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
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  };

  Object.entries(corsHeaders).forEach(([key, value]) => {
    res.setHeader(key, value);
  });

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return res.status(500).json({
        error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
      });
    }

    const authResult = await getAuthorizedClientUser(req);

    if (authResult.error) {
      return res.status(authResult.status).json({ error: authResult.error });
    }

    const { clientUser } = authResult;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const {
      report_id,
      property_slug,
      resolution_note,
      resolution_photo_url,
      resolved_by
    } = req.body || {};

    const resolvedByClean = String(resolved_by || "").trim();

    if (!resolvedByClean || resolvedByClean.length < 5 || !resolvedByClean.includes(" ")) {
      return res.status(400).json({
        error: "Resolved By must include both title and full name."
      });
    }

    const parts = resolvedByClean.includes("–")
      ? resolvedByClean.split("–")
      : resolvedByClean.split("-");

    const resolvedByTitle = parts[0]?.trim();
    const resolvedByName = parts.slice(1).join("-").trim();

    if (!resolvedByTitle || !resolvedByName) {
      return res.status(400).json({
        error: "Use format: Title – Full Name"
      });
    }

    if (!property_slug || typeof property_slug !== "string") {
      return res.status(400).json({ error: "Missing property_slug" });
    }

    const normalizedRequestedSlug = String(property_slug).trim().toLowerCase();
    const normalizedAllowedSlug = String(clientUser.property_slug).trim().toLowerCase();

    if (normalizedRequestedSlug !== normalizedAllowedSlug) {
      return res.status(403).json({ error: "You are not authorized for this property" });
    }

    if (!report_id) {
      return res.status(400).json({ error: "Missing report_id" });
    }

    if (!resolution_note || !String(resolution_note).trim()) {
      return res.status(400).json({ error: "Resolution note is required" });
    }

    const cleanedResolutionNote = String(resolution_note).trim();
    const cleanedPhotoUrl = resolution_photo_url ? String(resolution_photo_url).trim() : null;
    const submittedAt = new Date().toISOString();

    const { data: report, error: reportError } = await supabase
      .from("guest_reports")
      .select(`
        id,
        property_slug,
        property_name,
        room_number,
        status,
        hotel_notified_at,
        guest_email,
        resolution_token,
        confirmation_number,
        verification_id
      `)
      .eq("id", report_id)
      .maybeSingle();

    if (reportError) {
      return res.status(500).json({ error: reportError.message });
    }

    if (!report) {
      return res.status(404).json({ error: "Guest report not found" });
    }

    if (String(report.property_slug || "").trim().toLowerCase() !== normalizedRequestedSlug) {
      return res.status(403).json({
        error: "This report does not belong to the selected property"
      });
    }

    if (!report.hotel_notified_at) {
      return res.status(400).json({
        error: "This issue has not been sent to the property yet"
      });
    }

    if (String(report.status || "").trim() === "Verified Resolved") {
      return res.status(409).json({
        error: "This issue has already been marked resolved"
      });
    }

    const resolutionToken = report.resolution_token || generateResolutionToken();

    const updatePayload = {
      resolution_note: cleanedResolutionNote,
      resolution_photo_url: cleanedPhotoUrl,
      remediation_submitted_at: submittedAt,

      resolved_by: `${resolvedByTitle} – ${resolvedByName}`,
      resolved_by_title: resolvedByTitle,
      resolved_by_name: resolvedByName,

      status: "Remediation Submitted",
      verification_status: "pending_guest_confirmation",
      guest_confirmation_status: "pending",

      guest_resolution_status: null,
      guest_resolution_note: null,
      guest_resolution_confirmed_at: null,

      resolution_token: resolutionToken,
      updated_at: submittedAt
    };

    const { data: updatedReport, error: updateError } = await supabase
      .from("guest_reports")
      .update(updatePayload)
      .eq("id", report_id)
      .select()
      .maybeSingle();

    if (updateError) {
      return res.status(500).json({ error: updateError.message });
    }

    const emailWarnings = [];
    const resendApiKey = process.env.RESEND_API_KEY;
    const resendFromEmail = process.env.RESEND_FROM_EMAIL;

    if (!resendApiKey || !resendFromEmail) {
      emailWarnings.push("Guest confirmation email not sent. RESEND_API_KEY or RESEND_FROM_EMAIL is missing.");
    } else if (!updatedReport?.guest_email) {
      emailWarnings.push("Guest confirmation email not sent. guest_email is missing on this report.");
    } else {
      const followUpUrl =
        `https://verify.thereadymarkgroup.com/guest-follow-up.html?report_id=${encodeURIComponent(updatedReport.id)}` +
        `&token=${encodeURIComponent(resolutionToken)}`;

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
        emailWarnings.push(`Guest confirmation email failed: ${emailError.message}`);
      }
    }

    return res.status(200).json({
      success: true,
      message: emailWarnings.length
        ? "Remediation submitted successfully, but guest confirmation email may need review."
        : "Remediation submitted successfully. Guest confirmation email sent.",
      report: updatedReport,
      warnings: emailWarnings.length ? emailWarnings : undefined
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Server error"
    });
  }
}
