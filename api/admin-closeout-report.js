import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  const allowedOrigin = "https://verify.thereadymarkgroup.com";

  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-token");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const adminToken = String(req.headers["x-admin-token"] || "").trim();

    if (!adminToken || adminToken !== process.env.ADMIN_PORTAL_PASSWORD) {
      return res.status(401).json({
        error: "Unauthorized"
      });
    }

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const {
      report_id,
      admin_name,
      closeout_reason,
      closeout_note
    } = req.body || {};

    if (!report_id) {
      return res.status(400).json({
        error: "Missing report_id"
      });
    }

    const now = new Date().toISOString();

    const updatePayload = {
      status: "Resolved",

      verification_status: "admin_closed",

      guest_confirmation_status: "admin_override",

      resolved_at: now,

      verified_at: now,

      verified_by: admin_name || "Ready Mark Admin",

      admin_closeout_reason: String(closeout_reason || "").trim(),

      admin_closeout_note: String(closeout_note || "").trim(),

      admin_closed_at: now,

      updated_at: now
    };

    const { data, error } = await supabase
      .from("guest_reports")
      .update(updatePayload)
      .eq("id", report_id)
      .select()
      .maybeSingle();

    if (error) {
      return res.status(500).json({
        error: error.message
      });
    }

    return res.status(200).json({
      success: true,
      report: data
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Unable to close report"
    });
  }
}
