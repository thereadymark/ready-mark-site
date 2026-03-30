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
      return res.status(500).json({ error: "Missing server env vars" });
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
      return res.status(400).json({ error: "Missing required fields" });
    }

    // 🔥 Generate confirmation number
    const now = new Date();
    const datePart = now.toISOString().slice(0,10).replace(/-/g, "");
    const randomPart = Math.floor(1000 + Math.random() * 9000);
    const confirmationNumber = `RM-${datePart}-${randomPart}`;

    const insertUrl = `${supabaseUrl}/rest/v1/guest_reports`;

    const response = await fetch(insertUrl, {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
        Prefer: "return=representation"
      },
      body: JSON.stringify({
        property,
        room,
        issue,
        details,
        guest_name,
        guest_email,
        confirmation_number: confirmationNumber,
        created_at: new Date().toISOString(),
        stay_match_status: "pending"
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(500).json({
        error: "Insert failed",
        details: data
      });
    }

    return res.status(200).json({
      success: true,
      confirmationNumber
    });

  } catch (err) {
    return res.status(500).json({
      error: "Server error",
      details: err.message
    });
  }
}
