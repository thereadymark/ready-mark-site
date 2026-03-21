export default async function handler(req, res) {
  try {
    const { propertyId } = req.query;

    if (!propertyId) {
      return res.status(400).json({ error: "Missing propertyId" });
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

    const propertyRes = await fetch(
      `${supabaseUrl}/rest/v1/properties?id=eq.${encodeURIComponent(propertyId)}&select=*`,
      { headers }
    );

    const propertyData = await propertyRes.json();

    if (!propertyRes.ok) {
      return res.status(500).json({
        error: "Property lookup failed",
        details: propertyData,
      });
    }

    if (!propertyData.length) {
      return res.status(404).json({ error: "Property not found" });
    }

    const property = propertyData[0];

    const roomsRes = await fetch(
      `${supabaseUrl}/rest/v1/Rooms?property_id=eq.${encodeURIComponent(propertyId)}&select=*&order=room_number.asc`,
      { headers }
    );

    const roomsData = await roomsRes.json();

    if (!roomsRes.ok) {
      return res.status(500).json({
        error: "Room lookup failed",
        details: roomsData,
      });
    }

    const rooms = (roomsData || []).filter(
      (room) => room.qr_slug && room.qr_url
    );

    return res.status(200).json({
      property: {
        id: property.id,
        property_name: property.property_name,
        property_slug: property.property_slug,
      },
      rooms,
      total: rooms.length,
    });
  } catch (error) {
    return res.status(500).json({
      error: "Server error",
      details: error.message,
    });
  }
}
