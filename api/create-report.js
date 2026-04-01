function generateReportReference() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const datePart = `${yyyy}${mm}${dd}`;
  const randomPart = Math.floor(1000 + Math.random() * 9000);

  return `RM-RPT-${datePart}-${randomPart}`;
}

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

    const body =
      typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};

    const propertyName = body.property || body.property_name || "";
    const propertySlug = body.property_slug || "";
    const roomNumber = String(
      body.room || body.room_number || ""
    ).trim();
    const details = body.details || body.guest_note || null;
    const photoUrl = body.photo_url || null;
    const guestEmail = body.guest_email || null;
    const guestNameRaw = body.guest_name || "";
    const verificationId = String(body.verification_id || "").trim();

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

    const guestNameParts = guestNameRaw
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    const guestFirstName = guestNameParts[0] || null;
    const guestLastName =
      guestNameParts.length > 1
        ? guestNameParts.slice(1).join(" ")
        : null;

    const confirmationNumber = generateReportReference();

    const insertPayload = {
      verification_id: verificationId || null,
      confirmation_number: confirmationNumber,
      property_slug: propertySlug || null,
      property_name: propertyName,
      room_number: roomNumber,
      issue_types: issueTypes,
      guest_note: details,
      details: details,
      photo_url: photoUrl,
      status: "New",
      priority: "Urgent",
      reported_at: new Date().toISOString(),
      guest_email: guestEmail,
      guest_first_name: guestFirstName,
      guest_last_name: guestLastName,
    };

    const insertRes = await fetch(
      `${supabaseUrl}/rest/v1/guest_reports`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serviceRoleKey}`,
          apikey: serviceRoleKey,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify(insertPayload),
      }
    );

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

    const savedReport = Array.isArray(insertData)
      ? insertData[0]
      : insertData;

    // 🔥 UPGRADED EMAIL
    if (resendApiKey && resendFromEmail && guestEmail) {
      const guestHtml = `
      <div style="margin:0;padding:0;background:#111315;font-family:Georgia,serif;color:#f3eee5;">
        <div style="max-width:700px;margin:0 auto;padding:32px 20px;">
          <div style="background:linear-gradient(180deg,#1b1f23,#161a1e);border:1px solid rgba(199,162,87,0.25);border-radius:20px;overflow:hidden;">
            
            <div style="padding:32px 28px 22px;text-align:center;border-bottom:1px solid rgba(199,162,87,0.18);">
              <img src="https://verify.thereadymarkgroup.com/readymarkseal(best)nobackground.PNG" style="width:90px;display:block;margin:0 auto 12px;">
              <div style="color:#c7a257;font-size:14px;letter-spacing:2px;text-transform:uppercase;font-weight:700;margin-bottom:10px;">
                The Ready Mark
              </div>
              <h1 style="margin:0;color:#f3eee5;font-size:34px;">
                Issue Received
              </h1>
              <p style="margin-top:14px;color:#b7b0a5;font-size:15px;">
                Your report has been successfully received and forwarded for review.
              </p>
            </div>

            <div style="padding:26px 28px;">
              <div style="margin-bottom:16px;">
                <strong style="color:#d8bb7a;">Reference #:</strong><br/>
                ${confirmationNumber}
              </div>

              <div style="margin-bottom:16px;">
                <strong style="color:#d8bb7a;">Property:</strong><br/>
                ${propertyName}
              </div>

              <div style="margin-bottom:16px;">
                <strong style="color:#d8bb7a;">Room:</strong><br/>
                ${roomNumber}
              </div>

              <div style="margin-bottom:16px;">
                <strong style="color:#d8bb7a;">Reported Issue(s):</strong><br/>
                ${issueTypes.join(", ")}
              </div>

              ${
                details
                  ? `
                <div style="margin-bottom:16px;">
                  <strong style="color:#d8bb7a;">Additional Details:</strong><br/>
                  ${details}
                </div>
              `
                  : ""
              }

              <p style="margin-top:20px;color:#b7b0a5;font-size:14px;">
                Please keep this reference number for your records.
              </p>
            </div>

          </div>
        </div>
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
