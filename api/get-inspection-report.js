import { createClient } from "@supabase/supabase-js";

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

    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({
      error: error?.message || "Server error"
    });
  }
}
