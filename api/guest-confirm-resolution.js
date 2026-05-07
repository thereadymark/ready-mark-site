import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}

export default async function handler(req) {
  if (req.method !== "POST") {
    return json(405, { error: "Method not allowed." });
  }

  try {
    const body = await req.json();

    const reportId = String(body.report_id || "").trim();
    const token = String(body.token || "").trim();
    const guestResolutionStatus = String(body.guest_resolution_status || "").trim();
    const guestResolutionNote = String(body.guest_resolution_note || "").trim();

    const allowedStatuses = [
      "guest_confirmed_resolved",
      "guest_still_needs_attention"
    ];

    if (!reportId || !token) {
      return json(400, { error: "Missing report ID or confirmation token." });
    }

    if (!allowedStatuses.includes(guestResolutionStatus)) {
      return json(400, { error: "Invalid resolution status." });
    }

    const { data: report, error: lookupError } = await supabase
      .from("guest_reports")
      .select("id, resolution_token, status")
      .eq("id", reportId)
      .single();

    if (lookupError || !report) {
      return json(404, { error: "Report not found." });
    }

    if (report.resolution_token !== token) {
      return json(403, { error: "Invalid confirmation token." });
    }

    const now = new Date().toISOString();

    const updatePayload =
      guestResolutionStatus === "guest_confirmed_resolved"
        ? {
            status: "Confirmed with Guest",
            verification_status: "guest_confirmed",
            guest_confirmation_status: "satisfied",
            guest_confirmed_at: now,
            guest_resolution_status: "guest_confirmed_resolved",
            guest_resolution_note: guestResolutionNote || null,
            guest_resolution_confirmed_at: now,
            resolved_at: null,
            verified_at: null,
            verified_by: null,
            updated_at: now
          }
        : {
            status: "Still Needs Attention",
            verification_status: "reopened",
            guest_confirmation_status: "not_satisfied",
            guest_resolution_status: "guest_still_needs_attention",
            guest_resolution_note: guestResolutionNote || null,
            guest_resolution_confirmed_at: now,
            under_review_at: now,
            resolved_at: null,
            verified_at: null,
            verified_by: null,
            updated_at: now
          };

    const { data: updatedReport, error: updateError } = await supabase
      .from("guest_reports")
      .update(updatePayload)
      .eq("id", reportId)
      .select()
      .single();

    if (updateError) {
      throw updateError;
    }

    return json(200, {
      success: true,
      report: updatedReport,
      status: updatedReport.status
    });
  } catch (error) {
    console.error("guest-confirm-resolution error:", error);
    return json(500, {
      error: error.message || "Unable to confirm resolution."
    });
  }
}
