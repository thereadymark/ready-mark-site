import { getAuthorizedClientUser } from "./_clientAuth.js";
import { createClient } from "@supabase/supabase-js";

const ACTIVE_STATUSES = ["New", "Under Review", "Escalated", "Sent to Property"];
const RESOLVED_STATUS = "Resolved";
const CLIENT_VISIBLE_OPEN_STATUSES = ["Sent to Property", "Under Review", "Escalated"];

function sortByDateDesc(a, b, field) {
  const aTime = a?.[field] ? new Date(a[field]).getTime() : 0;
  const bTime = b?.[field] ? new Date(b[field]).getTime() : 0;
  return bTime - aTime;
}

function normalizeArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function buildRoomInspectionMap(inspections) {
  const grouped = new Map();

  for (const inspection of inspections) {
    if (!inspection.room_id) continue;

    if (!grouped.has(inspection.room_id)) {
      grouped.set(inspection.room_id, []);
    }

    grouped.get(inspection.room_id).push(inspection);
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

    res.setHeader("Access-Control-Allow-Origin", "https://verify.thereadymarkgroup.com");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
      return res.status(200).end();
    }

    if (req.method !== "GET") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const requestedSlug = String(req.query.property_slug || "").trim().toLowerCase();

    if (!requestedSlug) {
      return res.status(400).json({ error: "Missing property_slug" });
    }

    const authResult = await getAuthorizedClientUser(req);

    if (authResult.error) {
      return res.status(authResult.status || 401).json({ error: authResult.error });
    }

    const clientUser = authResult.clientUser;
    const allowedSlug = String(clientUser.property_slug || "").trim().toLowerCase();

    if (requestedSlug !== allowedSlug) {
      return res.status(403).json({ error: "You are not authorized for this property" });
    }

    const { data: property, error: propertyError } = await supabase
      .from("properties")
      .select("id, property_name, property_slug, city, state, property_type")
      .ilike("property_slug", requestedSlug)
      .maybeSingle();

    if (propertyError) throw new Error(propertyError.message);

    if (!property) {
      return res.status(404).json({ error: "Property not found" });
    }

    const { data: rooms, error: roomsError } = await supabase
      .from("Rooms")
      .select("id, room_number, qr_slug, qr_url, guest_access_code, property_id")
      .eq("property_id", property.id)
      .order("room_number", { ascending: true });

    if (roomsError) throw new Error(roomsError.message);

    const roomList = Array.isArray(rooms) ? rooms : [];
    const roomIds = roomList.map((room) => room.id);

    let inspections = [];

    if (roomIds.length) {
      const { data: inspectionData, error: inspectionsError } = await supabase
        .from("Inspections")
        .select(`
          id,
          room_id,
          inspector_id,
          created_at,
          certification_tier,
          verification_id,
          score,
          notes,
          photo_url,
          photo_urls,
          log_file_url
        `)
        .in("room_id", roomIds)
        .order("created_at", { ascending: false });

      if (inspectionsError) throw new Error(inspectionsError.message);

      inspections = Array.isArray(inspectionData) ? inspectionData : [];
    }

    const inspectionsByRoom = buildRoomInspectionMap(inspections);

    const roomSummaries = roomList.map((room) => {
      const roomInspections = inspectionsByRoom.get(room.id) || [];
      return buildRoomSummary(room, roomInspections[0] || null);
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
        under_review_at,
        escalated_at,
        remediation_submitted_at,
        resolution_note,
        resolved_by,
        resolved_at,
        guest_confirmation_status,
        guest_confirmed_at,
        verification_status,
        verified_at,
        verified_by,
        response_minutes,
        reservation_last_name
      `)
      .ilike("property_slug", requestedSlug)
      .not("hotel_notified_at", "is", null)
      .order("reported_at", { ascending: false });

    if (guestReportsError) throw new Error(guestReportsError.message);

    const reports = Array.isArray(guestReports) ? guestReports : [];

    const reportsWithSignedPhotos = await Promise.all(
      reports.map(async (report) => {
        const rawPhotoValue = String(report.photo_url || "").trim();

        if (!rawPhotoValue) return report;

        if (rawPhotoValue.startsWith("http://") || rawPhotoValue.startsWith("https://")) {
          return report;
        }

        const { data: signedData, error: signedError } = await supabase.storage
          .from("guest-reports")
          .createSignedUrl(rawPhotoValue, 60 * 60);

        if (signedError || !signedData?.signedUrl) {
          return { ...report, photo_url: null };
        }

        return { ...report, photo_url: signedData.signedUrl };
      })
    );

    const activeIssues = reportsWithSignedPhotos.filter((report) =>
      ACTIVE_STATUSES.includes(report.status)
    );

    const awaitingResponse = reportsWithSignedPhotos.filter((report) =>
      CLIENT_VISIBLE_OPEN_STATUSES.includes(report.status) &&
      !report.resolution_note &&
      !report.resolved_at
    );

    const remediationSubmitted = reportsWithSignedPhotos.filter((report) =>
      report.resolution_note && !report.resolved_at
    );

    const resolvedIssues = reportsWithSignedPhotos.filter((report) =>
      report.resolved_at || report.status === RESOLVED_STATUS
    );

    const inspectionHistory = inspections
      .slice()
      .sort((a, b) => sortByDateDesc(a, b, "created_at"))
      .map((inspection) => {
        const room = roomList.find((r) => r.id === inspection.room_id);

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
          qr_slug: room?.qr_slug || "",
          photo_url: inspection.photo_url || "",
          photo_urls: normalizeArray(inspection.photo_urls),
          log_file_url: inspection.log_file_url || ""
        };
      });

    const qrRecords = roomSummaries.map((room) => ({
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
        total_reports: reportsWithSignedPhotos.length,
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
      error: err?.message || "Client dashboard failed to load"
    });
  }
}
