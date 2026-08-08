import "server-only";

import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { readRequiredEnv } from "@/lib/env";

// This module is intentionally a dynamic adapter. Supabase's generated fluent
// builder types cannot express a runtime-selected project, so `any` is contained
// at this boundary only. `supabase-admin.ts` exposes the normal Supabase client
// surface to the rest of the application.
type DynamicClient = any;
type DataHome = "primary" | "trial" | "archive";
type QueryCall = { method: string; args: unknown[] };
type RouteHint = { tenantId: string | null; branchId: string | null };
type LifecycleRow = { data_home: DataHome; lifecycle_status: string; routing_version: number | null };
type PosSessionRouteRow = {
  id: string;
  tenant_id: string;
  branch_id: string;
  user_id: string;
  device_code: string | null;
  shift_id: string | null;
  status: string;
  issued_at: string;
  expires_at: string;
};
type ObjectRoute = { tenant_id: string; branch_id: string | null };
type CacheEntry<T> = { value: T; expiresAt: number };

const BUSINESS_TABLES = new Set([
  "branch_inventory_settings",
  "tenant_tax_settings",
  "product_categories",
  "products",
  "product_combo_items",
  "ingredients",
  "ingredient_packages",
  "recipes",
  "stock_movements",
  "table_zones",
  "dining_tables",
  "table_layout_objects",
  "table_bill_sessions",
  "table_qr_sessions",
  "table_qr_orders",
  "orders",
  "order_items",
  "payments",
  "transfer_payment_verifications"
]);

const BUSINESS_RPCS = new Set([
  "next_pos_order_no",
  "create_pos_order_tx",
  "complete_pos_payment_tx",
  "submit_table_qr_order_tx",
  "create_stock_adjustment_tx"
]);

const MUTATION_METHODS = new Set(["insert", "upsert", "update", "delete"]);
const ROUTE_CACHE_TTL_MS = 1_500;
const SCOPE_SYNC_TTL_MS = 15_000;
const RUNTIME_LEASE_TTL_MS = 120_000;

export class TenantDataRoutingError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "TenantDataRoutingError";
    this.code = code;
  }
}

function globalCache() {
  return globalThis as typeof globalThis & {
    __cpiposPrimaryServiceClient?: DynamicClient;
    __cpiposTrialServiceClient?: DynamicClient;
    __cpiposRoutedServiceClient?: DynamicClient;
    __cpiposTenantRouteCache?: Map<string, CacheEntry<LifecycleRow | null>>;
    __cpiposTrialScopeSyncCache?: Map<string, number>;
  };
}

function createPrimaryClient(): DynamicClient {
  const url = readRequiredEnv("NEXT_PUBLIC_SUPABASE_URL", "Missing Supabase service role environment variables.");
  const key = readRequiredEnv("SUPABASE_SERVICE_ROLE_KEY", "Missing Supabase service role environment variables.");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

function createTrialClient(): DynamicClient {
  const url = String(process.env.TRIAL_SUPABASE_URL ?? "").trim();
  const key = String(process.env.TRIAL_SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!url || !key) {
    throw new TenantDataRoutingError(
      "trial_data_plane_credentials_missing",
      "CpiPOS-002 is authoritative for this tenant, but server-only Trial Supabase credentials are missing."
    );
  }
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export function getPrimarySupabaseServiceClient(): DynamicClient {
  if (typeof window !== "undefined") throw new Error("Supabase service client can only be used on the server.");
  const cache = globalCache();
  cache.__cpiposPrimaryServiceClient ??= createPrimaryClient();
  return cache.__cpiposPrimaryServiceClient;
}

export function getTrialSupabaseServiceClient(): DynamicClient {
  if (typeof window !== "undefined") throw new Error("Supabase service client can only be used on the server.");
  const cache = globalCache();
  cache.__cpiposTrialServiceClient ??= createTrialClient();
  return cache.__cpiposTrialServiceClient;
}

function trialRoutingEnabled() {
  const value = String(process.env.TRIAL_DATA_ROUTING_ENABLED ?? "false").trim().toLowerCase();
  return value === "true" || value === "1";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

function firstRecord(value: unknown) {
  return asRecord(Array.isArray(value) ? value[0] : value);
}

function inferScope(calls: QueryCall[]): RouteHint {
  let tenantId: string | null = null;
  let branchId: string | null = null;
  for (const call of calls) {
    if (call.method === "eq") {
      const key = asString(call.args[0]);
      const value = asString(call.args[1]);
      if (key === "tenant_id" && value) tenantId = value;
      if (key === "branch_id" && value) branchId = value;
    }
    if (call.method === "match") {
      const row = asRecord(call.args[0]);
      tenantId = asString(row?.tenant_id) ?? tenantId;
      branchId = asString(row?.branch_id) ?? branchId;
    }
    if (["insert", "upsert", "update"].includes(call.method)) {
      const row = firstRecord(call.args[0]);
      tenantId = asString(row?.tenant_id) ?? tenantId;
      branchId = asString(row?.branch_id) ?? branchId;
    }
  }
  return { tenantId, branchId };
}

function eqValue(calls: QueryCall[], column: string) {
  for (const call of calls) {
    if (call.method === "eq" && asString(call.args[0]) === column) return asString(call.args[1]);
  }
  return null;
}

function objectRouteHint(table: string, calls: QueryCall[]) {
  const id = eqValue(calls, "id");
  if (id) return { objectType: table, objectId: id };
  const foreignFields: Array<[string, string]> = [
    ["order_id", "orders"],
    ["qr_session_id", "table_qr_sessions"],
    ["table_session_id", "table_bill_sessions"],
    ["table_id", "dining_tables"],
    ["product_id", "products"],
    ["ingredient_id", "ingredients"]
  ];
  for (const [column, objectType] of foreignFields) {
    const objectId = eqValue(calls, column);
    if (objectId) return { objectType, objectId };
  }
  return null;
}

async function lookupObjectRoute(objectType: string, objectId: string): Promise<ObjectRoute | null> {
  const { data, error } = await getPrimarySupabaseServiceClient()
    .from("tenant_data_object_routes")
    .select("tenant_id,branch_id")
    .eq("object_type", objectType)
    .eq("object_id", objectId)
    .maybeSingle();
  if (error) throw new TenantDataRoutingError("object_route_lookup_failed", error.message);
  return (data as ObjectRoute | null) ?? null;
}

async function currentPosSession(): Promise<PosSessionRouteRow | null> {
  try {
    const store = await cookies();
    const name = String(process.env.POS_SESSION_ID_COOKIE_NAME ?? "pos_session_id").trim() || "pos_session_id";
    const sessionId = String(store.get(name)?.value ?? "").trim().replace(/^\"+|\"+$/g, "");
    if (!sessionId) return null;
    const { data, error } = await getPrimarySupabaseServiceClient()
      .from("pos_sessions")
      .select("id,tenant_id,branch_id,user_id,device_code,shift_id,status,issued_at,expires_at")
      .eq("id", sessionId)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as PosSessionRouteRow;
    if (row.status !== "active" || new Date(row.expires_at).getTime() <= Date.now()) return null;
    return row;
  } catch {
    return null;
  }
}

function routeCache() {
  const cache = globalCache();
  cache.__cpiposTenantRouteCache ??= new Map();
  return cache.__cpiposTenantRouteCache;
}

async function loadLifecycle(tenantId: string): Promise<LifecycleRow | null> {
  const cache = routeCache();
  const cached = cache.get(tenantId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const { data, error } = await getPrimarySupabaseServiceClient()
    .from("tenant_data_lifecycle")
    .select("data_home,lifecycle_status,routing_version")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw new TenantDataRoutingError("tenant_data_lifecycle_lookup_failed", error.message);
  const value = (data as LifecycleRow | null) ?? null;
  cache.set(tenantId, { value, expiresAt: Date.now() + ROUTE_CACHE_TTL_MS });
  return value;
}

function mapLifecycle(status: string): "trial" | "active" | "grace" | "expired" | "archived" {
  if (status === "trial" || status === "grace" || status === "archived") return status;
  if (status === "expired" || status === "suspended") return "expired";
  return "active";
}

function scopeSyncCache() {
  const cache = globalCache();
  cache.__cpiposTrialScopeSyncCache ??= new Map();
  return cache.__cpiposTrialScopeSyncCache;
}

async function ensureTrialScopes(tenantId: string, branchId: string | null) {
  const cacheKey = `${tenantId}:${branchId ?? "tenant"}`;
  const cache = scopeSyncCache();
  if ((cache.get(cacheKey) ?? 0) > Date.now()) return;

  const primary = getPrimarySupabaseServiceClient();
  const trial = getTrialSupabaseServiceClient();
  const [lifecycleResult, tenantResult] = await Promise.all([
    primary.from("tenant_data_lifecycle").select("lifecycle_status,routing_version").eq("tenant_id", tenantId).maybeSingle(),
    primary.from("tenants").select("id,code,name,is_active").eq("id", tenantId).maybeSingle()
  ]);
  if (lifecycleResult.error) throw new TenantDataRoutingError("trial_scope_lifecycle_lookup_failed", lifecycleResult.error.message);
  if (tenantResult.error) throw new TenantDataRoutingError("trial_scope_tenant_lookup_failed", tenantResult.error.message);
  if (!tenantResult.data) throw new TenantDataRoutingError("trial_scope_tenant_missing", "Tenant was not found in CpiPOS-001.");

  const lifecycleStatus = mapLifecycle(String(lifecycleResult.data?.lifecycle_status ?? "active"));
  const tenantSync = await trial.from("trial_tenant_scopes").upsert(
    {
      tenant_id: tenantId,
      lifecycle_status: lifecycleStatus,
      is_active: tenantResult.data.is_active !== false && !["expired", "archived"].includes(lifecycleStatus),
      source_control_plane: "CpiPOS-001",
      synced_at: new Date().toISOString(),
      metadata: {
        tenant_code: tenantResult.data.code,
        tenant_name: tenantResult.data.name,
        routing_version: lifecycleResult.data?.routing_version ?? null
      }
    },
    { onConflict: "tenant_id" }
  );
  if (tenantSync.error) throw new TenantDataRoutingError("trial_scope_tenant_sync_failed", tenantSync.error.message);

  if (branchId) {
    const branchResult = await primary
      .from("branches")
      .select("id,code,name,is_active")
      .eq("tenant_id", tenantId)
      .eq("id", branchId)
      .maybeSingle();
    if (branchResult.error) throw new TenantDataRoutingError("trial_scope_branch_lookup_failed", branchResult.error.message);
    if (!branchResult.data) throw new TenantDataRoutingError("trial_scope_branch_missing", "Branch was not found in CpiPOS-001.");
    const branchSync = await trial.from("trial_branch_scopes").upsert(
      {
        tenant_id: tenantId,
        branch_id: branchId,
        is_active: branchResult.data.is_active !== false,
        synced_at: new Date().toISOString(),
        metadata: { branch_code: branchResult.data.code, branch_name: branchResult.data.name }
      },
      { onConflict: "tenant_id,branch_id" }
    );
    if (branchSync.error) throw new TenantDataRoutingError("trial_scope_branch_sync_failed", branchSync.error.message);
  }

  cache.set(cacheKey, Date.now() + SCOPE_SYNC_TTL_MS);
}

async function findOpenShift(tenantId: string, branchId: string, preferredShiftId: string | null) {
  const primary = getPrimarySupabaseServiceClient();
  let query = primary.from("shifts").select("id").eq("tenant_id", tenantId).eq("branch_id", branchId).eq("status", "open");
  if (preferredShiftId) query = query.eq("id", preferredShiftId);
  else query = query.order("opened_at", { ascending: false }).limit(1);
  const { data, error } = await query.maybeSingle();
  if (error) throw new TenantDataRoutingError("trial_runtime_shift_lookup_failed", error.message);
  if (!data?.id) throw new TenantDataRoutingError("trial_runtime_shift_not_open", "An open CpiPOS-001 shift is required for Trial transactions.");
  return String(data.id);
}

async function findActiveSession(args: { tenantId: string; branchId: string; userId: string | null; shiftId: string }) {
  const cookieSession = await currentPosSession();
  if (
    cookieSession &&
    cookieSession.tenant_id === args.tenantId &&
    cookieSession.branch_id === args.branchId &&
    cookieSession.shift_id === args.shiftId &&
    (!args.userId || cookieSession.user_id === args.userId)
  ) return cookieSession;

  let query = getPrimarySupabaseServiceClient()
    .from("pos_sessions")
    .select("id,tenant_id,branch_id,user_id,device_code,shift_id,status,issued_at,expires_at")
    .eq("tenant_id", args.tenantId)
    .eq("branch_id", args.branchId)
    .eq("shift_id", args.shiftId)
    .eq("status", "active")
    .gt("expires_at", new Date().toISOString());
  if (args.userId) query = query.eq("user_id", args.userId);
  const { data, error } = await query.order("issued_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new TenantDataRoutingError("trial_runtime_session_lookup_failed", error.message);
  if (!data) throw new TenantDataRoutingError("trial_runtime_session_missing", "An active CpiPOS-001 POS session for the selected open shift is required for Trial transactions.");
  return data as PosSessionRouteRow;
}

async function ensureTrialRuntimeLease(args: { tenantId: string; branchId: string; userId?: string | null; shiftId?: string | null }) {
  const shiftId = await findOpenShift(args.tenantId, args.branchId, args.shiftId ?? null);
  const session = await findActiveSession({ tenantId: args.tenantId, branchId: args.branchId, userId: args.userId ?? null, shiftId });
  if (args.userId && session.user_id !== args.userId) {
    throw new TenantDataRoutingError("trial_runtime_user_mismatch", "CpiPOS-001 POS session user does not match the requested actor.");
  }
  const expiresAtMs = Math.min(new Date(session.expires_at).getTime(), Date.now() + RUNTIME_LEASE_TTL_MS);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
    throw new TenantDataRoutingError("trial_runtime_session_expired", "CpiPOS-001 POS session is expired.");
  }
  const { error } = await getTrialSupabaseServiceClient().from("trial_runtime_leases").upsert(
    {
      pos_session_id: session.id,
      tenant_id: args.tenantId,
      branch_id: args.branchId,
      shift_id: shiftId,
      user_id: session.user_id,
      device_code: session.device_code,
      status: "active",
      issued_at: session.issued_at,
      expires_at: new Date(expiresAtMs).toISOString(),
      synced_at: new Date().toISOString(),
      metadata: { source: "CpiPOS-001", router: "server" }
    },
    { onConflict: "pos_session_id" }
  );
  if (error) throw new TenantDataRoutingError("trial_runtime_lease_sync_failed", error.message);
}

async function clientForTenant(tenantId: string, branchId: string | null) {
  const lifecycle = await loadLifecycle(tenantId);
  const home: DataHome = lifecycle?.data_home ?? "primary";
  if (home === "primary") return { client: getPrimarySupabaseServiceClient(), home };
  if (home === "archive") throw new TenantDataRoutingError("tenant_data_archived", "Archived business data cannot accept live POS traffic.");
  if (!trialRoutingEnabled()) {
    throw new TenantDataRoutingError(
      "trial_data_routing_disabled",
      "CpiPOS-001 marks this tenant as Trial Data Plane, but Trial routing is disabled. Request failed closed."
    );
  }
  await ensureTrialScopes(tenantId, branchId);
  return { client: getTrialSupabaseServiceClient(), home };
}

async function tableTarget(table: string, calls: QueryCall[]) {
  const scope = inferScope(calls);
  if (scope.tenantId) return { ...(await clientForTenant(scope.tenantId, scope.branchId)), ...scope };

  const hint = objectRouteHint(table, calls);
  if (hint) {
    const route = await lookupObjectRoute(hint.objectType, hint.objectId);
    if (route) {
      return {
        ...(await clientForTenant(route.tenant_id, route.branch_id)),
        tenantId: route.tenant_id,
        branchId: route.branch_id
      };
    }
  }

  const session = await currentPosSession();
  if (session) {
    return {
      ...(await clientForTenant(session.tenant_id, session.branch_id)),
      tenantId: session.tenant_id,
      branchId: session.branch_id
    };
  }

  if (calls.some((call) => MUTATION_METHODS.has(call.method))) {
    throw new TenantDataRoutingError("tenant_data_route_unresolved", `Refusing unscoped business mutation for ${table}.`);
  }
  return { client: getPrimarySupabaseServiceClient(), home: "primary" as const, tenantId: null, branchId: null };
}

async function rpcTarget(fn: string, params: Record<string, unknown>) {
  let tenantId = asString(params.p_tenant_id) ?? asString(params.tenant_id);
  let branchId = asString(params.p_branch_id) ?? asString(params.branch_id);

  if (!tenantId && fn === "submit_table_qr_order_tx") {
    const qrSessionId = asString(params.p_qr_session_id);
    const route = qrSessionId ? await lookupObjectRoute("table_qr_sessions", qrSessionId) : null;
    if (route) {
      tenantId = route.tenant_id;
      branchId = route.branch_id;
    }
  }
  if (!tenantId) {
    const session = await currentPosSession();
    if (session) {
      tenantId = session.tenant_id;
      branchId = session.branch_id;
    }
  }
  if (!tenantId) throw new TenantDataRoutingError("tenant_data_route_unresolved", `Tenant route unresolved for RPC ${fn}.`);

  const target = await clientForTenant(tenantId, branchId);
  if (target.home === "trial") {
    if (!branchId) throw new TenantDataRoutingError("trial_branch_route_unresolved", `Branch route unresolved for Trial RPC ${fn}.`);
    if (fn === "create_pos_order_tx") {
      await ensureTrialRuntimeLease({
        tenantId,
        branchId,
        userId: asString(params.p_created_by),
        shiftId: asString(params.p_shift_id)
      });
    } else if (fn === "complete_pos_payment_tx") {
      const orderId = asString(params.p_order_id);
      if (!orderId) throw new TenantDataRoutingError("trial_payment_order_missing", "Payment order ID is required.");
      const { data, error } = await getTrialSupabaseServiceClient()
        .from("orders")
        .select("shift_id")
        .eq("tenant_id", tenantId)
        .eq("branch_id", branchId)
        .eq("id", orderId)
        .maybeSingle();
      if (error) throw new TenantDataRoutingError("trial_payment_order_lookup_failed", error.message);
      if (!data?.shift_id) throw new TenantDataRoutingError("trial_payment_order_missing", "Payment order was not found in CpiPOS-002.");
      await ensureTrialRuntimeLease({
        tenantId,
        branchId,
        userId: asString(params.p_received_by),
        shiftId: String(data.shift_id)
      });
    } else if (fn === "submit_table_qr_order_tx") {
      await ensureTrialRuntimeLease({ tenantId, branchId });
    }
  }
  return { ...target, tenantId, branchId };
}

async function replay(builder: DynamicClient, calls: QueryCall[]) {
  let current = builder;
  for (const call of calls) {
    const method = current?.[call.method];
    if (typeof method !== "function") throw new Error(`Routed Supabase builder method unavailable: ${call.method}`);
    current = method.apply(current, call.args);
  }
  return await current;
}

async function registerRoutes(table: string, result: unknown, tenantId: string | null, branchId: string | null) {
  const data = asRecord(result)?.data;
  const rows = Array.isArray(data) ? data : data && typeof data === "object" ? [data] : [];
  const entries: Array<Record<string, unknown>> = [];
  for (const value of rows) {
    const row = asRecord(value);
    const objectId = asString(row?.id);
    const rowTenantId = asString(row?.tenant_id) ?? tenantId;
    const rowBranchId = asString(row?.branch_id) ?? branchId;
    if (!objectId || !rowTenantId) continue;
    entries.push({ object_type: table, object_id: objectId, tenant_id: rowTenantId, branch_id: rowBranchId, metadata: { source_home: "trial" } });
  }
  if (!entries.length) return;
  const { error } = await getPrimarySupabaseServiceClient()
    .from("tenant_data_object_routes")
    .upsert(entries, { onConflict: "object_type,object_id" });
  if (error) console.error("[tenant-data-router] object route registration failed", { table, error: error.message });
}

async function registerRpcRoutes(fn: string, result: unknown, tenantId: string, branchId: string | null) {
  const data = asRecord(result)?.data;
  const rows = Array.isArray(data) ? data : data && typeof data === "object" ? [data] : [];
  const entries: Array<Record<string, unknown>> = [];
  for (const value of rows) {
    const row = asRecord(value);
    if (!row) continue;
    const add = (objectType: string, objectId: string | null) => {
      if (objectId) entries.push({ object_type: objectType, object_id: objectId, tenant_id: tenantId, branch_id: branchId, metadata: { source_home: "trial" } });
    };
    if (fn === "create_pos_order_tx") add("orders", asString(row.order_id));
    if (fn === "submit_table_qr_order_tx") {
      add("orders", asString(row.order_id));
      add("table_qr_orders", asString(row.submission_id));
    }
    if (fn === "create_stock_adjustment_tx") add("stock_movements", asString(row.movement_id));
  }
  if (!entries.length) return;
  const { error } = await getPrimarySupabaseServiceClient()
    .from("tenant_data_object_routes")
    .upsert(entries, { onConflict: "object_type,object_id" });
  if (error) console.error("[tenant-data-router] RPC route registration failed", { fn, error: error.message });
}

function deferredTable(table: string): DynamicClient {
  const calls: QueryCall[] = [];
  let execution: Promise<unknown> | null = null;
  let proxy: DynamicClient;
  const execute = () => {
    execution ??= (async () => {
      const target = await tableTarget(table, calls);
      const result = await replay(target.client.from(table), calls);
      if (target.home === "trial") await registerRoutes(table, result, target.tenantId, target.branchId);
      return result;
    })();
    return execution;
  };
  proxy = new Proxy({}, {
    get(_target, property) {
      if (property === "then") return (resolve: unknown, reject: unknown) => execute().then(resolve as never, reject as never);
      if (property === "catch") return (reject: unknown) => execute().catch(reject as never);
      if (property === "finally") return (handler: unknown) => execute().finally(handler as never);
      return (...args: unknown[]) => {
        calls.push({ method: String(property), args });
        return proxy;
      };
    }
  });
  return proxy;
}

function deferredRpc(fn: string, params: Record<string, unknown>, options?: unknown): DynamicClient {
  const calls: QueryCall[] = [];
  let execution: Promise<unknown> | null = null;
  let proxy: DynamicClient;
  const execute = () => {
    execution ??= (async () => {
      const target = await rpcTarget(fn, params);
      const base = options === undefined ? target.client.rpc(fn, params) : target.client.rpc(fn, params, options);
      const result = await replay(base, calls);
      if (target.home === "trial") await registerRpcRoutes(fn, result, target.tenantId, target.branchId);
      return result;
    })();
    return execution;
  };
  proxy = new Proxy({}, {
    get(_target, property) {
      if (property === "then") return (resolve: unknown, reject: unknown) => execute().then(resolve as never, reject as never);
      if (property === "catch") return (reject: unknown) => execute().catch(reject as never);
      if (property === "finally") return (handler: unknown) => execute().finally(handler as never);
      return (...args: unknown[]) => {
        calls.push({ method: String(property), args });
        return proxy;
      };
    }
  });
  return proxy;
}

function createRoutedClient(): DynamicClient {
  const primary = getPrimarySupabaseServiceClient();
  return new Proxy(primary, {
    get(target, property) {
      if (property === "from") {
        return (table: string) => BUSINESS_TABLES.has(table) ? deferredTable(table) : target.from(table);
      }
      if (property === "rpc") {
        return (fn: string, params: Record<string, unknown> = {}, options?: unknown) =>
          BUSINESS_RPCS.has(fn) ? deferredRpc(fn, params, options) : target.rpc(fn, params, options);
      }
      const value = target[property];
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}

export function getRoutedSupabaseServiceClient(): DynamicClient {
  if (typeof window !== "undefined") throw new Error("Supabase service client can only be used on the server.");
  const cache = globalCache();
  cache.__cpiposRoutedServiceClient ??= createRoutedClient();
  return cache.__cpiposRoutedServiceClient;
}

export function invalidateTenantDataRouteCache(tenantId?: string) {
  const cache = routeCache();
  if (tenantId) cache.delete(tenantId);
  else cache.clear();
}
