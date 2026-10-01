import crypto from "node:crypto";
import { getPrimarySupabaseServiceClient } from "@/lib/supabase-admin";
import { customerEmailProblem } from "@/lib/services/it-admin/customer-email-service";
import {
  generateItTemporaryPassword,
  sendItTemporaryPasswordEmail
} from "@/lib/services/it-admin/it-password-recovery-service";
import { enforceRateLimit, getClientIpAddress } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status: number, retryAfterSeconds?: number) {
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  if (retryAfterSeconds) headers["Retry-After"] = String(retryAfterSeconds);
  return Response.json(body, { status, headers });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { email?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || customerEmailProblem(email)) {
    return json({ ok: false, code: "invalid_email" }, 422);
  }

  const ipLimit = await enforceRateLimit({
    namespace: "it_forgot_password_ip",
    key: getClientIpAddress(request),
    max: 5,
    windowMs: 15 * 60 * 1000,
    failClosedOnBackendError: true
  });
  if (!ipLimit.ok) {
    return json({ ok: false, code: "rate_limited" }, 429, ipLimit.retryAfterSeconds);
  }

  const accountLimit = await enforceRateLimit({
    namespace: "it_forgot_password_account",
    key: email,
    max: 3,
    windowMs: 30 * 60 * 1000,
    failClosedOnBackendError: true
  });
  if (!accountLimit.ok) {
    return json({ ok: false, code: "rate_limited" }, 429, accountLimit.retryAfterSeconds);
  }

  const admin = getPrimarySupabaseServiceClient();
  const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listed.error) {
    console.error("[it-password-reset] auth user lookup failed", { error: listed.error.message });
    return json({ ok: false, code: "service_unavailable" }, 503);
  }

  const user = listed.data.users.find((candidate) => candidate.email?.trim().toLowerCase() === email);
  if (!user) {
    return json({ ok: true, code: "reset_requested" }, 200);
  }

  const profile = await admin
    .from("users_profiles")
    .select("platform_role,is_active")
    .eq("id", user.id)
    .maybeSingle<{ platform_role: string | null; is_active: boolean | null }>();
  if (profile.error) {
    console.error("[it-password-reset] profile lookup failed", { user_id: user.id, error: profile.error.message });
    return json({ ok: false, code: "service_unavailable" }, 503);
  }

  if (!profile.data?.is_active) {
    return json({ ok: false, code: "account_inactive" }, 403);
  }

  if (!["it_admin", "it_support"].includes(profile.data.platform_role ?? "")) {
    return json({ ok: false, code: "not_authorized" }, 403);
  }

  const temporaryPassword = generateItTemporaryPassword();
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + 30 * 60 * 1000);
  const requestId = crypto.randomUUID();

  try {
    await sendItTemporaryPasswordEmail({
      to: email,
      temporaryPassword,
      expiresAt,
      requestId
    });
  } catch (error) {
    console.error("[it-password-reset] temporary password email failed", {
      user_id: user.id,
      error: error instanceof Error ? error.message : "mail_failed"
    });
    return json({ ok: false, code: "email_delivery_failed" }, 503);
  }

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
    console.error("[it-password-reset] temporary password activation failed", {
      user_id: user.id,
      error: updated.error.message
    });
    return json({ ok: false, code: "password_reset_failed" }, 503);
  }

  return json({ ok: true, code: "temporary_password_sent" }, 200);
}
