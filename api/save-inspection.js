function generateGuestAccessCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export default async function handler(req, res) {
  const allowedOrigin = "https://verify.thereadymarkgroup.com";

  const corsHeaders = {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-admin-token"
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

  const adminToken = req.headers["x-admin-token"];
  const expectedToken = process.env.ADMIN_TOKEN;

  if (!adminToken || !expectedToken || adminToken !== expectedToken) {
    return res.status(401).json({ error: "Unauthorized" });
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
      notes
    } = req.body || {};

    if (!property_slug) return res.status(400).json({ error: "Missing property_slug" });
    if (!room_number) return res.status(400).json({ error: "Missing room_number" });
    if (!inspector_id) return res.status(400).json({ error: "Missing inspector_id" });
    if (!inspection_date) return res.status(400).json({ error: "Missing inspection_date" });
    if (!certification_tier) return res.status(400).json({ error: "Missing certification_tier" });
    if (!verification_id) return res.status(400).json({ error: "Missing verification_id" });

    const normalizedPropertySlug = String(property_slug).trim();
    const normalizedRoomNumber = String(room_number).trim();

    // 🔍 PROPERTY LOOKUP
    const propertyRes = await fetch(
      `${supabaseUrl}/rest/v1/properties?property_slug=eq.${encodeURIComponent(normalizedPropertySlug)}&select=id,property_name,property_slug&limit=1`,
      { headers }
    );

    const propertyData = await propertyRes.json().catch(() => null);

    if (!propertyRes.ok) {
      return res.status(500).json({
        error: "Property lookup failed",
        details: propertyData
      });
    }

    if (!Array.isArray(propertyData) || propertyData.length === 0) {
      return res.status(404).json({
        error: `Property not found for slug: ${normalizedPropertySlug}`
      });
    }

    const property = propertyData[0];

    // 🔍 ROOM LOOKUP
    const roomLookupRes = await fetch(
      `${supabaseUrl}/rest/v1/Rooms?property_id=eq.${encodeURIComponent(property.id)}&room_number=eq.${encodeURIComponent(normalizedRoomNumber)}&select=id,room_number,qr_slug,qr_url&limit=1`,
      { headers }
    );

    const roomLookupData = await roomLookupRes.json().catch(() => null);

    if (!roomLookupRes.ok) {
      return res.status(500).json({
        error: "Room lookup failed",
        details: roomLookupData
      });
    }

    let room = null;

    if (Array.isArray(roomLookupData) && roomLookupData.length > 0) {
      room = roomLookupData[0];
    } else {
      const cleanRoomNumber = normalizedRoomNumber.toLowerCase().replace(/\s+/g, "");
      const qrSlug = `${normalizedPropertySlug}-room-${cleanRoomNumber}`;
      const qrUrl = `https://verify.thereadymarkgroup.com/${qrSlug}`;

      const roomInsertRes = await fetch(`${supabaseUrl}/rest/v1/Rooms`, {
        method: "POST",
        headers,
        body: JSON.stringify([{
          property_id: property.id,
          room_number: normalizedRoomNumber,
          qr_slug: qrSlug,
          qr_url: qrUrl,
          guest_access_code: generateGuestAccessCode()
        }])
      });

      const roomInsertData = await roomInsertRes.json().catch(() => null);

      if (!roomInsertRes.ok || !Array.isArray(roomInsertData) || !roomInsertData.length) {
        return res.status(500).json({
          error: "Room creation failed",
          details: roomInsertData
        });
      }

      room = roomInsertData[0];
    }

    // 🧾 CREATE INSPECTION
    const inspectionRes = await fetch(`${supabaseUrl}/rest/v1/Inspections`, {
      method: "POST",
      headers,
      body: JSON.stringify([{
        room_id: room.id,
        inspector_id: String(inspector_id).trim(),
        created_at: new Date(inspection_date).toISOString(),
        certification_tier: String(certification_tier).trim(),
        verification_id: String(verification_id).trim(),
        score: score ? Number(score) : null,
        notes: notes ? String(notes).trim() : null
      }])
    });

    const inspectionData = await inspectionRes.json().catch(() => null);

    if (!inspectionRes.ok) {
      return res.status(500).json({
        error: "Inspection save failed",
        details: inspectionData
      });
    }

    return res.status(200).json({
      success: true,
      property_name: property.property_name,
      property_slug: property.property_slug,
      room_number: room.room_number,
      verification_id,
      public_url: room.qr_url || `https://verify.thereadymarkgroup.com/${property.property_slug}-room-${room.room_number}`
    });

  } catch (error) {
    return res.status(500).json({
      error: `Server error: ${error.message}`
    });
  }
}
