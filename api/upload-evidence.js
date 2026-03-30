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
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return res.status(500).json({
        error: "Missing server env vars"
      });
    }

    const contentType = req.headers["content-type"] || "";
    const boundaryMatch = contentType.match(/boundary=(.*)$/);

    if (!boundaryMatch) {
      return res.status(400).json({ error: "Missing multipart boundary" });
    }

    const boundary = boundaryMatch[1];
    const chunks = [];

    for await (const chunk of req) {
      chunks.push(chunk);
    }

    const bodyBuffer = Buffer.concat(chunks);
    const bodyText = bodyBuffer.toString("binary");

    const parts = bodyText.split(`--${boundary}`);
    const filePart = parts.find(
      (part) =>
        part.includes('name="file"') &&
        part.includes("filename=")
    );

    if (!filePart) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const fileNameMatch = filePart.match(/filename="([^"]+)"/);
    const mimeMatch = filePart.match(/Content-Type:\s*([^\r\n]+)/i);

    const originalFileName = fileNameMatch ? fileNameMatch[1] : `upload-${Date.now()}.jpg`;
    const mimeType = mimeMatch ? mimeMatch[1].trim() : "application/octet-stream";

    const headerEnd = filePart.indexOf("\r\n\r\n");
    if (headerEnd === -1) {
      return res.status(400).json({ error: "Invalid multipart file format" });
    }

    let fileBinary = filePart.slice(headerEnd + 4);

    if (fileBinary.endsWith("\r\n")) {
      fileBinary = fileBinary.slice(0, -2);
    }

    const fileBuffer = Buffer.from(fileBinary, "binary");

    const safeFileName = originalFileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storagePath = `guest-reports/${Date.now()}-${safeFileName}`;

    const uploadRes = await fetch(
      `${supabaseUrl}/storage/v1/object/guest_report_photos/${encodeURIComponent(storagePath).replace(/%2F/g, "/")}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serviceRoleKey}`,
          apikey: serviceRoleKey,
          "Content-Type": mimeType,
          "x-upsert": "false"
        },
        body: fileBuffer
      }
    );

    const uploadData = await uploadRes.json().catch(() => null);

    if (!uploadRes.ok) {
      return res.status(500).json({
        error:
          uploadData?.message ||
          uploadData?.error ||
          JSON.stringify(uploadData) ||
          "Upload failed"
      });
    }

    const publicUrl = `${supabaseUrl}/storage/v1/object/public/guest_report_photos/${storagePath}`;

    return res.status(200).json({
      success: true,
      photo_url: publicUrl,
      path: storagePath
    });
  } catch (err) {
    return res.status(500).json({
      error: err.message || "Server error"
    });
  }
}
