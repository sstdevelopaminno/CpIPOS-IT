"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useItAccess } from "@/components/layout/app-shell";
import type { Language } from "@/lib/i18n";
import { DailySalesEmailPreviewModal } from "./daily-sales-email-preview-modal";

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
    needs_attention: number;
  };
  stores: StoreRow[];
};

type Filter = "all" | "enabled" | "disabled" | "needs_attention";

const PAGE_SIZE = 10;

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
    preview: "Preview",
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
    noRows: "ไม่พบร้านตามตัวกรอง",
    previous: "ก่อนหน้า",
    next: "ถัดไป",
    showing: "แสดง",
    of: "จาก",
    stores: "ร้าน"
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
    preview: "Preview",
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
    noRows: "No stores match this filter",
    previous: "Previous",
    next: "Next",
    showing: "Showing",
    of: "of",
    stores: "stores"
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
  const [previewStore, setPreviewStore] = useState<StoreRow | null>(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
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

  const filteredRows = useMemo(() => {
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

  const pageCount = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const rows = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredRows.slice(start, start + PAGE_SIZE);
  }, [filteredRows, page]);

  const pageItems = useMemo(() => {
    if (pageCount <= 7) return Array.from({ length: pageCount }, (_, index) => index + 1) as Array<number | "…">;
    const numbers = [...new Set([1, pageCount, page - 1, page, page + 1]
      .filter((value) => value >= 1 && value <= pageCount))]
      .sort((a, b) => a - b);
    const items: Array<number | "…"> = [];
    numbers.forEach((value, index) => {
      const previous = numbers[index - 1];
      if (index > 0 && previous != null && value - previous > 1) items.push("…");
      items.push(value);
    });
    return items;
  }, [page, pageCount]);

  useEffect(() => {
    setPage(1);
  }, [filter, query]);

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

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

  return (
    <>
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      {message ? <div className="mx-4 mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">{message}</div> : null}
      {error ? <div className="mx-4 mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</div> : null}

      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-3">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t.search}
          className="min-w-[240px] flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400"
        />
        {([
          ["all", `${t.all} (${stats?.total_stores ?? 0})`],
          ["enabled", `${t.filterEnabled} (${stats?.enabled ?? 0})`],
          ["disabled", `${t.filterDisabled} (${stats?.disabled ?? 0})`],
          ["needs_attention", `${t.filterAttention} (${stats?.needs_attention ?? 0})`]
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
                    <div className="flex flex-wrap justify-end gap-2">
                      <button type="button"
                        disabled={!row.tenant_active || retrying !== null}
                        onClick={() => setPreviewStore(row)}
                        className="rounded-xl border border-blue-300 bg-blue-50 px-3 py-2 text-xs font-black text-blue-700 disabled:opacity-40">
                        {t.preview}
                      </button>
                      {delivery?.retryable ? (
                        <button type="button" disabled={!canRetry || retrying !== null}
                          onClick={() => void retry(row)}
                          className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-black text-amber-900 disabled:opacity-40">
                          {retrying === delivery.id ? t.retrying : canRetry ? t.retry : t.supportOnly}
                        </button>
                      ) : null}
                    </div>
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

      {!loading && filteredRows.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50/60 px-4 py-3">
          <div className="text-xs font-bold text-slate-500">
            {t.showing} {((page - 1) * PAGE_SIZE) + 1}-{Math.min(page * PAGE_SIZE, filteredRows.length)} {t.of} {filteredRows.length} {t.stores}
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <button
              type="button"
              onClick={() => setPage((value) => Math.max(1, value - 1))}
              disabled={page <= 1}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-black text-slate-700 disabled:opacity-40"
            >
              {t.previous}
            </button>
            {pageItems.map((item, index) => item === "…" ? (
              <span key={`ellipsis-${index}`} className="px-2 text-xs font-bold text-slate-400">…</span>
            ) : (
              <button
                key={item}
                type="button"
                onClick={() => setPage(item)}
                className={"min-w-8 rounded-lg border px-2.5 py-1.5 text-xs font-black " + (page === item
                  ? "border-blue-500 bg-blue-600 text-white"
                  : "border-slate-300 bg-white text-slate-700")}
              >
                {item}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setPage((value) => Math.min(pageCount, value + 1))}
              disabled={page >= pageCount}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-black text-slate-700 disabled:opacity-40"
            >
              {t.next}
            </button>
          </div>
        </div>
      ) : null}
    </section>

    {previewStore && data?.target_business_date ? (
      <DailySalesEmailPreviewModal
        language={language}
        tenantId={previewStore.tenant_id}
        tenantName={previewStore.tenant_name}
        defaultDate={data.target_business_date}
        canSendTest={canRetry}
        onClose={() => setPreviewStore(null)}
      />
    ) : null}
    </>
  );
}
