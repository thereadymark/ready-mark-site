import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const PHOTO_BUCKET = "inspection-photos";
const DOC_BUCKET = "inspection-docs";
const SIGNED_URL_EXPIRES_IN = 60 * 60;

export default async function handler(req, res) {
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
    const { slug } = req.query;

    if (!slug || typeof slug !== "string") {
      return res.status(400).json({ error: "Missing slug parameter" });
    }

    const normalizedSlug = String(slug).trim();

    let propertySlug = null;
    let roomNumber = null;

    if (normalizedSlug.includes("-room-")) {
      const parts = normalizedSlug.split("-room-");

      if (parts.length !== 2 || !parts[0] || !parts[1]) {
        return res.status(400).json({ error: "Invalid slug format" });
      }

      propertySlug = parts[0];
      roomNumber = parts[1];
    } else {
      roomNumber = normalizedSlug.replace(/^room-/, "");
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return res.status(500).json({ error: "Missing server environment variables" });
    }

    const headers = {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Accept: "application/json"
    };

    const ROOM_TABLE = "Rooms";
    const INSPECTION_TABLE = "Inspections";
    const PROPERTY_TABLE = "properties";

    async function fetchJson(url) {
      const response = await fetch(url, { headers });
      const json = await response.json().catch(() => null);
      return { response, json };
    }

    let room = null;
    let property = null;

    if (propertySlug) {
      const propertyUrl =
        `${supabaseUrl}/rest/v1/${PROPERTY_TABLE}` +
        `?property_slug=eq.${encodeURIComponent(propertySlug)}` +
        `&select=id,property_name,property_slug,city,state,property_type` +
        `&limit=1`;

      const { response: propertyRes, json: propertyData } = await fetchJson(propertyUrl);

      if (!propertyRes.ok) {
        return res.status(500).json({ error: "Property lookup failed" });
      }

      if (!Array.isArray(propertyData) || propertyData.length === 0) {
        return res.status(404).json({ error: "Property not found" });
      }

      property = propertyData[0];

      const roomUrl =
        `${supabaseUrl}/rest/v1/${ROOM_TABLE}` +
        `?property_id=eq.${encodeURIComponent(property.id)}` +
        `&room_number=eq.${encodeURIComponent(roomNumber)}` +
        `&select=id,property_id,room_number,qr_slug,qr_url` +
        `&limit=1`;

      const { response: roomRes, json: roomData } = await fetchJson(roomUrl);

      if (!roomRes.ok) {
        return res.status(500).json({ error: "Room lookup failed" });
      }

      if (!Array.isArray(roomData) || roomData.length === 0) {
        return res.status(404).json({ error: "Room not found for selected property" });
      }

      room = roomData[0];
    } else {
      const roomUrl =
        `${supabaseUrl}/rest/v1/${ROOM_TABLE}` +
        `?room_number=eq.${encodeURIComponent(roomNumber)}` +
        `&select=id,property_id,room_number,qr_slug,qr_url` +
        `&limit=1`;

      const { response: roomRes, json: roomData } = await fetchJson(roomUrl);

      if (!roomRes.ok) {
        return res.status(500).json({ error: "Room lookup failed" });
      }

      if (!Array.isArray(roomData) || roomData.length === 0) {
        return res.status(404).json({ error: "Room not found" });
      }

      room = roomData[0];

      if (room.property_id) {
        const propertyUrl =
          `${supabaseUrl}/rest/v1/${PROPERTY_TABLE}` +
          `?id=eq.${encodeURIComponent(room.property_id)}` +
          `&select=id,property_name,property_slug,city,state,property_type` +
          `&limit=1`;

        const { response: propertyRes, json: propertyData } = await fetchJson(propertyUrl);

        if (!propertyRes.ok) {
          return res.status(500).json({ error: "Property lookup failed" });
        }

        if (Array.isArray(propertyData) && propertyData.length > 0) {
          property = propertyData[0];
        }
      }
    }

const currentInspectionUrl =
  `${supabaseUrl}/rest/v1/${INSPECTION_TABLE}` +
  `?room_id=eq.${encodeURIComponent(room.id)}` +
  `&is_current=eq.true` +
  `&select=id,inspector_id,created_at,certification_tier,verification_id,score,notes,photo_url,photo_urls,log_file_url,is_current` +
  `&order=is_current.desc,created_at.desc.nullslast` +
  `&limit=1`;

const { response: inspectionRes, json: inspectionData } = await fetchJson(currentInspectionUrl);

if (!inspectionRes.ok) {
  return res.status(500).json({ error: "Inspection lookup failed" });
}

let inspection =
  Array.isArray(inspectionData) && inspectionData.length > 0
    ? inspectionData[0]
    : null;

if (!inspection) {
  const fallbackInspectionUrl =
    `${supabaseUrl}/rest/v1/${INSPECTION_TABLE}` +
    `?room_id=eq.${encodeURIComponent(room.id)}` +
    `&select=id,inspector_id,created_at,certification_tier,verification_id,score,notes,photo_url,photo_urls,log_file_url,is_current` +
    `&order=created_at.desc.nullslast` +
    `&limit=1`;

  const { response: fallbackRes, json: fallbackData } = await fetchJson(fallbackInspectionUrl);

  if (!fallbackRes.ok) {
    return res.status(500).json({ error: "Inspection lookup failed" });
  }

  inspection =
    Array.isArray(fallbackData) && fallbackData.length > 0
      ? fallbackData[0]
      : null;
}    
const historyUrl =
  `${supabaseUrl}/rest/v1/${INSPECTION_TABLE}` +
  `?room_id=eq.${encodeURIComponent(room.id)}` +
  `&select=id,created_at,certification_tier,verification_id,score,is_current` +
  `&order=created_at.desc.nullslast` +
  `&limit=5`;
    
const { response: historyRes, json: historyData } = await fetchJson(historyUrl);

if (!historyRes.ok) {
  return res.status(500).json({ error: "Inspection history lookup failed" });
}

const inspectionHistory = Array.isArray(historyData) ? historyData : [];

let signedPhotoUrl = "";
let signedLogFileUrl = "";
let signedPhotoUrls = [];

const photoPath = inspection?.photo_url ? String(inspection.photo_url).trim() : "";
const logFilePath = inspection?.log_file_url ? String(inspection.log_file_url).trim() : "";

const rawPhotoUrls = Array.isArray(inspection?.photo_urls)
  ? inspection.photo_urls.map(path => String(path || "").trim()).filter(Boolean)
  : [];

if (photoPath) {
  const { data, error } = await supabase.storage
    .from(PHOTO_BUCKET)
    .createSignedUrl(photoPath, SIGNED_URL_EXPIRES_IN);

  if (!error && data?.signedUrl) {
    signedPhotoUrl = data.signedUrl;
  }
}

if (rawPhotoUrls.length) {
  const signedResults = await Promise.all(
    rawPhotoUrls.map(async (path) => {
      const { data, error } = await supabase.storage
        .from(PHOTO_BUCKET)
        .createSignedUrl(path, SIGNED_URL_EXPIRES_IN);

      if (error || !data?.signedUrl) return null;
      return data.signedUrl;
    })
  );

  signedPhotoUrls = signedResults.filter(Boolean);
}

if (!signedPhotoUrls.length && signedPhotoUrl) {
  signedPhotoUrls = [signedPhotoUrl];
}

if (logFilePath) {
  const { data, error } = await supabase.storage
    .from(DOC_BUCKET)
    .createSignedUrl(logFilePath, SIGNED_URL_EXPIRES_IN);

  if (!error && data?.signedUrl) {
    signedLogFileUrl = data.signedUrl;
  }
}

return res.status(200).json({
  property: property?.property_name ?? "",
  property_slug: property?.property_slug ?? propertySlug ?? "",
  room: room?.room_number ?? roomNumber ?? "",
  qrSlug: room?.qr_slug ?? "",
  qrUrl: room?.qr_url ?? "",
  inspectorId: inspection?.inspector_id ?? "",
  inspectionDate: inspection?.created_at ?? "",
  certificationTier: inspection?.certification_tier ?? "Not verified",
  verificationId: inspection?.verification_id ?? "",
  score: inspection?.score ?? "",
  status: inspection?.certification_tier ?? "Not verified",
  notes: inspection?.notes ?? "",
  photoPath,
  logFilePath,
  photoUrl: signedPhotoUrl,
  photoUrls: signedPhotoUrls,
  logFileUrl: signedLogFileUrl,
  inspectionHistory
});
  } 
  catch (error) {
    return res.status(500).json({
      error: error?.message || "Server error"
    });
  }
}
