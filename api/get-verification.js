export default async function handler(req, res) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
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
        error: "Missing server environment variables",
        missing: {
          SUPABASE_URL: !supabaseUrl,
          SUPABASE_SERVICE_ROLE_KEY: !serviceRoleKey,
        },
      });
    }

    const headers = {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Accept: "application/json",
    };

    const ROOM_TABLE = "Rooms";
    const INSPECTION_TABLE = "Inspections";
    const PROPERTY_TABLE = "properties";

    function uniq(arr) {
      return [...new Set(arr.filter(Boolean))];
    }

    function buildSlugCandidates(rawSlug) {
      const clean = String(rawSlug).trim();
      const lower = clean.toLowerCase();

      let numeric = lower;
      numeric = numeric.replace(/^room-?/i, "").trim();

      return uniq([
        clean,
        lower,
        lower.replace(/\s+/g, ""),
        lower.replace(/\s+/g, "-"),
        lower.replace(/^room(\d+)$/, "room-$1"),
        lower.replace(/^room-(\d+)$/, "$1"),
        numeric,
        `room-${numeric}`,
        `room${numeric}`,
        `Room ${numeric}`,
      ]);
    }

    async function fetchJson(url) {
      const response = await fetch(url, { headers });
      const json = await response.json().catch(() => null);
      return { response, json };
    }

    const slugCandidates = buildSlugCandidates(slug);

    // Fetch room
let room = null;

if (propertySlug) {
  // New format: property + room, e.g. crown-plaza-hotel-stl-room-102
  const roomUrl =
    `${supabaseUrl}/rest/v1/${ROOM_TABLE}` +
    `?room_number=eq.${encodeURIComponent(roomNumber)}` +
    `&select=*` +
    `&limit=50`;

  const { response: roomRes, json: roomData } = await fetchJson(roomUrl);

  if (!roomRes.ok) {
    return res.status(500).json({
      error: "Room lookup failed",
      details: roomData,
      propertySlug,
      roomNumber
    });
  }

  if (!Array.isArray(roomData) || roomData.length === 0) {
    return res.status(404).json({
      error: "Room not found",
      propertySlug,
      roomNumber
    });
  }

  // Find the matching property record by slug
  const propertyUrl =
    `${supabaseUrl}/rest/v1/${PROPERTY_TABLE}` +
    `?property_slug=eq.${encodeURIComponent(propertySlug)}` +
    `&select=*` +
    `&limit=1`;

  const { response: propertyRes, json: propertyData } = await fetchJson(propertyUrl);

  if (!propertyRes.ok) {
    return res.status(500).json({
      error: "Property lookup failed",
      details: propertyData,
      propertySlug
    });
  }

  if (!Array.isArray(propertyData) || propertyData.length === 0) {
    return res.status(404).json({
      error: "Property not found",
      propertySlug
    });
  }

  const matchedProperty = propertyData[0];

  room = roomData.find(r => r.property_id === matchedProperty.id) || null;

  if (!room) {
    return res.status(404).json({
      error: "Room not found for selected property",
      propertySlug,
      roomNumber
    });
  }
} else {
  // Old format fallback: room-102
  const roomUrl =
    `${supabaseUrl}/rest/v1/${ROOM_TABLE}` +
    `?room_number=eq.${encodeURIComponent(roomNumber)}` +
    `&select=*` +
    `&limit=1`;

  const { response: roomRes, json: roomData } = await fetchJson(roomUrl);

  if (!roomRes.ok) {
    return res.status(500).json({
      error: "Room lookup failed",
      details: roomData,
      roomNumber
    });
  }

  if (!Array.isArray(roomData) || roomData.length === 0) {
    return res.status(404).json({
      error: "Room not found",
      roomNumber
    });
  }

  room = roomData[0];
}    // Fetch property name from properties table using property_id
    let propertyName = "";

    if (room.property_id) {
      const propertyUrl =
        `${supabaseUrl}/rest/v1/${PROPERTY_TABLE}` +
        `?id=eq.${encodeURIComponent(room.property_id)}` +
        `&select=*` +
        `&limit=1`;

      const { response: propertyRes, json: propertyData } = await fetchJson(propertyUrl);

      if (!propertyRes.ok) {
        return res.status(500).json({
          error: "Property lookup failed",
          details: propertyData,
          propertyId: room.property_id,
        });
      }

      if (Array.isArray(propertyData) && propertyData.length > 0) {
        const property = propertyData[0];
        propertyName =
          property.property_name ??
          property.name ??
          property.title ??
          "";
      }
    }

    // Fetch latest inspection for this room
    const inspectionUrl =
      `${supabaseUrl}/rest/v1/${INSPECTION_TABLE}` +
      `?room_id=eq.${encodeURIComponent(room.id)}` +
      `&select=*` +
      `&order=created_at.desc` +
      `&limit=1`;

    const { response: inspectionRes, json: inspectionData } = await fetchJson(inspectionUrl);

    if (!inspectionRes.ok) {
      return res.status(500).json({
        error: "Inspection lookup failed",
        details: inspectionData,
        roomId: room.id,
      });
    }

    const inspection =
      Array.isArray(inspectionData) && inspectionData.length > 0
        ? inspectionData[0]
        : null;

    return res.status(200).json({
      property: propertyName,
      room: room.room_number ?? room.room ?? room.number ?? "",
      qrSlug: room.qr_slug ?? room.slug ?? "",
      qrUrl: room.qr_url ?? "",
      inspectorId: inspection?.inspector_id ?? inspection?.inspectorId ?? "",
      inspectionDate:
        inspection?.created_at ??
        inspection?.inspection_date ??
        inspection?.inspectionDate ??
        "",
      certificationTier:
        inspection?.certification_tier ??
        inspection?.certificationTier ??
        "Not verified",
      verificationId:
        inspection?.verification_id ??
        inspection?.verificationId ??
        "",
      score: inspection?.score ?? "",
      status:
        inspection?.certification_tier ??
        inspection?.certificationTier ??
        "Not verified",
      debug: {
        requestedSlug: slug,
        matchedRoomId: room.id,
        matchedPropertyId: room.property_id ?? null,
        matchedQrSlug: room.qr_slug ?? null,
        matchedRoomNumber: room.room_number ?? null,
      },
    });
  } catch (error) {
    return res.status(500).json({
      error: "Server error",
      details: error.message,
    });
  }
}
