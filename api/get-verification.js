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

    // Try to find a room using qr_slug first, then fallback to room_number if needed.
    let room = null;
    let roomLookupDebug = [];

    for (const candidate of slugCandidates) {
      const qrSlugUrl =
        `${supabaseUrl}/rest/v1/${ROOM_TABLE}` +
        `?qr_slug=eq.${encodeURIComponent(candidate)}` +
        `&select=*` +
        `&limit=1`;

      const { response, json } = await fetchJson(qrSlugUrl);

      roomLookupDebug.push({
        field: "qr_slug",
        candidate,
        ok: response.ok,
        found: Array.isArray(json) ? json.length : 0,
      });

      if (!response.ok) {
        return res.status(500).json({
          error: "Room lookup failed on qr_slug",
          details: json,
          debug: roomLookupDebug,
        });
      }

      if (Array.isArray(json) && json.length > 0) {
        room = json[0];
        break;
      }
    }

    if (!room) {
      for (const candidate of slugCandidates) {
        const roomNumberUrl =
          `${supabaseUrl}/rest/v1/${ROOM_TABLE}` +
          `?room_number=eq.${encodeURIComponent(candidate)}` +
          `&select=*` +
          `&limit=1`;

        const { response, json } = await fetchJson(roomNumberUrl);

        roomLookupDebug.push({
          field: "room_number",
          candidate,
          ok: response.ok,
          found: Array.isArray(json) ? json.length : 0,
        });

        if (!response.ok) {
          return res.status(500).json({
            error: "Room lookup failed on room_number",
            details: json,
            debug: roomLookupDebug,
          });
        }

        if (Array.isArray(json) && json.length > 0) {
          room = json[0];
          break;
        }
      }
    }

    if (!room) {
      return res.status(404).json({
        error: "Room not found",
        attemptedSlug: slug,
        candidatesTried: slugCandidates,
        debug: roomLookupDebug,
      });
    }

    if (!room.id) {
      return res.status(500).json({
        error: "Room record found but missing room.id",
        room,
      });
    }

    // Find latest inspection for this room
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

    const inspection = Array.isArray(inspectionData) && inspectionData.length > 0
      ? inspectionData[0]
      : null;

    return res.status(200).json({
      property:
        room.property_name ??
        room.property ??
        room.propertyTitle ??
        "",
      room:
        room.room_number ??
        room.room ??
        room.number ??
        "",
      qrSlug:
        room.qr_slug ??
        room.slug ??
        "",
      qrUrl:
        room.qr_url ??
        "",
      inspectorId:
        inspection?.inspector_id ??
        inspection?.inspectorId ??
        "",
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
      score:
        inspection?.score ??
        "",
      status:
        inspection?.certification_tier ??
        inspection?.certificationTier ??
        "Not verified",

      // Helpful temporary debug
      debug: {
        requestedSlug: slug,
        matchedRoomId: room.id,
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
