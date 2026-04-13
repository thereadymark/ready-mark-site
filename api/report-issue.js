export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const {
      verification_id,
      property_slug,
      property_name,
      room_number,
      issue_types,
      guest_note,
      reservation_last_name,
      photo_file
    } = req.body || {};

    const guestToken = req.headers["x-guest-token"];

    if (!guestToken) {
      return res.status(401).json({ error: "Missing guest token" });
    }

    if (!verification_id || !room_number) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Normalize values (but DO NOT block)
    const normalizedIssues = Array.isArray(issue_types)
      ? issue_types.filter(Boolean)
      : [];

    const normalizedNote = guest_note
      ? String(guest_note).trim()
      : "";

    const normalizedLastName = reservation_last_name
      ? String(reservation_last_name).trim()
      : null;

    // Optional photo handling (safe)
    let photoPayload = null;
    if (photo_file && photo_file.base64) {
      photoPayload = {
        name: photo_file.name || "upload.jpg",
        type: photo_file.type || "image/jpeg",
        base64: photo_file.base64
      };
    }

    // 👉 This is where you normally insert into DB
    // Keeping it simple so nothing breaks your UI
    console.log("REPORT ISSUE:", {
      verification_id,
      property_slug,
      property_name,
      room_number,
      issues: normalizedIssues,
      note: normalizedNote,
      reservation_last_name: normalizedLastName,
      hasPhoto: !!photoPayload
    });

    return res.status(200).json({
      success: true,
      message: "Report submitted successfully"
    });

  } catch (err) {
    console.error("REPORT ISSUE ERROR:", err);
    return res.status(500).json({
      error: "Something went wrong"
    });
  }
}
