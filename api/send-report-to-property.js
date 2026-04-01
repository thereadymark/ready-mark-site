export default async function handler(req, res) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-admin-token"
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

  const adminToken = req.headers["x-admin-token"];

  if (!adminToken) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const { report_id } = req.body || {};

    if (!report_id) {
      return res.status(400).json({ error: "Missing report_id" });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const resendApiKey = process.env.RESEND_API_KEY;
    const resendFromEmail = process.env.RESEND_FROM_EMAIL;

    if (!supabaseUrl || !serviceRoleKey) {
      return res.status(500).json({ error: "Missing server environment variables" });
    }

    if (!resendApiKey || !resendFromEmail) {
      return res.status(500).json({ error: "Missing Resend configuration" });
    }

    const headers = {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Accept: "application/json"
    };

    const reportUrl =
      `${supabaseUrl}/rest/v1/guest_reports` +
      `?id=eq.${encodeURIComponent(report_id)}` +
      `&select=id,verification_id,confirmation_number,property_slug,property_name,room_number,issue_types,guest_note,details,photo_url,status,priority,reported_at,guest_email,guest_first_name,guest_last_name`;

    const reportRes = await fetch(reportUrl, { headers });
    const reportData = await reportRes.json().catch(() => []);

    if (!reportRes.ok) {
      return res.status(500).json({
        error: "Failed to load guest report",
        details: reportData
      });
    }

    const report = Array.isArray(reportData) ? reportData[0] : reportData;

    if (!report) {
      return res.status(404).json({ error: "Guest report not found" });
    }

    if (!report.property_slug) {
      return res.status(400).json({ error: "Guest report is missing property_slug" });
    }

    const propertyUrl =
      `${supabaseUrl}/rest/v1/properties` +
      `?property_slug=eq.${encodeURIComponent(report.property_slug)}` +
      `&select=id,property_name,property_slug,city,state,property_type` +
      `&limit=1`;

    const propertyRes = await fetch(propertyUrl, { headers });
    const propertyData = await propertyRes.json().catch(() => []);

    if (!propertyRes.ok) {
      return res.status(500).json({
        error: "Failed to load property",
        details: propertyData
      });
    }

    const property = Array.isArray(propertyData) ? propertyData[0] : propertyData;

    if (!property) {
      return res.status(404).json({ error: "Property not found for this report" });
    }

    const contactUrl =
      `${supabaseUrl}/rest/v1/property_contacts` +
      `?property_id=eq.${encodeURIComponent(property.id)}` +
      `&active=eq.true` +
      `&select=id,name,email,role,is_primary,active,created_at` +
      `&order=is_primary.desc,created_at.asc`;

    const contactRes = await fetch(contactUrl, { headers });
    const contactData = await contactRes.json().catch(() => []);

    if (!contactRes.ok) {
      return res.status(500).json({
        error: "Failed to load property contacts",
        details: contactData
      });
    }

    const contact = Array.isArray(contactData) ? contactData[0] : contactData;

    if (!contact || !contact.email) {
      return res.status(404).json({
        error: "No active property contact with an email was found"
      });
    }

    const issueText =
      Array.isArray(report.issue_types) && report.issue_types.length
        ? report.issue_types.join(", ")
        : "Not provided";

    const detailText =
      report.guest_note || report.details || "No additional notes provided.";

    const reportReference = report.confirmation_number || "Not available";
    const verificationId = report.verification_id || "Not available";
    const submittedAt = report.reported_at
      ? new Date(report.reported_at).toLocaleString()
      : "Not available";

    const photoSection = report.photo_url
      ? `
        <div style="margin-top:16px;padding:18px;border-radius:14px;background:#0f1317;border:1px solid rgba(199,162,87,0.15);text-align:center;">
          <div style="color:#d8bb7a;font-size:12px;text-transform:uppercase;margin-bottom:10px;">
            Supporting Evidence
          </div>
          <a href="${report.photo_url}" style="display:inline-block;padding:12px 18px;border-radius:12px;background:#c7a257;color:#111;font-weight:700;text-decoration:none;">
            View Attached Photo
          </a>
        </div>
      `
      : "";

    const emailHtml = `
<div style="margin:0;padding:0;background:#0f1114;font-family:Georgia,serif;color:#f3eee5;">
  <div style="max-width:720px;margin:0 auto;padding:36px 20px;">
    <div style="background:#15191d;border:1px solid rgba(199,162,87,0.25);border-radius:22px;overflow:hidden;">
      
      <div style="padding:34px 30px 24px;text-align:center;border-bottom:1px solid rgba(199,162,87,0.18);">
        <img src="https://verify.thereadymarkgroup.com/readymarkseal(best)nobackground.PNG" alt="The Ready Mark" style="width:90px;margin-bottom:12px;">
        
        <div style="color:#c7a257;font-size:13px;letter-spacing:3px;text-transform:uppercase;font-weight:700;">
          The Ready Mark
        </div>

        <h1 style="margin:10px 0 6px;font-size:32px;color:#ffffff;">
          Operational Notice
        </h1>

        <p style="margin:0;color:#b7b0a5;font-size:15px;">
          A guest-submitted issue has been formally recorded and requires review.
        </p>
      </div>

      <div style="padding:26px 30px;">
        
        <div style="margin-bottom:18px;">
          <div style="color:#d8bb7a;font-size:12px;text-transform:uppercase;margin-bottom:6px;">Reference</div>
          <div style="font-size:18px;">${reportReference}</div>
        </div>

        <div style="margin-bottom:18px;">
          <div style="color:#d8bb7a;font-size:12px;text-transform:uppercase;margin-bottom:6px;">Verification ID</div>
          <div style="font-size:18px;">${verificationId}</div>
        </div>

        <div style="margin-bottom:18px;">
          <div style="color:#d8bb7a;font-size:12px;text-transform:uppercase;margin-bottom:6px;">Property</div>
          <div style="font-size:18px;">${property.property_name || report.property_name || "Not available"}</div>
        </div>

        <div style="margin-bottom:18px;">
          <div style="color:#d8bb7a;font-size:12px;text-transform:uppercase;margin-bottom:6px;">Room</div>
          <div style="font-size:18px;">${report.room_number || "Not available"}</div>
        </div>

        <div style="margin-bottom:18px;">
          <div style="color:#d8bb7a;font-size:12px;text-transform:uppercase;margin-bottom:6px;">Submitted</div>
          <div style="font-size:16px;">${submittedAt}</div>
        </div>

        <div style="margin-bottom:18px;">
          <div style="color:#d8bb7a;font-size:12px;text-transform:uppercase;margin-bottom:6px;">Priority</div>
          <div style="font-size:16px;">${report.priority || "Normal"}</div>
        </div>

        <div style="margin-top:22px;padding:18px;border-radius:14px;background:#0f1317;border:1px solid rgba(199,162,87,0.15);">
          <div style="color:#d8bb7a;font-size:12px;text-transform:uppercase;margin-bottom:8px;">
            Reported Issue
          </div>
          <div style="font-size:16px;line-height:1.7;">
            ${issueText}
          </div>
        </div>

        <div style="margin-top:16px;padding:18px;border-radius:14px;background:#0f1317;border:1px solid rgba(199,162,87,0.15);">
          <div style="color:#d8bb7a;font-size:12px;text-transform:uppercase;margin-bottom:8px;">
            Guest Statement
          </div>
          <div style="font-size:16px;line-height:1.8;">
            ${detailText}
          </div>
        </div>

        ${photoSection}

        <div style="margin-top:24px;font-size:13px;color:#8f8775;line-height:1.7;">
          This notice was generated by The Ready Mark Cleanliness Certification System and forwarded for operational awareness and resolution tracking.
        </div>

      </div>
    </div>
  </div>
</div>
`;

    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: resendFromEmail,
        to: contact.email,
        subject: `Ready Mark Guest Issue Report – ${reportReference}`,
        html: emailHtml
      })
    });

    const emailData = await emailRes.json().catch(() => null);

    if (!emailRes.ok) {
      return res.status(500).json({
        error: "Failed to send property email",
        details: emailData
      });
    }

    const patchRes = await fetch(
      `${supabaseUrl}/rest/v1/guest_reports?id=eq.${encodeURIComponent(report.id)}`,
      {
        method: "PATCH",
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          "Content-Type": "application/json",
          Prefer: "return=representation"
        },
        body: JSON.stringify({
          status: "Sent to Property"
        })
      }
    );

    const patchData = await patchRes.json().catch(() => null);

    if (!patchRes.ok) {
      return res.status(500).json({
        error: "Email sent, but failed to update report status",
        details: patchData
      });
    }

    const updatedReport = Array.isArray(patchData) ? patchData[0] : patchData;

    return res.status(200).json({
      success: true,
      message: "Report sent to property successfully.",
      sent_to: {
        name: contact.name || null,
        email: contact.email,
        role: contact.role || null
      },
      report: updatedReport
    });
  } catch (error) {
    return res.status(500).json({
      error: "Server error",
      details: error.message
    });
  }
}
