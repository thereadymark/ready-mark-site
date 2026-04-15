import { createClient } from "@supabase/supabase-js";

const ACTIVE_STATUSES = ["New", "Under Review", "Escalated", "Sent to Property"];
const RESOLVED_STATUS = "Resolved";

function sortByDateDesc(a, b, field) {
  const aTime = a?.[field] ? new Date(a[field]).getTime() : 0;
  const bTime = b?.[field] ? new Date(b[field]).getTime() : 0;
  return bTime - aTime;
}

function buildRoomInspectionMap(inspections) {
  const grouped = new Map();

  for (const inspection of inspections) {
    const roomId = inspection.room_id;
    if (!roomId) continue;

    if (!grouped.has(roomId)) {
      grouped.set(roomId, []);
    }

    grouped.get(roomId).push(inspection);
  }

  for (const [roomId, roomInspections] of grouped.entries()) {
    roomInspections.sort((a, b) => sortByDateDesc(a, b, "created_at"));
    grouped.set(roomId, roomInspections);
  }

  return grouped;
}

function buildRoomSummary(room, latestInspection) {
  return {
    room_id: room.id,
    room_number: room.room_number || "",
    qr_slug: room.qr_slug || "",
    qr_url: room.qr_url || "",
    guest_access_code: room.guest_access_code || null,
    latest_inspection: latestInspection
      ? {
          created_at: latestInspection.created_at || "",
          certification_tier: latestInspection.certification_tier || "",
          verification_id: latestInspection.verification_id || "",
          score: latestInspection.score ?? null,
          notes: latestInspection.notes || ""
        }
      : null
  };
}

export default async function handler(req, res) {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const allowedOrigin = "https://verify.thereadymarkgroup.com";

    const corsHeaders = {
      "Access-Control-Allow-Origin": allowedOrigin,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
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

    const { property_slug } = req.query || {};

    if (!property_slug || typeof property_slug !== "string") {
      return res.status(400).json({
        error: "Missing property_slug"
      });
    }

    const normalizedPropertySlug = String(property_slug).trim().toLowerCase();

    const { data: property, error: propertyError } = await supabase
      .from("properties")
      .select("id, property_name, property_slug, city, state, property_type")
      .eq("property_slug", normalizedPropertySlug)
      .maybeSingle();

    if (propertyError) {
      throw new Error(propertyError.message);
    }

    if (!property) {
      return res.status(404).json({
        error: "Property not found"
      });
    }

    const { data: rooms, error: roomsError } = await supabase
      .from("rooms")
      .select("id, room_number, qr_slug, qr_url, guest_access_code, property_id")
      .eq("property_id", property.id)
      .order("room_number", { ascending: true });

    if (roomsError) {
      throw new Error(roomsError.message);
    }

    const roomList = Array.isArray(rooms) ? rooms : [];
    const roomIds = roomList.map(room => room.id);

    let inspections = [];
    if (roomIds.length > 0) {
      const { data: inspectionData, error: inspectionsError } = await supabase
        .from("inspections")
        .select("id, room_id, inspector_id, created_at, certification_tier, verification_id, score, notes")
        .in("room_id", roomIds)
        .order("created_at", { ascending: false });

      if (inspectionsError) {
        throw new Error(inspectionsError.message);
      }

      inspections = Array.isArray(inspectionData) ? inspectionData : [];
    }

    const inspectionsByRoom = buildRoomInspectionMap(inspections);

    const roomSummaries = roomList.map(room => {
      const roomInspections = inspectionsByRoom.get(room.id) || [];
      const latestInspection = roomInspections[0] || null;
      return buildRoomSummary(room, latestInspection);
    });

    const { data: guestReports, error: guestReportsError } = await supabase
      .from("guest_reports")
      .select(`
        id,
        confirmation_number,
        verification_id,
        property_slug,
        property_name,
        room_number,
        issue_types,
        guest_note,
        details,
        photo_url,
        status,
        priority,
        reported_at,
        hotel_notified_at,
        resolution_note,
        resolved_by,
        resolved_at,
        response_minutes,
        reservation_last_name
      `)
      .eq("property_slug", normalizedPropertySlug)
      .not("hotel_notified_at", "is", null)
      .order("reported_at", { ascending: false });

    if (guestReportsError) {
      throw new Error(guestReportsError.message);
    }

    const reports = Array.isArray(guestReports) ? guestReports : [];

    const activeIssues = reports.filter(report =>
      ACTIVE_STATUSES.includes(report.status)
    );

    const awaitingResponse = reports.filter(report =>
      report.status === "Sent to Property" &&
      !report.resolution_note &&
      !report.resolved_at
    );

    const remediationSubmitted = reports.filter(report =>
      report.resolution_note &&
      !report.resolved_at
    );

    const resolvedIssues = reports.filter(report =>
      report.resolved_at || report.status === RESOLVED_STATUS
    );

    const inspectionHistory = inspections
      .slice()
      .sort((a, b) => sortByDateDesc(a, b, "created_at"))
      .map(inspection => {
        const room = roomList.find(r => r.id === inspection.room_id);

        return {
          id: inspection.id,
          room_id: inspection.room_id,
          room_number: room?.room_number || "",
          verification_id: inspection.verification_id || "",
          certification_tier: inspection.certification_tier || "",
          score: inspection.score ?? null,
          notes: inspection.notes || "",
          inspector_id: inspection.inspector_id || "",
          created_at: inspection.created_at || "",
          qr_url: room?.qr_url || "",
          qr_slug: room?.qr_slug || ""
        };
      });

    const qrRecords = roomSummaries.map(room => ({
      room_id: room.room_id,
      room_number: room.room_number,
      qr_slug: room.qr_slug,
      qr_url: room.qr_url,
      verification_id: room.latest_inspection?.verification_id || "",
      certification_tier: room.latest_inspection?.certification_tier || "",
      last_inspected_at: room.latest_inspection?.created_at || ""
    }));

    const latestInspectionOverall = inspectionHistory[0] || null;

    return res.status(200).json({
      success: true,
      property: {
        id: property.id,
        property_name: property.property_name || "",
        property_slug: property.property_slug || "",
        city: property.city || "",
        state: property.state || "",
        property_type: property.property_type || ""
      },

      summary: {
        total_rooms: roomSummaries.length,
        total_active_issues: activeIssues.length,
        total_awaiting_response: awaitingResponse.length,
        total_remediation_submitted: remediationSubmitted.length,
        total_resolved_issues: resolvedIssues.length,
        total_reports: reports.length,
        latest_inspection_date: latestInspectionOverall?.created_at || null,
        latest_inspection_room: latestInspectionOverall?.room_number || null
      },

      rooms: roomSummaries,
      qr_records: qrRecords,
      active_issues: activeIssues,
      awaiting_response: awaitingResponse,
      remediation_submitted: remediationSubmitted,
      resolved_issues: resolvedIssues,
      inspection_history: inspectionHistory
    });
  } catch (err) {
    console.error("CLIENT DASHBOARD ERROR:", err);

    return res.status(500).json({
      error: err.message || "Internal server error",
      stack: err.stack || null
    });
  }
}
