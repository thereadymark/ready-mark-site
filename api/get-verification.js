export default async function handler(req, res) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  if (req.method === "OPTIONS") {
    Object.entries(corsHeaders).forEach(([key, value]) => res.setHeader(key, value));
    return res.status(200).end();
  }

  Object.entries(corsHeaders).forEach(([key, value]) => res.setHeader(key, value));

  try {
    const { slug } = req.query;

    if (!slug) {
      return res.status(400).json({ error: "Missing slug parameter" });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return res.status(500).json({ error: "Missing server environment variables" });
    }

    const headers = {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    };

    // 1) Find the room by QR slug
    const roomRes = await fetch(
      `${supabaseUrl}/rest/v1/Rooms?qr_slug=eq.${encodeURIComponent(slug)}&select=*`,
      { headers }
    );

    const roomData = await roomRes.json();

    if (!roomRes.ok) {
      return res.status(500).json({
        error: "Room lookup failed",
        details: roomData,
      });
    }

    if (!roomData.length) {
      return res.status(404).json({ error: "Room not found" });
    }

    const room = roomData[0];

    // 2) Find the latest inspection for that room
    const inspectionRes = await fetch(
      `${supabaseUrl}/rest/v1/Inspections?room_id=eq.${room.id}&select=*&order=created_at.desc&limit=1`,
      { headers }
    );

    const inspectionData = await inspectionRes.json();

    if (!inspectionRes.ok) {
      return res.status(500).json({
        error: "Inspection lookup failed",
        details: inspectionData,
      });
    }

    const inspection = inspectionData[0] || null;

    return res.status(200).json({
      property: room.property_name ?? "",
      room: room.room_number ?? "",
      qrSlug: room.qr_slug ?? "",
      qrUrl: room.qr_url ?? "",
      inspectorId: inspection?.inspector_id ?? "",
      inspectionDate: inspection?.created_at ?? "",
      certificationTier: inspection?.certification_tier ?? "",
      verificationId: inspection?.verification_id ?? "",
      score: inspection?.score ?? "",
      status: inspection?.certification_tier ?? "Not verified",
    });
  } catch (error) {
    return res.status(500).json({
      error: "Server error",
      details: error.message,
    });
  }
}
