export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { propertyId, roomNumber } = req.body;

    if (!propertyId || !roomNumber) {
      return res.status(400).json({ error: "Missing propertyId or roomNumber" });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return res.status(500).json({ error: "Missing server environment variables" });
    }

    const headers = {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    };

    // 1. Get the property
    const propertyRes = await fetch(
      `${supabaseUrl}/rest/v1/properties?id=eq.${encodeURIComponent(propertyId)}&select=*`,
      { headers }
    );

    const propertyData = await propertyRes.json();

    if (!propertyRes.ok) {
      return res.status(500).json({ error: "Property lookup failed", details: propertyData });
    }

    if (!propertyData.length) {
      return res.status(404).json({ error: "Property not found" });
    }

    const property = propertyData[0];

    // 2. Build slug + url
    const cleanRoomNumber = String(roomNumber).trim();
    const qrSlug = `${property.property_slug}-${cleanRoomNumber}`;
    const qrUrl = `https://verify.thereadymarkgroup.com/${qrSlug}`;

    // 3. Insert room
    const insertRes = await fetch(`${supabaseUrl}/rest/v1/Rooms`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        property_id: property.id,
        room_number: cleanRoomNumber,
        qr_slug: qrSlug,
        qr_url: qrUrl,
      }),
    });

    const insertData = await insertRes.json();

    if (!insertRes.ok) {
      return res.status(500).json({ error: "Room insert failed", details: insertData });
    }

    return res.status(200).json({
      message: "Room created successfully",
      room: insertData[0],
    });
  } catch (error) {
    return res.status(500).json({
      error: "Server error",
      details: error.message,
    });
  }
}
