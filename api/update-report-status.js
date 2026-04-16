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
      "Resolved by Property",
      "Confirmed with Guest",
      "Remediation Submitted",
      "Resolved",
      "Fully Resolved"
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
      `${supabaseUrl}/rest/v1/guest_reports?id=eq.${encodeURIComponent(report_id)}&select=id,status,verification_status,resolved_at,verified_at,guest_confirmation_status,remediation_submitted_at,under_review_at,escalated_at&limit=1`,
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

    let updatePayload = {
      status
    };

    if (status === "Under Review") {
      updatePayload = {
        ...updatePayload,
        under_review_at: existingReport.under_review_at || now
      };
    }

    if (status === "Escalated") {
      updatePayload = {
        ...updatePayload,
        escalated_at: existingReport.escalated_at || now
      };
    }

    if (status === "Sent to Property") {
      updatePayload = {
        ...updatePayload
      };
    }

    if (status === "Resolved by Property" || status === "Remediation Submitted") {
      updatePayload = {
        ...updatePayload,
        status: "Remediation Submitted",
        verification_status: "pending",
        remediation_submitted_at: existingReport.remediation_submitted_at || now,
        resolved_at: null,
        verified_at: null,
        verified_by: null
      };
    }

    if (status === "Confirmed with Guest") {
      updatePayload = {
        ...updatePayload,
        guest_confirmation_status: "satisfied",
        guest_confirmed_at: now
      };
    }

    if (status === "Fully Resolved" || status === "Resolved") {
      updatePayload = {
        ...updatePayload,
        status: "Resolved",
        verification_status: "approved",
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

    return res.status(200).json({
      success: true,
      report: updatedReport,
      applied_status: status,
      stored_status: updatedReport?.status || status
    });
  } catch (error) {
    return res.status(500).json({
      error: "Server error",
      details: error.message
    });
  }
}
