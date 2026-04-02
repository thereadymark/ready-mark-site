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
    const { slug } = req.query;

    if (!slug || typeof slug !== "string") {
      return res.status(400).json({ error: "Missing slug parameter" });
    }

    let propertySlug = null;
    let roomNumber = null;

    if (slug.includes("-room-")) {
      const parts = slug.split("-room-");

      if (parts.length !== 2 || !parts[0] || !parts[1]) {
        return res.status(400).json({ error: "Invalid slug format" });
      }

      propertySlug = parts[0];
      roomNumber = parts[1];
    } else {
      roomNumber = slug.replace(/^room-/, "");
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

    const ROOM_TABLE = "Rooms";
    const INSPECTION_TABLE = "Inspections";
    const PROPERTY_TABLE = "properties";

    async function fetchJson(url) {
      const response = await fetch(url, { headers });
      const json = await response.json().catch(() => null);
      return { response, json };
    }

    let room = null;
    let property = null;

    if (propertySlug) {
      const roomUrl =
        `${supabaseUrl}/rest/v1/${ROOM_TABLE}` +
        `?room_number=eq.${encodeURIComponent(roomNumber)}` +
        `&select=id,property_id,room_number,qr_slug,qr_url` +
        `&limit=50`;

      const { response: roomRes, json: roomData } = await fetchJson(roomUrl);

      if (!roomRes.ok) {
        return res.status(500).json({
          error: "Room lookup failed"
        });
      }

      if (!Array.isArray(roomData) || roomData.length === 0) {
        return res.status(404).json({
          error: "Room not found"
        });
      }

      const propertyUrl =
        `${supabaseUrl}/rest/v1/${PROPERTY_TABLE}` +
        `?property_slug=eq.${encodeURIComponent(propertySlug)}` +
        `&select=id,property_name,property_slug` +
        `&limit=1`;

      const { response: propertyRes, json: propertyData } = await fetchJson(propertyUrl);

      if (!propertyRes.ok) {
        return res.status(500).json({
          error: "Property lookup failed"
        });
      }

      if (!Array.isArray(propertyData) || propertyData.length === 0) {
        return res.status(404).json({
          error: "Property not found"
        });
      }

      property = propertyData[0];
      room = roomData.find(r => r.property_id === property.id) || null;

      if (!room) {
        return res.status(404).json({
          error: "Room not found for selected property"
        });
      }
    } else {
      const roomUrl =
        `${supabaseUrl}/rest/v1/${ROOM_TABLE}` +
        `?room_number=eq.${encodeURIComponent(roomNumber)}` +
        `&select=id,property_id,room_number,qr_slug,qr_url` +
        `&limit=1`;

      const { response: roomRes, json: roomData } = await fetchJson(roomUrl);

      if (!roomRes.ok) {
        return res.status(500).json({
          error: "Room lookup failed"
        });
      }

      if (!Array.isArray(roomData) || roomData.length === 0) {
        return res.status(404).json({
          error: "Room not found"
        });
      }

      room = roomData[0];
    }

    if (!property && room.property_id) {
      const propertyUrl =
        `${supabaseUrl}/rest/v1/${PROPERTY_TABLE}` +
        `?id=eq.${encodeURIComponent(room.property_id)}` +
        `&select=id,property_name,property_slug` +
        `&limit=1`;

      const { response: propertyRes, json: propertyData } = await fetchJson(propertyUrl);

      if (!propertyRes.ok) {
        return res.status(500).json({
          error: "Property lookup failed"
        });
      }

      if (Array.isArray(propertyData) && propertyData.length > 0) {
        property = propertyData[0];
      }
    }

    const inspectionUrl =
      `${supabaseUrl}/rest/v1/${INSPECTION_TABLE}` +
      `?room_id=eq.${encodeURIComponent(room.id)}` +
      `&select=inspector_id,created_at,inspection_date,certification_tier,verification_id,score` +
      `&order=created_at.desc` +
      `&limit=1`;

    const { response: inspectionRes, json: inspectionData } = await fetchJson(inspectionUrl);

    if (!inspectionRes.ok) {
      return res.status(500).json({
        error: "Inspection lookup failed"
      });
    }

    const inspection =
      Array.isArray(inspectionData) && inspectionData.length > 0
        ? inspectionData[0]
        : null;

    return res.status(200).json({
      property: property?.property_name ?? "",
      property_slug: property?.property_slug ?? propertySlug ?? "",
      room: room.room_number ?? "",
      qrSlug: room.qr_slug ?? "",
      qrUrl: room.qr_url ?? "",
      inspectorId: inspection?.inspector_id ?? "",
      inspectionDate:
        inspection?.created_at ??
        inspection?.inspection_date ??
        "",
      certificationTier:
        inspection?.certification_tier ??
        "Not verified",
      verificationId:
        inspection?.verification_id ??
        "",
      score: inspection?.score ?? "",
      status:
        inspection?.certification_tier ??
        "Not verified"
    });
  } catch (error) {
    return res.status(500).json({
      error: "Server error",
      details: error.message
    });
  }
}
