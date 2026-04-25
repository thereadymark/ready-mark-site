import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function normalizeUrl(value) {
  if (!value) return "";

  const text = String(value).trim();

  if (text.startsWith("http://") || text.startsWith("https://")) {
    return text;
  }

  return text;
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

    inspection.photo_url = normalizeUrl(inspection.photo_url);

    inspection.photo_urls = Array.isArray(inspection.photo_urls)
      ? inspection.photo_urls.map(normalizeUrl).filter(Boolean)
      : [];

    inspection.log_file_url = normalizeUrl(inspection.log_file_url);

    return res.status(200).json(inspection);
  } catch (error) {
    return res.status(500).json({
      error: error?.message || "Server error"
    });
  }
}
