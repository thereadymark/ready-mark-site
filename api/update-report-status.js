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
    const { report_id, status } = req.body || {};

    if (!report_id || !status) {
      return res.status(400).json({ error: "Missing report_id or status" });
    }

    const allowedStatuses = [
      "New",
      "Under Review",
      "Sent to Property",
      "Escalated",
      "Resolved by Property",
      "Confirmed with Guest",
      "Fully Resolved"
    ];

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
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
      `${supabaseUrl}/rest/v1/guest_reports?id=eq.${encodeURIComponent(report_id)}&select=id,status&limit=1`,
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
        body: JSON.stringify({ status })
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
      report: updatedReport
    });
  } catch (error) {
    return res.status(500).json({
      error: "Server error",
      details: error.message
    });
  }
}
