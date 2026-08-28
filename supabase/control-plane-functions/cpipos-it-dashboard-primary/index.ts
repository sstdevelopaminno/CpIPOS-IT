import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function readAdminKey() {
  const secretSet = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (secretSet) {
    try {
      const parsed = JSON.parse(secretSet) as Record<string, string>;
      if (parsed.default) return parsed.default;
    } catch {
      // Fall through to the legacy built-in key.
    }
  }
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  throw new Error("admin_key_missing");
}

function readPublicKey() {
  const legacy = Deno.env.get("SUPABASE_ANON_KEY");
  if (legacy) return legacy;
  const publishableSet = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  if (publishableSet) {
    const parsed = JSON.parse(publishableSet) as Record<string, string>;
    if (parsed.default) return parsed.default;
  }
  throw new Error("public_key_missing");
}

function bearerToken(req: Request) {
  const value = req.headers.get("authorization") ?? "";
  return value.toLowerCase().startsWith("bearer ") ? value.slice(7).trim() : "";
}

async function exactCount(query: PromiseLike<{ count: number | null; error: { code?: string; message?: string } | null }>, code: string) {
  const result = await query;
  if (result.error) throw new Error(`${code}:${result.error.code ?? "query_failed"}`);
  return result.count ?? 0;
}

function summarizeApiPerf(rows: Array<{ metadata?: Record<string, unknown> | null }>) {
  let total = 0;
  let http4xx = 0;
  let http5xx = 0;
  const routes = new Map<string, number>();

  for (const row of rows) {
    const metadata = row.metadata ?? {};
    const status = Number(metadata.status_code);
    if (!Number.isFinite(status) || status < 400 || status > 599) continue;
    total += 1;
    if (status >= 500) http5xx += 1;
    else http4xx += 1;
    const raw = typeof metadata.route === "string" ? metadata.route.trim() : "";
    const route = raw.startsWith("/") ? raw.slice(0, 120) : "unknown";
    routes.set(route, (routes.get(route) ?? 0) + 1);
  }

  return {
    total,
    http_4xx: http4xx,
    http_5xx: http5xx,
    top_routes: [...routes.entries()]
      .map(([route, count]) => ({ route, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
  };
}

Deno.serve(async (req) => {
  if (req.method !== "GET" && req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const token = bearerToken(req);
  if (!token) return json({ error: "unauthorized" }, 401);

  try {
    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const userClient = createClient(url, readPublicKey(), { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: userResult, error: userError } = await userClient.auth.getUser(token);
    if (userError || !userResult.user) return json({ error: "unauthorized" }, 401);

    const admin = createClient(url, readAdminKey(), { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: profile, error: profileError } = await admin
      .from("users_profiles")
      .select("platform_role,is_active")
      .eq("id", userResult.user.id)
      .maybeSingle();
    if (profileError) throw new Error(`profile_lookup_failed:${profileError.code ?? "query_failed"}`);
    if (!profile?.is_active || profile.platform_role !== "it_admin") return json({ error: "forbidden" }, 403);

    const perfSince = new Date(Date.now() - 60 * 60_000).toISOString();
    const [total, open, closed, databaseResult, perfResult] = await Promise.all([
      exactCount(admin.from("tenants").select("id", { count: "exact", head: true }), "store_total_failed"),
      exactCount(admin.from("tenants").select("id", { count: "exact", head: true }).eq("is_active", true), "store_open_failed"),
      exactCount(admin.from("tenants").select("id", { count: "exact", head: true }).eq("is_active", false), "store_closed_failed"),
      admin.rpc("get_it_database_metrics"),
      admin
        .from("audit_logs")
        .select("metadata")
        .eq("action", "pos_route_perf")
        .gte("created_at", perfSince)
        .order("created_at", { ascending: false })
        .limit(500)
    ]);

    if (databaseResult.error) throw new Error(`database_metrics_failed:${databaseResult.error.code ?? "rpc_failed"}`);
    if (perfResult.error) throw new Error(`api_perf_failed:${perfResult.error.code ?? "query_failed"}`);

    return json({
      plane: "business",
      checked_at: new Date().toISOString(),
      stores: { total, open, closed },
      database: databaseResult.data,
      api_errors_60m: summarizeApiPerf(perfResult.data ?? [])
    });
  } catch (error) {
    console.error("[cpipos-it-dashboard-primary] failed", error instanceof Error ? error.message : "unknown_error");
    return json({ error: "primary_metrics_unavailable" }, 503);
  }
});
