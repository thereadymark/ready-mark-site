import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "20mb"
    }
  }
};

const PHOTO_BUCKET = "inspection-photos";
const DOC_BUCKET = "inspection-docs";

const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const MAX_DOC_BYTES = 15 * 1024 * 1024;

const ALLOWED_PHOTO_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif"
]);

const ALLOWED_DOC_TYPES = new Set([
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

function validatePhotoFile(file, fileBuffer) {
  if (!ALLOWED_PHOTO_TYPES.has(file.type)) {
    return "Inspection photo must be a JPG, PNG, WEBP, or HEIC image.";
  }

  if (fileBuffer.length > MAX_PHOTO_BYTES) {
    return "Inspection photo is too large. Maximum size is 10 MB.";
  }

  return null;
}

function validateDocFile(file, fileBuffer) {
  if (!ALLOWED_DOC_TYPES.has(file.type)) {
    return "Inspection log must be a PDF or supported image file.";
  }

  if (fileBuffer.length > MAX_DOC_BYTES) {
    return "Inspection log is too large. Maximum size is 15 MB.";
  }

  return null;
}

export default async function handler(req, res) {
  const allowedOrigin = "https://verify.thereadymarkgroup.com";

  const corsHeaders = {
    "Access-Control-Allow-Origin": allowedOrigin,
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

  try {
    const adminToken = req.headers["x-admin-token"];
    const expectedAdminToken = process.env.ADMIN_TOKEN;

    if (!expectedAdminToken) {
      return res.status(500).json({ error: "Missing ADMIN_TOKEN" });
    }

    if (!adminToken || adminToken !== expectedAdminToken) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { verification_id, photo_file, log_file } = req.body || {};

    if (!verification_id) {
      return res.status(400).json({ error: "Missing verification_id" });
    }

    if (!photo_file && !log_file) {
      return res.status(400).json({ error: "No files provided" });
    }

    const verificationId = String(verification_id).trim();

    let uploadedPhotoPath = null;
    let uploadedLogPath = null;

    if (photo_file?.base64) {
      const photoBuffer = bufferFromBase64(photo_file.base64);
      const photoValidationError = validatePhotoFile(photo_file, photoBuffer);

      if (photoValidationError) {
        return res.status(400).json({ error: photoValidationError });
      }

      const photoName = sanitizeFileName(photo_file.name);
      const photoPath = `${verificationId}/${Date.now()}-${photoName}`;

      const { error: photoUploadError } = await supabase.storage
        .from(PHOTO_BUCKET)
        .upload(photoPath, photoBuffer, {
          contentType: photo_file.type,
          upsert: false
        });

      if (photoUploadError) {
        return res.status(500).json({
          error: `Inspection photo upload failed: ${photoUploadError.message}`
        });
      }

      uploadedPhotoPath = photoPath;
    }

    if (log_file?.base64) {
      const logBuffer = bufferFromBase64(log_file.base64);
      const logValidationError = validateDocFile(log_file, logBuffer);

      if (logValidationError) {
        return res.status(400).json({ error: logValidationError });
      }

      const logName = sanitizeFileName(log_file.name);
      const logPath = `${verificationId}/${Date.now()}-${logName}`;

      const { error: logUploadError } = await supabase.storage
        .from(DOC_BUCKET)
        .upload(logPath, logBuffer, {
          contentType: log_file.type,
          upsert: false
        });

      if (logUploadError) {
        return res.status(500).json({
          error: `Inspection log upload failed: ${logUploadError.message}`
        });
      }

      uploadedLogPath = logPath;
    }

    return res.status(200).json({
      success: true,
      verification_id: verificationId,
      photo_path: uploadedPhotoPath,
      log_file_path: uploadedLogPath
    });
  } catch (err) {
    return res.status(500).json({
      error: err?.message || "Server error"
    });
  }
}
