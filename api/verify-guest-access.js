export default async function handler(req, res) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
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
      return res.status(400).json({ error: "Missing verification_id or guest_access_code" });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    const headers = {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Accept: "application/json"
    };

    const inspectionRes = await fetch(
      `${supabaseUrl}/rest/v1/Inspections?verification_id=eq.${encodeURIComponent(verification_id)}&select=room_id&limit=1`,
      { headers }
    );
    const inspectionData = await inspectionRes.json();

    if (!inspectionRes.ok || !inspectionData.length) {
      return res.status(404).json({ error: "Verification record not found" });
    }

    const roomId = inspectionData[0].room_id;

    const roomRes = await fetch(
      `${supabaseUrl}/rest/v1/Rooms?id=eq.${encodeURIComponent(roomId)}&select=id,guest_access_code&limit=1`,
      { headers }
    );
    const roomData = await roomRes.json();

    if (!roomRes.ok || !roomData.length) {
      return res.status(404).json({ error: "Room not found" });
    }

    const room = roomData[0];

    if (String(room.guest_access_code || "").trim() !== String(guest_access_code).trim()) {
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
