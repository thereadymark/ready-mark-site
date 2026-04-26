import { createClient } from "@supabase/supabase-js";

const PHOTO_BUCKET = "inspection-photos";
const DOC_BUCKET = "inspection-docs";
const SIGNED_URL_EXPIRES_IN = 60 * 60; // 1 hour

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function getStoragePath(value, bucketName) {
  if (!value) return "";

  const text = String(value).trim();

  // Already a storage path
  if (!text.startsWith("http://") && !text.startsWith("https://")) {
    return text;
  }

  // Supabase public URL format:
  // .../storage/v1/object/public/BucketName/path/to/file.jpg
  const publicMarker = `/storage/v1/object/public/${bucketName}/`;
  if (text.includes(publicMarker)) {
    return text.split(publicMarker)[1] || "";
  }

  // Supabase signed URL format:
  // .../storage/v1/object/sign/BucketName/path/to/file.jpg?token=...
  const signedMarker = `/storage/v1/object/sign/${bucketName}/`;
  if (text.includes(signedMarker)) {
    return (text.split(signedMarker)[1] || "").split("?")[0] || "";
  }

  return text;
}

async function createSignedStorageUrl(value, bucketName) {
  const path = getStoragePath(value, bucketName);

  if (!path) return "";

  // If somehow this is a non-Supabase full URL, return it as-is.
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }

  const { data, error } = await supabase.storage
    .from(bucketName)
    .createSignedUrl(path, SIGNED_URL_EXPIRES_IN);

  if (error) {
    console.error(`Signed URL failed for ${bucketName}:`, error.message);
    return "";
  }

  return data?.signedUrl || "";
}

export default async function handler(req, res) {
  try {
    const { id } = req.query;

    if (!id) {
      return res.status(400).json({ error: "Missing inspection ID" });
    }

    const { data, error } = await supabase
      .from("Inspections")
      .select(`
        *,
        Rooms (
          room_number,
          properties (
            property_name,
            property_slug
          )
        )
      `)
      .eq("id", id)
      .limit(1);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    const inspection = data?.[0];

    if (!inspection) {
      return res.status(404).json({ error: "Inspection not found" });
    }

    const rawPhotoUrls = Array.isArray(inspection.photo_urls)
      ? inspection.photo_urls.filter(Boolean)
      : [];

    const signedPhotoUrls = await Promise.all(
      rawPhotoUrls.map((url) => createSignedStorageUrl(url, PHOTO_BUCKET))
    );

    const signedSinglePhotoUrl = inspection.photo_url
      ? await createSignedStorageUrl(inspection.photo_url, PHOTO_BUCKET)
      : "";

    const signedLogFileUrl = inspection.log_file_url
      ? await createSignedStorageUrl(inspection.log_file_url, DOC_BUCKET)
      : "";

    inspection.photo_url = signedSinglePhotoUrl;
    inspection.photo_urls = signedPhotoUrls.filter(Boolean);
    inspection.log_file_url = signedLogFileUrl;

    return res.status(200).json(inspection);
  } catch (error) {
    return res.status(500).json({
      error: error?.message || "Server error"
    });
  }
}
