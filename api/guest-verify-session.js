import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-guest-token"
  };

  Object.entries(corsHeaders).forEach(([key, value]) => {
    res.setHeader(key, value);
  });

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const token = req.headers["x-guest-token"];

    if (!token) {
      return res.status(401).json({ error: "Missing guest token" });
    }

    const { data: session, error: sessionError } = await supabase
      .from("guest_sessions")
      .select("*, guest_users(*)")
      .eq("session_token", token)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    if (sessionError) {
      return res.status(500).json({ error: sessionError.message });
    }

    if (!session) {
      return res.status(401).json({ error: "Invalid or expired session" });
    }

    return res.status(200).json({
      success: true,
      guest: {
        id: session.guest_users.id,
        first_name: session.guest_users.first_name,
        last_name: session.guest_users.last_name,
        email: session.guest_users.email
      }
    });
  } catch (error) {
    return res.status(500).json({
      error: `Server error: ${error.message}`
    });
  }
}
