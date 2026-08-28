import { getPrimarySupabaseServiceClient } from "@/lib/supabase-admin";
import { getSupabaseServerClient } from "@/lib/supabase-server";

function json(body: Record<string, unknown>, status: number) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

export async function POST(request: Request) {
  let body: { email?: unknown; password?: unknown };
  try {
    body = (await request.json()) as { email?: unknown; password?: unknown };
  } catch {
    return json({ ok: false, code: "invalid_request" }, 400);
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password) {
    return json({ ok: false, code: "credentials_required" }, 422);
  }

  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    return json({ ok: false, code: "invalid_credentials" }, 401);
  }

  const primary = getPrimarySupabaseServiceClient();
  const { data: profile, error: profileError } = await primary
    .from("users_profiles")
    .select("platform_role")
    .eq("id", data.user.id)
    .maybeSingle<{ platform_role: string | null }>();

  if (profileError) {
    await supabase.auth.signOut();
    console.error("[it-admin-auth] platform role lookup failed", {
      user_id: data.user.id,
      error: profileError.message
    });
    return json({ ok: false, code: "auth_profile_lookup_failed" }, 503);
  }

  if (profile?.platform_role !== "it_admin") {
    await supabase.auth.signOut();
    return json({ ok: false, code: "not_authorized" }, 403);
  }

  return json({ ok: true }, 200);
}
