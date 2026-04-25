import { createClient } from "@supabase/supabase-js";

const PHOTO_BUCKET = "inspection-photos";
const DOC_BUCKET = "inspection-docs";
const SIGNED_URL_EXPIRES_IN = 60 * 60;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    let signedPhotoUrl = "";
    let signedPhotoUrls = [];
    let signedLogFileUrl = "";

    if (data.photo_url) {
      const { data: signedData } = await supabase.storage
        .from(PHOTO_BUCKET)
        .createSignedUrl(data.photo_url, SIGNED_URL_EXPIRES_IN);

      signedPhotoUrl = signedData?.signedUrl || "";
    }

    if (Array.isArray(data.photo_urls) && data.photo_urls.length) {
      const signedResults = await Promise.all(
        data.photo_urls.map(async (path) => {
          const { data: signedData } = await supabase.storage
            .from(PHOTO_BUCKET)
            .createSignedUrl(path, SIGNED_URL_EXPIRES_IN);

          return signedData?.signedUrl || null;
        })
      );

      signedPhotoUrls = signedResults.filter(Boolean);
    }

    if (data.log_file_url) {
      const { data: signedData } = await supabase.storage
        .from(DOC_BUCKET)
        .createSignedUrl(data.log_file_url, SIGNED_URL_EXPIRES_IN);

      signedLogFileUrl = signedData?.signedUrl || "";
    }

    data.photo_url = signedPhotoUrl;
    data.photo_urls = signedPhotoUrls;
    data.log_file_url = signedLogFileUrl;

    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({
      error: error?.message || "Server error"
    });
  }
}
