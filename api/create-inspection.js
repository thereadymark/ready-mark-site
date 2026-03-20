export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { roomId, inspectorId, score, certificationTier, notes } = req.body;

    if (!roomId || !inspectorId || score === undefined || score === null || !certificationTier) {
      return res.status(400).json({
        error: "Missing roomId, inspectorId, score, or certificationTier",
      });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return res.status(500).json({ error: "Missing server environment variables" });
    }

    const headers = {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    };

    // mark old inspections as not current
    await fetch(
      `${supabaseUrl}/rest/v1/Inspections?room_id=eq.${encodeURIComponent(roomId)}`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({ is_current: false }),
      }
    );

    // make verification ID
    const year = new Date().getFullYear();

    const existingRes = await fetch(
      `${supabaseUrl}/rest/v1/Inspections?select=verification_id&order=created_at.desc&limit=1`,
      { headers }
    );

    const existingData = await existingRes.json();

    let nextNumber = 1;

    if (existingRes.ok && existingData.length && existingData[0].verification_id) {
      const match = existingData[0].verification_id.match(/RM-\d{4}-(\d+)/);
      if (match) {
        nextNumber = parseInt(match[1], 10) + 1;
      }
    }

    const verificationId = `RM-${year}-${String(nextNumber).padStart(4, "0")}`;

    const insertRes = await fetch(`${supabaseUrl}/rest/v1/Inspections`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        room_id: roomId,
        inspector_id: inspectorId,
        score: Number(score),
        certification_tier: certificationTier,
        verification_id: verificationId,
        notes: notes || "",
        is_current: true,
      }),
    });

    const insertData = await insertRes.json();

    if (!insertRes.ok) {
      return res.status(500).json({ error: "Inspection insert failed", details: insertData });
    }

    return res.status(200).json({
      message: "Inspection created successfully",
      inspection: insertData[0],
    });
  } catch (error) {
    return res.status(500).json({
      error: "Server error",
      details: error.message,
    });
  }
}
