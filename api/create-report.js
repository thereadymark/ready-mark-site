export default async function handler(req, res) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed",
    });
  }

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const resendApiKey = process.env.RESEND_API_KEY;
    const resendFromEmail = process.env.RESEND_FROM_EMAIL;

    if (!supabaseUrl || !serviceRoleKey) {
      return res.status(500).json({
        success: false,
        error: "Missing server environment variables",
      });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};

    const propertyName = body.property || body.property_name || "";
    const propertySlug = body.property_slug || "";
    const roomNumber = String(body.room || body.room_number || "").trim();
    const details = body.details || body.guest_note || null;
    const photoUrl = body.photo_url || null;
    const guestEmail = body.guest_email || null;
    const guestNameRaw = body.guest_name || "";
    const issueTypes = Array.isArray(body.issue)
      ? body.issue
      : Array.isArray(body.issue_types)
      ? body.issue_types
      : [];

    if (!propertyName || !roomNumber || !issueTypes.length) {
      return res.status(400).json({
        success: false,
        error: "Missing required report fields",
      });
    }

    const guestNameParts = guestNameRaw.trim().split(/\s+/).filter(Boolean);
    const guestFirstName = guestNameParts[0] || null;
    const guestLastName = guestNameParts.length > 1 ? guestNameParts.slice(1).join(" ") : null;

    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    const randomPart = Math.floor(1000 + Math.random() * 9000);
    const confirmationNumber = `RM-${y}${m}${d}-${randomPart}`;

    const insertPayload = {
      verification_id: confirmationNumber,
      confirmation_number: confirmationNumber,
      property_slug: propertySlug || null,
      property_name: propertyName,
      room_number: roomNumber,
      issue_types: issueTypes,
      guest_note: details,
      details: details,
      photo_url: photoUrl,
      status: "new",
      priority: "urgent",
      reported_at: now.toISOString(),
      guest_email: guestEmail,
      guest_first_name: guestFirstName,
      guest_last_name: guestLastName,
    };

    const insertRes = await fetch(`${supabaseUrl}/rest/v1/guest_reports`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(insertPayload),
    });

    const insertData = await insertRes.json().catch(() => null);

    if (!insertRes.ok) {
      return res.status(500).json({
        success: false,
        error:
          insertData?.message ||
          insertData?.error ||
          insertData?.details ||
          "Failed to save report",
      });
    }

    const savedReport = Array.isArray(insertData) ? insertData[0] : insertData;

    // Guest confirmation email
    if (resendApiKey && resendFromEmail && guestEmail) {
      const guestHtml = `
        <div style="font-family: Georgia, serif; line-height: 1.6; color: #111;">
          <h2 style="margin-bottom: 12px;">Your Ready Mark Report Confirmation</h2>
          <p>Thank you for submitting your cleanliness report.</p>
          <p>Your concern has been successfully received and forwarded for review.</p>
          <p><strong>Reference Number:</strong> ${confirmationNumber}</p>
          <p><strong>Property:</strong> ${propertyName}</p>
          <p><strong>Room:</strong> ${roomNumber}</p>
          <p><strong>Reported Issue(s):</strong> ${issueTypes.join(", ")}</p>
          ${details ? `<p><strong>Additional Details:</strong> ${details}</p>` : ""}
          <p>Please keep this reference number for your records.</p>
          <p>— Ready Mark</p>
        </div>
      `;

      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: resendFromEmail,
          to: guestEmail,
          subject: `Your Ready Mark Report Confirmation – ${confirmationNumber}`,
          html: guestHtml,
        }),
      }).catch(() => null);
    }

    return res.status(200).json({
      success: true,
      message: "Report received.",
      confirmationNumber,
      confirmation_number: confirmationNumber,
      reference: confirmationNumber,
      report: savedReport,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err?.message || "Server error",
    });
  }
}
