import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "20mb",
    },
  },
};

const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

const ALLOWED_PHOTO_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif"
]);

function bufferFromBase64(base64String) {
  return Buffer.from(base64String, "base64");
}

function sanitizeFileName(name) {
  return String(name || "file")
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "");
}

function validatePhotoFile(photoFile, fileBuffer) {
  if (!ALLOWED_PHOTO_TYPES.has(photoFile.type)) {
    return "Issue photo must be a JPG, PNG, WEBP, or HEIC image.";
  }

  if (fileBuffer.length > MAX_PHOTO_BYTES) {
    return "Issue photo is too large. Maximum size is 10 MB.";
  }

  return null;
}

export default async function handler(req, res) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-guest-token"
  };

  Object.entries(corsHeaders).forEach(([key, value]) => {
    res.setHeader(key, value);
  });

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const guestToken = req.headers["x-guest-token"];

    if (!guestToken) {
      return res.status(401).json({ error: "Guest login required" });
    }

    const { data: session, error: sessionError } = await supabase
      .from("guest_sessions")
      .select("*, guest_users(*)")
      .eq("session_token", guestToken)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    if (sessionError) {
      return res.status(500).json({ error: sessionError.message });
    }

    if (!session) {
      return res.status(401).json({ error: "Invalid or expired guest session" });
    }

    const {
      verification_id,
      property_slug,
      property_name,
      room_number,
      issue_types,
      guest_note,
      photo_file,
      guest_access_code
    } = req.body || {};

    if (!verification_id) {
      return res.status(400).json({ error: "Missing verification_id" });
    }

    if (!room_number) {
      return res.status(400).json({ error: "Missing room_number" });
    }

    if (!guest_access_code) {
      return res.status(400).json({ error: "Missing guest support code" });
    }

    if (!Array.isArray(issue_types) || issue_types.length === 0) {
      return res.status(400).json({ error: "Please select at least one issue type." });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    const headers = {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Accept: "application/json"
    };

    const inspectionRes = await fetch(
      `${supabaseUrl}/rest/v1/Inspections?verification_id=eq.${encodeURIComponent(verification_id)}&select=room_id&limit=1`,
      { headers }
    );
    const inspectionData = await inspectionRes.json();

    if (!inspectionRes.ok || !inspectionData.length) {
      return res.status(404).json({ error: "Verification record not found" });
    }

    const roomId = inspectionData[0].room_id;

    const roomRes = await fetch(
      `${supabaseUrl}/rest/v1/Rooms?id=eq.${encodeURIComponent(roomId)}&select=id,guest_access_code&limit=1`,
      { headers }
    );
    const roomData = await roomRes.json();

    if (!roomRes.ok || !roomData.length) {
      return res.status(404).json({ error: "Room not found" });
    }

    const room = roomData[0];

    if (String(room.guest_access_code || "").trim() !== String(guest_access_code).trim()) {
      return res.status(401).json({ error: "Invalid guest support code" });
    }

    let uploadedPhotoUrl = "";

    if (photo_file && photo_file.base64) {
      const photoBuffer = bufferFromBase64(photo_file.base64);
      const photoValidationError = validatePhotoFile(photo_file, photoBuffer);

      if (photoValidationError) {
        return res.status(400).json({ error: photoValidationError });
      }

      const fileName = sanitizeFileName(photo_file.name);
      const filePath = `${verification_id}/${Date.now()}-${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from("guest-reports")
        .upload(filePath, photoBuffer, {
          contentType: photo_file.type,
          upsert: false
        });

      if (uploadError) {
        return res.status(500).json({
          error: `Photo upload failed: ${uploadError.message}`
        });
      }

      const { data } = supabase.storage
        .from("guest-reports")
        .getPublicUrl(filePath);

      uploadedPhotoUrl = data.publicUrl;
    }

    const insertPayload = {
      verification_id: String(verification_id).trim(),
      property_slug: property_slug ? String(property_slug).trim() : null,
      property_name: property_name ? String(property_name).trim() : null,
      room_number: String(room_number).trim(),
      issue_types,
      guest_note: guest_note ? String(guest_note).trim() : null,
      photo_url: uploadedPhotoUrl || null,
      status: "new",
      priority: uploadedPhotoUrl ? "urgent" : "normal",
      reported_at: new Date().toISOString(),
      guest_user_id: session.guest_users.id,
      guest_email: session.guest_users.email,
      guest_first_name: session.guest_users.first_name,
      guest_last_name: session.guest_users.last_name,
      access_code_verified: true
    };

    const { data, error } = await supabase
      .from("guest_reports")
      .insert([insertPayload])
      .select()
      .single();

    if (error) {
      return res.status(500).json({
        error: `Guest report save failed: ${error.message}`
      });
    }

    return res.status(200).json({
      success: true,
      report: data
    });
  } catch (error) {
    return res.status(500).json({
      error: `Server error: ${error.message}`
    });
  }
}
