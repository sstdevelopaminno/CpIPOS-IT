"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useItAccess } from "@/components/layout/app-shell";
import type { Language } from "@/lib/i18n";
import { DailySalesEmailOperations } from "./daily-sales-email-operations";

type CronJob = { jobname: string; schedule: string; active: boolean };
type PackagePolicy = { code: string; name: string; retention_months: number | null; is_active: boolean; status: string | null };
type CleanupRun = {
  id: string; scope: string; mode: string; source: string; actor_role: string | null;
  deleted_counts: Record<string, number>; created_at: string;
};
type SalesBatch = {
  id: string; tenant_id: string; tenant_name: string | null; package_code: string | null;
  retention_months: number; status: string; order_count: number; item_count: number;
  payment_count: number; shift_count: number; stock_movement_count: number;
  updated_at: string; last_error: string | null;
};
type OperationalPreview = {
  retention_days: number; timezone: string; cutoff_at: string;
  preview: {
    audit: { total: number; audit_logs: number };
    monitoring: { total: number; [key: string]: number };
    incidents: { total: number; [key: string]: number };
    print_history: { total: number; [key: string]: number };
  };
};
type Overview = {
  timezone: string;
  database: { size_bytes: number; size_pretty: string };
  operational: OperationalPreview;
  cron_jobs: CronJob[];
  packages: PackagePolicy[];
  sales_status: Record<string, number>;
  recent_sales_batches: SalesBatch[];
  recent_cleanup_runs: CleanupRun[];
};

type ModalKey = "overview" | "operational" | "sales" | "packages" | "history" | null;

const COPY = {
  th: {
    refresh: "รีเฟรช",
    overview: "ภาพรวมระบบ",
    operational: "Operational 7 วัน",
    sales: "Sales Retention",
    packages: "นโยบายแพ็กเกจ",
    history: "ประวัติงาน",
    close: "ปิด",
    database: "ขนาดฐานข้อมูล",
    expired: "Operational พ้นกำหนด",
    salesPending: "Sales Retention ที่ยังไม่จบ",
    cron: "งานอัตโนมัติ",
    active: "ทำงาน",
    inactive: "ปิด",
    rows: "รายการ",
    jobs: "งาน",
    operationalTitle: "Operational Retention · 7 วัน",
    operationalDesc: "Audit, Monitoring, Incident ที่ปิดแล้ว และ Print history เก่าจะถูกล้างอัตโนมัติ โดยไม่แตะสถานะเครื่องล่าสุด",
    runOperational: "รัน Cleanup 7 วันตอนนี้",
    salesTitle: "Sales Retention · ตามแพ็กเกจ",
    salesDesc: "ข้อมูลบิลจะ Export CSV → ส่งอีเมล → ตรวจไฟล์ → Purge ตามอายุแพ็กเกจ และไม่ลบหาก Email/Archive ไม่สำเร็จ",
    runSales: "รัน Sales Retention ตอนนี้",
    package: "แพ็กเกจ",
    months: "ระยะเก็บ",
    status: "สถานะ",
    monthUnit: "เดือน",
    customRetention: "ตามสัญญา / รายร้าน",
    recentSales: "Sales Retention ล่าสุด",
    recentCleanup: "Cleanup Ledger ล่าสุด",
    counts: "จำนวน",
    updated: "อัปเดต",
    result: "ผลลัพธ์",
    noData: "ยังไม่มีข้อมูล",
    running: "กำลังสั่งงาน...",
    successOperational: "รัน Operational Retention สำเร็จ",
    successSales: "ส่งคำสั่ง Sales Retention Worker แล้ว",
    failed: "ดำเนินการไม่สำเร็จ",
    confirmOperational: "ยืนยันรัน Cleanup ข้อมูล Operational ที่เก่ากว่า 7 วันตอนนี้?",
    confirmSales: "ยืนยันรัน Sales Retention Worker ตอนนี้? ระบบจะประมวลผลเฉพาะข้อมูลที่ครบกำหนดตามแพ็กเกจ",
    scheduleSales: "00:00 น. ไทย",
    scheduleOps: "00:10 น. ไทย",
    errorState: "ต้องตรวจสอบ",
    completed: "ปกติ",
    supportOnly: "สั่งงานได้เฉพาะ IT Support"
  },
  en: {
    refresh: "Refresh",
    overview: "System overview",
    operational: "Operational 7 days",
    sales: "Sales Retention",
    packages: "Package policies",
    history: "History",
    close: "Close",
    database: "Database size",
    expired: "Expired operational",
    salesPending: "Unfinished Sales Retention",
    cron: "Automation jobs",
    active: "Active",
    inactive: "Inactive",
    rows: "records",
    jobs: "jobs",
    operationalTitle: "Operational Retention · 7 days",
    operationalDesc: "Old audit, monitoring, resolved incidents and print history are cleaned automatically without deleting latest device state.",
    runOperational: "Run 7-day cleanup now",
    salesTitle: "Sales Retention · by package",
    salesDesc: "Expired sales data follows CSV export → email → verification → purge. Purge is blocked if email or archive verification fails.",
    runSales: "Run Sales Retention now",
    package: "Package",
    months: "Retention",
    status: "Status",
    monthUnit: "months",
    customRetention: "Per contract / tenant",
    recentSales: "Recent Sales Retention",
    recentCleanup: "Recent Cleanup Ledger",
    counts: "Counts",
    updated: "Updated",
    result: "Result",
    noData: "No data yet",
    running: "Running...",
    successOperational: "Operational retention completed",
    successSales: "Sales retention worker invoked",
    failed: "Action failed",
    confirmOperational: "Run cleanup for operational records older than 7 days now?",
    confirmSales: "Run the Sales Retention worker now? Only package-expired data will be processed.",
    scheduleSales: "00:00 Bangkok",
    scheduleOps: "00:10 Bangkok",
    errorState: "Needs attention",
    completed: "Healthy",
    supportOnly: "Actions require IT Support"
  }
} as const;

function dateTime(value: string | null | undefined, language: Language) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(language === "th" ? "th-TH" : "en-US", {
    timeZone: "Asia/Bangkok",
    dateStyle: "short",
    timeStyle: "short"
  });
}

function deletedTotal(counts: Record<string, number> | null | undefined) {
  return Object.values(counts ?? {}).reduce((sum, value) => sum + Number(value || 0), 0);
}

function statusClass(status: string) {
  if (status === "purged") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (["failed", "email_failed", "email_blocked"].includes(status)) return "border-red-200 bg-red-50 text-red-700";
  if (["exported", "email_pending", "purge_ready"].includes(status)) return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

export function ItMaintenanceConsole({ language }: { language: Language }) {
  const t = COPY[language];
  const access = useItAccess();
  const canRun = access.role === "it_support";
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"operational" | "sales" | null>(null);
  const [modal, setModal] = useState<ModalKey>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const response = await fetch("/api/it-admin/v1/maintenance/overview", { cache: "no-store" });
      const body = await response.json().catch(() => null) as { data?: Overview; error?: { message?: string } } | null;
      if (!response.ok || !body?.data) throw new Error(body?.error?.message || t.failed);
      setOverview(body.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.failed);
    } finally {
      setLoading(false);
    }
  }, [t.failed]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!modal) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setModal(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [modal]);

  const expiredTotal = useMemo(() => {
    const p = overview?.operational?.preview;
    if (!p) return 0;
    return Number(p.audit?.total ?? 0) + Number(p.monitoring?.total ?? 0)
      + Number(p.incidents?.total ?? 0) + Number(p.print_history?.total ?? 0);
  }, [overview]);

  const unfinishedSales = useMemo(() => {
    return Object.entries(overview?.sales_status ?? {})
      .filter(([status]) => status !== "purged")
      .reduce((sum, [, count]) => sum + Number(count || 0), 0);
  }, [overview]);

  const errorSales = useMemo(() => {
    const s = overview?.sales_status ?? {};
    return Number(s.failed ?? 0) + Number(s.email_failed ?? 0) + Number(s.email_blocked ?? 0);
  }, [overview]);

  async function run(action: "run_operational_retention" | "run_sales_retention") {
    const operational = action === "run_operational_retention";
    if (!window.confirm(operational ? t.confirmOperational : t.confirmSales)) return;
    setBusy(operational ? "operational" : "sales");
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/it-admin/v1/maintenance/overview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, confirmation: "RUN_RETENTION" })
      });
      const body = await response.json().catch(() => null) as { data?: unknown; error?: { message?: string } } | null;
      if (!response.ok) throw new Error(body?.error?.message || t.failed);
      setMessage(operational ? t.successOperational : t.successSales);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t.failed);
    } finally {
      setBusy(null);
    }
  }

  const activeCrons = (overview?.cron_jobs ?? []).filter((job) => job.active).length;
  const locale = language === "th" ? "th-TH" : "en-US";

  const toolbar = [
    ["overview", t.overview],
    ["operational", t.operational],
    ["sales", t.sales],
    ["packages", t.packages],
    ["history", t.history]
  ] as Array<[Exclude<ModalKey, null>, string]>;

  return (
    <div className="space-y-4 pb-8">
      {message ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">{message}</div> : null}
      {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</div> : null}

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3">
        {toolbar.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setModal(key)}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-black text-slate-800 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading || busy !== null}
          className="ml-auto rounded-xl border border-blue-300 bg-blue-50 px-4 py-2 text-sm font-black text-blue-700 disabled:opacity-50"
        >
          {t.refresh}
        </button>
      </div>

      <DailySalesEmailOperations language={language} />

      {modal ? (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/55 p-3 backdrop-blur-[2px]">
          <div className="flex max-h-[92vh] w-full max-w-[980px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
              <h3 className="text-lg font-black text-slate-950">
                {modal === "overview" ? t.overview
                  : modal === "operational" ? t.operationalTitle
                    : modal === "sales" ? t.salesTitle
                      : modal === "packages" ? t.packages
                        : t.history}
              </h3>
              <button
                type="button"
                onClick={() => setModal(null)}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-black text-slate-700"
              >
                {t.close}
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-auto p-5">
              {modal === "overview" ? (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                    <div className="text-xs font-bold text-slate-500">{t.database}</div>
                    <div className="mt-2 text-3xl font-black text-slate-950">{overview?.database?.size_pretty ?? (loading ? "…" : "—")}</div>
                    <div className="mt-1 text-xs text-slate-500">CpiPOS-001</div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                    <div className="text-xs font-bold text-slate-500">{t.expired}</div>
                    <div className="mt-2 text-3xl font-black text-slate-950">{expiredTotal.toLocaleString(locale)}</div>
                    <div className="mt-1 text-xs text-slate-500">{t.rows}</div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                    <div className="text-xs font-bold text-slate-500">{t.salesPending}</div>
                    <div className={"mt-2 text-3xl font-black " + (errorSales > 0 ? "text-red-600" : "text-slate-950")}>{unfinishedSales.toLocaleString(locale)}</div>
                    <div className="mt-1 text-xs text-slate-500">{errorSales > 0 ? t.errorState + ": " + errorSales : t.completed}</div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                    <div className="text-xs font-bold text-slate-500">{t.cron}</div>
                    <div className="mt-2 text-3xl font-black text-slate-950">{activeCrons}/{overview?.cron_jobs?.length ?? 0}</div>
                    <div className="mt-1 text-xs text-slate-500">{t.jobs}</div>
                  </div>
                </div>
              ) : null}

              {modal === "operational" ? (
                <div>
                  <p className="text-sm leading-6 text-slate-600">{t.operationalDesc}</p>
                  <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {[
                      ["Audit", overview?.operational?.preview?.audit?.total ?? 0],
                      ["Monitoring", overview?.operational?.preview?.monitoring?.total ?? 0],
                      ["Incidents", overview?.operational?.preview?.incidents?.total ?? 0],
                      ["Print", overview?.operational?.preview?.print_history?.total ?? 0]
                    ].map(([label, count]) => (
                      <div key={String(label)} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
                        <div className="text-xs font-bold text-slate-500">{String(label)}</div>
                        <div className="mt-1 text-2xl font-black text-slate-900">{Number(count).toLocaleString(locale)}</div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-600">
                    {(overview?.cron_jobs ?? []).filter((job) => job.jobname === "cpipos_operational_retention_7d").map((job) => (
                      <span key={job.jobname} className="rounded-full border border-slate-200 px-3 py-1">
                        {job.active ? t.active : t.inactive} · {t.scheduleOps} · {job.schedule}
                      </span>
                    ))}
                  </div>
                  <div className="mt-5 text-right">
                    <button
                      type="button"
                      disabled={!canRun || busy !== null || expiredTotal === 0}
                      onClick={() => void run("run_operational_retention")}
                      className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-black text-amber-900 disabled:opacity-40"
                    >
                      {busy === "operational" ? t.running : !canRun ? t.supportOnly : t.runOperational}
                    </button>
                  </div>
                </div>
              ) : null}

              {modal === "sales" ? (
                <div>
                  <p className="text-sm leading-6 text-slate-600">{t.salesDesc}</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {Object.entries(overview?.sales_status ?? {}).length
                      ? Object.entries(overview?.sales_status ?? {}).map(([status, count]) => (
                          <span key={status} className={"rounded-full border px-3 py-1 text-xs font-bold " + statusClass(status)}>
                            {status}: {Number(count).toLocaleString(locale)}
                          </span>
                        ))
                      : <span className="text-sm text-slate-500">{t.noData}</span>}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-600">
                    {(overview?.cron_jobs ?? []).filter((job) => job.jobname === "cpipos_sales_retention_daily").map((job) => (
                      <span key={job.jobname} className="rounded-full border border-slate-200 px-3 py-1">
                        {job.active ? t.active : t.inactive} · {t.scheduleSales} · {job.schedule}
                      </span>
                    ))}
                  </div>
                  <div className="mt-5 text-right">
                    <button
                      type="button"
                      disabled={!canRun || busy !== null}
                      onClick={() => void run("run_sales_retention")}
                      className="rounded-xl border border-blue-300 bg-blue-50 px-4 py-2 text-sm font-black text-blue-800 disabled:opacity-40"
                    >
                      {busy === "sales" ? t.running : !canRun ? t.supportOnly : t.runSales}
                    </button>
                  </div>
                </div>
              ) : null}

              {modal === "packages" ? (
                <div className="overflow-hidden rounded-xl border border-slate-200">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs text-slate-500">
                      <tr>
                        <th className="px-5 py-3">{t.package}</th>
                        <th className="px-5 py-3">{t.months}</th>
                        <th className="px-5 py-3">{t.status}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(overview?.packages ?? []).map((pkg) => (
                        <tr key={pkg.code}>
                          <td className="px-5 py-3">
                            <div className="font-bold text-slate-900">{pkg.name}</div>
                            <div className="text-xs text-slate-500">{pkg.code}</div>
                          </td>
                          <td className="px-5 py-3 font-bold">
                            {pkg.retention_months == null ? t.customRetention : String(pkg.retention_months) + " " + t.monthUnit}
                          </td>
                          <td className="px-5 py-3">
                            <span className={"rounded-full border px-2.5 py-1 text-xs font-bold " + (pkg.is_active
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                              : "border-slate-200 bg-slate-50 text-slate-500")}>
                              {pkg.is_active ? t.active : t.inactive}
                            </span>
                          </td>
                        </tr>
                      ))}
                      {!loading && !(overview?.packages ?? []).length ? (
                        <tr><td colSpan={3} className="px-5 py-6 text-center text-slate-500">{t.noData}</td></tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              ) : null}

              {modal === "history" ? (
                <div className="grid gap-4 lg:grid-cols-2">
                  <section className="overflow-hidden rounded-xl border border-slate-200">
                    <div className="border-b border-slate-200 px-4 py-3">
                      <h4 className="font-black text-slate-950">{t.recentSales}</h4>
                    </div>
                    <div className="max-h-[520px] overflow-auto">
                      {(overview?.recent_sales_batches ?? []).length ? (overview?.recent_sales_batches ?? []).map((batch) => (
                        <div key={batch.id} className="border-b border-slate-100 px-4 py-4 last:border-b-0">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="font-bold text-slate-900">{batch.tenant_name || batch.tenant_id}</div>
                              <div className="mt-1 text-xs text-slate-500">{batch.package_code || "—"} · {batch.retention_months} {t.monthUnit}</div>
                            </div>
                            <span className={"rounded-full border px-2.5 py-1 text-[11px] font-bold " + statusClass(batch.status)}>{batch.status}</span>
                          </div>
                          <div className="mt-2 text-xs text-slate-600">{t.counts}: {batch.order_count} orders · {batch.item_count} items · {batch.payment_count} payments</div>
                          <div className="mt-1 text-xs text-slate-500">{t.updated}: {dateTime(batch.updated_at, language)}</div>
                          {batch.last_error ? <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{batch.last_error}</div> : null}
                        </div>
                      )) : <div className="px-4 py-8 text-center text-sm text-slate-500">{t.noData}</div>}
                    </div>
                  </section>

                  <section className="overflow-hidden rounded-xl border border-slate-200">
                    <div className="border-b border-slate-200 px-4 py-3">
                      <h4 className="font-black text-slate-950">{t.recentCleanup}</h4>
                    </div>
                    <div className="max-h-[520px] overflow-auto">
                      {(overview?.recent_cleanup_runs ?? []).length ? (overview?.recent_cleanup_runs ?? []).map((run) => (
                        <div key={run.id} className="border-b border-slate-100 px-4 py-4 last:border-b-0">
                          <div className="flex items-start justify-between gap-3">
                            <div className="font-bold text-slate-900">{run.scope} · {run.mode}</div>
                            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-bold text-slate-600">{run.source}</span>
                          </div>
                          <div className="mt-2 text-xs text-slate-600">{t.result}: {deletedTotal(run.deleted_counts).toLocaleString(locale)} {t.rows}</div>
                          <div className="mt-1 text-xs text-slate-500">{dateTime(run.created_at, language)}</div>
                        </div>
                      )) : <div className="px-4 py-8 text-center text-sm text-slate-500">{t.noData}</div>}
                    </div>
                  </section>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
