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
      return res.status(500).json({ error: "Missing env vars" });
    }

    const {
      property,
      property_slug,
      room,
      issue,
      details,
      guest_name,
      guest_email
    } = req.body || {};

    if (!room || !issue || !guest_email) {
      return res.status(400).json({
        error: "Missing required fields"
      });
    }

    // Generate IDs
    const now = new Date();
    const datePart = now.toISOString().slice(0, 10).replace(/-/g, "");
    const randomPart = Math.floor(1000 + Math.random() * 9000);

    const verificationId = `RM-${datePart}-${randomPart}`;
    const confirmationNumber = verificationId;

    // Split name
    const nameParts = String(guest_name || "").trim().split(/\s+/);
    const first = nameParts[0] || "";
    const last = nameParts.slice(1).join(" ") || "";

    const insertPayload = {
      verification_id: verificationId,
      confirmation_number: confirmationNumber,

      property_slug: property_slug || null,
      property_name: property || null,
      room_number: String(room),

      issue_types: Array.isArray(issue) ? issue : [issue],

      guest_note: details || null,

      guest_email,
      guest_first_name: first || null,
      guest_last_name: last || null,

      status: "new",
      priority: "urgent",
      stay_match_status: "pending",
      reported_at: new Date().toISOString()
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
        error: data?.message || JSON.stringify(data)
      });
    }

    return res.status(200).json({
      success: true,
      confirmationNumber,
      report: Array.isArray(data) ? data[0] : data
    });

  } catch (err) {
    return res.status(500).json({
      error: err.message
    });
  }
}
