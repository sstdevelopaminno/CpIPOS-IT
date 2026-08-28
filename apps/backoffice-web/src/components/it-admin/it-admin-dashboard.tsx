"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Language } from "@/lib/i18n";
import styles from "./it-admin-dashboard.module.css";

type ApiEnvelope<T> = {
  data: T | null;
  error: { code?: string; message?: string } | null;
};

type HealthPayload = {
  status: "ready" | "degraded";
  checked_at: string;
  integration: {
    mode: string;
    auth_business_plane: string;
    it_operational_plane: string;
    pos_runtime: string;
    control_plane: string;
    auth_plane_ready: boolean;
    data_bridge_ready: boolean;
  };
};

type TenantSummary = {
  id: string;
  code: string;
  name: string;
  store_code?: string | null;
  package_name: string | null;
  contract_status: string | null;
  is_active: boolean;
  branch_count: number;
  active_branch_count: number;
  device_count: number;
  active_device_count: number;
};

type TenantsPayload = {
  tenants: TenantSummary[];
  next_cursor: string | null;
  source: string;
};

type MonitorPayload = {
  generated_at: string;
  degraded_sources?: string[];
  totals: {
    branches: number;
    queued_orders: number;
    dead_letters_recent: number;
    critical: number;
    warn: number;
    api_errors_recent_total: number;
    api_errors_4xx_recent: number;
    api_errors_409_recent: number;
    api_errors_5xx_recent: number;
  };
};

type DashboardData = {
  health: HealthPayload;
  tenants: TenantsPayload;
  monitor: MonitorPayload;
};

const copy = {
  th: {
    eyebrow: "CPIPOS · IT CONTROL PLANE",
    title: "ศูนย์ควบคุมระบบ CpIPOS",
    description: "ภาพรวมสถานะระบบ ลูกค้า และงานปฏิบัติการจาก API จริงของ IT Backoffice โดยไม่ผสมกับ POS Production release lane",
    refresh: "รีเฟรช",
    refreshing: "กำลังรีเฟรช...",
    lastUpdated: "อัปเดตล่าสุด",
    controlPlane: "Control Plane",
    ready: "พร้อมใช้งาน",
    degraded: "ต้องตรวจสอบ",
    stores: "ร้านค้า",
    activeStores: "ร้านที่ Active",
    monitoredBranches: "สาขาที่ Monitoring",
    branchWarnings: "เตือน / Critical",
    apiErrors: "API Errors · 60 นาที",
    serverErrors: "5xx",
    architecture: "โครงสร้าง Control Plane",
    architectureDesc: "แยก authority และ operational data plane ตามสถาปัตยกรรมปัจจุบัน",
    businessPlane: "CpiPOS-001 · Identity / Business",
    operationalPlane: "CpiPOS-002 · IT / MDM Operations",
    posRuntime: "CpIPOS · POS Production",
    reachable: "เชื่อมต่อได้",
    unavailable: "ไม่พร้อม",
    isolated: "แยก release lane",
    telemetryNote: "สถานะด้านบนตรวจเฉพาะการเชื่อมต่อ control plane ไม่ได้แปลว่าเครื่องลูกค้าส่ง device telemetry แล้ว Dashboard จะไม่สร้าง health data จำลอง",
    operations: "สถานะปฏิบัติการ 60 นาทีล่าสุด",
    operationsDesc: "ตัวเลขจาก Monitoring API ปัจจุบัน",
    queued: "Queued Orders",
    deadLetters: "Dead Letters",
    http4xx: "4xx",
    conflicts: "409",
    http5xx: "5xx",
    noAlerts: "ไม่พบสาขาระดับ Warning/Critical ในข้อมูลล่าสุด",
    degradedSources: "Monitoring บางแหล่งข้อมูลยังไม่พร้อม",
    recentStores: "ร้านค้าล่าสุด",
    recentStoresDesc: "สรุปจาก Tenant API สูงสุด 100 รายการต่อการโหลดหนึ่งครั้ง",
    viewAll: "ดูร้านค้าทั้งหมด",
    store: "ร้าน",
    package: "แพ็กเกจ",
    branches: "สาขา",
    devices: "อุปกรณ์",
    status: "สถานะ",
    active: "Active",
    inactive: "Inactive",
    noPackage: "ยังไม่ผูกแพ็กเกจ",
    emptyStores: "ยังไม่มีข้อมูลร้านค้าในรายการนี้",
    quickActions: "ทางลัด",
    manageStores: "จัดการร้านค้า",
    openMonitoring: "เปิด Monitoring",
    auditLogs: "ดู Audit Logs",
    loadErrorTitle: "โหลด Dashboard ไม่สำเร็จ",
    loadErrorDesc: "ระบบไม่แสดงค่าประมาณแทนข้อมูลจริง กรุณาลองโหลดใหม่หรือตรวจ API ที่เกี่ยวข้อง",
    retry: "ลองใหม่",
    loading: "กำลังโหลดข้อมูล Control Plane..."
  },
  en: {
    eyebrow: "CPIPOS · IT CONTROL PLANE",
    title: "CpIPOS Control Center",
    description: "Live IT Backoffice overview for system, customer, and operations state without mixing changes into the POS Production release lane.",
    refresh: "Refresh",
    refreshing: "Refreshing...",
    lastUpdated: "Last updated",
    controlPlane: "Control Plane",
    ready: "Ready",
    degraded: "Needs attention",
    stores: "Stores",
    activeStores: "Active stores",
    monitoredBranches: "Monitored branches",
    branchWarnings: "Warning / Critical",
    apiErrors: "API Errors · 60 min",
    serverErrors: "5xx",
    architecture: "Control Plane Architecture",
    architectureDesc: "Current authority and operational data-plane separation",
    businessPlane: "CpiPOS-001 · Identity / Business",
    operationalPlane: "CpiPOS-002 · IT / MDM Operations",
    posRuntime: "CpIPOS · POS Production",
    reachable: "Reachable",
    unavailable: "Unavailable",
    isolated: "Separate release lane",
    telemetryNote: "These checks validate control-plane reachability only. They do not imply that customer devices are reporting telemetry, and this dashboard never fabricates health data.",
    operations: "Operations · Last 60 minutes",
    operationsDesc: "Current values from the Monitoring API",
    queued: "Queued Orders",
    deadLetters: "Dead Letters",
    http4xx: "4xx",
    conflicts: "409",
    http5xx: "5xx",
    noAlerts: "No Warning/Critical branches in the latest monitoring payload",
    degradedSources: "Some monitoring sources are degraded",
    recentStores: "Recent Stores",
    recentStoresDesc: "Summary from the Tenant API, up to 100 records per load",
    viewAll: "View all stores",
    store: "Store",
    package: "Package",
    branches: "Branches",
    devices: "Devices",
    status: "Status",
    active: "Active",
    inactive: "Inactive",
    noPackage: "No package",
    emptyStores: "No stores in the current result",
    quickActions: "Quick actions",
    manageStores: "Manage stores",
    openMonitoring: "Open Monitoring",
    auditLogs: "View Audit Logs",
    loadErrorTitle: "Dashboard failed to load",
    loadErrorDesc: "The dashboard will not substitute estimates for live data. Retry or inspect the relevant APIs.",
    retry: "Retry",
    loading: "Loading Control Plane data..."
  }
} as const;

async function readApi<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store", credentials: "include" });
  const body = (await response.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (!response.ok || !body?.data) {
    throw new Error(body?.error?.message ?? `Request failed with status ${response.status}.`);
  }
  return body.data;
}

function StatusBadge({ ok, yes, no }: { ok: boolean; yes: string; no: string }) {
  return <span className={`${styles.statusBadge} ${ok ? styles.statusOk : styles.statusWarn}`}>{ok ? yes : no}</span>;
}

export function ItAdminDashboard({ language }: { language: Language }) {
  const text = copy[language];
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const [health, tenants, monitor] = await Promise.all([
        readApi<HealthPayload>("/api/it-admin/v1/health"),
        readApi<TenantsPayload>("/api/it-admin/v1/tenants?limit=100"),
        readApi<MonitorPayload>("/api/it-admin/v1/monitor?minutes=60")
      ]);
      setData({ health, tenants, monitor });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unknown dashboard error.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
    const timer = window.setInterval(() => void load(true), 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const summary = useMemo(() => {
    if (!data) return null;
    const tenants = data.tenants.tenants;
    const activeTenants = tenants.filter((tenant) => tenant.is_active).length;
    const tenantLabel = data.tenants.next_cursor ? `${tenants.length}+` : String(tenants.length);
    return {
      tenantLabel,
      activeTenants,
      recentTenants: tenants.slice(0, 5),
      warnings: data.monitor.totals.warn + data.monitor.totals.critical
    };
  }, [data]);

  const updatedAt = data?.monitor.generated_at ?? data?.health.checked_at ?? null;
  const formattedUpdatedAt = updatedAt
    ? new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-US", {
        dateStyle: "medium",
        timeStyle: "short"
      }).format(new Date(updatedAt))
    : null;

  if (loading && !data) {
    return (
      <section className={styles.loadingState} aria-live="polite">
        <div className={styles.loadingPulse} />
        <div>
          <strong>{text.loading}</strong>
          <span>Health · Tenants · Monitoring</span>
        </div>
      </section>
    );
  }

  if (error && !data) {
    return (
      <section className={styles.errorState} role="alert">
        <div className={styles.errorIcon}>!</div>
        <div className={styles.errorCopy}>
          <h2>{text.loadErrorTitle}</h2>
          <p>{text.loadErrorDesc}</p>
          <code>{error}</code>
        </div>
        <button type="button" onClick={() => void load(false)}>{text.retry}</button>
      </section>
    );
  }

  if (!data || !summary) return null;

  return (
    <div className={styles.dashboard}>
      <section className={styles.hero}>
        <div>
          <div className={styles.eyebrow}>{text.eyebrow}</div>
          <h2>{text.title}</h2>
          <p>{text.description}</p>
        </div>
        <div className={styles.heroActions}>
          {formattedUpdatedAt ? <span>{text.lastUpdated}: {formattedUpdatedAt}</span> : null}
          <button type="button" onClick={() => void load(true)} disabled={refreshing}>
            {refreshing ? text.refreshing : text.refresh}
          </button>
        </div>
      </section>

      {error ? (
        <div className={styles.inlineWarning} role="status">
          <strong>{text.loadErrorTitle}</strong>
          <span>{error}</span>
        </div>
      ) : null}

      <section className={styles.metricsGrid} aria-label="IT control plane summary">
        <article className={styles.metricCard}>
          <div className={styles.metricHeader}>
            <span>{text.controlPlane}</span>
            <span className={`${styles.metricDot} ${data.health.status === "ready" ? styles.dotOk : styles.dotWarn}`} />
          </div>
          <strong>{data.health.status === "ready" ? text.ready : text.degraded}</strong>
          <small>{data.health.integration.mode}</small>
        </article>

        <article className={styles.metricCard}>
          <div className={styles.metricHeader}><span>{text.stores}</span></div>
          <strong>{summary.tenantLabel}</strong>
          <small>{text.activeStores}: {summary.activeTenants}</small>
        </article>

        <article className={styles.metricCard}>
          <div className={styles.metricHeader}><span>{text.monitoredBranches}</span></div>
          <strong>{data.monitor.totals.branches}</strong>
          <small>{text.branchWarnings}: {summary.warnings}</small>
        </article>

        <article className={styles.metricCard}>
          <div className={styles.metricHeader}><span>{text.apiErrors}</span></div>
          <strong>{data.monitor.totals.api_errors_recent_total}</strong>
          <small>{text.serverErrors}: {data.monitor.totals.api_errors_5xx_recent}</small>
        </article>
      </section>

      <section className={styles.mainGrid}>
        <article className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <h3>{text.architecture}</h3>
              <p>{text.architectureDesc}</p>
            </div>
          </div>

          <div className={styles.planeList}>
            <div className={styles.planeRow}>
              <div><strong>{text.businessPlane}</strong><span>Auth · Tenant · Store · Branch · Subscription</span></div>
              <StatusBadge ok={data.health.integration.auth_plane_ready} yes={text.reachable} no={text.unavailable} />
            </div>
            <div className={styles.planeRow}>
              <div><strong>{text.operationalPlane}</strong><span>Device registry · Health · Incident · Remote commands</span></div>
              <StatusBadge ok={data.health.integration.data_bridge_ready} yes={text.reachable} no={text.unavailable} />
            </div>
            <div className={styles.planeRow}>
              <div><strong>{text.posRuntime}</strong><span>Customer sales runtime</span></div>
              <span className={`${styles.statusBadge} ${styles.statusNeutral}`}>{text.isolated}</span>
            </div>
          </div>

          <div className={styles.noteBox}>{text.telemetryNote}</div>
        </article>

        <article className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <h3>{text.operations}</h3>
              <p>{text.operationsDesc}</p>
            </div>
            {summary.warnings === 0 ? <span className={`${styles.statusBadge} ${styles.statusOk}`}>{text.ready}</span> : null}
          </div>

          {data.monitor.degraded_sources?.length ? (
            <div className={styles.opsWarning}>{text.degradedSources}: {data.monitor.degraded_sources.join(", ")}</div>
          ) : null}

          <div className={styles.opsGrid}>
            <div><span>{text.queued}</span><strong>{data.monitor.totals.queued_orders}</strong></div>
            <div><span>{text.deadLetters}</span><strong>{data.monitor.totals.dead_letters_recent}</strong></div>
            <div><span>{text.http4xx}</span><strong>{data.monitor.totals.api_errors_4xx_recent}</strong></div>
            <div><span>{text.conflicts}</span><strong>{data.monitor.totals.api_errors_409_recent}</strong></div>
            <div><span>{text.http5xx}</span><strong>{data.monitor.totals.api_errors_5xx_recent}</strong></div>
          </div>

          {summary.warnings === 0 && !data.monitor.degraded_sources?.length ? (
            <div className={styles.clearState}>{text.noAlerts}</div>
          ) : null}
        </article>
      </section>

      <section className={styles.bottomGrid}>
        <article className={`${styles.panel} ${styles.storePanel}`}>
          <div className={styles.panelHeader}>
            <div>
              <h3>{text.recentStores}</h3>
              <p>{text.recentStoresDesc}</p>
            </div>
            <Link href="/it-admin/tenants" className={styles.textLink}>{text.viewAll}</Link>
          </div>

          {summary.recentTenants.length === 0 ? (
            <div className={styles.emptyState}>{text.emptyStores}</div>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.storeTable}>
                <thead>
                  <tr>
                    <th>{text.store}</th>
                    <th>{text.package}</th>
                    <th>{text.branches}</th>
                    <th>{text.devices}</th>
                    <th>{text.status}</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.recentTenants.map((tenant) => (
                    <tr key={tenant.id}>
                      <td>
                        <strong>{tenant.name}</strong>
                        <span>{tenant.store_code ?? tenant.code}</span>
                      </td>
                      <td>{tenant.package_name ?? text.noPackage}</td>
                      <td>{tenant.active_branch_count}/{tenant.branch_count}</td>
                      <td>{tenant.active_device_count}/{tenant.device_count}</td>
                      <td>
                        <span className={`${styles.statusBadge} ${tenant.is_active ? styles.statusOk : styles.statusNeutral}`}>
                          {tenant.is_active ? text.active : text.inactive}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>

        <aside className={`${styles.panel} ${styles.quickPanel}`}>
          <div className={styles.panelHeader}><div><h3>{text.quickActions}</h3></div></div>
          <div className={styles.quickLinks}>
            <Link href="/it-admin/tenants"><span>01</span><strong>{text.manageStores}</strong><small>Tenant / Store</small></Link>
            <Link href="/it-admin/monitoring"><span>02</span><strong>{text.openMonitoring}</strong><small>POS Health</small></Link>
            <Link href="/audit-logs"><span>03</span><strong>{text.auditLogs}</strong><small>Traceability</small></Link>
          </div>
        </aside>
      </section>
    </div>
  );
}
