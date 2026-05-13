import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  const allowedOrigin = "https://verify.thereadymarkgroup.com";

  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    const body = req.body || {};

    const reportId = String(body.report_id || "").trim();
    const token = String(body.token || "").trim();
    const guestResolutionStatus = String(body.guest_resolution_status || "").trim();
    const guestResolutionNote = String(body.guest_resolution_note || "").trim();

    if (!reportId || !token) {
      return res.status(400).json({ error: "Missing report ID or token." });
    }

    const allowedStatuses = [
      "guest_confirmed_resolved",
      "guest_still_needs_attention"
    ];

    if (!allowedStatuses.includes(guestResolutionStatus)) {
      return res.status(400).json({ error: "Invalid resolution status." });
    }

    const { data: report, error: lookupError } = await supabase
      .from("guest_reports")
      .select("id, resolution_token, status")
      .eq("id", reportId)
      .maybeSingle();

    if (lookupError) {
      return res.status(500).json({ error: lookupError.message });
    }

    if (!report) {
      return res.status(404).json({ error: "Report not found." });
    }

    if (report.resolution_token !== token) {
      return res.status(403).json({ error: "Invalid token." });
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
            updated_at: now
          }
        : {
    status: "Escalated",
    verification_status: "escalated",
    guest_confirmation_status: "not_satisfied",

    guest_resolution_status: "guest_still_needs_attention",
    guest_resolution_note: guestResolutionNote || null,
    guest_resolution_confirmed_at: now,
          
    escalated_at: now,
    under_review_at: null,

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
      .maybeSingle();

    if (updateError) {
      return res.status(500).json({ error: updateError.message });
    }

    return res.status(200).json({
      success: true,
      status: updatePayload.status,
      report: updatedReport
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Unable to confirm resolution."
    });
  }
}
