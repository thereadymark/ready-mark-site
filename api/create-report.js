export default async function handler(req, res) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return res.status(500).json({
        error: "Missing server env vars",
        details: {
          SUPABASE_URL: !!supabaseUrl,
          SUPABASE_SERVICE_ROLE_KEY: !!serviceRoleKey
        }
      });
    }

    const {
      property,
      room,
      issue,
      details,
      guest_name,
      guest_email
    } = req.body || {};

    if (!room || !issue || !guest_email) {
      return res.status(400).json({
        error: "Missing required fields",
        details: { property, room, issue, guest_name, guest_email }
      });
    }

    const now = new Date();
    const datePart = now.toISOString().slice(0, 10).replace(/-/g, "");
    const randomPart = Math.floor(1000 + Math.random() * 9000);
    const confirmationNumber = `RM-${datePart}-${randomPart}`;

    const insertPayload = {
      property,
      room,
      issue,
      details,
      guest_name,
      guest_email,
      confirmation_number: confirmationNumber,
      created_at: new Date().toISOString(),
      stay_match_status: "pending"
    };

    const response = await fetch(`${supabaseUrl}/rest/v1/guest_reports`, {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
        Prefer: "return=representation"
      },
      body: JSON.stringify(insertPayload)
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      return res.status(500).json({
        error: "Insert failed",
        details: data,
        payload: insertPayload
      });
    }

    return res.status(200).json({
      success: true,
      confirmationNumber,
      report: Array.isArray(data) ? data[0] : data
    });

  } catch (err) {
    return res.status(500).json({
      error: "Server error",
      details: err.message
    });
  }
}
