import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "40mb"
    }
  }
};

const PHOTO_BUCKET = "inspection-photos";
const DOC_BUCKET = "inspection-docs";

const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const MAX_DOC_BYTES = 15 * 1024 * 1024;
const MAX_PHOTO_COUNT = 6;

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
    return Buffer.from(base64String, "base64");
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

function normalizePhotoFiles(photoFileInput) {
  if (!photoFileInput) return [];

  if (Array.isArray(photoFileInput)) {
    return photoFileInput.filter(file => file && file.base64);
  }

  if (photoFileInput.base64) {
    return [photoFileInput];
  }

  return [];
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

    const photoFiles = normalizePhotoFiles(photo_file);

    if (!photoFiles.length && !log_file) {
      return res.status(400).json({ error: "No files provided" });
    }

    if (photoFiles.length > MAX_PHOTO_COUNT) {
      return res.status(400).json({
        error: `You can upload up to ${MAX_PHOTO_COUNT} photos at one time.`
      });
    }

    const verificationId = String(verification_id).trim();

    let uploadedLogPath = null;
    const uploadedPhotoPaths = [];

    // Upload one or many photos
    for (let i = 0; i < photoFiles.length; i += 1) {
      const currentPhoto = photoFiles[i];
      const buffer = bufferFromBase64(currentPhoto.base64);

      const error = validateFile({
        type: currentPhoto.type,
        buffer,
        allowedTypes: ALLOWED_PHOTO_TYPES,
        maxBytes: MAX_PHOTO_BYTES,
        label: `Inspection photo ${i + 1}`
      });

      if (error) {
        return res.status(400).json({ error });
      }

      const fileName = sanitizeFileName(currentPhoto.name);
      const filePath = `${verificationId}/${Date.now()}-${i + 1}-${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from(PHOTO_BUCKET)
        .upload(filePath, buffer, {
          contentType: currentPhoto.type,
          upsert: false
        });

      if (uploadError) {
        return res.status(500).json({
          error: `Photo upload failed`,
          details: uploadError.message
        });
      }

      uploadedPhotoPaths.push(filePath);
    }

    // Upload log
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
          error: "Log upload failed",
          details: uploadError.message
        });
      }

      uploadedLogPath = filePath;
    }

    // Load current inspection record first so we can merge photo arrays
    const { data: existingInspection, error: existingInspectionError } = await supabase
      .from("Inspections")
      .select("id, verification_id, photo_url, photo_urls, log_file_url")
      .eq("verification_id", verificationId)
      .single();

    if (existingInspectionError) {
      return res.status(500).json({
        error: "Files uploaded but failed to load inspection record",
        details: existingInspectionError.message
      });
    }

    const existingPhotoUrls = Array.isArray(existingInspection.photo_urls)
      ? existingInspection.photo_urls.filter(Boolean)
      : [];

    const mergedPhotoUrls = [...existingPhotoUrls, ...uploadedPhotoPaths];

    const updatePayload = {};

    if (uploadedPhotoPaths.length) {
      updatePayload.photo_url = mergedPhotoUrls[0] || uploadedPhotoPaths[0];
      updatePayload.photo_urls = mergedPhotoUrls;
    }

    if (uploadedLogPath) {
      updatePayload.log_file_url = uploadedLogPath;
    }

    if (Object.keys(updatePayload).length > 0) {
      const { data: updatedInspection, error: updateError } = await supabase
        .from("Inspections")
        .update(updatePayload)
        .eq("verification_id", verificationId)
        .select("id, verification_id, photo_url, photo_urls, log_file_url")
        .single();

      if (updateError) {
        return res.status(500).json({
          error: "Files uploaded but failed to update inspection record",
          details: updateError.message
        });
      }

      return res.status(200).json({
        success: true,
        verification_id: verificationId,
        photo_path: uploadedPhotoPaths[0] || null,
        photo_paths: uploadedPhotoPaths,
        log_file_path: uploadedLogPath,
        inspection: updatedInspection
      });
    }

    return res.status(200).json({
      success: true,
      verification_id: verificationId,
      photo_path: uploadedPhotoPaths[0] || null,
      photo_paths: uploadedPhotoPaths,
      log_file_path: uploadedLogPath
    });
  } catch (error) {
    return res.status(500).json({
      error: "Server error",
      details: error.message
    });
  }
}
