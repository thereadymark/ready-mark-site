import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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

  try {
    const { property_slug } = req.query || {};

    if (!property_slug || typeof property_slug !== "string") {
      return res.status(400).json({
        error: "Missing property_slug"
      });
    }

    const normalizedPropertySlug = String(property_slug).trim().toLowerCase();

    // PROPERTY
    const { data: property, error: propertyError } = await supabase
      .from("properties")
      .select("id, property_name, property_slug, city, state, property_type")
      .eq("property_slug", normalizedPropertySlug)
      .maybeSingle();

    if (propertyError) {
      return res.status(500).json({
        error: propertyError.message
      });
    }

    if (!property) {
      return res.status(404).json({
        error: "Property not found"
      });
    }

    // ROOMS
    const { data: rooms, error: roomsError } = await supabase
      .from("Rooms")
      .select("id, room_number, qr_slug, qr_url, guest_access_code, property_id")
      .eq("property_id", property.id)
      .order("room_number", { ascending: true });

    if (roomsError) {
      return res.status(500).json({
        error: roomsError.message
      });
    }

    const roomList = Array.isArray(rooms) ? rooms : [];
    const roomIds = roomList.map(room => room.id);

    // INSPECTIONS
    let inspections = [];
    if (roomIds.length > 0) {
      const { data: inspectionData, error: inspectionsError } = await supabase
        .from("Inspections")
        .select("id, room_id, inspector_id, created_at, certification_tier, verification_id, score, notes")
        .in("room_id", roomIds)
        .order("created_at", { ascending: false });

      if (inspectionsError) {
        return res.status(500).json({
          error: inspectionsError.message
        });
      }

      inspections = Array.isArray(inspectionData) ? inspectionData : [];
    }

    const inspectionsByRoom = buildRoomInspectionMap(inspections);

    const roomSummaries = roomList.map(room => {
      const roomInspections = inspectionsByRoom.get(room.id) || [];
      const latestInspection = roomInspections[0] || null;
      return buildRoomSummary(room, latestInspection);
    });

   / 🔥 CLIENT-FACING DATA
  active_issues: activeIssues,
  awaiting_response: awaitingResponse,
  remediation_submitted: remediationSubmitted,
  resolved_issues: resolvedIssues,

  inspection_history: inspectionHistory
});


// GUEST REPORTS (CLIENT VISIBLE ONLY)
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
    response_minutes
  `)
  .eq("property_slug", normalizedPropertySlug)
  .not("hotel_notified_at", "is", null) // 🔥 KEY FILTER
  .order("reported_at", { ascending: false });

if (guestReportsError) {
  return res.status(500).json({
    error: guestReportsError.message
  });
}

const reports = Array.isArray(guestReports) ? guestReports : [];

// 🔥 NEW CLASSIFICATION LOGIC

const activeIssues = reports.filter(r =>
  ["Sent to Property", "Escalated"].includes(r.status)
);

const awaitingResponse = reports.filter(r =>
  r.status === "Sent to Property" &&
  !r.resolution_note &&
  !r.resolved_at
);

const remediationSubmitted = reports.filter(r =>
  r.resolution_note &&
  !r.resolved_at
);

const resolvedIssues = reports.filter(r =>
  r.resolved_at || r.status === "Resolved"
);

    // RECENT INSPECTION HISTORY
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

    // QR LOOKUP LIST
    const qrRecords = roomSummaries.map(room => ({
      room_id: room.room_id,
      room_number: room.room_number,
      qr_slug: room.qr_slug,
      qr_url: room.qr_url,
      verification_id: room.latest_inspection?.verification_id || "",
      certification_tier: room.latest_inspection?.certification_tier || "",
      last_inspected_at: room.latest_inspection?.created_at || ""
    }));

    // DASHBOARD SUMMARY
    const latestInspectionOverall = inspectionHistory[0] || null;

    const summary = {
      total_rooms: roomSummaries.length,
      total_active_issues: activeIssues.length,
      total_resolved_issues: resolvedIssues.length,
      total_reports: reports.length,
      latest_inspection_date: latestInspectionOverall?.created_at || null,
      latest_inspection_room: latestInspectionOverall?.room_number || null
    };

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
    total_reports: reports.length
  },

  rooms: roomSummaries,
  qr_records: qrRecords,

  // 🔥 CLIENT-FACING DATA
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
