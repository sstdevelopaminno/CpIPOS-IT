import crypto from "node:crypto";
import { getPrimarySupabaseServiceClient } from "@/lib/supabase-admin";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import {
  generateItTemporaryPassword,
  sendItTemporaryPasswordEmail
} from "@/lib/services/it-admin/it-password-recovery-service";
import { enforceRateLimit } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status: number, retryAfterSeconds?: number) {
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  if (retryAfterSeconds) headers["Retry-After"] = String(retryAfterSeconds);
  return Response.json(body, { status, headers });
}

function maskEmail(email: string) {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "***";
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"*".repeat(Math.max(3, Math.min(8, local.length - visible.length)))}@${domain}`;
}

export async function POST() {
  const supabase = await getSupabaseServerClient();
  const userResult = await supabase.auth.getUser();
  const user = userResult.data.user;
  if (userResult.error || !user?.email) {
    return json({ ok: false, code: "not_authenticated" }, 401);
  }

  const profile = await supabase
    .from("users_profiles")
    .select("platform_role,is_active")
    .eq("id", user.id)
    .maybeSingle<{ platform_role: string | null; is_active: boolean | null }>();

  if (profile.error) {
    console.error("[it-password-reset-settings] profile lookup failed", {
      user_id: user.id,
      error: profile.error.message
    });
    return json({ ok: false, code: "service_unavailable" }, 503);
  }

  if (!profile.data?.is_active) {
    return json({ ok: false, code: "account_inactive" }, 403);
  }
  if (!["it_admin", "it_support"].includes(profile.data.platform_role ?? "")) {
    return json({ ok: false, code: "not_authorized" }, 403);
  }

  const limit = await enforceRateLimit({
    namespace: "it_settings_temp_password",
    key: user.id,
    max: 3,
    windowMs: 30 * 60 * 1000,
    failClosedOnBackendError: true
  });
  if (!limit.ok) {
    return json({ ok: false, code: "rate_limited" }, 429, limit.retryAfterSeconds);
  }

  const temporaryPassword = generateItTemporaryPassword();
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + 30 * 60 * 1000);
  const requestId = crypto.randomUUID();

  try {
    await sendItTemporaryPasswordEmail({
      to: user.email,
      temporaryPassword,
      expiresAt,
      requestId
    });
  } catch (error) {
    console.error("[it-password-reset-settings] temporary password email failed", {
      user_id: user.id,
      error: error instanceof Error ? error.message : "mail_failed"
    });
    return json({ ok: false, code: "email_delivery_failed" }, 503);
  }

  const admin = getPrimarySupabaseServiceClient();
  const updated = await admin.auth.admin.updateUserById(user.id, {
    password: temporaryPassword,
    app_metadata: {
      ...(user.app_metadata ?? {}),
      password_change_required: true,
      temp_password_issued_at: issuedAt.toISOString(),
      temp_password_expires_at: expiresAt.toISOString()
    }
  });
  if (updated.error) {
    console.error("[it-password-reset-settings] temporary password activation failed", {
      user_id: user.id,
      error: updated.error.message
    });
    return json({ ok: false, code: "password_reset_failed" }, 503);
  }

  return json({
    ok: true,
    code: "temporary_password_sent",
    masked_email: maskEmail(user.email)
  }, 200);
}
