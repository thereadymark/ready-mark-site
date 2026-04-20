import { getAuthorizedClientUser } from "./_clientAuth.js";
import { createClient } from "@supabase/supabase-js";
export default async function handler(req, res) {
  const allowedOrigin = "https://verify.thereadymarkgroup.com";

  const corsHeaders = {
    "Access-Control-Allow-Origin": allowedOrigin,
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
      return res.status(500).json({
        error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
      });
    }

    const authResult = await getAuthorizedClientUser(req);

if (authResult.error) {
  return res.status(authResult.status).json({ error: authResult.error });
}

const { clientUser } = authResult;

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const {
      report_id,
      property_slug,
      resolution_note,
      resolution_photo_url,
      resolved_by
    } = req.body || {};

const resolvedByClean = String(resolved_by || "").trim();

if (!resolvedByClean || resolvedByClean.length < 5 || !resolvedByClean.includes(" ")) {
  return res.status(400).json({
    error: "Resolved By must include both title and full name."
  });
}

const parts = resolvedByClean.includes("–")
  ? resolvedByClean.split("–")
  : resolvedByClean.split("-");

const resolvedByTitle = parts[0]?.trim();
const resolvedByName = parts.slice(1).join("-").trim();

if (!resolvedByTitle || !resolvedByName) {
  return res.status(400).json({
    error: "Use format: Title – Full Name"
  });
}
    if (!property_slug || typeof property_slug !== "string") {
  return res.status(400).json({ error: "Missing property_slug" });
}

const normalizedRequestedSlug = String(property_slug).trim().toLowerCase();
const normalizedAllowedSlug = String(clientUser.property_slug).trim().toLowerCase();

if (normalizedRequestedSlug !== normalizedAllowedSlug) {
  return res.status(403).json({ error: "You are not authorized for this property" });
}
    if (!report_id) {
      return res.status(400).json({ error: "Missing report_id" });
    }

    if (!resolution_note || !String(resolution_note).trim()) {
      return res.status(400).json({ error: "Resolution note is required" });
    }

    const normalizedPropertySlug = normalizedRequestedSlug;
    const cleanedResolutionNote = String(resolution_note).trim();
    const cleanedResolvedBy = resolved_by ? String(resolved_by).trim() : "Property Team";
    const cleanedPhotoUrl = resolution_photo_url ? String(resolution_photo_url).trim() : null;
    const submittedAt = new Date().toISOString();

    const { data: report, error: reportError } = await supabase
      .from("guest_reports")
      .select("id, property_slug, status, hotel_notified_at, resolution_note, remediation_submitted_at")
      .eq("id", report_id)
      .maybeSingle();

    if (reportError) {
      return res.status(500).json({
        error: reportError.message
      });
    }

    if (!report) {
      return res.status(404).json({
        error: "Guest report not found"
      });
    }

    if (String(report.property_slug || "").trim().toLowerCase() !== normalizedPropertySlug) {
      return res.status(403).json({
        error: "This report does not belong to the selected property"
      });
    }

    if (!report.hotel_notified_at) {
      return res.status(400).json({
        error: "This issue has not been sent to the property yet"
      });
    }

    if (String(report.status || "").trim() === "Verified Resolved") {
      return res.status(409).json({
        error: "This issue has already been marked resolved"
      });
    }

    const updatePayload = {
      resolution_note: cleanedResolutionNote,
      resolution_photo_url: cleanedPhotoUrl,
      remediation_submitted_at: submittedAt,
      resolved_by: `${resolvedByTitle} – ${resolvedByName}`,
      resolved_by_title: resolvedByTitle,
      resolved_by_name: resolvedByName,      
      status: "Remediation Submitted",
      verification_status: "pending"
    };

    const { data: updatedReport, error: updateError } = await supabase
      .from("guest_reports")
      .update(updatePayload)
      .eq("id", report_id)
      .select()
      .maybeSingle();

    if (updateError) {
      return res.status(500).json({
        error: updateError.message
      });
    }

    return res.status(200).json({
      success: true,
      message: "Remediation submitted successfully.",
      report: updatedReport
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Server error"
    });
  }
}
