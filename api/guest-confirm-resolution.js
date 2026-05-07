import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, serviceRoleKey);

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
    const guestResolutionStatus = String(
      body.guest_resolution_status || ""
    ).trim();

    const guestResolutionNote = String(
      body.guest_resolution_note || ""
    ).trim();

    if (!reportId || !token) {
      return json(400, {
        error: "Missing report ID or token."
      });
    }

    const allowedStatuses = [
      "guest_confirmed_resolved",
      "guest_still_needs_attention"
    ];

    if (!allowedStatuses.includes(guestResolutionStatus)) {
      return json(400, {
        error: "Invalid resolution status."
      });
    }

    const { data: report, error: lookupError } = await supabase
      .from("guest_reports")
      .select(`
        id,
        resolution_token,
        status
      `)
      .eq("id", reportId)
      .maybeSingle();

    if (lookupError) {
      return json(500, {
        error: lookupError.message
      });
    }

    if (!report) {
      return json(404, {
        error: "Report not found."
      });
    }

    if (report.resolution_token !== token) {
      return json(403, {
        error: "Invalid token."
      });
    }

    let updatePayload = {};

    if (guestResolutionStatus === "guest_confirmed_resolved") {
      updatePayload = {
        status: "Confirmed with Guest",
        verification_status: "guest_confirmed",
        guest_confirmation_status: "satisfied",
        guest_confirmed_at: new Date().toISOString(),
        guest_resolution_note:
          guestResolutionNote || null,
        updated_at: new Date().toISOString()
      };
    } else {
      updatePayload = {
        status: "Still Needs Attention",
        verification_status: "reopened",
        guest_confirmation_status: "not_satisfied",
        guest_resolution_note:
          guestResolutionNote || null,
        under_review_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        resolved_at: null,
        verified_at: null,
        verified_by: null
      };
    }

    const { error: updateError } = await supabase
      .from("guest_reports")
      .update(updatePayload)
      .eq("id", reportId);

    if (updateError) {
      return json(500, {
        error: updateError.message
      });
    }

    return json(200, {
      success: true,
      status: updatePayload.status
    });

  } catch (error) {
    return json(500, {
      error: error.message || "Unknown server error."
    });
  }
}
