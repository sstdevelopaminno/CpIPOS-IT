"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useItAccess } from "@/components/layout/app-shell";
import type { Language } from "@/lib/i18n";

type Delivery = {
  id: string;
  business_date: string | null;
  recipient_email: string;
  status: string;
  attempt_count: number;
  last_attempt_at: string | null;
  sent_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  retryable: boolean;
};

type StoreRow = {
  tenant_id: string;
  tenant_name: string;
  tenant_active: boolean;
  enabled: boolean;
  setting_updated_at: string | null;
  owner: {
    user_id: string | null;
    name: string;
    email: string | null;
    ready: boolean;
    problem: string | null;
  };
  latest_delivery: Delivery | null;
};

type Overview = {
  timezone: string;
  cutoff: string;
  send_at: string;
  target_business_date: string;
  stats: {
    total_stores: number;
    active_stores: number;
    enabled: number;
    disabled: number;
    owner_not_ready: number;
    sent_latest: number;
    failed_latest: number;
    blocked_latest: number;
    retryable: number;
  };
  stores: StoreRow[];
};

type Filter = "all" | "enabled" | "disabled" | "needs_attention";

const COPY = {
  th: {
    eyebrow: "DAILY SALES EMAIL OPERATIONS",
    title: "ติดตามการส่งสรุปยอดขายรายวัน",
    desc: "ดูสถานะเปิด/ปิดของทุกร้าน อีเมล Owner ปัจจุบัน ผลการส่งล่าสุด และ Retry เฉพาะรายการที่ Failed/Blocked",
    refresh: "รีเฟรช",
    total: "ร้านทั้งหมด",
    enabled: "เปิดส่ง",
    disabled: "ปิดส่ง",
    attention: "ต้องตรวจสอบ",
    retryable: "Retry ได้",
    search: "ค้นหาร้านหรืออีเมล Owner",
    all: "ทั้งหมด",
    filterEnabled: "เปิดส่ง",
    filterDisabled: "ปิดส่ง",
    filterAttention: "มีปัญหา",
    store: "ร้าน",
    email: "Owner Email",
    switch: "การส่ง",
    businessDate: "วันที่ยอดขาย",
    latest: "ส่งล่าสุด",
    action: "จัดการ",
    on: "เปิด",
    off: "ปิด",
    noDelivery: "ยังไม่เคยส่ง",
    ready: "พร้อม",
    ownerProblem: "Owner ไม่พร้อม",
    retry: "Retry",
    retrying: "กำลัง Retry…",
    supportOnly: "IT Support เท่านั้น",
    sent: "ส่งสำเร็จ",
    failed: "ส่งไม่สำเร็จ",
    blocked: "ถูกบล็อก",
    pending: "รอส่ง",
    sending: "กำลังส่ง",
    confirmRetry: "ยืนยัน Retry อีเมลสรุปยอดขายรายการนี้? ระบบจะใช้อีเมล Owner ปัจจุบันและจะไม่ส่งซ้ำหากรายการเดิมสำเร็จแล้ว",
    retrySuccess: "Retry และส่งอีเมลสำเร็จแล้ว",
    loadFailed: "โหลดสถานะ Daily Sales Email ไม่สำเร็จ",
    retryFailed: "Retry ไม่สำเร็จ",
    schedule: "ตัดวัน 00:00 · ส่ง 00:15 น. · Asia/Bangkok",
    noRows: "ไม่พบร้านตามตัวกรอง"
  },
  en: {
    eyebrow: "DAILY SALES EMAIL OPERATIONS",
    title: "Daily sales email operations",
    desc: "Track per-store enablement, current Owner email, last delivery and retry only failed/blocked deliveries.",
    refresh: "Refresh",
    total: "Stores",
    enabled: "Enabled",
    disabled: "Disabled",
    attention: "Needs attention",
    retryable: "Retryable",
    search: "Search store or Owner email",
    all: "All",
    filterEnabled: "Enabled",
    filterDisabled: "Disabled",
    filterAttention: "Attention",
    store: "Store",
    email: "Owner Email",
    switch: "Delivery",
    businessDate: "Sales date",
    latest: "Latest delivery",
    action: "Action",
    on: "On",
    off: "Off",
    noDelivery: "No delivery yet",
    ready: "Ready",
    ownerProblem: "Owner not ready",
    retry: "Retry",
    retrying: "Retrying…",
    supportOnly: "IT Support only",
    sent: "Sent",
    failed: "Failed",
    blocked: "Blocked",
    pending: "Pending",
    sending: "Sending",
    confirmRetry: "Retry this daily sales email? The current Owner email will be used and sent deliveries are protected from duplicates.",
    retrySuccess: "Retry sent successfully",
    loadFailed: "Unable to load Daily Sales Email status",
    retryFailed: "Retry failed",
    schedule: "00:00 cutoff · 00:15 delivery · Asia/Bangkok",
    noRows: "No stores match this filter"
  }
} as const;

function statusLabel(status: string | null | undefined, language: Language) {
  const t = COPY[language];
  if (status === "sent") return t.sent;
  if (status === "failed") return t.failed;
  if (status === "blocked") return t.blocked;
  if (status === "pending") return t.pending;
  if (status === "sending") return t.sending;
  return t.noDelivery;
}

function statusClass(status: string | null | undefined) {
  if (status === "sent") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "failed" || status === "blocked") return "border-red-200 bg-red-50 text-red-700";
  if (status === "pending" || status === "sending") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

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

function businessDate(value: string | null | undefined, language: Language) {
  if (!value) return "—";
  const date = new Date(value + "T12:00:00+07:00");
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(language === "th" ? "th-TH" : "en-US", {
    timeZone: "Asia/Bangkok",
    dateStyle: "medium"
  });
}

export function DailySalesEmailOperations({ language }: { language: Language }) {
  const t = COPY[language];
  const access = useItAccess();
  const canRetry = access.role === "it_support";
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const response = await fetch("/api/it-admin/v1/maintenance/daily-sales-email", {
        cache: "no-store",
        credentials: "include"
      });
      const body = await response.json().catch(() => null) as {
        data?: Overview;
        error?: { message?: string };
      } | null;
      if (!response.ok || !body?.data) throw new Error(body?.error?.message || t.loadFailed);
      setData(body.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.loadFailed);
    } finally {
      setLoading(false);
    }
  }, [t.loadFailed]);

  useEffect(() => { void load(); }, [load]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (data?.stores ?? []).filter((row) => {
      if (filter === "enabled" && !row.enabled) return false;
      if (filter === "disabled" && row.enabled) return false;
      if (filter === "needs_attention") {
        const deliveryProblem = ["failed", "blocked"].includes(row.latest_delivery?.status ?? "");
        if (!deliveryProblem && !(row.enabled && !row.owner.ready)) return false;
      }
      if (!needle) return true;
      return row.tenant_name.toLowerCase().includes(needle)
        || (row.owner.email ?? "").toLowerCase().includes(needle)
        || row.owner.name.toLowerCase().includes(needle);
    });
  }, [data?.stores, filter, query]);

  async function retry(row: StoreRow) {
    const delivery = row.latest_delivery;
    if (!delivery?.retryable || !canRetry || retrying) return;
    if (!window.confirm(t.confirmRetry)) return;

    setRetrying(delivery.id);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/it-admin/v1/maintenance/daily-sales-email", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "retry_failed_daily_sales_email",
          delivery_id: delivery.id,
          confirmation: "RETRY_DAILY_SALES_EMAIL"
        })
      });
      const body = await response.json().catch(() => null) as {
        data?: unknown;
        error?: { message?: string };
      } | null;
      if (!response.ok) throw new Error(body?.error?.message || t.retryFailed);
      setMessage(t.retrySuccess);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t.retryFailed);
    } finally {
      setRetrying(null);
    }
  }

  const stats = data?.stats;
  const locale = language === "th" ? "th-TH" : "en-US";

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-5 py-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-[11px] font-black tracking-[0.18em] text-blue-600">{t.eyebrow}</div>
            <h3 className="mt-1 text-xl font-black text-slate-950">{t.title}</h3>
            <p className="mt-1 max-w-4xl text-xs leading-5 text-slate-500">{t.desc}</p>
            <div className="mt-2 text-[11px] font-bold text-slate-500">{t.schedule}</div>
          </div>
          <button type="button" onClick={() => void load()} disabled={loading || retrying !== null}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-800 disabled:opacity-50">
            {t.refresh}
          </button>
        </div>
      </div>

      {message ? <div className="mx-5 mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">{message}</div> : null}
      {error ? <div className="mx-5 mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</div> : null}

      <div className="grid gap-3 px-5 py-4 sm:grid-cols-2 xl:grid-cols-5">
        {[
          [t.total, stats?.total_stores ?? 0, "text-slate-950"],
          [t.enabled, stats?.enabled ?? 0, "text-emerald-700"],
          [t.disabled, stats?.disabled ?? 0, "text-slate-700"],
          [t.attention, (stats?.owner_not_ready ?? 0) + (stats?.failed_latest ?? 0) + (stats?.blocked_latest ?? 0), "text-red-600"],
          [t.retryable, stats?.retryable ?? 0, "text-amber-700"]
        ].map(([label, value, tone]) => (
          <div key={String(label)} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="text-[11px] font-bold text-slate-500">{String(label)}</div>
            <div className={"mt-1 text-2xl font-black " + String(tone)}>{Number(value).toLocaleString(locale)}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-y border-slate-200 bg-slate-50/60 px-5 py-3">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t.search}
          className="min-w-[240px] flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400"
        />
        {([
          ["all", t.all],
          ["enabled", t.filterEnabled],
          ["disabled", t.filterDisabled],
          ["needs_attention", t.filterAttention]
        ] as Array<[Filter, string]>).map(([key, label]) => (
          <button key={key} type="button" onClick={() => setFilter(key)}
            className={"rounded-xl border px-3 py-2 text-xs font-bold " + (filter === key
              ? "border-blue-300 bg-blue-50 text-blue-700"
              : "border-slate-300 bg-white text-slate-600")}>
            {label}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-[1040px] w-full text-sm">
          <thead className="bg-slate-50 text-left text-[11px] font-bold text-slate-500">
            <tr>
              <th className="px-5 py-3">{t.store}</th>
              <th className="px-4 py-3">{t.email}</th>
              <th className="px-4 py-3">{t.switch}</th>
              <th className="px-4 py-3">{t.businessDate}</th>
              <th className="px-4 py-3">{t.latest}</th>
              <th className="px-5 py-3 text-right">{t.action}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => {
              const delivery = row.latest_delivery;
              return (
                <tr key={row.tenant_id} className="align-top hover:bg-slate-50/70">
                  <td className="px-5 py-4">
                    <div className="font-black text-slate-900">{row.tenant_name}</div>
                    <div className="mt-1 text-[11px] text-slate-500">{row.tenant_active ? "Active" : "Inactive"}</div>
                  </td>
                  <td className="px-4 py-4">
                    <div className="max-w-[260px] break-all font-bold text-slate-800">{row.owner.email || "—"}</div>
                    <div className={"mt-1 text-[11px] font-bold " + (row.owner.ready ? "text-emerald-700" : "text-red-600")}>
                      {row.owner.ready ? t.ready : row.owner.problem || t.ownerProblem}
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <span className={"rounded-full border px-2.5 py-1 text-xs font-black " + (row.enabled
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-slate-200 bg-slate-50 text-slate-500")}>
                      {row.enabled ? t.on : t.off}
                    </span>
                  </td>
                  <td className="px-4 py-4 font-bold text-slate-700">{businessDate(delivery?.business_date, language)}</td>
                  <td className="px-4 py-4">
                    <span className={"rounded-full border px-2.5 py-1 text-xs font-bold " + statusClass(delivery?.status)}>
                      {statusLabel(delivery?.status, language)}
                    </span>
                    <div className="mt-2 text-[11px] text-slate-500">
                      {delivery?.sent_at ? dateTime(delivery.sent_at, language) : delivery?.last_attempt_at ? dateTime(delivery.last_attempt_at, language) : "—"}
                    </div>
                    {delivery?.last_error ? (
                      <div className="mt-2 max-w-[300px] break-words rounded-lg bg-red-50 px-2 py-1.5 text-[10px] leading-4 text-red-700">
                        {delivery.last_error}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-5 py-4 text-right">
                    {delivery?.retryable ? (
                      <button type="button" disabled={!canRetry || retrying !== null}
                        onClick={() => void retry(row)}
                        className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-black text-amber-900 disabled:opacity-40">
                        {retrying === delivery.id ? t.retrying : canRetry ? t.retry : t.supportOnly}
                      </button>
                    ) : <span className="text-xs text-slate-400">—</span>}
                  </td>
                </tr>
              );
            })}
            {!loading && rows.length === 0 ? (
              <tr><td colSpan={6} className="px-5 py-8 text-center text-sm text-slate-500">{t.noRows}</td></tr>
            ) : null}
            {loading ? (
              <tr><td colSpan={6} className="px-5 py-8 text-center text-sm text-slate-500">Loading…</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
