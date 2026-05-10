import { getAuthorizedClientUser } from "./_clientAuth.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "https://verify.thereadymarkgroup.com");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const authResult = await getAuthorizedClientUser(req);

    if (authResult.error) {
      return res.status(authResult.status || 401).json({ error: authResult.error });
    }

    const { user, clientUser, adminClient } = authResult;
    const { new_password } = req.body || {};

    if (!new_password || String(new_password).trim().length < 8) {
      return res.status(400).json({
        error: "New password must be at least 8 characters."
      });
    }

    const password = String(new_password).trim();

    const { error: passwordError } = await adminClient.auth.admin.updateUserById(user.id, {
      password
    });

    if (passwordError) {
      return res.status(500).json({ error: passwordError.message });
    }

    const { error: updateError } = await adminClient
      .from("client_users")
      .update({ must_change_password: false })
      .eq("email", clientUser.email);

    if (updateError) {
      return res.status(500).json({ error: updateError.message });
    }

    return res.status(200).json({
      success: true,
      message: "Password updated successfully."
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Unable to update password."
    });
  }
}
