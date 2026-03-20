export default async function handler(req, res) {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return res.status(500).json({ error: "Missing server environment variables" });
    }

    const headers = {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    };

    const roomRes = await fetch(
      `${supabaseUrl}/rest/v1/Rooms?select=*,properties:property_id(property_name)&order=created_at.desc`,
      { headers }
    );

    const roomData = await roomRes.json();

    if (!roomRes.ok) {
      return res.status(500).json({ error: "Room lookup failed", details: roomData });
    }

    const rooms = roomData.map((room) => ({
      id: room.id,
      room_number: room.room_number,
      qr_slug: room.qr_slug,
      qr_url: room.qr_url,
      property_name: room.properties?.property_name || "Unknown Property",
    }));

    return res.status(200).json({ rooms });
  } catch (error) {
    return res.status(500).json({
      error: "Server error",
      details: error.message,
    });
  }
}
