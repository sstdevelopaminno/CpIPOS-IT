import { getPrimarySupabaseServiceClient } from "@/lib/supabase-admin";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { enforceRateLimit } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status: number, retryAfterSeconds?: number) {
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  if (retryAfterSeconds) headers["Retry-After"] = String(retryAfterSeconds);
  return Response.json(body, { status, headers });
}

function strongEnough(password: string) {
  return password.length >= 12 &&
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /\d/.test(password) &&
    /[^A-Za-z0-9]/.test(password);
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as {
    current_password?: unknown;
    new_password?: unknown;
  } | null;
  const currentPassword = typeof body?.current_password === "string" ? body.current_password : "";
  const newPassword = typeof body?.new_password === "string" ? body.new_password : "";

  if (!currentPassword || !newPassword) {
    return json({ ok: false, code: "passwords_required" }, 422);
  }
  if (currentPassword === newPassword) {
    return json({ ok: false, code: "password_unchanged" }, 422);
  }
  if (!strongEnough(newPassword)) {
    return json({ ok: false, code: "weak_password" }, 422);
  }

  const supabase = await getSupabaseServerClient();
  const userResult = await supabase.auth.getUser();
  const user = userResult.data.user;
  if (userResult.error || !user?.email) {
    return json({ ok: false, code: "not_authenticated" }, 401);
  }

  const limit = await enforceRateLimit({
    namespace: "it_change_password",
    key: user.id,
    max: 8,
    windowMs: 15 * 60 * 1000,
    failClosedOnBackendError: true
  });
  if (!limit.ok) {
    return json({ ok: false, code: "rate_limited" }, 429, limit.retryAfterSeconds);
  }

  const verified = await supabase.auth.signInWithPassword({
    email: user.email,
    password: currentPassword
  });
  if (verified.error || !verified.data.user || verified.data.user.id !== user.id) {
    return json({ ok: false, code: "current_password_invalid" }, 401);
  }

  const changed = await supabase.auth.updateUser({ password: newPassword });
  if (changed.error) {
    console.error("[it-change-password] auth update failed", { user_id: user.id, error: changed.error.message });
    return json({ ok: false, code: "password_update_failed" }, 503);
  }

  const admin = getPrimarySupabaseServiceClient();
  const metadata = changed.data.user?.app_metadata ?? user.app_metadata ?? {};
  const cleared = await admin.auth.admin.updateUserById(user.id, {
    app_metadata: {
      ...metadata,
      password_change_required: false,
      temp_password_issued_at: null,
      temp_password_expires_at: null
    }
  });
  if (cleared.error) {
    console.error("[it-change-password] reset metadata cleanup failed", { user_id: user.id, error: cleared.error.message });
  }

  return json({ ok: true }, 200);
}
