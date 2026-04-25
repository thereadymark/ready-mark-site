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

const ALLOWED_ORIGIN = "https://verify.thereadymarkgroup.com";

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
  return String(name || "file")
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

function normalizePhotoFiles(photoFileInput) {
  if (!photoFileInput) return [];

  if (Array.isArray(photoFileInput)) {
    return photoFileInput.filter((file) => file?.base64);
  }

  if (photoFileInput?.base64) {
    return [photoFileInput];
  }

  return [];
}

async function uploadFileToStorage({ bucket, folder, file, index, label }) {
  const buffer = bufferFromBase64(file.base64);

  const validationError = validateFile({
    file,
    buffer,
    allowedTypes: bucket === PHOTO_BUCKET ? ALLOWED_PHOTO_TYPES : ALLOWED_DOC_TYPES,
    maxBytes: bucket === PHOTO_BUCKET ? MAX_PHOTO_BYTES : MAX_DOC_BYTES,
    label
  });

  if (validationError) {
    return { error: validationError, status: 400 };
  }

  const fileName = sanitizeFileName(file.name);
  const prefix = index ? `${Date.now()}-${index}` : `${Date.now()}`;
  const filePath = `${folder}/${prefix}-${fileName}`;

  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(filePath, buffer, {
      contentType: file.type,
      upsert: false
    });

  if (uploadError) {
    return {
      error: `${label} upload failed.`,
      details: uploadError.message,
      status: 500
    };
  }

  const { data: publicUrlData } = supabase.storage
    .from(bucket)
    .getPublicUrl(filePath);

  return {
    path: filePath,
    url: publicUrlData?.publicUrl || filePath
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
    return res.status(500).json({
      error: "Missing Supabase environment variables"
    });
  }

  if (!expectedToken) {
    return res.status(500).json({ error: "Missing ADMIN_TOKEN" });
  }

  if (!adminToken || adminToken !== expectedToken) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const { inspection_id, verification_id, photo_file, log_file } = req.body || {};

    if (!verification_id) {
      return res.status(400).json({ error: "Missing verification_id" });
    }

    if (!inspection_id) {
  return res.status(400).json({ error: "Missing inspection_id" });
}

    const verificationId = String(verification_id).trim();
    const inspectionId = String(inspection_id).trim();
    const folder = sanitizeFolderName(inspectionId);

    if (!folder) {
      return res.status(400).json({ error: "Invalid verification_id" });
    }

    const photoFiles = normalizePhotoFiles(photo_file);

    if (!photoFiles.length && !log_file?.base64) {
      return res.status(400).json({ error: "No files provided" });
    }

    if (photoFiles.length > MAX_PHOTO_COUNT) {
      return res.status(400).json({
        error: `You can upload up to ${MAX_PHOTO_COUNT} photos at one time.`
      });
    }

    const uploadedPhotos = [];
    let uploadedLog = null;

    for (let i = 0; i < photoFiles.length; i += 1) {
      const result = await uploadFileToStorage({
        bucket: PHOTO_BUCKET,
        folder,
        file: photoFiles[i],
        index: i + 1,
        label: `Inspection photo ${i + 1}`
      });

      if (result.error) {
        return res.status(result.status || 500).json(result);
      }

      uploadedPhotos.push(result);
    }

    if (log_file?.base64) {
      const result = await uploadFileToStorage({
        bucket: DOC_BUCKET,
        folder,
        file: log_file,
        index: null,
        label: "Inspection log"
      });

      if (result.error) {
        return res.status(result.status || 500).json(result);
      }

      uploadedLog = result;
    }

    const { data: inspectionRows, error: lookupError } = await supabase
      .from("Inspections")
      .select("id, verification_id, photo_url, photo_urls, log_file_url, created_at")
      .eq("id", inspectionId)
      .order("created_at", { ascending: false })
      .limit(1);

    if (lookupError) {
      return res.status(500).json({
        error: "Files uploaded, but inspection lookup failed.",
        details: lookupError.message
      });
    }

    const inspection = inspectionRows?.[0];

    if (!inspection?.id) {
      return res.status(404).json({
        error: "Files uploaded, but no matching inspection record was found.",
        verification_id: verificationId,
        uploaded: {
          photos: uploadedPhotos,
          log: uploadedLog
        }
      });
    }

    const existingPhotoUrls = Array.isArray(inspection.photo_urls)
      ? inspection.photo_urls.filter(Boolean)
      : [];

    const newPhotoUrls = uploadedPhotos
      .map((photo) => photo.url)
      .filter(Boolean);

   const mergedPhotoUrls = [...new Set([...existingPhotoUrls, ...newPhotoUrls])];
    
    const updatePayload = {};

    if (newPhotoUrls.length) {
      updatePayload.photo_url = newPhotoUrls[newPhotoUrls.length - 1];
      updatePayload.photo_urls = mergedPhotoUrls;
    }

    if (uploadedLog?.url) {
      updatePayload.log_file_url = uploadedLog.url;
    }

    let updatedInspection = inspection;

    if (Object.keys(updatePayload).length > 0) {
      const { data: updatedRows, error: updateError } = await supabase
        .from("Inspections")
        .update(updatePayload)
        .eq("id", inspection.id)
        .select("id, verification_id, photo_url, photo_urls, log_file_url, created_at");

      if (updateError) {
        return res.status(500).json({
          error: "Files uploaded, but inspection update failed.",
          details: updateError.message,
          uploaded: {
            photos: uploadedPhotos,
            log: uploadedLog
          }
        });
      }

      updatedInspection = updatedRows?.[0] || inspection;
    }

    return res.status(200).json({
      success: true,
      verification_id: verificationId,
      photo_url: newPhotoUrls[newPhotoUrls.length - 1] || null,
      photo_urls: mergedPhotoUrls,
      log_file_url: uploadedLog?.url || null,
      uploaded: {
        photos: uploadedPhotos,
        log: uploadedLog
      },
      inspection: updatedInspection
    });
  } catch (error) {
    return res.status(500).json({
      error: "Server error",
      details: error.message
    });
  }
}
