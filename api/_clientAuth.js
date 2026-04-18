import { createClient } from "@supabase/supabase-js";

export async function getAuthorizedClientUser(req) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : "";

  if (!token) {
    return { error: "Missing authorization token", status: 401 };
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const {
    data: { user },
    error: userError
  } = await adminClient.auth.getUser(token);

  if (userError || !user || !user.email) {
    return { error: "Unauthorized", status: 401 };
  }

  const email = String(user.email).trim().toLowerCase();

  const { data: clientUser, error: clientUserError } = await adminClient
    .from("client_users")
    .select("email, property_slug, full_name, role, is_active")
    .eq("email", email)
    .maybeSingle();

  if (clientUserError) {
    throw new Error(clientUserError.message);
  }

  if (!clientUser || !clientUser.is_active) {
    return { error: "Client user not found or inactive", status: 403 };
  }

  return {
    user,
    clientUser,
    adminClient
  };
}
