"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type MonitorItem = {
  branch_id: string;
  branch_name: string;
  level: "ok" | "warn" | "critical";
  queued_orders: number;
  queued_orders_stale: number;
  print_queue_depth: number;
  print_failed_recent: number;
  dead_letters_recent: number;
  order_dead_letters_recent: number;
  payment_dead_letters_recent: number;
  api_errors_recent_total: number;
  api_errors_4xx_recent: number;
  api_errors_409_recent: number;
  api_errors_5xx_recent: number;
  api_error_routes_top: Array<{ route: string; count: number }>;
};

type MonitorPayload = {
  generated_at: string;
  filters: {
    minutes: number;
    branch_id: string | null;
  };
  totals: {
    branches: number;
    queued_orders: number;
    dead_letters_recent: number;
    order_dead_letters_recent: number;
    payment_dead_letters_recent: number;
    critical: number;
    warn: number;
    api_errors_recent_total: number;
    api_errors_4xx_recent: number;
    api_errors_409_recent: number;
    api_errors_5xx_recent: number;
  };
  items: MonitorItem[];
};

type PlatformConnectionStatus = "online" | "degraded" | "unreachable" | "unconfigured" | "misconfigured";

type PlatformTarget = {
  id: "pos_web" | "backoffice_web";
  label: string;
  status: PlatformConnectionStatus;
  hostname: string | null;
  version_endpoint: string;
  http_status: number | null;
  latency_ms: number | null;
  checked_at: string;
  version: {
    web: {
      commit_sha: string | null;
      commit_ref: string | null;
      environment: string | null;
    };
    source_versions: Record<string, string>;
    generated_at: string | null;
  } | null;
  message: string | null;
};

type PlatformStatusPayload = {
  checked_at: string;
  timeout_ms: number;
  summary: {
    total: number;
    online: number;
    attention: number;
  };
  targets: PlatformTarget[];
};

const WINDOW_OPTIONS = [
  { value: 15, label: "15 นาที" },
  { value: 30, label: "30 นาที" },
  { value: 60, label: "1 ชั่วโมง" },
  { value: 180, label: "3 ชั่วโมง" },
  { value: 360, label: "6 ชั่วโมง" },
  { value: 1440, label: "24 ชั่วโมง" }
];

function levelBadgeClass(level: MonitorItem["level"]) {
  if (level === "critical") return "pos-monitor-level pos-monitor-level--critical";
  if (level === "warn") return "pos-monitor-level pos-monitor-level--warn";
  return "pos-monitor-level pos-monitor-level--ok";
}

function platformBadgeClass(status: PlatformConnectionStatus) {
  if (status === "online") return "pos-monitor-level pos-monitor-level--ok";
  if (status === "degraded" || status === "unconfigured") return "pos-monitor-level pos-monitor-level--warn";
  return "pos-monitor-level pos-monitor-level--critical";
}

function formatSourceVersions(versions: Record<string, string> | undefined) {
  if (!versions) return "-";
  const rows = Object.entries(versions);
  if (rows.length === 0) return "-";
  return rows.map(([key, value]) => `${key}: ${value}`).join(", ");
}

export default function MonitoringPage() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [platformError, setPlatformError] = useState<string | null>(null);
  const [minutes, setMinutes] = useState(60);
  const [branchId, setBranchId] = useState<string>("all");
  const [data, setData] = useState<MonitorPayload | null>(null);
  const [platformData, setPlatformData] = useState<PlatformStatusPayload | null>(null);

  const loadPlatformStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/it-admin/v1/platform-status", { cache: "no-store" });
      const body = (await response.json()) as { data?: PlatformStatusPayload; error?: { message?: string } };
      if (!response.ok || body.error || !body.data) {
        throw new Error(body.error?.message ?? "Failed to load POS platform status.");
      }
      setPlatformData(body.data);
      setPlatformError(null);
    } catch (loadError) {
      setPlatformError(loadError instanceof Error ? loadError.message : "Unknown platform connection error");
    }
  }, []);

  const load = useCallback(
    async (silent = false) => {
      if (silent) setRefreshing(true);
      else setLoading(true);
      setError(null);
      void loadPlatformStatus();

      try {
        const query = new URLSearchParams();
        query.set("minutes", String(minutes));
        if (branchId !== "all") {
          query.set("branch_id", branchId);
        }
        const response = await fetch(`/api/admin/pos/monitor?${query.toString()}`, { cache: "no-store" });
        const body = (await response.json()) as { data?: MonitorPayload; error?: { message?: string } };
        if (!response.ok || body.error || !body.data) {
          throw new Error(body.error?.message ?? "Failed to load monitor data.");
        }
        setData(body.data);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Unknown error");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [minutes, branchId, loadPlatformStatus]
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void load(true);
    }, 15000);
    return () => window.clearInterval(timer);
  }, [load]);

  const branchOptions = useMemo(() => {
    const rows = data?.items ?? [];
    const unique = new Map<string, string>();
    for (const item of rows) {
      unique.set(item.branch_id, item.branch_name);
    }
    return Array.from(unique.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [data?.items]);

  const sortedRows = useMemo(() => {
    const rows = [...(data?.items ?? [])];
    const score = (level: MonitorItem["level"]) => (level === "critical" ? 3 : level === "warn" ? 2 : 1);
    return rows.sort((a, b) => {
      const byLevel = score(b.level) - score(a.level);
      if (byLevel !== 0) return byLevel;
      const byApiErrors = b.api_errors_recent_total - a.api_errors_recent_total;
      if (byApiErrors !== 0) return byApiErrors;
      return b.queued_orders - a.queued_orders;
    });
  }, [data?.items]);

  return (
    <section className="surface pos-monitor-card">
      <div className="pos-monitor-head">
        <div>
          <h2 className="pos-monitor-head__title">IT Monitoring: POS Health</h2>
          <p className="pos-monitor-head__subtitle">ตรวจการเชื่อมต่อระบบ POS และกรองสุขภาพรายสาขา พร้อม API 4xx/409/5xx</p>
        </div>
        <div className="pos-monitor-head__actions">
          <label className="pos-monitor-date-field">
            ช่วงเวลา
            <select value={minutes} onChange={(event) => setMinutes(Number(event.target.value))}>
              {WINDOW_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="pos-monitor-date-field">
            สาขา
            <select value={branchId} onChange={(event) => setBranchId(event.target.value)}>
              <option value="all">ทุกสาขา</option>
              {branchOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="pos-monitor-btn pos-monitor-btn--primary" onClick={() => void load(false)} disabled={loading || refreshing}>
            {loading || refreshing ? "กำลังรีเฟรช..." : "รีเฟรช"}
          </button>
        </div>
      </div>

      <div className="pos-monitor-meta">
        <span className="pos-monitor-pill">POS Platforms: {platformData ? `${platformData.summary.online}/${platformData.summary.total} online` : "กำลังตรวจสอบ"}</span>
        {platformData?.summary.attention ? <span className="pos-monitor-pill pos-monitor-pill--warn">Attention: {platformData.summary.attention}</span> : null}
        {platformData ? <span className="pos-monitor-pill">Checked: {new Date(platformData.checked_at).toLocaleString("th-TH")}</span> : null}
      </div>

      {platformError ? <div className="pos-monitor-banner pos-monitor-banner--error">POS platform check: {platformError}</div> : null}

      {platformData ? (
        <div className="pos-monitor-table-wrap">
          <table className="pos-monitor-table">
            <thead>
              <tr>
                <th>ระบบ POS</th>
                <th>สถานะ</th>
                <th>Host</th>
                <th>HTTP</th>
                <th>Latency</th>
                <th>Environment</th>
                <th>Commit</th>
                <th>Source Versions</th>
              </tr>
            </thead>
            <tbody>
              {platformData.targets.map((target) => (
                <tr key={target.id}>
                  <td>
                    <strong>{target.label}</strong>
                    <br />
                    <small>{target.version_endpoint}</small>
                  </td>
                  <td>
                    <span className={platformBadgeClass(target.status)}>{target.status.toUpperCase()}</span>
                    {target.message ? (
                      <>
                        <br />
                        <small>{target.message}</small>
                      </>
                    ) : null}
                  </td>
                  <td>{target.hostname ?? "-"}</td>
                  <td>{target.http_status ?? "-"}</td>
                  <td>{target.latency_ms === null ? "-" : `${target.latency_ms} ms`}</td>
                  <td>{target.version?.web.environment ?? "-"}</td>
                  <td>{target.version?.web.commit_sha ? target.version.web.commit_sha.slice(0, 10) : "-"}</td>
                  <td>{formatSourceVersions(target.version?.source_versions)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {error ? <div className="pos-monitor-banner pos-monitor-banner--error">{error}</div> : null}
      {!error && loading ? <p className="pos-monitor-loading">กำลังโหลดข้อมูล monitoring...</p> : null}

      {!loading && !error && data ? (
        <>
          <div className="pos-monitor-meta">
            <span className="pos-monitor-pill">Branches: {data.totals.branches}</span>
            <span className="pos-monitor-pill">Queued: {data.totals.queued_orders}</span>
            <span className="pos-monitor-pill">Dead letters: {data.totals.dead_letters_recent}</span>
            <span className="pos-monitor-pill">API errors: {data.totals.api_errors_recent_total}</span>
            <span className="pos-monitor-pill pos-monitor-pill--warn">4xx: {data.totals.api_errors_4xx_recent}</span>
            <span className="pos-monitor-pill pos-monitor-pill--warn">409: {data.totals.api_errors_409_recent}</span>
            <span className="pos-monitor-pill pos-monitor-pill--critical">5xx: {data.totals.api_errors_5xx_recent}</span>
            <span className="pos-monitor-pill">Updated: {new Date(data.generated_at).toLocaleString("th-TH")}</span>
          </div>

          <div className="pos-monitor-table-wrap">
            <table className="pos-monitor-table">
              <thead>
                <tr>
                  <th>สาขา</th>
                  <th>สถานะ</th>
                  <th>Queued</th>
                  <th>Stale</th>
                  <th>Print Queue</th>
                  <th>Dead Letters</th>
                  <th>4xx</th>
                  <th>409</th>
                  <th>5xx</th>
                  <th>Top Error Routes</th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row) => (
                  <tr key={row.branch_id}>
                    <td>{row.branch_name}</td>
                    <td>
                      <span className={levelBadgeClass(row.level)}>{row.level.toUpperCase()}</span>
                    </td>
                    <td>{row.queued_orders}</td>
                    <td>{row.queued_orders_stale}</td>
                    <td>{row.print_queue_depth}</td>
                    <td>{row.dead_letters_recent + row.print_failed_recent}</td>
                    <td>{row.api_errors_4xx_recent}</td>
                    <td>{row.api_errors_409_recent}</td>
                    <td>{row.api_errors_5xx_recent}</td>
                    <td>{row.api_error_routes_top.length > 0 ? row.api_error_routes_top.map((entry) => `${entry.route} (${entry.count})`).join(", ") : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </section>
  );
}
