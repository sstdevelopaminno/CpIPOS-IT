import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const PRIMARY_URL = "https://deejlitaivfnsbwqdugy.supabase.co";
const PRIMARY_PUBLISHABLE_KEY = "sb_publishable_nGX5abZtEmd7Ynzyofop1A_caORaUII";
const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function bearerToken(req: Request) {
  const value = req.headers.get("authorization") ?? "";
  return value.toLowerCase().startsWith("bearer ") ? value.slice(7).trim() : "";
}

function readAdminKey() {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  const secretSet = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (secretSet) {
    try {
      const parsed = JSON.parse(secretSet) as Record<string, string>;
      if (parsed.default) return parsed.default;
    } catch {
      // Ignore malformed built-in key set.
    }
  }
  throw new Error("admin_key_missing");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown) {
  return typeof value === "string" ? value : "";
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
  return !profileError && Boolean(profile?.is_active && profile.platform_role === "it_admin");
}

function moduleResponse(module: string, summary: Record<string, number | string>, rows: unknown[], note?: string) {
  return json({ plane: "operational", module, checked_at: new Date().toISOString(), summary, rows, note: note ?? null });
}

Deno.serve(async (req) => {
  if (req.method !== "GET" && req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const token = bearerToken(req);
  if (!token) return json({ error: "unauthorized" }, 401);

  try {
    if (!(await authorizePrimaryItAdmin(token))) return json({ error: "forbidden" }, 403);
    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const admin = createClient(url, readAdminKey(), { auth: { persistSession: false, autoRefreshToken: false } });
    const requestUrl = new URL(req.url);
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const module = text(asRecord(body).module || requestUrl.searchParams.get("module")).trim().toLowerCase();

    if (module === "devices") {
      const [deviceResult, healthResult, tenantResult, branchResult] = await Promise.all([
        admin.from("it_devices").select("id,tenant_id,branch_id,device_code,device_name,device_type,status,is_locked,is_active,last_seen_at,synced_at").order("source_created_at", { ascending: true }),
        admin.from("it_device_health_latest").select("pos_device_id,status,hostname,runtime_version,app_version,last_error,last_seen_at"),
        admin.from("it_tenants").select("id,name"),
        admin.from("it_branches").select("id,name")
      ]);
      for (const result of [deviceResult, healthResult, tenantResult, branchResult]) if (result.error) throw result.error;
      const tenants = new Map((tenantResult.data ?? []).map((row) => [String(row.id), row.name]));
      const branches = new Map((branchResult.data ?? []).map((row) => [String(row.id), row.name]));
      const health = new Map((healthResult.data ?? []).map((row) => [String(row.pos_device_id), row]));
      const rows = (deviceResult.data ?? []).map((row) => {
        const latest = health.get(String(row.id));
        return {
          id: row.id,
          tenant: tenants.get(String(row.tenant_id)) ?? "—",
          branch: branches.get(String(row.branch_id)) ?? "—",
          device: row.device_name || row.device_code,
          device_code: row.device_code,
          type: row.device_type,
          registry_status: row.status,
          health: latest?.status ?? "Not reported",
          app_version: latest?.app_version ?? "—",
          runtime_version: latest?.runtime_version ?? "—",
          hostname: latest?.hostname ?? "—",
          last_error: latest?.last_error ?? "—",
          last_seen_at: latest?.last_seen_at ?? row.last_seen_at,
          locked: row.is_locked ? "Locked" : "Normal",
          active: row.is_active ? "Active" : "Inactive"
        };
      });
      return moduleResponse("devices", {
        total: rows.length,
        active: rows.filter((row) => row.active === "Active").length,
        health_reported: (healthResult.data ?? []).length,
        locked: rows.filter((row) => row.locked === "Locked").length
      }, rows, healthResult.data?.length ? undefined : "No CpiPOS-002 health telemetry has been reported yet; registry state is shown separately and is not treated as online health.");
    }

    if (module === "incidents") {
      const [incidentResult, tenantResult, branchResult, deviceResult] = await Promise.all([
        admin.from("it_device_incidents").select("id,tenant_id,branch_id,pos_device_id,device_code,code,severity,title,message,detected_at,resolved_at").order("detected_at", { ascending: false }).limit(100),
        admin.from("it_tenants").select("id,name"),
        admin.from("it_branches").select("id,name"),
        admin.from("it_devices").select("id,device_name,device_code")
      ]);
      for (const result of [incidentResult, tenantResult, branchResult, deviceResult]) if (result.error) throw result.error;
      const tenants = new Map((tenantResult.data ?? []).map((row) => [String(row.id), row.name]));
      const branches = new Map((branchResult.data ?? []).map((row) => [String(row.id), row.name]));
      const devices = new Map((deviceResult.data ?? []).map((row) => [String(row.id), row.device_name || row.device_code]));
      const rows = (incidentResult.data ?? []).map((row) => ({
        id: row.id,
        tenant: tenants.get(String(row.tenant_id)) ?? "—",
        branch: branches.get(String(row.branch_id)) ?? "—",
        device: devices.get(String(row.pos_device_id)) ?? row.device_code ?? "—",
        severity: row.severity,
        code: row.code,
        title: row.title,
        message: row.message,
        detected_at: row.detected_at,
        status: row.resolved_at ? "Resolved" : "Open"
      }));
      return moduleResponse("incidents", {
        recent: rows.length,
        open: rows.filter((row) => row.status === "Open").length,
        critical: rows.filter((row) => row.status === "Open" && String(row.severity).toLowerCase() === "critical").length
      }, rows, rows.length ? undefined : "No CpiPOS-002 operational incidents are currently recorded.");
    }

    return json({ error: "unknown_module" }, 404);
  } catch (error) {
    console.error("[cpipos-it-module-operational] failed", error instanceof Error ? error.message : "unknown_error");
    return json({ error: "operational_module_unavailable" }, 503);
  }
});