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

    const nextStatus =
      guestResolutionStatus === "guest_confirmed_resolved"
        ? "guest_confirmed_resolved"
        : "reopened_guest_still_needs_attention";

    const { error: updateError } = await supabase
      .from("guest_reports")
      .update({
        status: nextStatus,
        guest_resolution_status: guestResolutionStatus,
        guest_resolution_note: guestResolutionNote || null,
        guest_resolution_confirmed_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq("id", reportId);

    if (updateError) {
      throw updateError;
    }

    return json(200, {
      success: true,
      status: nextStatus
    });
  } catch (error) {
    console.error("guest-confirm-resolution error:", error);
    return json(500, {
      error: error.message || "Unable to confirm resolution."
    });
  }
}
