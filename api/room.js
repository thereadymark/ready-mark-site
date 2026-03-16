export default async function handler(req, res) {
  const { slug } = req.query;

  if (!slug) {
    return res.status(400).json({ error: "Missing slug" });
  }

  const baseId = process.env.AIRTABLE_BASE_ID;
  const token = process.env.AIRTABLE_TOKEN;
  const tableName = "Rooms";

  const formula = `{QR Slug}='room-101'`;
  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}?filterByFormula=${encodeURIComponent(formula)}`;

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    const data = await response.json();

    if (!data.records || data.records.length === 0) {
      return res.status(404).json({ error: "Room not found" });
    }

    const fields = data.records[0].fields;

    return res.status(200).json({
      property: fields["Property"] || "",
      roomNumber: fields["Room Number"] || "",
      inspector: Array.isArray(fields["Latest Inspector"]) ? fields["Latest Inspector"][0] : fields["Latest Inspector"] || "",
      inspectionDate: Array.isArray(fields["Latest Inspection Date"]) ? fields["Latest Inspection Date"][0] : fields["Latest Inspection Date"] || "",
      certificationTier: Array.isArray(fields["Latest Certification Tier"]) ? fields["Latest Certification Tier"][0] : fields["Latest Certification Tier"] || "",
      verificationRecordId: Array.isArray(fields["Latest Verification Record ID"]) ? fields["Latest Verification Record ID"][0] : fields["Latest Verification Record ID"] || "",
      score: Array.isArray(fields["Inspection Scores"]) ? fields["Inspection Scores"][0] : fields["Inspection Scores"] || ""
    });
  } catch (error) {
    return res.status(500).json({ error: "Failed to load room data", details: error.message });
  }
}
