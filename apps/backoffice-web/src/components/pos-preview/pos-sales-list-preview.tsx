"use client";

import { useMemo, useState } from "react";
import { t, type Language } from "@/lib/i18n";

type SaleStatus = "paid" | "pending" | "cancelled";

type SaleItem = {
  billNo: string;
  table: string;
  channel: "dine_in" | "takeaway" | "delivery";
  total: number;
  time: string;
  cashier: string;
  status: SaleStatus;
};

const MOCK_SALES: SaleItem[] = [
  { billNo: "DIN-20260525-001", table: "A1", channel: "dine_in", total: 420, time: "08:34", cashier: "Nok", status: "paid" },
  { billNo: "TKO-20260525-015", table: "-", channel: "takeaway", total: 95, time: "08:41", cashier: "Nok", status: "paid" },
  { billNo: "DLV-20260525-003", table: "-", channel: "delivery", total: 260, time: "08:49", cashier: "Mai", status: "pending" },
  { billNo: "DIN-20260525-004", table: "B3", channel: "dine_in", total: 180, time: "08:55", cashier: "Beam", status: "paid" },
  { billNo: "DIN-20260525-005", table: "C2", channel: "dine_in", total: 0, time: "09:00", cashier: "Beam", status: "cancelled" },
  { billNo: "DLV-20260525-006", table: "-", channel: "delivery", total: 315, time: "09:02", cashier: "Nok", status: "pending" }
];

const STATUS_OPTIONS: Array<SaleStatus | "all"> = ["all", "paid", "pending", "cancelled"];

function channelLabel(lang: Language, channel: SaleItem["channel"]): string {
  if (channel === "dine_in") return t(lang, "sales_list_mode_dine_in");
  if (channel === "takeaway") return t(lang, "sales_list_mode_takeaway");
  return t(lang, "sales_list_mode_delivery");
}

function statusLabel(lang: Language, status: SaleStatus): string {
  if (status === "paid") return t(lang, "pos_sales_preview_status_paid");
  if (status === "pending") return t(lang, "pos_sales_preview_status_pending");
  return t(lang, "pos_sales_preview_status_cancelled");
}

function statusBadgeClass(status: SaleStatus): string {
  if (status === "paid") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (status === "pending") return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-rose-50 text-rose-700 border-rose-200";
}

export function PosSalesListPreview({ lang }: { lang: Language }) {
  const [statusFilter, setStatusFilter] = useState<SaleStatus | "all">("all");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return MOCK_SALES.filter((row) => {
      if (statusFilter !== "all" && row.status !== statusFilter) return false;
      if (!normalized) return true;
      return row.billNo.toLowerCase().includes(normalized) || row.cashier.toLowerCase().includes(normalized) || row.table.toLowerCase().includes(normalized);
    });
  }, [query, statusFilter]);

  const summary = useMemo(() => {
    const paid = filtered.filter((row) => row.status === "paid");
    const pending = filtered.filter((row) => row.status === "pending");
    return {
      tickets: filtered.length,
      paidAmount: paid.reduce((sum, row) => sum + row.total, 0),
      pendingCount: pending.length
    };
  }, [filtered]);

  return (
    <section className="rounded-2xl border border-slate-300 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-extrabold text-slate-900">{t(lang, "pos_sales_preview_title")}</h2>
          <p className="mt-1 text-sm text-slate-600">{t(lang, "pos_sales_preview_subtitle")}</p>
        </div>
        <div className="text-xs font-semibold text-slate-500">{t(lang, "pos_sales_preview_mode_local")}</div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs text-slate-500">{t(lang, "pos_sales_preview_visible_tickets")}</p>
          <p className="mt-1 text-2xl font-black text-slate-900">{summary.tickets}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs text-slate-500">{t(lang, "pos_sales_preview_paid_amount")}</p>
          <p className="mt-1 text-2xl font-black text-slate-900">B{summary.paidAmount.toFixed(2)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs text-slate-500">{t(lang, "pos_sales_preview_pending_bills")}</p>
          <p className="mt-1 text-2xl font-black text-slate-900">{summary.pendingCount}</p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {STATUS_OPTIONS.map((option) => {
          const active = statusFilter === option;
          const label = option === "all" ? t(lang, "pos_sales_preview_filter_all") : statusLabel(lang, option);
          return (
            <button
              key={option}
              type="button"
              onClick={() => setStatusFilter(option)}
              className={`min-h-9 rounded-lg border px-3 text-sm font-bold transition ${
                active ? "border-orange-500 bg-orange-500 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              {label}
            </button>
          );
        })}

        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t(lang, "pos_sales_preview_search_placeholder")}
          className="ml-auto min-h-9 min-w-64 rounded-lg border border-slate-300 px-3 text-sm outline-none focus:border-orange-500"
        />
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
        <table className="min-w-full border-collapse text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-3 py-2 text-left">{t(lang, "pos_sales_preview_bill_no")}</th>
              <th className="px-3 py-2 text-left">{t(lang, "pos_sales_preview_channel")}</th>
              <th className="px-3 py-2 text-left">{t(lang, "pos_sales_preview_table")}</th>
              <th className="px-3 py-2 text-right">{t(lang, "pos_sales_preview_total")}</th>
              <th className="px-3 py-2 text-left">{t(lang, "pos_sales_preview_cashier")}</th>
              <th className="px-3 py-2 text-left">{t(lang, "pos_sales_preview_time")}</th>
              <th className="px-3 py-2 text-left">{t(lang, "pos_sales_preview_status")}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={row.billNo} className="border-t border-slate-200">
                <td className="px-3 py-2 font-semibold text-slate-900">{row.billNo}</td>
                <td className="px-3 py-2">{channelLabel(lang, row.channel)}</td>
                <td className="px-3 py-2">{row.table}</td>
                <td className="px-3 py-2 text-right font-semibold">B{row.total.toFixed(2)}</td>
                <td className="px-3 py-2">{row.cashier}</td>
                <td className="px-3 py-2">{row.time}</td>
                <td className="px-3 py-2">
                  <span className={`inline-flex min-h-7 items-center rounded-full border px-2 text-xs font-bold ${statusBadgeClass(row.status)}`}>
                    {statusLabel(lang, row.status)}
                  </span>
                </td>
              </tr>
            ))}
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-slate-500">
                  {t(lang, "pos_sales_preview_no_records")}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
