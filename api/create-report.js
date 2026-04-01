function generateReportReference() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const datePart = `${yyyy}${mm}${dd}`;
  const randomPart = Math.floor(1000 + Math.random() * 9000);

  return `RM-RPT-${datePart}-${randomPart}`;
}

function formatPropertyName(value) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";

  const upperAcronyms = new Set(["stl", "nyc", "la", "usa", "uk", "llc", "qa", "gm"]);

  return normalized
    .split(" ")
    .map(word => {
      const lower = word.toLowerCase();
      if (upperAcronyms.has(lower)) return lower.toUpperCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

function buildCard(label, value) {
  return `
    <div style="
      margin-bottom:16px;
      padding:18px 18px 16px;
      border-radius:18px;
      background:linear-gradient(180deg,#11151a,#0c1014);
      border:1px solid rgba(199,162,87,0.22);
      box-shadow:0 0 18px rgba(199,162,87,0.06);
    ">
      <div style="
        color:#c7a257;
        font-size:12px;
        letter-spacing:2px;
        text-transform:uppercase;
        margin-bottom:8px;
      ">
        ${label}
      </div>
      <div style="
        color:#f3eee5;
        font-size:18px;
        line-height:1.7;
        font-weight:600;
      ">
        ${value || "Not available"}
      </div>
    </div>
  `;
}

export default async function handler(req, res) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  };

  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
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
        error: "Missing server environment variables"
      });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};

    const rawPropertyName = body.property || body.property_name || "";
    const propertyName = formatPropertyName(rawPropertyName);
    const propertySlug = body.property_slug || "";
    const roomNumber = String(body.room || body.room_number || "").trim();
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
        error: "Missing required report fields"
      });
    }

    const guestNameParts = guestNameRaw.trim().split(/\s+/).filter(Boolean);
    const guestFirstName = guestNameParts[0] || null;
    const guestLastName =
      guestNameParts.length > 1 ? guestNameParts.slice(1).join(" ") : null;

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
      guest_last_name: guestLastName
    };

    const insertRes = await fetch(`${supabaseUrl}/rest/v1/guest_reports`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
        "Content-Type": "application/json",
        Prefer: "return=representation"
      },
      body: JSON.stringify(insertPayload)
    });

    const insertData = await insertRes.json().catch(() => null);

    if (!insertRes.ok) {
      return res.status(500).json({
        success: false,
        error:
          insertData?.message ||
          insertData?.error ||
          insertData?.details ||
          "Failed to save report"
      });
    }

    const savedReport = Array.isArray(insertData) ? insertData[0] : insertData;

    if (resendApiKey && resendFromEmail && guestEmail) {
      const detailCard = details ? buildCard("Additional Details", details) : "";

      const guestHtml = `
<div style="margin:0;padding:0;background:#0f1114;font-family:Georgia,serif;color:#f3eee5;">
  <div style="max-width:720px;margin:0 auto;padding:40px 20px;">
    <div style="
      background:linear-gradient(180deg,#12161b,#0f1114);
      border:1px solid rgba(199,162,87,0.25);
      border-radius:24px;
      overflow:hidden;
      box-shadow:0 0 40px rgba(199,162,87,0.08);
    ">
      
      <div style="padding:36px 30px 26px;text-align:center;border-bottom:1px solid rgba(199,162,87,0.18);">
        <img
          src="https://verify.thereadymarkgroup.com/readymarkseal(best)nobackground.PNG"
          alt="The Ready Mark"
          style="width:90px;margin-bottom:14px;display:block;margin-left:auto;margin-right:auto;"
        >

        <div style="color:#c7a257;font-size:13px;letter-spacing:3px;text-transform:uppercase;font-weight:600;">
          The Ready Mark
        </div>

        <h1 style="margin:10px 0 6px;font-size:34px;color:#ffffff;font-weight:600;">
          Issue Received
        </h1>

        <p style="margin:0;color:#b7b0a5;font-size:15px;line-height:1.7;max-width:520px;margin-left:auto;margin-right:auto;">
          Your report has been received and logged for review.
        </p>
      </div>

      <div style="padding:28px 28px 32px;">
        ${buildCard("Reference #", confirmationNumber)}
        ${buildCard("Room", roomNumber)}
        ${buildCard("Property", propertyName)}
        ${buildCard("Reported Issue(s)", issueTypes.join(", "))}
        ${detailCard}

        <div style="margin-top:22px;color:#c9c1b3;font-size:15px;line-height:1.8;">
          Please keep this reference number for your records.
        </div>
      </div>

      <div style="padding:0 30px 26px;text-align:center;">
        <div style="color:#7f7666;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;">
          The Ready Mark · Cleanliness Certification System
        </div>
      </div>
    </div>
  </div>
</div>
`;

      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from: resendFromEmail,
          to: guestEmail,
          subject: `Your Ready Mark Report Confirmation – ${confirmationNumber}`,
          html: guestHtml
        })
      }).catch(() => null);
    }

    return res.status(200).json({
      success: true,
      message: "Report received.",
      confirmationNumber,
      confirmation_number: confirmationNumber,
      reference: confirmationNumber,
      report: savedReport
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err?.message || "Server error"
    });
  }
}
