import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  const allowedOrigin = "https://verify.thereadymarkgroup.com";

  const corsHeaders = {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-admin-password"
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
    const adminPassword = process.env.ADMIN_PORTAL_PASSWORD;
    const providedPassword = req.headers["x-admin-password"];

    if (!adminPassword) {
      return res.status(500).json({ error: "Missing ADMIN_PORTAL_PASSWORD" });
    }

    if (!providedPassword || providedPassword !== adminPassword) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return res.status(500).json({
        error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
      });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const {
      email,
      property_slug,
      full_name,
      role,
      is_active,
      temporary_password
    } = req.body || {};

    if (!email || typeof email !== "string") {
      return res.status(400).json({ error: "Valid email is required" });
    }

    if (!property_slug || typeof property_slug !== "string") {
      return res.status(400).json({ error: "property_slug is required" });
    }

    if (!temporary_password || String(temporary_password).trim().length < 8) {
      return res.status(400).json({
        error: "Temporary password is required and must be at least 8 characters."
      });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const normalizedSlug = String(property_slug).trim().toLowerCase();
    const cleanedName = full_name ? String(full_name).trim() : null;
    const cleanedRole = role ? String(role).trim().toLowerCase() : "manager";
    const activeFlag = typeof is_active === "boolean" ? is_active : true;
    const password = String(temporary_password).trim();

    const { data: existingAuthUsers, error: listError } =
      await supabase.auth.admin.listUsers();

    if (listError) {
      return res.status(500).json({ error: listError.message });
    }

    const existingAuthUser = existingAuthUsers?.users?.find(
      user => String(user.email || "").toLowerCase() === normalizedEmail
    );

    let authUser = existingAuthUser || null;

    if (existingAuthUser) {
      const { data: updatedAuth, error: updateAuthError } =
        await supabase.auth.admin.updateUserById(existingAuthUser.id, {
          password,
          email_confirm: true,
          user_metadata: {
            full_name: cleanedName,
            property_slug: normalizedSlug,
            role: cleanedRole
          }
        });

      if (updateAuthError) {
        return res.status(500).json({ error: updateAuthError.message });
      }

      authUser = updatedAuth.user;
    } else {
      const { data: createdAuth, error: createAuthError } =
        await supabase.auth.admin.createUser({
          email: normalizedEmail,
          password,
          email_confirm: true,
          user_metadata: {
            full_name: cleanedName,
            property_slug: normalizedSlug,
            role: cleanedRole
          }
        });

      if (createAuthError) {
        return res.status(500).json({ error: createAuthError.message });
      }

      authUser = createdAuth.user;
    }

    const { data: clientUser, error: upsertError } = await supabase
      .from("client_users")
      .upsert(
        {
          email: normalizedEmail,
          property_slug: normalizedSlug,
          full_name: cleanedName,
          role: cleanedRole,
          is_active: activeFlag
          must_change_password: true 
        },
        { onConflict: "email" }
      )
      .select()
      .maybeSingle();

    if (upsertError) {
      return res.status(500).json({ error: upsertError.message });
    }

    return res.status(200).json({
      success: true,
      message: existingAuthUser
        ? "Client user updated and password reset successfully."
        : "Client user created successfully.",
      auth_user_id: authUser?.id || null,
      client_user: clientUser
    });
  } catch (error) {
    return res.status(500).json({
  error: {
    message: error?.message || "Server error",
    stack: error?.stack || null
  }
});
}
}
