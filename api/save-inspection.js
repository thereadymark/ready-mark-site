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
      "Content-Type": "application/json",
      Accept: "application/json",
      Prefer: "return=representation"
    };

    const {
      property_slug,
      room_number,
      inspector_id,
      inspection_date,
      certification_tier,
      score,
      verification_id,
      status,
      notes
    } = req.body || {};

    if (!property_slug) {
      return res.status(400).json({ error: "Missing property_slug" });
    }

    if (!room_number) {
      return res.status(400).json({ error: "Missing room_number" });
    }

    if (!inspector_id) {
      return res.status(400).json({ error: "Missing inspector_id" });
    }

    if (!inspection_date) {
      return res.status(400).json({ error: "Missing inspection_date" });
    }

    if (!certification_tier) {
      return res.status(400).json({ error: "Missing certification_tier" });
    }

    if (!verification_id) {
      return res.status(400).json({ error: "Missing verification_id" });
    }

    // 1) Find property
    const propertyUrl =
      `${supabaseUrl}/rest/v1/properties` +
      `?property_slug=eq.${encodeURIComponent(property_slug)}` +
      `&select=id,property_name,property_slug` +
      `&limit=1`;

    const propertyRes = await fetch(propertyUrl, { headers });
    const propertyData = await propertyRes.json();

    if (!propertyRes.ok) {
      return res.status(500).json({
        error: `Property lookup failed: ${JSON.stringify(propertyData)}`
      });
    }

    if (!Array.isArray(propertyData) || propertyData.length === 0) {
      return res.status(404).json({
        error: `Property not found for slug: ${property_slug}`
      });
    }

    const property = propertyData[0];

    // 2) Find room for that property
    const roomLookupUrl =
      `${supabaseUrl}/rest/v1/Rooms` +
      `?property_id=eq.${encodeURIComponent(property.id)}` +
      `&room_number=eq.${encodeURIComponent(room_number)}` +
      `&select=*` +
      `&limit=1`;

    const roomLookupRes = await fetch(roomLookupUrl, { headers });
    const roomLookupData = await roomLookupRes.json();

    if (!roomLookupRes.ok) {
      return res.status(500).json({
        error: `Room lookup failed: ${JSON.stringify(roomLookupData)}`
      });
    }

    let room = null;

    // 3) Create room if missing
    if (Array.isArray(roomLookupData) && roomLookupData.length > 0) {
      room = roomLookupData[0];
    } else {
      const cleanRoomNumber = String(room_number).trim().toLowerCase().replace(/\s+/g, "");
      const qrSlug = `${property_slug}-room-${cleanRoomNumber}`;
      const qrUrl = `https://verify.thereadymarkgroup.com/${qrSlug}`;

      const roomInsertPayload = [{
        property_id: property.id,
        room_number: String(room_number).trim(),
        qr_slug: qrSlug,
        qr_url: qrUrl
      }];

      const roomInsertUrl = `${supabaseUrl}/rest/v1/Rooms`;
      const roomInsertRes = await fetch(roomInsertUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(roomInsertPayload)
      });

      const roomInsertData = await roomInsertRes.json();

      if (!roomInsertRes.ok) {
        return res.status(500).json({
          error: `Room creation failed: ${JSON.stringify(roomInsertData)}`
        });
      }

      if (!Array.isArray(roomInsertData) || roomInsertData.length === 0) {
        return res.status(500).json({
          error: "Room creation returned no record"
        });
      }

      room = roomInsertData[0];
    }

    // 4) Insert inspection
    // Keep this conservative for now so we avoid failing on optional columns.
    const inspectionPayload = [{
      room_id: room.id,
      inspector_id: String(inspector_id).trim(),
      created_at: new Date(inspection_date).toISOString(),
      certification_tier: String(certification_tier).trim(),
      verification_id: String(verification_id).trim(),
      score: score === "" || score === null || score === undefined ? null : Number(score),
    }];

    const inspectionUrl = `${supabaseUrl}/rest/v1/Inspections`;
    const inspectionRes = await fetch(inspectionUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(inspectionPayload)
    });

    const inspectionData = await inspectionRes.json();

    if (!inspectionRes.ok) {
      return res.status(500).json({
        error: `Inspection save failed: ${JSON.stringify(inspectionData)}`
      });
    }

    return res.status(200).json({
      success: true,
      property_name: property.property_name,
      property_slug: property.property_slug,
      room_number: room.room_number,
      verification_id: verification_id,
      public_url: room.qr_url || `https://verify.thereadymarkgroup.com/${property.property_slug}-room-${room.room_number}`
    });
  } catch (error) {
    return res.status(500).json({
      error: `Server error: ${error.message}`
    });
  }
}
