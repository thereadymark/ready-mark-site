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

    // 1) Get property
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

    // 2) Get all rooms for property
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

    const rooms = roomsData || [];
    const totalRooms = rooms.length;

    // Early return if no rooms
    if (!totalRooms) {
      return res.status(200).json({
        property: {
          id: property.id,
          property_name: property.property_name,
          property_slug: property.property_slug,
          property_type: property.property_type,
          city: property.city,
          state: property.state,
          status: property.status,
        },
        summary: {
          totalRooms: 0,
          premier: 0,
          verifiedClean: 0,
          needsAttention: 0,
          notClean: 0,
          pending: 0,
          verificationRate: 0,
          latestInspectionDate: null,
        },
        flaggedRooms: [],
        recentActivity: [],
        rooms: [],
      });
    }

    // Build room lookup
    const roomMap = {};
    const roomIds = rooms.map((room) => {
      roomMap[room.id] = room;
      return room.id;
    });

    // 3) Get current inspections for these rooms
    const quotedRoomIds = roomIds.map((id) => `"${id}"`).join(",");
    const inspectionsRes = await fetch(
      `${supabaseUrl}/rest/v1/Inspections?room_id=in.(${encodeURIComponent(
        quotedRoomIds
      )})&is_current=eq.true&select=*&order=created_at.desc`,
      { headers }
    );
    const inspectionsData = await inspectionsRes.json();

    if (!inspectionsRes.ok) {
      return res.status(500).json({
        error: "Inspection lookup failed",
        details: inspectionsData,
      });
    }

    const inspections = inspectionsData || [];

    // Current inspection by room_id
    const inspectionMap = {};
    inspections.forEach((inspection) => {
      inspectionMap[inspection.room_id] = inspection;
    });

    // 4) Build room summary rows
    const roomSummaries = rooms.map((room) => {
      const inspection = inspectionMap[room.id] || null;

      return {
        room_id: room.id,
        room_number: room.room_number,
        qr_slug: room.qr_slug,
        qr_url: room.qr_url,
        status: inspection?.certification_tier || "No Inspection",
        score: inspection?.score ?? null,
        verification_id: inspection?.verification_id || "",
        inspector_id: inspection?.inspector_id || "",
        inspection_date: inspection?.created_at || null,
        notes: inspection?.notes || "",
      };
    });

    // 5) Summary counts
    const premier = roomSummaries.filter(
      (room) => (room.status || "").toLowerCase() === "ready mark premier"
    ).length;

    const verifiedClean = roomSummaries.filter(
      (room) => (room.status || "").toLowerCase() === "verified clean"
    ).length;

    const needsAttention = roomSummaries.filter(
      (room) => (room.status || "").toLowerCase() === "needs attention"
    ).length;

    const notClean = roomSummaries.filter(
      (room) => (room.status || "").toLowerCase() === "not clean"
    ).length;

    const pending = roomSummaries.filter(
      (room) => (room.status || "").toLowerCase() === "no inspection"
    ).length;

    const verificationRate =
      totalRooms > 0 ? Math.round(((premier + verifiedClean) / totalRooms) * 100) : 0;

    const latestInspectionDate = roomSummaries
      .filter((room) => room.inspection_date)
      .sort((a, b) => new Date(b.inspection_date) - new Date(a.inspection_date))[0]
      ?.inspection_date || null;

    // 6) Flagged rooms
    const flaggedRooms = roomSummaries
      .filter((room) =>
        ["needs attention", "not clean", "no inspection"].includes(
          (room.status || "").toLowerCase()
        )
      )
      .sort((a, b) => {
        const aRoom = String(a.room_number || "");
        const bRoom = String(b.room_number || "");
        return aRoom.localeCompare(bRoom, undefined, { numeric: true, sensitivity: "base" });
      });

    // 7) Recent activity
    const recentActivity = roomSummaries
      .filter((room) => room.inspection_date)
      .sort((a, b) => new Date(b.inspection_date) - new Date(a.inspection_date))
      .slice(0, 10);

    return res.status(200).json({
      property: {
        id: property.id,
        property_name: property.property_name,
        property_slug: property.property_slug,
        property_type: property.property_type,
        city: property.city,
        state: property.state,
        status: property.status,
      },
      summary: {
        totalRooms,
        premier,
        verifiedClean,
        needsAttention,
        notClean,
        pending,
        verificationRate,
        latestInspectionDate,
      },
      flaggedRooms,
      recentActivity,
      rooms: roomSummaries,
    });
  } catch (error) {
    return res.status(500).json({
      error: "Server error",
      details: error.message,
    });
  }
}
