export default async function handler(req, res) {
  const allowedOrigin = "https://verify.thereadymarkgroup.com";

  const corsHeaders = {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  };

  Object.entries(corsHeaders).forEach(([key, value]) => {
    res.setHeader(key, value);
  });

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { slug, record } = req.query || {};

    if (!slug && !record) {
      return res.status(400).json({ error: "Missing slug or record parameter" });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return res.status(500).json({
        error: "Missing server environment variables"
      });
    }

    const headers = {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Accept: "application/json"
    };

    async function fetchJson(url, label) {
      const response = await fetch(url, { headers });
      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw {
          status: 500,
          body: {
            error: `${label} failed`,
            details: data
          }
        };
      }

      return Array.isArray(data) ? data : [];
    }

    async function getPropertyById(propertyId) {
      if (!propertyId) return null;

      const propertyData = await fetchJson(
        `${supabaseUrl}/rest/v1/properties?id=eq.${encodeURIComponent(propertyId)}&select=id,property_name,property_slug&limit=1`,
        "Property lookup"
      );

      return propertyData[0] || null;
    }

    async function getRoomById(roomId) {
      if (!roomId) return null;

      const roomData = await fetchJson(
        `${supabaseUrl}/rest/v1/Rooms?id=eq.${encodeURIComponent(roomId)}&select=id,property_id,room_number,qr_slug,qr_url&limit=1`,
        "Room lookup"
      );

      return roomData[0] || null;
    }

    function buildResponse({ property, room, inspection, statusOverride = null }) {
      return {
        property: property?.property_name ?? "",
        room: room?.room_number ?? "",
        inspectorId: inspection?.inspector_id ?? "",
        inspectionDate: inspection?.created_at ?? "",
        certificationTier: inspection?.certification_tier ?? "",
        verificationId: inspection?.verification_id ?? "",
        score: inspection?.score ?? "",
        status: statusOverride || inspection?.certification_tier || "Verified Record",
        notes: inspection?.notes ?? ""
      };
    }

    // ROOM / QR SLUG LOOKUP
    if (slug) {
      const normalizedSlug = String(slug).trim();

      const roomData = await fetchJson(
        `${supabaseUrl}/rest/v1/Rooms?qr_slug=eq.${encodeURIComponent(normalizedSlug)}&select=id,property_id,room_number,qr_slug,qr_url&limit=1`,
        "Room lookup"
      );

      const room = roomData[0] || null;

      if (!room) {
        return res.status(404).json({ error: "Room not found" });
      }

      const property = await getPropertyById(room.property_id);

      const inspectionData = await fetchJson(
        `${supabaseUrl}/rest/v1/Inspections?room_id=eq.${encodeURIComponent(room.id)}&is_current=eq.true&select=room_id,inspector_id,created_at,certification_tier,verification_id,score,notes&limit=1`,
        "Inspection lookup"
      );

      const inspection = inspectionData[0] || null;

      if (!inspection) {
        return res.status(404).json({
          property: property?.property_name ?? "",
          room: room?.room_number ?? "",
          error: "Inspection not found"
        });
      }

      return res.status(200).json(
        buildResponse({
          property,
          room,
          inspection
        })
      );
    }

    // VERIFICATION RECORD LOOKUP
    if (record) {
      const normalizedRecord = String(record).trim();

      const inspectionData = await fetchJson(
        `${supabaseUrl}/rest/v1/Inspections?verification_id=eq.${encodeURIComponent(normalizedRecord)}&select=room_id,inspector_id,created_at,certification_tier,verification_id,score,notes&limit=1`,
        "Certificate lookup"
      );

      const inspection = inspectionData[0] || null;

      if (!inspection) {
        return res.status(404).json({ error: "Certificate not found" });
      }

      const room = await getRoomById(inspection.room_id);

      if (!room) {
        return res.status(404).json({ error: "Associated room not found" });
      }

      const property = await getPropertyById(room.property_id);

      return res.status(200).json(
        buildResponse({
          property,
          room,
          inspection,
          statusOverride: "Verified Record"
        })
      );
    }

    return res.status(400).json({ error: "Missing slug or record parameter" });
  } catch (error) {
    if (error?.body && error?.status) {
      return res.status(error.status).json(error.body);
    }

    return res.status(500).json({
      error: "Server error",
      details: error.message
    });
  }
}
