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
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif"
]);

const ALLOWED_DOC_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif"
]);

function bufferFromBase64(base64String) {
  try {
    if (!base64String) return null;

    const cleaned = base64String.includes("base64,")
      ? base64String.split("base64,")[1]
      : base64String;

    return Buffer.from(cleaned, "base64");
  } catch {
    return null;
  }
}
function sanitizeFileName(name) {
  return String(name || "file")
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .toLowerCase();
}

function validateFile({ type, buffer, allowedTypes, maxBytes, label }) {
  if (!type || !allowedTypes.has(type)) {
    return `${label} must be a supported file type.`;
  }

  if (!buffer || !buffer.length) {
    return `${label} file is invalid or corrupted.`;
  }

  if (buffer.length > maxBytes) {
    return `${label} exceeds maximum size.`;
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

  const adminToken = req.headers["x-admin-token"];
  const expectedToken = process.env.ADMIN_TOKEN;

  if (!expectedToken) {
    return res.status(500).json({ error: "Missing ADMIN_TOKEN" });
  }

  if (!adminToken || adminToken !== expectedToken) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
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

    // 📸 PHOTO UPLOAD
    if (photo_file?.base64) {
      const buffer = bufferFromBase64(photo_file.base64);

      const error = validateFile({
        type: photo_file.type,
        buffer,
        allowedTypes: ALLOWED_PHOTO_TYPES,
        maxBytes: MAX_PHOTO_BYTES,
        label: "Inspection photo"
      });

      if (error) {
        return res.status(400).json({ error });
      }

      const fileName = sanitizeFileName(photo_file.name);
      const filePath = `${verificationId}/${Date.now()}-${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from(PHOTO_BUCKET)
        .upload(filePath, buffer, {
          contentType: photo_file.type,
          upsert: false
        });

      if (uploadError) {
        return res.status(500).json({
          error: `Photo upload failed`,
          details: uploadError.message
        });
      }

      uploadedPhotoPath = filePath;
    }

    // 📄 LOG FILE UPLOAD
    if (log_file?.base64) {
      const buffer = bufferFromBase64(log_file.base64);

      const error = validateFile({
        type: log_file.type,
        buffer,
        allowedTypes: ALLOWED_DOC_TYPES,
        maxBytes: MAX_DOC_BYTES,
        label: "Inspection log"
      });

      if (error) {
        return res.status(400).json({ error });
      }

      const fileName = sanitizeFileName(log_file.name);
      const filePath = `${verificationId}/${Date.now()}-${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from(DOC_BUCKET)
        .upload(filePath, buffer, {
          contentType: log_file.type,
          upsert: false
        });

      if (uploadError) {
        return res.status(500).json({
          error: `Log upload failed`,
          details: uploadError.message
        });
      }

      uploadedLogPath = filePath;
    }

    return res.status(200).json({
      success: true,
      verification_id: verificationId,
      photo_path: uploadedPhotoPath,
      log_file_path: uploadedLogPath
    });

  } catch (error) {
    return res.status(500).json({
      error: "Server error",
      details: error.message
    });
  }
}
