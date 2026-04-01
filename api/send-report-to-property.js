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

    const detailText = report.guest_note || report.details || "No additional notes provided.";
    const reportReference = report.confirmation_number || "Not available";
    const verificationId = report.verification_id || "Not available";
    const submittedAt = report.reported_at
      ? new Date(report.reported_at).toLocaleString()
      : "Not available";

    const emailHtml = `
      <div style="margin:0;padding:0;background:#111315;font-family:Georgia,serif;color:#f3eee5;">
        <div style="max-width:700px;margin:0 auto;padding:32px 20px;">
          <div style="background:linear-gradient(180deg,#1b1f23,#161a1e);border:1px solid rgba(199,162,87,0.25);border-radius:20px;overflow:hidden;">
            <div style="padding:32px 28px 22px;text-align:center;border-bottom:1px solid rgba(199,162,87,0.18);">
              <img src="https://verify.thereadymarkgroup.com/readymarkseal(best)nobackground.PNG" alt="The Ready Mark" style="width:90px;display:block;margin:0 auto 12px;">
              <div style="color:#c7a257;font-size:14px;letter-spacing:2px;text-transform:uppercase;font-weight:700;margin-bottom:10px;">
                The Ready Mark
              </div>
              <h1 style="margin:0;color:#f3eee5;font-size:34px;line-height:1.1;">
                Guest Issue Report
              </h1>
              <p style="max-width:560px;margin:14px auto 0;color:#b7b0a5;font-size:15px;line-height:1.7;">
                A guest-submitted issue has been received and forwarded for review.
              </p>
            </div>

            <div style="padding:26px 28px;">
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
                <div style="padding:16px;border-radius:14px;background:rgba(255,255,255,0.02);border:1px solid rgba(199,162,87,0.12);">
                  <div style="color:#d8bb7a;font-size:12px;letter-spacing:1px;text-transform:uppercase;margin-bottom:8px;">Reference #</div>
                  <div style="font-size:18px;line-height:1.5;color:#f3eee5;">${reportReference}</div>
                </div>

                <div style="padding:16px;border-radius:14px;background:rgba(255,255,255,0.02);border:1px solid rgba(199,162,87,0.12);">
                  <div style="color:#d8bb7a;font-size:12px;letter-spacing:1px;text-transform:uppercase;margin-bottom:8px;">Verification ID</div>
                  <div style="font-size:18px;line-height:1.5;color:#f3eee5;">${verificationId}</div>
                </div>

                <div style="padding:16px;border-radius:14px;background:rgba(255,255,255,0.02);border:1px solid rgba(199,162,87,0.12);">
                  <div style="color:#d8bb7a;font-size:12px;letter-spacing:1px;text-transform:uppercase;margin-bottom:8px;">Property</div>
                  <div style="font-size:18px;line-height:1.5;color:#f3eee5;">${property.property_name || report.property_name || "Not available"}</div>
                </div>

                <div style="padding:16px;border-radius:14px;background:rgba(255,255,255,0.02);border:1px solid rgba(199,162,87,0.12);">
                  <div style="color:#d8bb7a;font-size:12px;letter-spacing:1px;text-transform:uppercase;margin-bottom:8px;">Room</div>
                  <div style="font-size:18px;line-height:1.5;color:#f3eee5;">${report.room_number || "Not available"}</div>
                </div>

                <div style="padding:16px;border-radius:14px;background:rgba(255,255,255,0.02);border:1px solid rgba(199,162,87,0.12);">
                  <div style="color:#d8bb7a;font-size:12px;letter-spacing:1px;text-transform:uppercase;margin-bottom:8px;">Submitted</div>
                  <div style="font-size:18px;line-height:1.5;color:#f3eee5;">${submittedAt}</div>
                </div>

                <div style="padding:16px;border-radius:14px;background:rgba(255,255,255,0.02);border:1px solid rgba(199,162,87,0.12);">
                  <div style="color:#d8bb7a;font-size:12px;letter-spacing:1px;text-transform:uppercase;margin-bottom:8px;">Priority</div>
                  <div style="font-size:18px;line-height:1.5;color:#f3eee5;">${report.priority || "Normal"}</div>
                </div>
              </div>

              <div style="margin-top:16px;padding:18px;border-radius:14px;background:rgba(255,255,255,0.02);border:1px solid rgba(199,162,87,0.12);">
                <div style="color:#d8bb7a;font-size:12px;letter-spacing:1px;text-transform:uppercase;margin-bottom:8px;">Reported Issue Types</div>
                <div style="font-size:17px;line-height:1.7;color:#f3eee5;">${issueText}</div>
              </div>

              <div style="margin-top:16px;padding:18px;border-radius:14px;background:rgba(255,255,255,0.02);border:1px solid rgba(199,162,87,0.12);">
                <div style="color:#d8bb7a;font-size:12px;letter-spacing:1px;text-transform:uppercase;margin-bottom:8px;">Guest Notes</div>
                <div style="font-size:17px;line-height:1.8;color:#f3eee5;">${detailText}</div>
              </div>

              ${
                report.photo_url
                  ? `
              <div style="margin-top:16px;padding:18px;border-radius:14px;background:rgba(255,255,255,0.02);border:1px solid rgba(199,162,87,0.12);">
                <div style="color:#d8bb7a;font-size:12px;letter-spacing:1px;text-transform:uppercase;margin-bottom:8px;">Attached Photo</div>
                <div style="font-size:16px;line-height:1.7;color:#f3eee5;">
                  A supporting photo was included with this report.
                </div>
                <div style="margin-top:10px;">
                  <a href="${report.photo_url}" style="display:inline-block;padding:12px 16px;border-radius:12px;background:linear-gradient(180deg,#d8ba73,#b8934c);color:#111315;font-weight:700;text-decoration:none;">
                    View Attached Photo
                  </a>
                </div>
              </div>
                  `
                  : ""
              }

              <div style="margin-top:20px;color:#b7b0a5;font-size:14px;line-height:1.7;">
                This report was forwarded by The Ready Mark for operational review and resolution.
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
