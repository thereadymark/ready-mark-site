export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { propertyId, roomNumbers } = req.body;

    if (!propertyId || !Array.isArray(roomNumbers) || !roomNumbers.length) {
      return res.status(400).json({ error: "Missing propertyId or roomNumbers" });
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

    // Get property
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

    // Clean room numbers
    const cleanedRooms = roomNumbers
      .map((room) => String(room).trim())
      .filter(Boolean);

    if (!cleanedRooms.length) {
      return res.status(400).json({ error: "No valid room numbers provided" });
    }

    // Existing rooms for this property
    const existingRes = await fetch(
      `${supabaseUrl}/rest/v1/Rooms?property_id=eq.${encodeURIComponent(propertyId)}&select=room_number`,
      { headers }
    );

    const existingData = await existingRes.json();

    if (!existingRes.ok) {
      return res.status(500).json({ error: "Existing room lookup failed", details: existingData });
    }

    const existingRoomSet = new Set(
      (existingData || []).map((room) => String(room.room_number).trim().toLowerCase())
    );

    const newRoomsPayload = [];
    const skippedRooms = [];

    cleanedRooms.forEach((roomNumber) => {
      const normalized = roomNumber.toLowerCase();

      if (existingRoomSet.has(normalized)) {
        skippedRooms.push(roomNumber);
        return;
      }

      const qrSlug = `${property.property_slug}-${roomNumber}`;
      const qrUrl = `https://verify.thereadymarkgroup.com/${qrSlug}`;

      newRoomsPayload.push({
        property_id: property.id,
        room_number: roomNumber,
        qr_slug: qrSlug,
        qr_url: qrUrl,
      });
    });

    if (!newRoomsPayload.length) {
      return res.status(200).json({
        message: "No new rooms created. All provided rooms already exist.",
        created: [],
        skipped: skippedRooms,
      });
    }

    const insertRes = await fetch(`${supabaseUrl}/rest/v1/Rooms`, {
      method: "POST",
      headers,
      body: JSON.stringify(newRoomsPayload),
    });

    const insertData = await insertRes.json();

    if (!insertRes.ok) {
      return res.status(500).json({ error: "Bulk room insert failed", details: insertData });
    }

    return res.status(200).json({
      message: "Bulk room creation complete",
      created: insertData,
      skipped: skippedRooms,
    });
  } catch (error) {
    return res.status(500).json({
      error: "Server error",
      details: error.message,
    });
  }
}
