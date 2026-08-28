import "server-only";

import { readRequiredEnv } from "@/lib/env";

export const DASHBOARD_ONLINE_WINDOW_MINUTES = 5;
export const SUPABASE_FREE_DATABASE_QUOTA_BYTES = 500 * 1024 * 1024;
const DASHBOARD_BRIDGE_TIMEOUT_MS = 8_000;
const PRIMARY_BRIDGE_SLUG = "cpipos-it-dashboard-primary";
const OPERATIONAL_BRIDGE_SLUG = "cpipos-it-dashboard-operational";

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

export type SourceState<T> = {
  ready: boolean;
  data: T | null;
  error_code: string | null;
  duration_ms: number | null;
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

type PrimaryBridgePayload = {
  plane: "business";
  checked_at: string;
  stores: {
    total: number;
    open: number;
    closed: number;
  };
  database: unknown;
  api_errors_60m: {
    total: number;
    http_4xx: number;
    http_5xx: number;
    top_routes: Array<{ route: string; count: number }>;
  };
};

type OperationalBridgePayload = {
  plane: "operational";
  checked_at: string;
  online_window_minutes: number;
  devices: {
    total: number;
    online: number;
    stores_online: number;
    latest_seen_at: string | null;
  };
  operations: {
    open_incidents: number;
    critical_incidents: number;
    pending_commands: number;
  };
  database: unknown;
};

type PrimaryBridgeResult = {
  payload: PrimaryBridgePayload;
  database: DatabaseMetrics;
};

type OperationalBridgeResult = {
  payload: OperationalBridgePayload;
  database: DatabaseMetrics;
};

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

async function invokeBridge<T>(args: {
  baseUrl: string;
  publishableKey: string;
  slug: string;
  accessToken: string;
  expectedPlane: "business" | "operational";
  errorCode: string;
}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DASHBOARD_BRIDGE_TIMEOUT_MS);

  try {
    const response = await fetch(`${args.baseUrl.replace(/\/$/, "")}/functions/v1/${args.slug}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${args.accessToken}`,
        apikey: args.publishableKey,
        "content-type": "application/json"
      },
      body: "{}",
      cache: "no-store",
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`${args.errorCode}:http_${response.status}`);
    }

    const body = (await response.json().catch(() => null)) as unknown;
    const record = asRecord(body);
    if (!record || record.plane !== args.expectedPlane) {
      throw new Error(`${args.errorCode}:invalid_payload`);
    }

    return body as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`${args.errorCode}:timeout`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function databaseSource<T extends { database: DatabaseMetrics }>(source: SourceState<T>): SourceState<DatabaseMetrics> {
  return {
    ready: source.ready,
    data: source.data?.database ?? null,
    error_code: source.error_code,
    duration_ms: source.duration_ms
  };
}

export async function loadDashboardOverview(accessToken: string): Promise<DashboardOverview> {
  const checkedAt = new Date();
  const primaryUrl = readRequiredEnv("CPIPOS_SUPABASE_URL", "Missing CpiPOS-001 Supabase URL.");
  const primaryPublishableKey = readRequiredEnv(
    "CPIPOS_SUPABASE_PUBLISHABLE_KEY",
    "Missing CpiPOS-001 Supabase publishable key."
  );
  const operationalUrl = readRequiredEnv("IT_SUPABASE_URL", "Missing CpiPOS-002 Supabase URL.");
  const operationalPublishableKey = readRequiredEnv(
    "IT_SUPABASE_PUBLISHABLE_KEY",
    "Missing CpiPOS-002 Supabase publishable key."
  );

  const [primary, operational] = await Promise.all([
    capture<PrimaryBridgeResult>("business_control_plane_bridge_failed", async () => {
      const payload = await invokeBridge<PrimaryBridgePayload>({
        baseUrl: primaryUrl,
        publishableKey: primaryPublishableKey,
        slug: PRIMARY_BRIDGE_SLUG,
        accessToken,
        expectedPlane: "business",
        errorCode: "business_control_plane_bridge_failed"
      });
      const database = normalizeDatabaseMetrics(payload.database);
      if (!database) throw new Error("business_database_metrics_invalid");
      return { payload, database };
    }),
    capture<OperationalBridgeResult>("operational_control_plane_bridge_failed", async () => {
      const payload = await invokeBridge<OperationalBridgePayload>({
        baseUrl: operationalUrl,
        publishableKey: operationalPublishableKey,
        slug: OPERATIONAL_BRIDGE_SLUG,
        accessToken,
        expectedPlane: "operational",
        errorCode: "operational_control_plane_bridge_failed"
      });
      const database = normalizeDatabaseMetrics(payload.database);
      if (!database) throw new Error("operational_database_metrics_invalid");
      return { payload, database };
    })
  ]);

  const businessDatabase = databaseSource(primary);
  const operationalDatabase = databaseSource(operational);
  const businessMetrics = businessDatabase.data;
  const operationalMetrics = operationalDatabase.data;
  const primaryPayload = primary.data?.payload ?? null;
  const operationalPayload = operational.data?.payload ?? null;
  const degradedSources = [primary, operational]
    .filter((source) => !source.ready)
    .map((source) => source.error_code)
    .filter((code): code is string => Boolean(code));

  const recentErrors = primaryPayload?.api_errors_60m ?? {
    total: null,
    http_4xx: null,
    http_5xx: null,
    top_routes: []
  };

  return {
    status: degradedSources.length ? "degraded" : "ready",
    checked_at: checkedAt.toISOString(),
    online_window_minutes: operationalPayload?.online_window_minutes ?? DASHBOARD_ONLINE_WINDOW_MINUTES,
    quota: {
      plan: "free",
      database_quota_bytes: SUPABASE_FREE_DATABASE_QUOTA_BYTES,
      source: "supabase_free_plan"
    },
    stores: {
      total: primaryPayload?.stores.total ?? null,
      open: primaryPayload?.stores.open ?? null,
      closed: primaryPayload?.stores.closed ?? null,
      online: operationalPayload?.devices.stores_online ?? null
    },
    devices: {
      total: operationalPayload?.devices.total ?? null,
      online: operationalPayload?.devices.online ?? null,
      latest_seen_at: operationalPayload?.devices.latest_seen_at ?? null
    },
    data: {
      estimated_rows_total:
        businessMetrics && operationalMetrics ? businessMetrics.estimated_rows + operationalMetrics.estimated_rows : null,
      user_tables_total: businessMetrics && operationalMetrics ? businessMetrics.user_tables + operationalMetrics.user_tables : null
    },
    databases: {
      business: businessDatabase,
      operational: operationalDatabase
    },
    api: {
      business_plane_ready: primary.ready,
      operational_plane_ready: operational.ready,
      business_latency_ms: primary.duration_ms,
      operational_latency_ms: operational.duration_ms,
      recent_errors_60m: recentErrors
    },
    operations: {
      open_incidents: operationalPayload?.operations.open_incidents ?? null,
      critical_incidents: operationalPayload?.operations.critical_incidents ?? null,
      pending_commands: operationalPayload?.operations.pending_commands ?? null
    },
    degraded_sources: degradedSources
  };
}
