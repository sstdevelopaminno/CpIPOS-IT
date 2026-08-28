import "server-only";

import type { ItAdminContext } from "@/lib/it-admin-guard";

export const DASHBOARD_ONLINE_WINDOW_MINUTES = 5;
export const SUPABASE_FREE_DATABASE_QUOTA_BYTES = 500 * 1024 * 1024;

export type DatabaseTopTable = {
  schema: string;
  table: string;
  estimated_rows: number;
  total_bytes: number;
};

export type DatabaseMetrics = {
  database_bytes: number;
  quota_bytes: number;
  remaining_bytes: number;
  usage_percent: number;
  estimated_rows: number;
  user_tables: number;
  connections_total: number;
  connections_active: number;
  top_tables: DatabaseTopTable[];
  checked_at: string | null;
};

export type DashboardOverview = {
  status: "ready" | "degraded";
  checked_at: string;
  online_window_minutes: number;
  quota: {
    plan: "free";
    database_quota_bytes: number;
    source: "supabase_free_plan";
  };
  stores: {
    total: number | null;
    open: number | null;
    closed: number | null;
    online: number | null;
  };
  devices: {
    total: number | null;
    online: number | null;
    latest_seen_at: string | null;
  };
  data: {
    estimated_rows_total: number | null;
    user_tables_total: number | null;
  };
  databases: {
    business: SourceState<DatabaseMetrics>;
    operational: SourceState<DatabaseMetrics>;
  };
  api: {
    business_plane_ready: boolean;
    operational_plane_ready: boolean;
    business_latency_ms: number | null;
    operational_latency_ms: number | null;
    recent_errors_60m: {
      total: number | null;
      http_4xx: number | null;
      http_5xx: number | null;
      top_routes: Array<{ route: string; count: number }>;
    };
  };
  operations: {
    open_incidents: number | null;
    critical_incidents: number | null;
    pending_commands: number | null;
  };
  degraded_sources: string[];
};

export type SourceState<T> = {
  ready: boolean;
  data: T | null;
  error_code: string | null;
  duration_ms: number | null;
};

type ApiPerfRow = { metadata?: Record<string, unknown> | null };
type DeviceSeenRow = { tenant_id?: string | null; last_seen_at?: string | null };

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asFiniteNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

function safeErrorCode(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  const [prefix] = error.message.split(":", 1);
  const normalized = String(prefix ?? "").trim();
  return normalized && /^[a-z0-9_]+$/i.test(normalized) ? normalized : fallback;
}

export function normalizeDatabaseMetrics(raw: unknown, quotaBytes = SUPABASE_FREE_DATABASE_QUOTA_BYTES): DatabaseMetrics | null {
  const record = asRecord(Array.isArray(raw) ? raw[0] : raw);
  if (!record) return null;

  const databaseBytes = asFiniteNumber(record.database_bytes);
  const safeQuota = Math.max(1, asFiniteNumber(quotaBytes));
  const topTablesRaw = Array.isArray(record.top_tables) ? record.top_tables : [];
  const topTables = topTablesRaw
    .map((value) => {
      const row = asRecord(value);
      if (!row) return null;
      const schema = asString(row.schema);
      const table = asString(row.table);
      if (!schema || !table) return null;
      return {
        schema,
        table,
        estimated_rows: asFiniteNumber(row.estimated_rows),
        total_bytes: asFiniteNumber(row.total_bytes)
      } satisfies DatabaseTopTable;
    })
    .filter((value): value is DatabaseTopTable => Boolean(value));

  return {
    database_bytes: databaseBytes,
    quota_bytes: safeQuota,
    remaining_bytes: Math.max(0, safeQuota - databaseBytes),
    usage_percent: Math.min(100, (databaseBytes / safeQuota) * 100),
    estimated_rows: asFiniteNumber(record.estimated_rows),
    user_tables: asFiniteNumber(record.user_tables),
    connections_total: asFiniteNumber(record.connections_total),
    connections_active: asFiniteNumber(record.connections_active),
    top_tables: topTables,
    checked_at: asString(record.checked_at)
  };
}

export function summarizeApiPerf(rows: ApiPerfRow[]) {
  let total = 0;
  let http4xx = 0;
  let http5xx = 0;
  const routeCounts = new Map<string, number>();

  for (const row of rows) {
    const metadata = row.metadata ?? {};
    const status = Number(metadata.status_code);
    if (!Number.isFinite(status) || status < 400 || status > 599) continue;
    total += 1;
    if (status >= 500) http5xx += 1;
    else http4xx += 1;
    const rawRoute = typeof metadata.route === "string" ? metadata.route.trim() : "";
    const route = rawRoute.startsWith("/") ? rawRoute.slice(0, 120) : "unknown";
    routeCounts.set(route, (routeCounts.get(route) ?? 0) + 1);
  }

  return {
    total,
    http_4xx: http4xx,
    http_5xx: http5xx,
    top_routes: [...routeCounts.entries()]
      .map(([route, count]) => ({ route, count }))
      .sort((left, right) => right.count - left.count)
      .slice(0, 5)
  };
}

export function summarizeOnlineStores(rows: DeviceSeenRow[], onlineSinceMs: number) {
  const onlineTenants = new Set<string>();
  let onlineDevices = 0;
  let latestSeenAt: string | null = null;
  let latestSeenMs = 0;

  for (const row of rows) {
    const tenantId = asString(row.tenant_id);
    const seenAt = asString(row.last_seen_at);
    const seenMs = seenAt ? new Date(seenAt).getTime() : Number.NaN;
    if (Number.isFinite(seenMs) && seenMs > latestSeenMs) {
      latestSeenMs = seenMs;
      latestSeenAt = seenAt;
    }
    if (!tenantId || !Number.isFinite(seenMs) || seenMs < onlineSinceMs) continue;
    onlineDevices += 1;
    onlineTenants.add(tenantId);
  }

  return { stores_online: onlineTenants.size, devices_online: onlineDevices, latest_seen_at: latestSeenAt };
}

async function capture<T>(fallbackCode: string, loader: () => Promise<T>): Promise<SourceState<T>> {
  const startedAt = Date.now();
  try {
    return {
      ready: true,
      data: await loader(),
      error_code: null,
      duration_ms: Date.now() - startedAt
    };
  } catch (error) {
    return {
      ready: false,
      data: null,
      error_code: safeErrorCode(error, fallbackCode),
      duration_ms: Date.now() - startedAt
    };
  }
}

async function exactCount(query: PromiseLike<{ count: number | null; error: { code?: string | null } | null }>, code: string) {
  const result = await query;
  if (result.error) throw new Error(`${code}:${result.error.code ?? "query_failed"}`);
  return result.count ?? 0;
}

async function databaseMetrics(client: ItAdminContext["supabase"] | ItAdminContext["itSupabase"], code: string) {
  const { data, error } = await client.rpc("get_it_database_metrics");
  if (error) throw new Error(`${code}:${error.code ?? "rpc_failed"}`);
  const normalized = normalizeDatabaseMetrics(data);
  if (!normalized) throw new Error(`${code}:invalid_payload`);
  return normalized;
}

export async function loadDashboardOverview(context: ItAdminContext): Promise<DashboardOverview> {
  const checkedAt = new Date();
  const onlineSinceMs = checkedAt.getTime() - DASHBOARD_ONLINE_WINDOW_MINUTES * 60_000;
  const onlineSince = new Date(onlineSinceMs).toISOString();
  const perfSince = new Date(checkedAt.getTime() - 60 * 60_000).toISOString();

  const [businessDb, operationalDb, storeTotal, storeOpen, storeClosed, deviceRows, deviceTotal, incidentsOpen, incidentsCritical, commandsPending, apiPerf] =
    await Promise.all([
      capture("business_database_metrics_failed", () => databaseMetrics(context.supabase, "business_database_metrics_failed")),
      capture("operational_database_metrics_failed", () => databaseMetrics(context.itSupabase, "operational_database_metrics_failed")),
      capture("store_total_query_failed", () =>
        exactCount(context.supabase.from("tenants").select("id", { count: "exact", head: true }), "store_total_query_failed")
      ),
      capture("store_open_query_failed", () =>
        exactCount(context.supabase.from("tenants").select("id", { count: "exact", head: true }).eq("is_active", true), "store_open_query_failed")
      ),
      capture("store_closed_query_failed", () =>
        exactCount(context.supabase.from("tenants").select("id", { count: "exact", head: true }).eq("is_active", false), "store_closed_query_failed")
      ),
      capture("device_seen_query_failed", async () => {
        const { data, error } = await context.itSupabase
          .from("it_devices")
          .select("tenant_id,last_seen_at")
          .order("last_seen_at", { ascending: false, nullsFirst: false })
          .limit(1000)
          .returns<DeviceSeenRow[]>();
        if (error) throw new Error(`device_seen_query_failed:${error.code ?? "query_failed"}`);
        return data ?? [];
      }),
      capture("device_total_query_failed", () =>
        exactCount(context.itSupabase.from("it_devices").select("id", { count: "exact", head: true }), "device_total_query_failed")
      ),
      capture("incident_open_query_failed", () =>
        exactCount(
          context.itSupabase.from("it_device_incidents").select("id", { count: "exact", head: true }).is("resolved_at", null),
          "incident_open_query_failed"
        )
      ),
      capture("incident_critical_query_failed", () =>
        exactCount(
          context.itSupabase
            .from("it_device_incidents")
            .select("id", { count: "exact", head: true })
            .is("resolved_at", null)
            .eq("severity", "critical"),
          "incident_critical_query_failed"
        )
      ),
      capture("command_pending_query_failed", () =>
        exactCount(
          context.itSupabase
            .from("it_device_commands")
            .select("id", { count: "exact", head: true })
            .in("status", ["queued", "pending", "delivered"]),
          "command_pending_query_failed"
        )
      ),
      capture("api_perf_query_failed", async () => {
        const { data, error } = await context.supabase
          .from("audit_logs")
          .select("metadata")
          .eq("action", "pos_route_perf")
          .gte("created_at", perfSince)
          .order("created_at", { ascending: false })
          .limit(500)
          .returns<ApiPerfRow[]>();
        if (error) throw new Error(`api_perf_query_failed:${error.code ?? "query_failed"}`);
        return summarizeApiPerf(data ?? []);
      })
    ]);

  const online = deviceRows.ready && deviceRows.data ? summarizeOnlineStores(deviceRows.data, onlineSinceMs) : null;
  const businessMetrics = businessDb.data;
  const operationalMetrics = operationalDb.data;
  const degradedSources = [
    businessDb,
    operationalDb,
    storeTotal,
    storeOpen,
    storeClosed,
    deviceRows,
    deviceTotal,
    incidentsOpen,
    incidentsCritical,
    commandsPending,
    apiPerf
  ]
    .filter((source) => !source.ready)
    .map((source) => source.error_code)
    .filter((code): code is string => Boolean(code));

  return {
    status: degradedSources.length ? "degraded" : "ready",
    checked_at: checkedAt.toISOString(),
    online_window_minutes: DASHBOARD_ONLINE_WINDOW_MINUTES,
    quota: {
      plan: "free",
      database_quota_bytes: SUPABASE_FREE_DATABASE_QUOTA_BYTES,
      source: "supabase_free_plan"
    },
    stores: {
      total: storeTotal.data,
      open: storeOpen.data,
      closed: storeClosed.data,
      online: online?.stores_online ?? null
    },
    devices: {
      total: deviceTotal.data,
      online: online?.devices_online ?? null,
      latest_seen_at: online?.latest_seen_at ?? null
    },
    data: {
      estimated_rows_total:
        businessMetrics && operationalMetrics ? businessMetrics.estimated_rows + operationalMetrics.estimated_rows : null,
      user_tables_total: businessMetrics && operationalMetrics ? businessMetrics.user_tables + operationalMetrics.user_tables : null
    },
    databases: {
      business: businessDb,
      operational: operationalDb
    },
    api: {
      business_plane_ready: businessDb.ready,
      operational_plane_ready: operationalDb.ready,
      business_latency_ms: businessDb.duration_ms,
      operational_latency_ms: operationalDb.duration_ms,
      recent_errors_60m: apiPerf.data ?? { total: null, http_4xx: null, http_5xx: null, top_routes: [] }
    },
    operations: {
      open_incidents: incidentsOpen.data,
      critical_incidents: incidentsCritical.data,
      pending_commands: commandsPending.data
    },
    degraded_sources: degradedSources
  };
}
