import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const PRIMARY_URL = "https://deejlitaivfnsbwqdugy.supabase.co";
const PRIMARY_PUBLISHABLE_KEY = "sb_publishable_nGX5abZtEmd7Ynzyofop1A_caORaUII";
const ONLINE_WINDOW_MINUTES = 5;
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

function bearerToken(req: Request) {
  const value = req.headers.get("authorization") ?? "";
  return value.toLowerCase().startsWith("bearer ") ? value.slice(7).trim() : "";
}

async function exactCount(query: PromiseLike<{ count: number | null; error: { code?: string; message?: string } | null }>, code: string) {
  const result = await query;
  if (result.error) throw new Error(`${code}:${result.error.code ?? "query_failed"}`);
  return result.count ?? 0;
}

async function authorizePrimaryItAdmin(token: string) {
  const primary = createClient(PRIMARY_URL, PRIMARY_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } }
  });
  const { data: userResult, error: userError } = await primary.auth.getUser(token);
  if (userError || !userResult.user) return false;

  const { data: profile, error: profileError } = await primary
    .from("users_profiles")
    .select("platform_role,is_active")
    .eq("id", userResult.user.id)
    .maybeSingle();
  if (profileError) return false;
  return Boolean(profile?.is_active && profile.platform_role === "it_admin");
}

Deno.serve(async (req) => {
  if (req.method !== "GET" && req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const token = bearerToken(req);
  if (!token) return json({ error: "unauthorized" }, 401);

  try {
    if (!(await authorizePrimaryItAdmin(token))) return json({ error: "forbidden" }, 403);

    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const admin = createClient(url, readAdminKey(), { auth: { persistSession: false, autoRefreshToken: false } });
    const onlineSinceMs = Date.now() - ONLINE_WINDOW_MINUTES * 60_000;

    const [deviceRowsResult, deviceTotal, incidentsOpen, incidentsCritical, commandsPending, databaseResult] = await Promise.all([
      admin
        .from("it_devices")
        .select("tenant_id,last_seen_at")
        .order("last_seen_at", { ascending: false, nullsFirst: false })
        .limit(1000),
      exactCount(admin.from("it_devices").select("id", { count: "exact", head: true }), "device_total_failed"),
      exactCount(admin.from("it_device_incidents").select("id", { count: "exact", head: true }).is("resolved_at", null), "incident_open_failed"),
      exactCount(
        admin.from("it_device_incidents").select("id", { count: "exact", head: true }).is("resolved_at", null).eq("severity", "critical"),
        "incident_critical_failed"
      ),
      exactCount(
        admin.from("it_device_commands").select("id", { count: "exact", head: true }).in("status", ["queued", "pending", "delivered"]),
        "command_pending_failed"
      ),
      admin.rpc("get_it_database_metrics")
    ]);

    if (deviceRowsResult.error) throw new Error(`device_seen_failed:${deviceRowsResult.error.code ?? "query_failed"}`);
    if (databaseResult.error) throw new Error(`database_metrics_failed:${databaseResult.error.code ?? "rpc_failed"}`);

    const onlineTenants = new Set<string>();
    let onlineDevices = 0;
    let latestSeenAt: string | null = null;
    let latestSeenMs = 0;

    for (const row of deviceRowsResult.data ?? []) {
      const tenantId = typeof row.tenant_id === "string" ? row.tenant_id.trim() : "";
      const seenAt = typeof row.last_seen_at === "string" ? row.last_seen_at : null;
      const seenMs = seenAt ? new Date(seenAt).getTime() : Number.NaN;
      if (Number.isFinite(seenMs) && seenMs > latestSeenMs) {
        latestSeenMs = seenMs;
        latestSeenAt = seenAt;
      }
      if (!tenantId || !Number.isFinite(seenMs) || seenMs < onlineSinceMs) continue;
      onlineDevices += 1;
      onlineTenants.add(tenantId);
    }

    return json({
      plane: "operational",
      checked_at: new Date().toISOString(),
      online_window_minutes: ONLINE_WINDOW_MINUTES,
      devices: {
        total: deviceTotal,
        online: onlineDevices,
        stores_online: onlineTenants.size,
        latest_seen_at: latestSeenAt
      },
      operations: {
        open_incidents: incidentsOpen,
        critical_incidents: incidentsCritical,
        pending_commands: commandsPending
      },
      database: databaseResult.data
    });
  } catch (error) {
    console.error("[cpipos-it-dashboard-operational] failed", error instanceof Error ? error.message : "unknown_error");
    return json({ error: "operational_metrics_unavailable" }, 503);
  }
});
