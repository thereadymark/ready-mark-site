export default async function handler(req, res) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
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

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return res.status(500).json({ error: "Missing server environment variables" });
    }

    const headers = {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      Prefer: "return=representation"
    };

    const {
      verification_id,
      photo_urls = [],
      log_file_url = ""
    } = req.body || {};

    if (!verification_id) {
      return res.status(400).json({ error: "Missing verification_id" });
    }

    const lookupUrl =
      `${supabaseUrl}/rest/v1/Inspections` +
      `?verification_id=eq.${encodeURIComponent(verification_id)}` +
      `&select=id,photo_urls,log_file_url` +
      `&limit=1`;

    const lookupRes = await fetch(lookupUrl, { headers });
    const lookupData = await lookupRes.json();

    if (!lookupRes.ok) {
      return res.status(500).json({
        error: `Inspection lookup failed: ${JSON.stringify(lookupData)}`
      });
    }

    if (!Array.isArray(lookupData) || lookupData.length === 0) {
      return res.status(404).json({
        error: `No inspection found for verification_id: ${verification_id}`
      });
    }

    const existing = lookupData[0];
    const existingPhotos = Array.isArray(existing.photo_urls) ? existing.photo_urls : [];

    const mergedPhotos = [...new Set([...existingPhotos, ...photo_urls.filter(Boolean)])];

    const patchPayload = {
      photo_urls: mergedPhotos,
      log_file_url: log_file_url || existing.log_file_url || null
    };

    const patchUrl =
      `${supabaseUrl}/rest/v1/Inspections` +
      `?id=eq.${encodeURIComponent(existing.id)}`;

    const patchRes = await fetch(patchUrl, {
      method: "PATCH",
      headers,
      body: JSON.stringify(patchPayload)
    });

    const patchData = await patchRes.json();

    if (!patchRes.ok) {
      return res.status(500).json({
        error: `Saving evidence failed: ${JSON.stringify(patchData)}`
      });
    }

    return res.status(200).json({
      success: true,
      verification_id,
      photo_count: mergedPhotos.length,
      log_file_url: patchPayload.log_file_url
    });
  } catch (error) {
    return res.status(500).json({
      error: `Server error: ${error.message}`
    });
  }
}
