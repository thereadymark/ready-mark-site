import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "20mb"
    }
  }
};

const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const GUEST_REPORTS_BUCKET = "guest-reports";
const SIGNED_URL_EXPIRES_IN = 60 * 60;

const ALLOWED_PHOTO_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif"
]);

function bufferFromBase64(base64String) {
  return Buffer.from(base64String, "base64");
}

function sanitizeFileName(name) {
  return String(name || "file")
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "");
}

function validatePhotoFile(photoFile, fileBuffer) {
  if (!photoFile || !photoFile.type) {
    return "Issue photo is missing required file metadata.";
  }

  if (!ALLOWED_PHOTO_TYPES.has(photoFile.type)) {
    return "Issue photo must be a JPG, PNG, WEBP, or HEIC image.";
  }

  if (fileBuffer.length > MAX_PHOTO_BYTES) {
    return "Issue photo is too large. Maximum size is 10 MB.";
  }

  return null;
}

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
    .map((word) => {
      const lower = word.toLowerCase();
      if (upperAcronyms.has(lower)) return lower.toUpperCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function sendEmail({ resendApiKey, from, to, subject, html }) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from,
      to,
      subject,
      html
    })
  });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    throw new Error(
      data?.message ||
      data?.error ||
      data?.name ||
      "Email send failed."
    );
  }

  return data;
}

function buildGuestConfirmationEmail({
  confirmationNumber,
  propertyName,
  roomNumber,
  issueText,
  guestNote
}) {
  return `
<div style="margin:0;padding:0;background:#f7f6f3;font-family:Georgia,serif;color:#111315;">
  <div style="max-width:720px;margin:0 auto;padding:32px 16px;">
    
    <div style="background:#ffffff;border:1px solid #e6e1d8;border-radius:18px;overflow:hidden;">
      
      <div style="padding:28px 24px;text-align:center;border-bottom:1px solid #eee;">
        <img src="https://verify.thereadymarkgroup.com/readymarkseal(best)nobackground.PNG"
             style="width:80px;margin-bottom:10px;" />

        <div style="color:#c7a257;font-size:12px;letter-spacing:3px;text-transform:uppercase;font-weight:700;">
          The Ready Mark
        </div>

        <h1 style="margin:12px 0 6px;font-size:28px;color:#111315;">
          Issue Received
        </h1>

        <p style="margin:0;color:#5f5a52;font-size:15px;line-height:1.6;">
          Your report has been received and logged for review.
        </p>
      </div>

      <div style="padding:24px;">
        
        ${infoRow("Reference", confirmationNumber)}
        ${infoRow("Property", propertyName)}
        ${infoRow("Room", roomNumber)}

        ${card("Reported Issue", issueText)}

        ${guestNote ? card("Additional Details", guestNote) : ""}

        <p style="margin-top:24px;font-size:13px;color:#7a7368;">
          Please keep this reference number for your records.
        </p>

      </div>
    </div>
  </div>
</div>
`;
}

function infoRow(label, value) {
  return `
  <div style="margin-bottom:16px;">
    <div style="color:#c7a257;font-size:12px;text-transform:uppercase;font-weight:700;margin-bottom:4px;">
      ${escapeHtml(label)}
    </div>
    <div style="font-size:17px;color:#111315;font-weight:600;">
      ${escapeHtml(value || "Not available")}
    </div>
  </div>
  `;
}

function card(title, content) {
  return `
  <div style="margin-top:20px;padding:16px;border-radius:14px;background:#111315;">
    <div style="color:#c7a257;font-size:12px;text-transform:uppercase;margin-bottom:6px;">
      ${escapeHtml(title)}
    </div>
    <div style="color:#ffffff;font-size:15px;line-height:1.6;">
      ${escapeHtml(content || "Not provided")}
    </div>
  </div>
  `;
}
function buildInternalAlertEmail({
  confirmationNumber,
  verificationId,
  propertyName,
  roomNumber,
  issueText,
  guestNote,
  guestName,
  guestEmail,
  reservationLastName,
  photoUrl,
  submittedAt,
  priority
}) {
  const photoSection = photoUrl
    ? `
      <div style="margin-top:16px;padding:18px;border-radius:14px;background:#0f1317;border:1px solid rgba(199,162,87,0.15);text-align:center;">
        <div style="color:#d8bb7a;font-size:12px;text-transform:uppercase;margin-bottom:10px;">
          Supporting Evidence
        </div>
        <a href="${escapeHtml(photoUrl)}" style="display:inline-block;padding:12px 18px;border-radius:12px;background:#c7a257;color:#111;font-weight:700;text-decoration:none;">
          View Attached Photo
        </a>
      </div>
    `
    : "";

  return `
<div style="margin:0;padding:0;background:#0f1114;font-family:Georgia,serif;color:#f3eee5;">
  <div style="max-width:720px;margin:0 auto;padding:36px 20px;">
    <div style="background:#15191d;border:1px solid rgba(199,162,87,0.25);border-radius:22px;overflow:hidden;box-shadow:0 0 40px rgba(199,162,87,0.08);">
      <div style="padding:34px 30px 24px;text-align:center;border-bottom:1px solid rgba(199,162,87,0.18);">
        <img src="https://verify.thereadymarkgroup.com/readymarkseal(best)nobackground.PNG" alt="The Ready Mark" style="width:90px;margin-bottom:12px;">
        <div style="color:#c7a257;font-size:13px;letter-spacing:3px;text-transform:uppercase;font-weight:700;">
          The Ready Mark
        </div>
        <h1 style="margin:10px 0 6px;font-size:32px;color:#ffffff;">
          New Guest Report
        </h1>
        <p style="margin:0;color:#b7b0a5;font-size:15px;line-height:1.75;max-width:540px;margin-left:auto;margin-right:auto;">
          A guest-submitted issue has been received and requires Ready Mark review.
        </p>
      </div>

      <div style="padding:26px 30px;">
        <div style="margin-bottom:18px;">
          <div style="color:#d8bb7a;font-size:12px;text-transform:uppercase;margin-bottom:6px;">Reference</div>
          <div style="font-size:18px;color:#f3eee5;font-weight:700;">${escapeHtml(confirmationNumber)}</div>
        </div>

        <div style="margin-bottom:18px;">
          <div style="color:#d8bb7a;font-size:12px;text-transform:uppercase;margin-bottom:6px;">Verification ID</div>
          <div style="font-size:18px;color:#f3eee5;">${escapeHtml(verificationId || "Not available")}</div>
        </div>

        <div style="margin-bottom:18px;">
          <div style="color:#d8bb7a;font-size:12px;text-transform:uppercase;margin-bottom:6px;">Property</div>
          <div style="font-size:18px;color:#f3eee5;">${escapeHtml(propertyName || "Not available")}</div>
        </div>

        <div style="margin-bottom:18px;">
          <div style="color:#d8bb7a;font-size:12px;text-transform:uppercase;margin-bottom:6px;">Room</div>
          <div style="font-size:18px;color:#f3eee5;">${escapeHtml(roomNumber || "Not available")}</div>
        </div>

        <div style="margin-bottom:18px;">
          <div style="color:#d8bb7a;font-size:12px;text-transform:uppercase;margin-bottom:6px;">Reservation Last Name</div>
          <div style="font-size:18px;color:#f3eee5;">${escapeHtml(reservationLastName || guestName || "Not available")}</div>
        </div>

        <div style="margin-bottom:18px;">
          <div style="color:#d8bb7a;font-size:12px;text-transform:uppercase;margin-bottom:6px;">Guest Email</div>
          <div style="font-size:18px;color:#f3eee5;">${escapeHtml(guestEmail || "Not available")}</div>
        </div>

        <div style="margin-bottom:18px;">
          <div style="color:#d8bb7a;font-size:12px;text-transform:uppercase;margin-bottom:6px;">Submitted</div>
          <div style="font-size:18px;color:#f3eee5;">${escapeHtml(submittedAt || "Not available")}</div>
        </div>

        <div style="margin-bottom:18px;">
          <div style="color:#d8bb7a;font-size:12px;text-transform:uppercase;margin-bottom:6px;">Priority</div>
          <div style="font-size:18px;color:#f3eee5;">${escapeHtml(priority || "Normal")}</div>
        </div>

        <div style="margin-top:22px;padding:18px;border-radius:14px;background:#0f1317;border:1px solid rgba(199,162,87,0.15);">
          <div style="color:#d8bb7a;font-size:12px;text-transform:uppercase;margin-bottom:8px;">
            Reported Issue
          </div>
          <div style="font-size:16px;line-height:1.7;color:#f3eee5;">
            ${escapeHtml(issueText || "Not provided")}
          </div>
        </div>

        <div style="margin-top:16px;padding:18px;border-radius:14px;background:#0f1317;border:1px solid rgba(199,162,87,0.15);">
          <div style="color:#d8bb7a;font-size:12px;text-transform:uppercase;margin-bottom:8px;">
            Guest Statement
          </div>
          <div style="font-size:16px;line-height:1.8;color:#f3eee5;">
            ${escapeHtml(guestNote || "No additional details provided.")}
          </div>
        </div>

        ${photoSection}

        <div style="margin-top:24px;font-size:13px;color:#8f8775;line-height:1.7;">
          This is an internal Ready Mark alert. Review the dashboard before forwarding a controlled version to the property.
        </div>
      </div>
    </div>
  </div>
</div>
`;
}

export default async function handler(req, res) {
  const allowedOrigin = "https://verify.thereadymarkgroup.com";

  const corsHeaders = {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-guest-token"
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
    const guestToken = req.headers["x-guest-token"];

    if (!guestToken) {
      return res.status(401).json({ error: "Guest login required" });
    }

    const { data: session, error: sessionError } = await supabase
      .from("guest_sessions")
      .select("guest_user_id, expires_at")
      .eq("session_token", guestToken)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    if (sessionError) {
      return res.status(500).json({ error: sessionError.message });
    }

    if (!session) {
      return res.status(401).json({ error: "Invalid or expired guest session" });
    }

    const { data: guestUser, error: guestError } = await supabase
      .from("guest_users")
      .select("id, first_name, last_name, email, email_verified")
      .eq("id", session.guest_user_id)
      .maybeSingle();

    if (guestError) {
      return res.status(500).json({ error: guestError.message });
    }

    if (!guestUser) {
      return res.status(401).json({ error: "Guest not found" });
    }

    if (!guestUser.email_verified) {
      return res.status(401).json({ error: "Email verification required" });
    }

    const {
      verification_id,
      property_slug,
      property_name,
      room_number,
      issue_types,
      guest_note,
      photo_file,
      reservation_last_name
    } = req.body || {};

    if (!verification_id) {
      return res.status(400).json({ error: "Missing verification_id" });
    }

    if (!room_number) {
      return res.status(400).json({ error: "Missing room_number" });
    }

    if (!Array.isArray(issue_types) || issue_types.length === 0) {
      return res.status(400).json({ error: "Please select at least one issue type." });
    }

    const normalizedVerificationId = String(verification_id).trim();
    const normalizedPropertySlug = property_slug ? String(property_slug).trim() : null;
    const normalizedPropertyName = formatPropertyName(property_name);
    const normalizedRoomNumber = String(room_number).trim();
    const normalizedGuestNote = guest_note ? String(guest_note).trim() : null;
    const normalizedReservationLastName = reservation_last_name
      ? String(reservation_last_name).trim()
      : "";

    const duplicateCheck = await supabase
      .from("guest_reports")
      .select("id, confirmation_number, status, reported_at")
      .eq("verification_id", normalizedVerificationId)
      .eq("guest_email", guestUser.email)
      .in("status", ["New", "Under Review", "Escalated", "Sent to Property"])
      .order("reported_at", { ascending: false })
      .limit(1);

    if (duplicateCheck.error) {
      return res.status(500).json({ error: duplicateCheck.error.message });
    }

    if (duplicateCheck.data && duplicateCheck.data.length > 0) {
      const existing = duplicateCheck.data[0];
      return res.status(409).json({
        error: "A report for this room is already open under your account.",
        reference: existing.confirmation_number || null,
        existing_report_id: existing.id || null,
        existing_status: existing.status || null
      });
    }

    const confirmationNumber = generateReportReference();

    let uploadedPhotoPath = "";

    if (photo_file && photo_file.base64) {
      const photoBuffer = bufferFromBase64(photo_file.base64);
      const photoValidationError = validatePhotoFile(photo_file, photoBuffer);

      if (photoValidationError) {
        return res.status(400).json({ error: photoValidationError });
      }

      const fileName = sanitizeFileName(photo_file.name);
      const filePath = `${confirmationNumber}/${Date.now()}-${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from(GUEST_REPORTS_BUCKET)
        .upload(filePath, photoBuffer, {
          contentType: photo_file.type,
          upsert: false
        });

      if (uploadError) {
        return res.status(500).json({
          error: `Photo upload failed: ${uploadError.message}`
        });
      }

      uploadedPhotoPath = filePath;
    }

    const insertPayload = {
      verification_id: normalizedVerificationId,
      confirmation_number: confirmationNumber,
      property_slug: normalizedPropertySlug,
      property_name: normalizedPropertyName || null,
      room_number: normalizedRoomNumber,
      issue_types,
      guest_note: normalizedGuestNote,
      details: normalizedGuestNote,
      photo_url: uploadedPhotoPath || null,
      status: "New",
      priority: uploadedPhotoPath ? "Urgent" : "Normal",
      reported_at: new Date().toISOString(),
      guest_user_id: guestUser.id,
      guest_email: guestUser.email,
      guest_first_name: "Guest",
      guest_last_name: normalizedReservationLastName || null,
      reservation_last_name: normalizedReservationLastName || null,
      access_code_verified: false,
      stay_match_status: "pending"
    };

    const { data, error } = await supabase
      .from("guest_reports")
      .insert([insertPayload])
      .select()
      .single();

    if (error) {
      return res.status(500).json({
        error: `Guest report save failed: ${error.message}`
      });
    }

    let signedPhotoUrl = null;

    if (uploadedPhotoPath) {
      const { data: signedData, error: signedError } = await supabase.storage
        .from(GUEST_REPORTS_BUCKET)
        .createSignedUrl(uploadedPhotoPath, SIGNED_URL_EXPIRES_IN);

      if (!signedError && signedData?.signedUrl) {
        signedPhotoUrl = signedData.signedUrl;
      }
    }

    const resendApiKey = process.env.RESEND_API_KEY;
    const resendFromEmail = process.env.RESEND_FROM_EMAIL;
    const internalAlertEmail =
      process.env.REPORT_ISSUES_EMAIL ||
      process.env.INTERNAL_REPORT_ALERT_EMAIL ||
      "reportissues@thereadymarkgroup.com";

    const guestFullName = normalizedReservationLastName || guestUser.last_name || guestUser.first_name || "Guest";
    const issueText = issue_types.join(", ");
    const submittedAt = data?.reported_at
      ? new Date(data.reported_at).toLocaleString()
      : new Date().toLocaleString();

    const emailErrors = [];

    if (resendApiKey && resendFromEmail) {
      try {
        await sendEmail({
          resendApiKey,
          from: `Ready Mark <${resendFromEmail}>`,
          to: guestUser.email,
          subject: `Your Ready Mark Report Confirmation – ${confirmationNumber}`,
          html: buildGuestConfirmationEmail({
            confirmationNumber,
            propertyName: normalizedPropertyName,
            roomNumber: normalizedRoomNumber,
            issueText,
            guestNote: normalizedGuestNote
          })
        });
      } catch (emailError) {
        emailErrors.push(`Guest confirmation email failed: ${emailError.message}`);
      }

      try {
        await sendEmail({
          resendApiKey,
          from: `Ready Mark <${resendFromEmail}>`,
          to: internalAlertEmail,
          subject: `Ready Mark New Guest Report – ${confirmationNumber}`,
          html: buildInternalAlertEmail({
            confirmationNumber,
            verificationId: normalizedVerificationId,
            propertyName: normalizedPropertyName,
            roomNumber: normalizedRoomNumber,
            issueText,
            guestNote: normalizedGuestNote,
            guestName: guestFullName,
            guestEmail: guestUser.email,
            reservationLastName: normalizedReservationLastName,
            photoUrl: signedPhotoUrl,
            submittedAt,
            priority: uploadedPhotoPath ? "Urgent" : "Normal"
          })
        });
      } catch (emailError) {
        emailErrors.push(`Internal alert email failed: ${emailError.message}`);
      }
    } else {
      emailErrors.push("Email configuration missing. RESEND_API_KEY or RESEND_FROM_EMAIL is not set.");
    }

    return res.status(200).json({
      success: true,
      confirmation_number: confirmationNumber,
      reference: confirmationNumber,
      report: data,
      warnings: emailErrors.length ? emailErrors : undefined
    });
  } catch (error) {
    return res.status(500).json({
      error: `Server error: ${error.message}`
    });
  }
}
