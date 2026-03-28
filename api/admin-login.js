import crypto from "crypto";

function generateAdminToken() {
  return crypto
    .createHash("sha256")
    .update(`${process.env.ADMIN_PASSWORD}:${Date.now()}:${Math.random()}`)
    .digest("hex");
}

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
    const { password } = req.body || {};

    if (!process.env.ADMIN_PASSWORD) {
      return res.status(500).json({ error: "Missing ADMIN_PASSWORD environment variable" });
    }

    if (!password || password !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({ error: "Invalid password" });
    }

    const token = generateAdminToken();

    return res.status(200).json({
      success: true,
      token
    });
  } catch (error) {
    return res.status(500).json({
      error: "Login failed",
      details: error.message
    });
  }
}
