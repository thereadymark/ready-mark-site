import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "25mb",
    },
  },
};

const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const MAX_LOG_BYTES = 15 * 1024 * 1024;

const ALLOWED_PHOTO_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif"
]);

const ALLOWED_LOG_TYPES = new Set([
  "application/pdf",
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

function validateBase64Payload(file, fieldName) {
  if (!file || typeof file !== "object") {
    return `${fieldName} is missing or invalid.`;
  }

  if (!file.name || typeof file.name !== "string") {
    return `${fieldName} name is missing.`;
  }

  if (!file.type || typeof file.type !== "string") {
    return `${fieldName} type is missing.`;
  }

  if (!file.base64 || typeof file.base64 !== "string") {
    return `${fieldName} file data is missing.`;
  }

  return null;
}

function validatePhotoFile(photoFile, fileBuffer) {
  if (!ALLOWED_PHOTO_TYPES.has(photoFile.type)) {
    return "Inspection photo must be a JPG, PNG, WEBP, or HEIC image.";
  }

  if (fileBuffer.length > MAX_PHOTO_BYTES) {
    return "Inspection photo is too large. Maximum size is 10 MB.";
  }

  return null;
}

function validateLogFile(logFile, fileBuffer) {
  if (!ALLOWED_LOG_TYPES.has(logFile.type)) {
    return "Inspection log must be a PDF or image file.";
  }

  if (fileBuffer.length > MAX_LOG_BYTES) {
    return "Inspection log is too large. Maximum size is 15 MB.";
  }

  return null;
}

export default async function handler(req, res) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-admin-token"
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

  const adminToken = req.headers["x-admin-token"];

  if (!adminToken) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const {
      verification_id,
      photo_file,
      log_file
    } = req.body || {};

    if (!verification_id) {
      return res.status(400).json({ error: "Missing verification_id" });
    }

    let uploadedPhotoUrl = "";
    let uploadedLogUrl = "";

    if (photo_file) {
      const payloadError = validateBase64Payload(photo_file, "photo_file");
      if (payloadError) {
        return res.status(400).json({ error: payloadError });
      }

      const photoBuffer = bufferFromBase64(photo_file.base64);
      const photoValidationError = validatePhotoFile(photo_file, photoBuffer);

      if (photoValidationError) {
        return res.status(400).json({ error: photoValidationError });
      }

      const fileName = sanitizeFileName(photo_file.name);
      const filePath = `${verification_id}/${Date.now()}-${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from("inspection-photos")
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
        .from("inspection-photos")
        .getPublicUrl(filePath);

      uploadedPhotoUrl = data.publicUrl;
    }

    if (log_file) {
      const payloadError = validateBase64Payload(log_file, "log_file");
      if (payloadError) {
        return res.status(400).json({ error: payloadError });
      }

      const logBuffer = bufferFromBase64(log_file.base64);
      const logValidationError = validateLogFile(log_file, logBuffer);

      if (logValidationError) {
        return res.status(400).json({ error: logValidationError });
      }

      const fileName = sanitizeFileName(log_file.name);
      const filePath = `${verification_id}/log-${Date.now()}-${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from("inspection-docs")
        .upload(filePath, logBuffer, {
          contentType: log_file.type,
          upsert: false
        });

      if (uploadError) {
        return res.status(500).json({
          error: `Log upload failed: ${uploadError.message}`
        });
      }

      const { data } = supabase.storage
        .from("inspection-docs")
        .getPublicUrl(filePath);

      uploadedLogUrl = data.publicUrl;
    }

    const updatePayload = {};

    if (uploadedPhotoUrl) {
      updatePayload.photo_url = uploadedPhotoUrl;
    }

    if (uploadedLogUrl) {
      updatePayload.log_file_url = uploadedLogUrl;
    }

    if (Object.keys(updatePayload).length > 0) {
      const { error: updateError } = await supabase
        .from("Inspections")
        .update(updatePayload)
        .eq("verification_id", verification_id);

      if (updateError) {
        return res.status(500).json({
          error: `Inspection update failed: ${updateError.message}`
        });
      }
    }

    return res.status(200).json({
      success: true,
      verification_id,
      photo_url: uploadedPhotoUrl,
      log_file_url: uploadedLogUrl
    });
  } catch (error) {
    return res.status(500).json({
      error: `Server error: ${error.message}`
    });
  }
}
