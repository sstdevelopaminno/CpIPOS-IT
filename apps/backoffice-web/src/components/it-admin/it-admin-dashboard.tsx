"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Language } from "@/lib/i18n";
import styles from "./it-admin-dashboard.module.css";

type ApiEnvelope<T> = {
  data: T | null;
  error: { code?: string; message?: string } | null;
};

type DatabaseTopTable = {
  schema: string;
  table: string;
  estimated_rows: number;
  total_bytes: number;
};

type DatabaseMetrics = {
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

type SourceState<T> = {
  ready: boolean;
  data: T | null;
  error_code: string | null;
  duration_ms: number | null;
};

type DashboardPayload = {
  status: "ready" | "degraded";
  checked_at: string;
  online_window_minutes: number;
  quota: {
    plan: "free";
    database_quota_bytes: number;
    source: string;
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

type ModalKind = "stores" | "data" | "databases" | "api" | null;

const copy = {
  th: {
    title: "ภาพรวมระบบ",
    subtitle: "สถานะร้านค้า ฐานข้อมูล และการเชื่อมต่อจาก Control Plane จริง",
    ready: "ระบบพร้อม",
    degraded: "บางส่วนต้องตรวจสอบ",
    refresh: "รีเฟรช",
    refreshing: "กำลังอัปเดต",
    updated: "อัปเดต",
    stores: "ร้านค้าทั้งหมด",
    open: "เปิด",
    closed: "ปิด",
    online: "ออนไลน์",
    devices: "อุปกรณ์ออนไลน์",
    rows: "ข้อมูลทั้งหมด",
    rowsHint: "ประมาณจำนวนแถวจาก PostgreSQL statistics",
    tables: "ตาราง",
    businessDb: "CpiPOS-001",
    businessRole: "Identity / Business Authority",
    operationalDb: "CpiPOS-002",
    operationalRole: "IT / MDM Operations",
    used: "ใช้แล้ว",
    remaining: "คงเหลือ",
    api: "API / Control Plane",
    connected: "เชื่อมต่อ",
    partial: "บางส่วนไม่พร้อม",
    view: "ดูรายละเอียด",
    storeStatus: "สถานะร้านค้า",
    storeStatusDesc: "ร้านออนไลน์ = มีอุปกรณ์ส่ง last_seen ภายในช่วงเวลาที่กำหนด",
    databaseUsage: "การใช้พื้นที่ฐานข้อมูล",
    databaseUsageDesc: "เทียบกับโควตา Supabase Free 500 MB ต่อโปรเจกต์",
    apiHealth: "การเชื่อมต่อและการวัดค่า",
    apiHealthDesc: "Response time ฝั่ง server → database และข้อผิดพลาด API ล่าสุด",
    businessPlane: "CpiPOS-001 API",
    operationalPlane: "CpiPOS-002 API",
    response: "ตอบกลับ",
    errors60: "API errors · 60 นาที",
    serverErrors: "5xx",
    incidents: "Incident เปิดอยู่",
    commands: "Remote command รอดำเนินการ",
    detailsStores: "รายละเอียดร้านค้า",
    detailsData: "รายละเอียดข้อมูล",
    detailsDatabases: "รายละเอียดฐานข้อมูล",
    detailsApi: "รายละเอียด API / Operations",
    totalRows: "จำนวนแถวโดยประมาณ",
    totalTables: "จำนวนตาราง",
    connections: "Database connections",
    activeConnections: "Active",
    topTables: "ตารางที่ใช้พื้นที่มาก",
    tableName: "ตาราง",
    tableRows: "แถวโดยประมาณ",
    tableSize: "พื้นที่",
    onlineWindow: "นิยามออนไลน์",
    latestSeen: "อุปกรณ์ seen ล่าสุด",
    noTelemetry: "ยังไม่มี telemetry ล่าสุดในช่วงออนไลน์",
    dataNote: "จำนวนแถวเป็นค่าประมาณจาก PostgreSQL live statistics เพื่อหลีกเลี่ยง COUNT(*) ทุกตารางบน Production",
    quotaNote: "โควตา 500 MB อ้างอิงแผน Supabase Free ที่ตรวจยืนยันปัจจุบัน หากเปลี่ยนแผนต้องอัปเดต quota source",
    degradedSources: "แหล่งข้อมูลที่ยังไม่พร้อม",
    none: "ไม่มี",
    close: "ปิด",
    loading: "กำลังโหลดข้อมูล Dashboard...",
    loadError: "โหลด Dashboard ไม่สำเร็จ",
    retry: "ลองใหม่",
    manageStores: "จัดการร้านค้า",
    monitoring: "Monitoring"
  },
  en: {
    title: "System overview",
    subtitle: "Live store, database, and Control Plane connectivity metrics",
    ready: "System ready",
    degraded: "Some sources need attention",
    refresh: "Refresh",
    refreshing: "Refreshing",
    updated: "Updated",
    stores: "Total stores",
    open: "Open",
    closed: "Closed",
    online: "Online",
    devices: "Online devices",
    rows: "Total data",
    rowsHint: "Estimated rows from PostgreSQL statistics",
    tables: "tables",
    businessDb: "CpiPOS-001",
    businessRole: "Identity / Business Authority",
    operationalDb: "CpiPOS-002",
    operationalRole: "IT / MDM Operations",
    used: "Used",
    remaining: "Remaining",
    api: "API / Control Plane",
    connected: "Connected",
    partial: "Partially unavailable",
    view: "View details",
    storeStatus: "Store status",
    storeStatusDesc: "Online means at least one device reported last_seen within the configured window",
    databaseUsage: "Database usage",
    databaseUsageDesc: "Compared with the Supabase Free 500 MB database quota per project",
    apiHealth: "Connectivity and measurements",
    apiHealthDesc: "Server-to-database response time and recent API errors",
    businessPlane: "CpiPOS-001 API",
    operationalPlane: "CpiPOS-002 API",
    response: "Response",
    errors60: "API errors · 60 min",
    serverErrors: "5xx",
    incidents: "Open incidents",
    commands: "Pending remote commands",
    detailsStores: "Store details",
    detailsData: "Data details",
    detailsDatabases: "Database details",
    detailsApi: "API / Operations details",
    totalRows: "Estimated rows",
    totalTables: "Tables",
    connections: "Database connections",
    activeConnections: "Active",
    topTables: "Largest tables",
    tableName: "Table",
    tableRows: "Estimated rows",
    tableSize: "Size",
    onlineWindow: "Online definition",
    latestSeen: "Latest device seen",
    noTelemetry: "No recent telemetry inside the online window",
    dataNote: "Row counts use PostgreSQL live statistics to avoid running COUNT(*) across every Production table.",
    quotaNote: "The 500 MB quota reflects the currently verified Supabase Free plan. Update the quota source if the plan changes.",
    degradedSources: "Unavailable sources",
    none: "None",
    close: "Close",
    loading: "Loading Dashboard metrics...",
    loadError: "Dashboard failed to load",
    retry: "Retry",
    manageStores: "Manage stores",
    monitoring: "Monitoring"
  }
} as const;

async function readDashboard(): Promise<DashboardPayload> {
  const response = await fetch("/api/it-admin/v1/dashboard", { cache: "no-store", credentials: "include" });
  const body = (await response.json().catch(() => null)) as ApiEnvelope<DashboardPayload> | null;
  if (!response.ok || !body?.data) {
    throw new Error(body?.error?.message ?? `Dashboard request failed (${response.status}).`);
  }
  return body.data;
}

function formatNumber(value: number | null, language: Language) {
  if (value === null) return "—";
  return new Intl.NumberFormat(language === "th" ? "th-TH" : "en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatBytes(value: number | null) {
  if (value === null) return "—";
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(value < 100 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatDate(value: string | null, language: Language) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function percent(value: number | null) {
  if (value === null || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function MiniStatus({ ready, yes, no }: { ready: boolean; yes: string; no: string }) {
  return <span className={`${styles.statusPill} ${ready ? styles.statusReady : styles.statusWarn}`}>{ready ? yes : no}</span>;
}

function StorageRow({ label, role, source }: { label: string; role: string; source: SourceState<DatabaseMetrics> }) {
  const data = source.data;
  return (
    <div className={styles.storageRow}>
      <div className={styles.storageHead}>
        <div>
          <strong>{label}</strong>
          <span>{role}</span>
        </div>
        <b>{data ? `${formatBytes(data.database_bytes)} / ${formatBytes(data.quota_bytes)}` : "—"}</b>
      </div>
      <div className={styles.progressTrack} aria-hidden="true">
        <span style={{ width: `${percent(data?.usage_percent ?? null)}%` }} />
      </div>
      <div className={styles.storageFoot}>
        <span>{data ? `${data.usage_percent.toFixed(1)}%` : source.error_code ?? "unavailable"}</span>
        <span>{data ? formatBytes(data.remaining_bytes) : "—"}</span>
      </div>
    </div>
  );
}

function DatabaseTable({ source, language }: { source: SourceState<DatabaseMetrics>; language: Language }) {
  if (!source.data) return <div className={styles.modalEmpty}>{source.error_code ?? "unavailable"}</div>;
  return (
    <div className={styles.tableWrap}>
      <table className={styles.detailTable}>
        <tbody>
          {source.data.top_tables.map((row) => (
            <tr key={`${row.schema}.${row.table}`}>
              <td><strong>{row.schema}.{row.table}</strong></td>
              <td>{formatNumber(row.estimated_rows, language)}</td>
              <td>{formatBytes(row.total_bytes)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ItAdminDashboard({ language }: { language: Language }) {
  const text = copy[language];
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalKind>(null);

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      setData(await readDashboard());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "dashboard_load_failed");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
    const timer = window.setInterval(() => void load(true), 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (!modal) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setModal(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modal]);

  const storeChart = useMemo(() => {
    const total = data?.stores.total ?? 0;
    const open = data?.stores.open ?? 0;
    const openAngle = total > 0 ? (open / total) * 360 : 0;
    return `conic-gradient(#2f6df6 0deg ${openAngle}deg, #dfe6ef ${openAngle}deg 360deg)`;
  }, [data]);

  if (loading && !data) {
    return <section className={styles.loadingState}><span className={styles.spinner} /><strong>{text.loading}</strong></section>;
  }

  if (error && !data) {
    return (
      <section className={styles.errorState} role="alert">
        <div><strong>{text.loadError}</strong><span>{error}</span></div>
        <button type="button" onClick={() => void load(false)}>{text.retry}</button>
      </section>
    );
  }

  if (!data) return null;

  const businessDb = data.databases.business.data;
  const operationalDb = data.databases.operational.data;
  const planesReady = Number(data.api.business_plane_ready) + Number(data.api.operational_plane_ready);

  return (
    <div className={styles.dashboard}>
      <section className={styles.headerCard}>
        <div>
          <div className={styles.headerStatus}>
            <MiniStatus ready={data.status === "ready"} yes={text.ready} no={text.degraded} />
            <span>{text.updated}: {formatDate(data.checked_at, language)}</span>
          </div>
          <h2>{text.title}</h2>
          <p>{text.subtitle}</p>
        </div>
        <button type="button" className={styles.refreshButton} onClick={() => void load(true)} disabled={refreshing}>
          {refreshing ? text.refreshing : text.refresh}
        </button>
      </section>

      {error ? <div className={styles.inlineWarning}>{error}</div> : null}

      <section className={styles.metricGrid}>
        <button type="button" className={styles.metricCard} onClick={() => setModal("stores")}>
          <span>{text.stores}</span>
          <strong>{formatNumber(data.stores.total, language)}</strong>
          <small>{text.open} {formatNumber(data.stores.open, language)} · {text.closed} {formatNumber(data.stores.closed, language)} · {text.online} {formatNumber(data.stores.online, language)}</small>
        </button>
        <button type="button" className={styles.metricCard} onClick={() => setModal("stores")}>
          <span>{text.devices}</span>
          <strong>{formatNumber(data.devices.online, language)} <em>/ {formatNumber(data.devices.total, language)}</em></strong>
          <small>{data.devices.latest_seen_at ? formatDate(data.devices.latest_seen_at, language) : text.noTelemetry}</small>
        </button>
        <button type="button" className={styles.metricCard} onClick={() => setModal("data")}>
          <span>{text.rows}</span>
          <strong>{formatNumber(data.data.estimated_rows_total, language)}</strong>
          <small>{formatNumber(data.data.user_tables_total, language)} {text.tables} · {text.rowsHint}</small>
        </button>
        <button type="button" className={styles.metricCard} onClick={() => setModal("databases")}>
          <span>{text.businessDb}</span>
          <strong>{formatBytes(businessDb?.database_bytes ?? null)}</strong>
          <small>{text.remaining} {formatBytes(businessDb?.remaining_bytes ?? null)}</small>
        </button>
        <button type="button" className={styles.metricCard} onClick={() => setModal("databases")}>
          <span>{text.operationalDb}</span>
          <strong>{formatBytes(operationalDb?.database_bytes ?? null)}</strong>
          <small>{text.remaining} {formatBytes(operationalDb?.remaining_bytes ?? null)}</small>
        </button>
        <button type="button" className={styles.metricCard} onClick={() => setModal("api")}>
          <span>{text.api}</span>
          <strong>{planesReady}/2</strong>
          <small>{data.api.recent_errors_60m.http_5xx ?? "—"} {text.serverErrors} · {data.operations.open_incidents ?? "—"} Incident</small>
        </button>
      </section>

      <section className={styles.contentGrid}>
        <article className={styles.panel}>
          <div className={styles.panelHeader}>
            <div><h3>{text.storeStatus}</h3><p>{text.storeStatusDesc}</p></div>
            <button type="button" onClick={() => setModal("stores")}>{text.view}</button>
          </div>
          <div className={styles.storeVisual}>
            <div className={styles.donut} style={{ background: storeChart }}>
              <div><strong>{formatNumber(data.stores.online, language)}</strong><span>{text.online}</span></div>
            </div>
            <div className={styles.legend}>
              <div><span className={styles.legendOpen} /><b>{text.open}</b><strong>{formatNumber(data.stores.open, language)}</strong></div>
              <div><span className={styles.legendClosed} /><b>{text.closed}</b><strong>{formatNumber(data.stores.closed, language)}</strong></div>
              <div><span className={styles.legendOnline} /><b>{text.online}</b><strong>{formatNumber(data.stores.online, language)}</strong></div>
            </div>
          </div>
        </article>

        <article className={styles.panel}>
          <div className={styles.panelHeader}>
            <div><h3>{text.databaseUsage}</h3><p>{text.databaseUsageDesc}</p></div>
            <button type="button" onClick={() => setModal("databases")}>{text.view}</button>
          </div>
          <div className={styles.storageList}>
            <StorageRow label={text.businessDb} role={text.businessRole} source={data.databases.business} />
            <StorageRow label={text.operationalDb} role={text.operationalRole} source={data.databases.operational} />
          </div>
        </article>
      </section>

      <section className={styles.apiPanel}>
        <div className={styles.panelHeader}>
          <div><h3>{text.apiHealth}</h3><p>{text.apiHealthDesc}</p></div>
          <button type="button" onClick={() => setModal("api")}>{text.view}</button>
        </div>
        <div className={styles.apiGrid}>
          <div className={styles.apiRow}>
            <span className={`${styles.apiDot} ${data.api.business_plane_ready ? styles.dotReady : styles.dotWarn}`} />
            <div><strong>{text.businessPlane}</strong><small>{text.response} {data.api.business_latency_ms ?? "—"} ms</small></div>
            <MiniStatus ready={data.api.business_plane_ready} yes={text.connected} no={text.partial} />
          </div>
          <div className={styles.apiRow}>
            <span className={`${styles.apiDot} ${data.api.operational_plane_ready ? styles.dotReady : styles.dotWarn}`} />
            <div><strong>{text.operationalPlane}</strong><small>{text.response} {data.api.operational_latency_ms ?? "—"} ms</small></div>
            <MiniStatus ready={data.api.operational_plane_ready} yes={text.connected} no={text.partial} />
          </div>
          <div className={styles.apiStat}><span>{text.errors60}</span><strong>{data.api.recent_errors_60m.total ?? "—"}</strong><small>{data.api.recent_errors_60m.http_5xx ?? "—"} {text.serverErrors}</small></div>
          <div className={styles.apiStat}><span>{text.incidents}</span><strong>{data.operations.open_incidents ?? "—"}</strong><small>{data.operations.critical_incidents ?? "—"} critical</small></div>
          <div className={styles.apiStat}><span>{text.commands}</span><strong>{data.operations.pending_commands ?? "—"}</strong><small>Queued / Pending / Delivered</small></div>
        </div>
      </section>

      <div className={styles.quickLinks}>
        <Link href="/it-admin/tenants">{text.manageStores}</Link>
        <Link href="/it-admin/monitoring">{text.monitoring}</Link>
      </div>

      {modal ? (
        <div className={styles.modalBackdrop} role="presentation" onMouseDown={() => setModal(null)}>
          <section className={styles.modal} role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <h3>{modal === "stores" ? text.detailsStores : modal === "data" ? text.detailsData : modal === "databases" ? text.detailsDatabases : text.detailsApi}</h3>
                <span>{formatDate(data.checked_at, language)}</span>
              </div>
              <button type="button" aria-label={text.close} onClick={() => setModal(null)}>×</button>
            </header>

            {modal === "stores" ? (
              <div className={styles.modalBody}>
                <div className={styles.detailCards}>
                  <div><span>{text.stores}</span><strong>{formatNumber(data.stores.total, language)}</strong></div>
                  <div><span>{text.open}</span><strong>{formatNumber(data.stores.open, language)}</strong></div>
                  <div><span>{text.closed}</span><strong>{formatNumber(data.stores.closed, language)}</strong></div>
                  <div><span>{text.online}</span><strong>{formatNumber(data.stores.online, language)}</strong></div>
                </div>
                <div className={styles.infoBox}><strong>{text.onlineWindow}</strong><span>{data.online_window_minutes} min · {text.storeStatusDesc}</span></div>
                <div className={styles.infoBox}><strong>{text.latestSeen}</strong><span>{data.devices.latest_seen_at ? formatDate(data.devices.latest_seen_at, language) : text.noTelemetry}</span></div>
              </div>
            ) : null}

            {modal === "data" ? (
              <div className={styles.modalBody}>
                <div className={styles.detailCards}>
                  <div><span>{text.totalRows}</span><strong>{formatNumber(data.data.estimated_rows_total, language)}</strong></div>
                  <div><span>{text.totalTables}</span><strong>{formatNumber(data.data.user_tables_total, language)}</strong></div>
                  <div><span>{text.businessDb}</span><strong>{formatNumber(businessDb?.estimated_rows ?? null, language)}</strong></div>
                  <div><span>{text.operationalDb}</span><strong>{formatNumber(operationalDb?.estimated_rows ?? null, language)}</strong></div>
                </div>
                <div className={styles.infoBox}><span>{text.dataNote}</span></div>
              </div>
            ) : null}

            {modal === "databases" ? (
              <div className={styles.modalBody}>
                <div className={styles.databaseDetailGrid}>
                  <div className={styles.databaseDetail}>
                    <h4>{text.businessDb}</h4>
                    <StorageRow label={text.businessDb} role={text.businessRole} source={data.databases.business} />
                    <div className={styles.connectionLine}><span>{text.connections}</span><strong>{businessDb?.connections_total ?? "—"}</strong><small>{text.activeConnections} {businessDb?.connections_active ?? "—"}</small></div>
                    <h5>{text.topTables}</h5>
                    <DatabaseTable source={data.databases.business} language={language} />
                  </div>
                  <div className={styles.databaseDetail}>
                    <h4>{text.operationalDb}</h4>
                    <StorageRow label={text.operationalDb} role={text.operationalRole} source={data.databases.operational} />
                    <div className={styles.connectionLine}><span>{text.connections}</span><strong>{operationalDb?.connections_total ?? "—"}</strong><small>{text.activeConnections} {operationalDb?.connections_active ?? "—"}</small></div>
                    <h5>{text.topTables}</h5>
                    <DatabaseTable source={data.databases.operational} language={language} />
                  </div>
                </div>
                <div className={styles.infoBox}><span>{text.quotaNote}</span></div>
              </div>
            ) : null}

            {modal === "api" ? (
              <div className={styles.modalBody}>
                <div className={styles.detailCards}>
                  <div><span>{text.businessPlane}</span><strong>{data.api.business_plane_ready ? "OK" : "—"}</strong><small>{data.api.business_latency_ms ?? "—"} ms</small></div>
                  <div><span>{text.operationalPlane}</span><strong>{data.api.operational_plane_ready ? "OK" : "—"}</strong><small>{data.api.operational_latency_ms ?? "—"} ms</small></div>
                  <div><span>{text.errors60}</span><strong>{data.api.recent_errors_60m.total ?? "—"}</strong><small>4xx {data.api.recent_errors_60m.http_4xx ?? "—"} · 5xx {data.api.recent_errors_60m.http_5xx ?? "—"}</small></div>
                  <div><span>{text.incidents}</span><strong>{data.operations.open_incidents ?? "—"}</strong><small>{data.operations.critical_incidents ?? "—"} critical</small></div>
                </div>
                {data.api.recent_errors_60m.top_routes.length ? (
                  <div className={styles.routeList}>{data.api.recent_errors_60m.top_routes.map((route) => <div key={route.route}><code>{route.route}</code><strong>{route.count}</strong></div>)}</div>
                ) : null}
                <div className={styles.infoBox}><strong>{text.degradedSources}</strong><span>{data.degraded_sources.length ? data.degraded_sources.join(" · ") : text.none}</span></div>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}
    </div>
  );
}
