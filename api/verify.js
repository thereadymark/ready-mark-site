export default async function handler(req, res) {
  try {
    const { slug, record } = req.query;

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return res.status(500).json({ error: "Missing server environment variables" });
    }

    const headers = {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    };

    // ROOM LOOKUP FLOW
    if (slug) {
      const roomRes = await fetch(
        `${supabaseUrl}/rest/v1/Rooms?qr_slug=eq.${encodeURIComponent(slug)}&select=*`,
        { headers }
      );

      const roomData = await roomRes.json();

      if (!roomRes.ok) {
        return res.status(500).json({ error: "Room lookup failed", details: roomData });
      }

      if (!roomData.length) {
        return res.status(404).json({ error: "Room not found" });
      }

      const room = roomData[0];

      const inspectionRes = await fetch(
        `${supabaseUrl}/rest/v1/Inspections?room_id=eq.${room.id}&select=*`,
        { headers }
      );

      const inspectionData = await inspectionRes.json();

      if (!inspectionRes.ok) {
        return res.status(500).json({ error: "Inspection lookup failed", details: inspectionData });
      }

      if (!inspectionData.length) {
        return res.status(404).json({
          property: room.property_name,
          room: room.room_number,
          error: "Inspection not found",
        });
      }

      const inspection = inspectionData[0];

      return res.status(200).json({
        property: room.property_name ?? "",
        room: room.room_number ?? "",
        inspectorId: inspection.inspector_id ?? "",
        inspectionDate: inspection.created_at ?? "",
        certificationTier: inspection.certification_tier ?? "",
        verificationId: inspection.verification_id ?? "",
        score: inspection.score ?? "",
      });
    }

    // CERTIFICATE LOOKUP FLOW
    if (record) {
      const inspectionRes = await fetch(
        `${supabaseUrl}/rest/v1/Inspections?verification_id=eq.${encodeURIComponent(record)}&select=*`,
        { headers }
      );

      const inspectionData = await inspectionRes.json();

      if (!inspectionRes.ok) {
        return res.status(500).json({ error: "Certificate lookup failed", details: inspectionData });
      }

      if (!inspectionData.length) {
        return res.status(404).json({ error: "Certificate not found" });
      }

      const inspection = inspectionData[0];

      const roomRes = await fetch(
        `${supabaseUrl}/rest/v1/Rooms?id=eq.${inspection.room_id}&select=*`,
        { headers }
      );

      const roomData = await roomRes.json();

      if (!roomRes.ok) {
        return res.status(500).json({ error: "Associated room lookup failed", details: roomData });
      }

      const room = roomData[0] || {};

      return res.status(200).json({
        property: room.property_name ?? "",
        room: room.room_number ?? "",
        inspectorId: inspection.inspector_id ?? "",
        inspectionDate: inspection.created_at ?? "",
        certificationTier: inspection.certification_tier ?? "",
        verificationId: inspection.verification_id ?? "",
        score: inspection.score ?? "",
        status: "Verified Record",
      });
    }

    return res.status(400).json({ error: "Missing slug or record parameter" });
  } catch (error) {
    return res.status(500).json({
      error: "Server error",
      details: error.message,
    });
  }
}
