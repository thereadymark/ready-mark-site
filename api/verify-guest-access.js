export default async function handler(req, res) {
  const allowedOrigin = "https://verify.thereadymarkgroup.com";

  const corsHeaders = {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
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

  try {
    const { verification_id, guest_access_code } = req.body || {};

    if (!verification_id || !guest_access_code) {
      return res.status(400).json({
        error: "Missing verification_id or guest_access_code"
      });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return res.status(500).json({
        error: "Missing server environment variables"
      });
    }

    const normalizedVerificationId = String(verification_id).trim();
    const normalizedGuestAccessCode = String(guest_access_code).trim();

    const headers = {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Accept: "application/json"
    };

    const inspectionRes = await fetch(
      `${supabaseUrl}/rest/v1/Inspections?verification_id=eq.${encodeURIComponent(normalizedVerificationId)}&select=room_id&limit=1`,
      { headers }
    );

    const inspectionData = await inspectionRes.json().catch(() => null);

    if (!inspectionRes.ok) {
      return res.status(500).json({
        error: "Inspection lookup failed",
        details: inspectionData
      });
    }

    const inspection = Array.isArray(inspectionData) ? inspectionData[0] : null;

    if (!inspection?.room_id) {
      return res.status(404).json({ error: "Verification record not found" });
    }

    const roomRes = await fetch(
      `${supabaseUrl}/rest/v1/Rooms?id=eq.${encodeURIComponent(inspection.room_id)}&select=id,guest_access_code&limit=1`,
      { headers }
    );

    const roomData = await roomRes.json().catch(() => null);

    if (!roomRes.ok) {
      return res.status(500).json({
        error: "Room lookup failed",
        details: roomData
      });
    }

    const room = Array.isArray(roomData) ? roomData[0] : null;

    if (!room) {
      return res.status(404).json({ error: "Room not found" });
    }

    const storedCode = String(room.guest_access_code || "").trim();

    if (!storedCode || storedCode !== normalizedGuestAccessCode) {
      return res.status(401).json({ error: "Invalid guest support code" });
    }

    return res.status(200).json({
      success: true,
      verified: true
    });
  } catch (error) {
    return res.status(500).json({
      error: `Server error: ${error.message}`
    });
  }
}
