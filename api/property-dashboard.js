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

    // 1. Property
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

    // 2. Rooms for property
    const roomsRes = await fetch(
      `${supabaseUrl}/rest/v1/Rooms?property_id=eq.${encodeURIComponent(propertyId)}&select=*`,
      { headers }
    );
    const roomsData = await roomsRes.json();

    if (!roomsRes.ok) {
      return res.status(500).json({ error: "Room lookup failed", details: roomsData });
    }

    const rooms = roomsData || [];
    const totalRooms = rooms.length;

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
          lastInspectionDate: null,
        },
        flaggedRooms: [],
        recentActivity: [],
      });
    }

    const roomMap = {};
    const roomIds = rooms.map((room) => {
      roomMap[room.id] = room;
      return room.id;
    });

    const inList = roomIds.map((id) => `"${id}"`).join(",");

    // 3. Current inspections for those rooms
    const inspectionsRes = await fetch(
      `${supabaseUrl}/rest/v1/Inspections?room_id=in.(${encodeURIComponent(inList)})&is_current=eq.true&select=*&order=created_at.desc`,
      { headers }
    );
    const inspectionsData = await inspectionsRes.json();

    if (!inspectionsRes.ok) {
      return res.status(500).json({ error: "Inspection lookup failed", details: inspectionsData });
    }

    const inspections = inspectionsData || [];

    let premier = 0;
    let verifiedClean = 0;
    let needsAttention = 0;
    let notClean = 0;

    inspections.forEach((inspection) => {
      const tier = (inspection.certification_tier || "").toLowerCase();

      if (tier === "ready mark premier") premier += 1;
      else if (tier === "verified clean") verifiedClean += 1;
      else if (tier === "needs attention") needsAttention += 1;
      else if (tier === "not clean") notClean += 1;
    });

    const currentInspectionRoomIds = new Set(inspections.map((i) => i.room_id));
    const pending = totalRooms - currentInspectionRoomIds.size;
    const verificationRate = totalRooms
      ? Math.round(((premier + verifiedClean) / totalRooms) * 100)
      : 0;

    const lastInspectionDate = inspections.length ? inspections[0].created_at : null;

    const flaggedRooms = inspections
      .filter((inspection) => {
        const tier = (inspection.certification_tier || "").toLowerCase();
        return tier === "needs attention" || tier === "not clean";
      })
      .map((inspection) => ({
        room_id: inspection.room_id,
        room_number: roomMap[inspection.room_id]?.room_number || "",
        certification_tier: inspection.certification_tier || "",
        score: inspection.score,
        verification_id: inspection.verification_id || "",
        notes: inspection.notes || "",
        created_at: inspection.created_at || "",
      }))
      .sort((a, b) => {
        const aScore = a.score ?? 999;
        const bScore = b.score ?? 999;
        return aScore - bScore;
      });

    const recentActivity = inspections.slice(0, 10).map((inspection) => ({
      room_id: inspection.room_id,
      room_number: roomMap[inspection.room_id]?.room_number || "",
      certification_tier: inspection.certification_tier || "",
      score: inspection.score,
      verification_id: inspection.verification_id || "",
      inspector_id: inspection.inspector_id || "",
      created_at: inspection.created_at || "",
    }));

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
        lastInspectionDate,
      },
      flaggedRooms,
      recentActivity,
    });
  } catch (error) {
    return res.status(500).json({
      error: "Server error",
      details: error.message,
    });
  }
}
