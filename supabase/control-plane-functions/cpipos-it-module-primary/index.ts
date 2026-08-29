import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

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

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function authorizeItAdmin(admin: ReturnType<typeof createClient>, token: string) {
  const { data: userResult, error: userError } = await admin.auth.getUser(token);
  if (userError || !userResult.user) return null;
  const { data: profile, error: profileError } = await admin
    .from("users_profiles")
    .select("id,platform_role,is_active")
    .eq("id", userResult.user.id)
    .maybeSingle();
  if (profileError || !profile?.is_active || profile.platform_role !== "it_admin") return null;
  return userResult.user.id;
}

async function exactCount(query: PromiseLike<{ count: number | null; error: { message?: string } | null }>, code: string) {
  const result = await query;
  if (result.error) throw new Error(`${code}:${result.error.message ?? "query_failed"}`);
  return result.count ?? 0;
}

function moduleResponse(module: string, summary: Record<string, number | string>, rows: unknown[], note?: string) {
  return json({ plane: "primary", module, checked_at: new Date().toISOString(), summary, rows, note: note ?? null });
}

Deno.serve(async (req) => {
  if (req.method !== "GET" && req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const token = bearerToken(req);
  if (!token) return json({ error: "unauthorized" }, 401);

  try {
    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const admin = createClient(url, readAdminKey(), { auth: { persistSession: false, autoRefreshToken: false } });
    if (!(await authorizeItAdmin(admin, token))) return json({ error: "forbidden" }, 403);

    const requestUrl = new URL(req.url);
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const module = text(asRecord(body).module || requestUrl.searchParams.get("module")).trim().toLowerCase();

    if (module === "tenants") {
      const [tenantResult, codeResult, branchResult, deviceResult, packageResult] = await Promise.all([
        admin.from("tenants").select("id,code,name,package_id,is_active,updated_at").order("created_at", { ascending: true }),
        admin.from("tenant_access_codes").select("tenant_id,access_code,is_active").eq("is_active", true),
        admin.from("branches").select("tenant_id,is_active"),
        admin.from("branch_devices").select("tenant_id,status,is_active"),
        admin.from("subscription_packages").select("id,code,name")
      ]);
      for (const result of [tenantResult, codeResult, branchResult, deviceResult, packageResult]) if (result.error) throw result.error;
      const codes = new Map((codeResult.data ?? []).map((row) => [String(row.tenant_id), String(row.access_code)]));
      const packages = new Map((packageResult.data ?? []).map((row) => [String(row.id), row]));
      const branchCounts = new Map<string, number>();
      const deviceCounts = new Map<string, number>();
      for (const row of branchResult.data ?? []) branchCounts.set(String(row.tenant_id), (branchCounts.get(String(row.tenant_id)) ?? 0) + 1);
      for (const row of deviceResult.data ?? []) deviceCounts.set(String(row.tenant_id), (deviceCounts.get(String(row.tenant_id)) ?? 0) + 1);
      const rows = (tenantResult.data ?? []).map((row) => {
        const pkg = row.package_id ? packages.get(String(row.package_id)) : null;
        return {
          id: row.id,
          store_code: codes.get(String(row.id)) ?? "—",
          name: row.name,
          internal_code: row.code,
          package: pkg?.name ?? "—",
          branches: branchCounts.get(String(row.id)) ?? 0,
          devices: deviceCounts.get(String(row.id)) ?? 0,
          status: row.is_active ? "Active" : "Inactive",
          updated_at: row.updated_at
        };
      });
      return moduleResponse("tenants", {
        total: rows.length,
        active: rows.filter((row) => row.status === "Active").length,
        inactive: rows.filter((row) => row.status !== "Active").length,
        branches: Array.from(branchCounts.values()).reduce((a, b) => a + b, 0),
        devices: Array.from(deviceCounts.values()).reduce((a, b) => a + b, 0)
      }, rows);
    }

    if (module === "branches") {
      const [branchResult, tenantResult, deviceResult] = await Promise.all([
        admin.from("branches").select("id,tenant_id,code,name,address,is_active,updated_at").order("created_at", { ascending: true }),
        admin.from("tenants").select("id,code,name"),
        admin.from("branch_devices").select("branch_id,last_seen_at,status,is_active")
      ]);
      for (const result of [branchResult, tenantResult, deviceResult]) if (result.error) throw result.error;
      const tenants = new Map((tenantResult.data ?? []).map((row) => [String(row.id), row]));
      const byBranch = new Map<string, { count: number; latest: string | null }>();
      for (const row of deviceResult.data ?? []) {
        const key = String(row.branch_id);
        const current = byBranch.get(key) ?? { count: 0, latest: null };
        current.count += 1;
        if (row.last_seen_at && (!current.latest || String(row.last_seen_at) > current.latest)) current.latest = String(row.last_seen_at);
        byBranch.set(key, current);
      }
      const rows = (branchResult.data ?? []).map((row) => ({
        id: row.id,
        tenant: tenants.get(String(row.tenant_id))?.name ?? "—",
        tenant_code: tenants.get(String(row.tenant_id))?.code ?? "—",
        code: row.code,
        name: row.name,
        devices: byBranch.get(String(row.id))?.count ?? 0,
        last_seen_at: byBranch.get(String(row.id))?.latest ?? null,
        status: row.is_active ? "Active" : "Inactive"
      }));
      return moduleResponse("branches", {
        total: rows.length,
        active: rows.filter((row) => row.status === "Active").length,
        inactive: rows.filter((row) => row.status !== "Active").length,
        devices: Array.from(byBranch.values()).reduce((sum, item) => sum + item.count, 0)
      }, rows);
    }

    if (module === "users") {
      const result = await admin.from("users_profiles").select("id,email,full_name,platform_role,is_active,updated_at").order("created_at", { ascending: true });
      if (result.error) throw result.error;
      const rows = (result.data ?? []).map((row) => ({
        id: row.id,
        name: row.full_name || "—",
        email: row.email || "—",
        role: row.platform_role || "tenant_user",
        status: row.is_active ? "Active" : "Inactive",
        updated_at: row.updated_at
      }));
      return moduleResponse("users", {
        total: rows.length,
        active: rows.filter((row) => row.status === "Active").length,
        it_admin: rows.filter((row) => row.role === "it_admin").length,
        inactive: rows.filter((row) => row.status !== "Active").length
      }, rows, "Sensitive credential and PIN fields are intentionally excluded.");
    }

    if (module === "packages" || module === "provisioning") {
      const [packageResult, featureResult] = await Promise.all([
        admin.from("subscription_packages").select("id,code,name,monthly_price,yearly_price,max_branches,max_devices,max_users,quota_mode,status,is_active,display_order").order("display_order", { ascending: true }),
        admin.from("subscription_package_features").select("package_id,feature_code,included")
      ]);
      if (packageResult.error) throw packageResult.error;
      if (featureResult.error) throw featureResult.error;
      const featureCounts = new Map<string, number>();
      for (const row of featureResult.data ?? []) if (row.included) featureCounts.set(String(row.package_id), (featureCounts.get(String(row.package_id)) ?? 0) + 1);
      const rows = (packageResult.data ?? []).map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        monthly_price: numberValue(row.monthly_price),
        yearly_price: numberValue(row.yearly_price),
        max_branches: row.max_branches ?? 0,
        max_devices: row.max_devices ?? 0,
        max_users: row.max_users ?? 0,
        quota_mode: row.quota_mode ?? "standard",
        features: featureCounts.get(String(row.id)) ?? 0,
        status: row.is_active && row.status === "active" ? "Active" : String(row.status ?? "Inactive")
      }));
      return moduleResponse(module, {
        total: rows.length,
        active: rows.filter((row) => row.status === "Active").length,
        features: Array.from(featureCounts.values()).reduce((a, b) => a + b, 0)
      }, rows);
    }

    if (module === "entitlements") {
      const [catalogResult, tenantResult] = await Promise.all([
        admin.from("package_feature_catalog").select("code,name,description,included_by_default,is_active,default_monthly_price").order("code", { ascending: true }),
        admin.from("tenant_feature_subscriptions").select("tenant_id,feature_code,is_enabled")
      ]);
      if (catalogResult.error) throw catalogResult.error;
      if (tenantResult.error) throw tenantResult.error;
      const enabled = new Map<string, Set<string>>();
      for (const row of tenantResult.data ?? []) {
        if (!row.is_enabled) continue;
        const code = String(row.feature_code);
        const set = enabled.get(code) ?? new Set<string>();
        set.add(String(row.tenant_id));
        enabled.set(code, set);
      }
      const rows = (catalogResult.data ?? []).map((row) => ({
        code: row.code,
        name: row.name,
        description: row.description || "—",
        default: row.included_by_default ? "Included" : "Optional",
        enabled_tenants: enabled.get(String(row.code))?.size ?? 0,
        monthly_price: numberValue(row.default_monthly_price),
        status: row.is_active ? "Active" : "Inactive"
      }));
      return moduleResponse("entitlements", {
        total: rows.length,
        active: rows.filter((row) => row.status === "Active").length,
        enabled_links: (tenantResult.data ?? []).filter((row) => row.is_enabled).length
      }, rows);
    }

    if (module === "android") {
      const [deviceResult, tenantResult, branchResult] = await Promise.all([
        admin.from("branch_devices").select("id,tenant_id,branch_id,device_code,device_name,status,last_seen_at,metadata").order("created_at", { ascending: true }),
        admin.from("tenants").select("id,name"),
        admin.from("branches").select("id,name")
      ]);
      for (const result of [deviceResult, tenantResult, branchResult]) if (result.error) throw result.error;
      const tenants = new Map((tenantResult.data ?? []).map((row) => [String(row.id), row.name]));
      const branches = new Map((branchResult.data ?? []).map((row) => [String(row.id), row.name]));
      const rows = (deviceResult.data ?? []).map((row) => {
        const meta = asRecord(row.metadata);
        const runtime = asRecord(meta.android_mdm_runtime);
        const update = asRecord(meta.android_mdm_update_state);
        const appVersion = text(meta.android_mdm_app_version) || text(runtime.version_name);
        const pairedAt = text(meta.android_mdm_paired_at);
        const lastSeen = text(meta.android_mdm_last_seen_at) || text(row.last_seen_at);
        const packageName = text(runtime.package) || text(meta.android_package);
        if (!appVersion && !pairedAt && !packageName) return null;
        return {
          id: row.id,
          tenant: tenants.get(String(row.tenant_id)) ?? "—",
          branch: branches.get(String(row.branch_id)) ?? "—",
          device: row.device_name || row.device_code,
          device_code: row.device_code,
          app_version: appVersion || "—",
          channel: text(update.channel) || text(runtime.update_channel) || "—",
          update_status: text(update.status) || "—",
          paired_at: pairedAt || null,
          last_seen_at: lastSeen || null,
          status: row.status
        };
      }).filter((row): row is NonNullable<typeof row> => Boolean(row));
      return moduleResponse("android", {
        total: rows.length,
        active: rows.filter((row) => row.status === "active").length,
        update_available: rows.filter((row) => row.update_status === "available").length
      }, rows, "Only curated Android MDM fields are returned; raw device metadata is not exposed.");
    }

    if (module === "printer") {
      const [printerResult, agentResult, tenantResult, branchResult] = await Promise.all([
        admin.from("printer_devices").select("id,tenant_id,branch_id,display_name,brand,model,connection_mode,paper_width_mm,status,last_seen_at,is_active").order("created_at", { ascending: true }),
        admin.from("print_agents").select("id,tenant_id,branch_id,agent_name,status,last_seen_at,app_version").order("created_at", { ascending: true }),
        admin.from("tenants").select("id,name"),
        admin.from("branches").select("id,name")
      ]);
      for (const result of [printerResult, agentResult, tenantResult, branchResult]) if (result.error) throw result.error;
      const tenants = new Map((tenantResult.data ?? []).map((row) => [String(row.id), row.name]));
      const branches = new Map((branchResult.data ?? []).map((row) => [String(row.id), row.name]));
      const printerRows = (printerResult.data ?? []).map((row) => ({
        id: `printer:${row.id}`,
        kind: "Printer",
        tenant: tenants.get(String(row.tenant_id)) ?? "—",
        branch: branches.get(String(row.branch_id)) ?? "—",
        name: row.display_name,
        model: [row.brand, row.model].filter(Boolean).join(" ") || "—",
        connection: row.connection_mode || "—",
        version: row.paper_width_mm ? `${row.paper_width_mm} mm` : "—",
        status: row.is_active ? row.status : "inactive",
        last_seen_at: row.last_seen_at
      }));
      const agentRows = (agentResult.data ?? []).map((row) => ({
        id: `agent:${row.id}`,
        kind: "Print Agent",
        tenant: tenants.get(String(row.tenant_id)) ?? "—",
        branch: branches.get(String(row.branch_id)) ?? "—",
        name: row.agent_name,
        model: "Agent",
        connection: "Runtime",
        version: row.app_version || "—",
        status: row.status,
        last_seen_at: row.last_seen_at
      }));
      const rows = [...printerRows, ...agentRows];
      return moduleResponse("printer", {
        total: rows.length,
        printers: printerRows.length,
        agents: agentRows.length,
        active: rows.filter((row) => String(row.status).toLowerCase() === "active").length
      }, rows);
    }

    if (module === "monitoring") {
      const windowSince = new Date(Date.now() - 60 * 60_000).toISOString();
      const staleSince = new Date(Date.now() - 20 * 60_000).toISOString();
      const [branchResult, tenantResult] = await Promise.all([
        admin.from("branches").select("id,tenant_id,code,name").eq("is_active", true).order("name", { ascending: true }).limit(250),
        admin.from("tenants").select("id,code,name")
      ]);
      if (branchResult.error) throw branchResult.error;
      if (tenantResult.error) throw tenantResult.error;
      const tenants = new Map((tenantResult.data ?? []).map((row) => [String(row.id), row]));
      const rows = await Promise.all((branchResult.data ?? []).map(async (branch) => {
        const tenantId = String(branch.tenant_id);
        const branchId = String(branch.id);
        const [queued, stale, printQueue, deadLetters, perfResult] = await Promise.all([
          exactCount(admin.from("orders").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("branch_id", branchId).eq("status", "queued"), "monitor_queued_failed"),
          exactCount(admin.from("orders").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("branch_id", branchId).eq("status", "queued").lt("created_at", staleSince), "monitor_stale_failed"),
          exactCount(admin.from("print_jobs").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("branch_id", branchId).in("status", ["pending", "printing", "retrying"]), "monitor_print_failed"),
          exactCount(admin.from("audit_logs").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("branch_id", branchId).in("action", ["pos_order_dead_letter", "pos_payment_dead_letter", "pos_print_dead_letter"]).gt("created_at", windowSince), "monitor_dead_letter_failed"),
          admin.from("audit_logs").select("metadata").eq("tenant_id", tenantId).eq("branch_id", branchId).eq("action", "pos_route_perf").gt("created_at", windowSince).order("created_at", { ascending: false }).limit(300)
        ]);
        if (perfResult.error) throw perfResult.error;
        let apiErrors = 0;
        let api5xx = 0;
        for (const entry of perfResult.data ?? []) {
          const metadata = asRecord(entry.metadata);
          const statusCode = numberValue(metadata.status_code);
          if (statusCode >= 400 && statusCode <= 599) apiErrors += 1;
          if (statusCode >= 500 && statusCode <= 599) api5xx += 1;
        }
        const level = api5xx >= 3 ? "Critical" : stale > 0 || deadLetters > 0 || apiErrors > 0 ? "Warning" : "OK";
        const tenant = tenants.get(tenantId);
        return {
          id: branchId,
          store: tenant?.name ?? tenant?.code ?? "—",
          branch: branch.name,
          level,
          queued_orders: queued,
          stale_orders: stale,
          print_queue: printQueue,
          dead_letters: deadLetters,
          api_errors: apiErrors,
          api_5xx: api5xx
        };
      }));
      return moduleResponse("monitoring", {
        branches: rows.length,
        queued_orders: rows.reduce((sum, row) => sum + row.queued_orders, 0),
        api_errors: rows.reduce((sum, row) => sum + row.api_errors, 0),
        warnings: rows.filter((row) => row.level === "Warning").length,
        critical: rows.filter((row) => row.level === "Critical").length
      }, rows, "60-minute read-only Control Plane view. No synthetic health is generated.");
    }

    if (module === "audit") {
      const result = await admin.from("audit_logs").select("id,actor_role,action,target_type,target_id,module,created_at").order("created_at", { ascending: false }).limit(80);
      if (result.error) throw result.error;
      const rows = (result.data ?? []).map((row) => ({
        id: row.id,
        action: row.action,
        module: row.module || "—",
        target: [row.target_type, row.target_id].filter(Boolean).join(" · ") || "—",
        actor: row.actor_role || "—",
        created_at: row.created_at
      }));
      return moduleResponse("audit", { recent: rows.length }, rows, "Recent audit rows only; before/after payloads and sensitive metadata are not returned.");
    }

    return json({ error: "unknown_module" }, 404);
  } catch (error) {
    console.error("[cpipos-it-module-primary] failed", error instanceof Error ? error.message : "unknown_error");
    return json({ error: "primary_module_unavailable" }, 503);
  }
});