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

export default function MonitoringPage() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [minutes, setMinutes] = useState(60);
  const [branchId, setBranchId] = useState<string>("all");
  const [data, setData] = useState<MonitorPayload | null>(null);

  const load = useCallback(
    async (silent = false) => {
      if (silent) setRefreshing(true);
      else setLoading(true);
      setError(null);
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
    [minutes, branchId]
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
          <p className="pos-monitor-head__subtitle">กรองตามช่วงเวลาและสาขา พร้อมดู API 4xx/409/5xx ต่อสาขา</p>
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
