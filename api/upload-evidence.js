import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "25mb"
    }
  }
};

const ALLOWED_ORIGIN = "https://verify.thereadymarkgroup.com";

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

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, x-admin-token"
  );
}

function cleanBase64(base64String) {
  if (!base64String || typeof base64String !== "string") return null;

  return base64String.includes("base64,")
    ? base64String.split("base64,")[1]
    : base64String;
}

function bufferFromBase64(base64String) {
  try {
    const cleaned = cleanBase64(base64String);
    if (!cleaned) return null;

    return Buffer.from(cleaned, "base64");
  } catch {
    return null;
  }
}

function sanitizeFileName(name) {
  const fallback = `file-${Date.now()}`;

  return String(name || fallback)
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .toLowerCase();
}

function sanitizeFolderName(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .toLowerCase();
}

function validateFile({ file, buffer, allowedTypes, maxBytes, label }) {
  if (!file?.base64) {
    return `${label} is missing.`;
  }

  if (!file?.type || !allowedTypes.has(file.type)) {
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

async function uploadEvidenceFile({ bucket, folder, file, allowedTypes, maxBytes, label }) {
  const buffer = bufferFromBase64(file.base64);

  const validationError = validateFile({
    file,
    buffer,
    allowedTypes,
    maxBytes,
    label
  });

  if (validationError) {
    return { error: validationError };
  }

  const safeName = sanitizeFileName(file.name);
  const filePath = `${folder}/${Date.now()}-${safeName}`;

  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(filePath, buffer, {
      contentType: file.type,
      upsert: false
    });

  if (uploadError) {
    return {
      error: `${label} upload failed.`,
      details: uploadError.message
    };
  }

  const { data: publicUrlData } = supabase.storage
    .from(bucket)
    .getPublicUrl(filePath);

  return {
    path: filePath,
    url: publicUrlData?.publicUrl || null
  };
}

export default async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const expectedToken = process.env.ADMIN_TOKEN;
  const adminToken = req.headers["x-admin-token"];

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: "Missing Supabase environment variables" });
  }

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

    if (!photo_file?.base64 && !log_file?.base64) {
      return res.status(400).json({ error: "No files provided" });
    }

    const verificationId = String(verification_id).trim();
    const folder = sanitizeFolderName(verificationId);

    if (!folder) {
      return res.status(400).json({ error: "Invalid verification_id" });
    }

    let uploadedPhoto = null;
    let uploadedLog = null;

    if (photo_file?.base64) {
      const result = await uploadEvidenceFile({
        bucket: PHOTO_BUCKET,
        folder,
        file: photo_file,
        allowedTypes: ALLOWED_PHOTO_TYPES,
        maxBytes: MAX_PHOTO_BYTES,
        label: "Inspection photo"
      });

      if (result.error) {
        return res.status(result.details ? 500 : 400).json(result);
      }

      uploadedPhoto = result;
    }

    if (log_file?.base64) {
      const result = await uploadEvidenceFile({
        bucket: DOC_BUCKET,
        folder,
        file: log_file,
        allowedTypes: ALLOWED_DOC_TYPES,
        maxBytes: MAX_DOC_BYTES,
        label: "Inspection log"
      });

      if (result.error) {
        return res.status(result.details ? 500 : 400).json(result);
      }

      uploadedLog = result;
    }

   const updatePayload = {};

if (uploadedPhoto?.url) {
  updatePayload.photo_url = uploadedPhoto.url;

  // If you want to support multiple photos later
  updatePayload.photo_urls = [uploadedPhoto.url];
}

if (uploadedLog?.url) {
  updatePayload.log_file_url = uploadedLog.url;
}
    if (Object.keys(updatePayload).length > 0) {
      const { error: updateError } = await supabase
        .from("inspections")
        .update(updatePayload)
        .eq("verification_id", verificationId);

      if (updateError) {
        return res.status(500).json({
          error: "Files uploaded, but inspection update failed.",
          details: updateError.message,
          uploaded: {
            photo: uploadedPhoto,
            log: uploadedLog
          }
        });
      }
    }

    return res.status(200).json({
      success: true,
      verification_id: verificationId,
      photo_path: uploadedPhoto?.path || null,
      photo_url: uploadedPhoto?.url || null,
      log_file_path: uploadedLog?.path || null,
      log_file_url: uploadedLog?.url || null
    });
  } catch (error) {
    return res.status(500).json({
      error: "Server error",
      details: error.message
    });
  }
}
