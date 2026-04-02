import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const GUEST_REPORTS_BUCKET = "guest-reports";
const SIGNED_URL_EXPIRES_IN = 60 * 60; // 1 hour

export default async function handler(req, res) {
  const allowedOrigin = "https://verify.thereadymarkgroup.com";

  const corsHeaders = {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-admin-token"
  };

  Object.entries(corsHeaders).forEach(([key, value]) => {
    res.setHeader(key, value);
  });

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const adminToken = req.headers["x-admin-token"];
    const expectedAdminToken = process.env.ADMIN_TOKEN;

    if (!expectedAdminToken) {
      return res.status(500).json({ error: "Missing ADMIN_TOKEN" });
    }

    if (!adminToken || adminToken !== expectedAdminToken) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return res.status(500).json({ error: "Missing server environment variables" });
    }

    const headers = {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Accept: "application/json"
    };

    const propertiesUrl =
      `${supabaseUrl}/rest/v1/properties` +
      `?select=id,property_name,property_slug,city,state,property_type` +
      `&order=property_name.asc`;

    const reportsUrl =
      `${supabaseUrl}/rest/v1/guest_reports` +
      `?select=id,verification_id,confirmation_number,property_slug,property_name,room_number,issue_types,guest_note,details,photo_url,status,priority,reported_at,guest_email,guest_first_name,guest_last_name` +
      `&order=reported_at.desc.nullslast`;

    const [propertiesRes, reportsRes] = await Promise.all([
      fetch(propertiesUrl, { headers }),
      fetch(reportsUrl, { headers })
    ]);

    const propertiesData = await propertiesRes.json().catch(() => []);
    const reportsData = await reportsRes.json().catch(() => []);

    if (!propertiesRes.ok) {
      return res.status(500).json({
        error: "Property lookup failed",
        details: propertiesData
      });
    }

    if (!reportsRes.ok) {
      return res.status(500).json({
        error: "Guest report lookup failed",
        details: reportsData
      });
    }

    const guestReports = Array.isArray(reportsData) ? reportsData : [];

    const guestReportsWithSignedUrls = await Promise.all(
      guestReports.map(async (report) => {
        const photoPath = report?.photo_url ? String(report.photo_url).trim() : "";

        if (!photoPath) {
          return {
            ...report,
            photo_path: null,
            photo_url: null
          };
        }

        const { data: signedData, error: signedError } = await supabase.storage
          .from(GUEST_REPORTS_BUCKET)
          .createSignedUrl(photoPath, SIGNED_URL_EXPIRES_IN);

        if (signedError || !signedData?.signedUrl) {
          return {
            ...report,
            photo_path: photoPath,
            photo_url: null
          };
        }

        return {
          ...report,
          photo_path: photoPath,
          photo_url: signedData.signedUrl
        };
      })
    );

    return res.status(200).json({
      properties: Array.isArray(propertiesData) ? propertiesData : [],
      guest_reports: guestReportsWithSignedUrls
    });
  } catch (error) {
    return res.status(500).json({
      error: "Server error",
      details: error.message
    });
  }
}
