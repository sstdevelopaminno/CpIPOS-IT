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

  // Use the authenticated session that was just created to read the caller's
  // own profile. users_profiles RLS explicitly permits id = auth.uid(), so the
  // login path does not need a service-role client merely to authorize IT Admin.
  const { data: profile, error: profileError } = await supabase
    .from("users_profiles")
    .select("platform_role,is_active")
    .eq("id", data.user.id)
    .maybeSingle<{ platform_role: string | null; is_active: boolean | null }>();

  if (profileError) {
    await supabase.auth.signOut();
    console.error("[it-admin-auth] own profile lookup failed", {
      user_id: data.user.id,
      error: profileError.message
    });
    return json({ ok: false, code: "auth_profile_lookup_failed" }, 503);
  }

  if (!profile?.is_active || profile.platform_role !== "it_admin") {
    await supabase.auth.signOut();
    return json({ ok: false, code: "not_authorized" }, 403);
  }

  return json({ ok: true }, 200);
}
