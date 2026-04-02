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
    const { password } = req.body || {};

    const adminPassword = process.env.ADMIN_PASSWORD;
    const adminToken = process.env.ADMIN_TOKEN;

    if (!adminPassword) {
      return res.status(500).json({ error: "Missing ADMIN_PASSWORD environment variable" });
    }

    if (!adminToken) {
      return res.status(500).json({ error: "Missing ADMIN_TOKEN environment variable" });
    }

    if (!password || password !== adminPassword) {
      return res.status(401).json({ error: "Invalid password" });
    }

    return res.status(200).json({
      success: true,
      token: adminToken
    });
  } catch (error) {
    return res.status(500).json({
      error: "Login failed",
      details: error.message
    });
  }
}
