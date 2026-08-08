"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { resolveShiftCycle, slotLabel, slotWindowLabel } from "@/lib/pos-shift-schedule";

type Lang = "th" | "en";
type ModalKind = "open" | "close" | "active" | "receipt" | "details" | "summary" | null;
type BusyState = "open" | "close" | "print" | null;

const BRANCH_FILTER_STORAGE_KEY = "pos_shift_history_branch_filter_v1";
const POS_SKIP_ENTRY_GATE_SPLASH_KEY = "pos_skip_entry_gate_overlay_once_v1";
const MODAL_TRANSITION_MS = 180;

type SessionCurrentResponse = {
  data?: {
    shift: { id: string; status: string; opened_at: string; closed_at: string | null } | null;
    has_active_shift: boolean;
  } | null;
  error?: { code?: string; message?: string } | null;
};

type SessionShift = {
  id: string;
  status: string;
  opened_at: string;
  closed_at: string | null;
} | null;

type ShiftHistoryResponse = {
  data?: {
    filters: {
      days: number;
      self_only: boolean;
      can_view_branch_wide: boolean;
      selected_branch_id: string | null;
      branch_options: Array<{ id: string; code: string | null; name: string | null }>;
    };
    summary: {
      shift_count: number;
      order_count: number;
      cancelled_order_count: number;
      sales_total: number;
      cash_total: number;
      transfer_total: number;
    };
    shifts: Array<{
      id: string;
      opened_by: string;
      closed_by: string | null;
      branch_code: string | null;
      branch_name: string | null;
      opened_by_name: string | null;
      closed_by_name: string | null;
      opened_at: string;
      closed_at: string | null;
      opening_cash: number;
      expected_cash: number | null;
      actual_cash: number | null;
      status: string;
      metadata: Record<string, unknown> | null;
      metrics: {
        order_count: number;
        cancelled_order_count: number;
        sales_total: number;
        cash_total: number;
        transfer_total: number;
      };
      summary_cutoff_at: string | null;
    }>;
  } | null;
  error?: { code?: string; message?: string } | null;
};
type ShiftHistoryItem = NonNullable<ShiftHistoryResponse["data"]>["shifts"][number];

type CloseShiftResponse = {
  data?: {
    shift_id: string;
    status: "closed";
    closed_at: string;
    summary_cutoff_at: string;
    summary: {
      order_count: number;
      cancelled_order_count: number;
      sales_total: number;
      cash_total: number;
      transfer_total: number;
    };
    receipt: {
      tenant_name: string;
      branch_name: string;
      branch_code: string | null;
      seller_name: string;
      opened_at: string;
      opening_cash: number;
      closing_cash: number;
      expected_cash: number;
      actual_cash: number;
    };
  } | null;
  error?: { code?: string; message?: string } | null;
};

type ShiftCloseReceiptData = NonNullable<CloseShiftResponse["data"]>;
type BluetoothPrintJobStatus = "pending" | "printing" | "printed" | "failed" | "retrying";
type BluetoothPrintJob = {
  id: string;
  status: BluetoothPrintJobStatus;
  last_error: string | null;
  printed_at: string | null;
};
type BluetoothReceiptPrintResponseBody = {
  data?: {
    ok?: boolean;
    code?: string;
    message?: string;
    action?: string;
    timestamp?: string;
    data?: {
      fallback_to_browser_print?: boolean;
      jobs?: BluetoothPrintJob[];
    };
  } | null;
  error?: { code?: string; message?: string } | null;
};

function formatMoney(value: number, lang: Lang) {
  return new Intl.NumberFormat(lang === "th" ? "th-TH" : "en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

function formatSignedMoney(value: number, lang: Lang) {
  if (Math.abs(value) < 0.01) return formatMoney(0, lang);
  return `${value > 0 ? "+" : "-"}${formatMoney(Math.abs(value), lang)}`;
}

function formatDateTime(value: string, lang: Lang) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return date.toLocaleString(lang === "th" ? "th-TH" : "en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

function toActionLabel(mode: "open" | "close", lang: Lang) {
  if (mode === "open") return lang === "th" ? "เปิดกะทันที" : "Open Shift Now";
  return lang === "th" ? "ปิดกะตอนนี้" : "Close Shift Now";
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildShiftCloseReceiptHtml(args: {
  receipt: ShiftCloseReceiptData;
  lang: Lang;
  labels: {
    orders: string;
    cancelled: string;
    sales: string;
    cash: string;
    transfer: string;
    receiptOpenedAt: string;
    receiptClosedAt: string;
    receiptCutoffAt: string;
    receiptSeller: string;
    receiptClosingCash: string;
  };
}) {
  const { receipt, lang, labels } = args;
  const dt = (value: string) => escapeHtml(formatDateTime(value, lang));
  const money = (value: number) => escapeHtml(formatMoney(value, lang));
  const line = (left: string, right: string) =>
    `<p style="margin:0;display:flex;justify-content:space-between;gap:6px;"><span>${escapeHtml(left)}</span><strong>${right}</strong></p>`;

  return `<!doctype html>
<html><head><meta charset="utf-8"/>
<style>
@page{size:58mm auto;margin:2mm;}
html,body{width:58mm;margin:0;padding:0;color:#000;font:11px/1.35 Tahoma,'Noto Sans Thai','Segoe UI',sans-serif;}
main{width:54mm;margin:0 auto;padding:0.8mm 0;}
h1,p{margin:0;}
.head{text-align:center;display:grid;gap:0.8mm}
.divider{border-top:1px dashed #000;margin:1.3mm 0}
.meta{display:grid;gap:0.7mm}
.summary{display:grid;gap:0.7mm}
.brand{padding-top:0.6mm;margin-top:0.6mm;border-top:1px solid #000;font-weight:900;text-align:center}
</style></head>
<body><main>
  <header class="head">
    <h1>${escapeHtml(receipt.receipt.tenant_name)}</h1>
    <p>${escapeHtml(receipt.receipt.branch_name)}</p>
  </header>
  <div class="divider"></div>
  <section class="meta">
    ${line(labels.receiptSeller, escapeHtml(receipt.receipt.seller_name))}
    ${line(labels.receiptOpenedAt, dt(receipt.receipt.opened_at))}
    ${line(labels.receiptClosedAt, dt(receipt.closed_at))}
    ${line(labels.receiptCutoffAt, dt(receipt.summary_cutoff_at))}
  </section>
  <div class="divider"></div>
  <section class="summary">
    ${line(labels.orders, String(receipt.summary.order_count))}
    ${line(labels.cancelled, String(receipt.summary.cancelled_order_count))}
    ${line(labels.sales, money(receipt.summary.sales_total))}
    ${line(labels.cash, money(receipt.summary.cash_total))}
    ${line(labels.transfer, money(receipt.summary.transfer_total))}
    ${line(labels.receiptClosingCash, money(receipt.receipt.closing_cash))}
  </section>
  <p class="brand">CpIPOS</p>
</main></body></html>`;
}

function isOverdueAutoClosedShift(shift: ShiftHistoryItem) {
  const metadata = shift.metadata ?? {};
  return (
    shift.status !== "open" &&
    (metadata.close_reason === "system_auto_close_overdue_shift" ||
      metadata.close_reason === "auto_close_overdue_shift" ||
      metadata.system_auto_closed === true)
  );
}

function shiftStatusBadge(shift: ShiftHistoryItem, lang: Lang) {
  if (shift.status === "open") {
    return {
      label: lang === "th" ? "เปิดอยู่" : "Open",
      className: "bg-blue-100 text-blue-700 ring-1 ring-blue-200"
    };
  }
  if (isOverdueAutoClosedShift(shift)) {
    return {
      label: lang === "th" ? "ลืมปิดกะ" : "Forgot to close",
      className: "bg-rose-100 text-rose-700 ring-1 ring-rose-200"
    };
  }
  return {
    label: lang === "th" ? "ปิดกะแล้ว" : "Closed",
    className: "bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200"
  };
}

type ShiftHistoryTableLabels = {
  title: string;
  branch: string;
  shiftName: string;
  openedAt: string;
  closedAt: string;
  status: string;
  orders: string;
  cancelled: string;
  sales: string;
  cashVariance: string;
};

type ShiftHistoryTableRow = {
  shiftName: string;
  branch: string;
  openedAt: string;
  closedAt: string;
  status: string;
  orders: string;
  cancelled: string;
  sales: string;
  cashVariance: string;
};

function getShiftCashVariance(shift: ShiftHistoryItem) {
  return shift.actual_cash === null ? null : Number((shift.actual_cash - shift.metrics.cash_total).toFixed(2));
}

function getShiftHistoryTableRows(shifts: ShiftHistoryItem[], lang: Lang): ShiftHistoryTableRow[] {
  return shifts.map((shift) => {
    const cycle = resolveShiftCycle(shift.opened_at);
    const cashVariance = getShiftCashVariance(shift);
    return {
      shiftName: cycle ? slotLabel(cycle.slot, lang) : "-",
      branch: shift.branch_name ?? shift.branch_code ?? "-",
      openedAt: formatDateTime(shift.opened_at, lang),
      closedAt: shift.closed_at ? formatDateTime(shift.closed_at, lang) : "-",
      status: shiftStatusBadge(shift, lang).label,
      orders: String(shift.metrics.order_count),
      cancelled: String(shift.metrics.cancelled_order_count),
      sales: formatMoney(shift.metrics.sales_total, lang),
      cashVariance: cashVariance === null ? "-" : formatSignedMoney(cashVariance, lang)
    };
  });
}

function escapeCsvCell(value: string) {
  if (!/[",\r\n]/.test(value)) return value;
  return `"${value.replaceAll('"', '""')}"`;
}

function buildShiftHistoryCsv(args: {
  rows: ShiftHistoryTableRow[];
  labels: ShiftHistoryTableLabels;
  includeBranch: boolean;
}) {
  const headers = [
    args.labels.shiftName,
    ...(args.includeBranch ? [args.labels.branch] : []),
    args.labels.openedAt,
    args.labels.closedAt,
    args.labels.status,
    args.labels.orders,
    args.labels.cancelled,
    args.labels.sales,
    args.labels.cashVariance
  ];
  const body = args.rows.map((row) => [
    row.shiftName,
    ...(args.includeBranch ? [row.branch] : []),
    row.openedAt,
    row.closedAt,
    row.status,
    row.orders,
    row.cancelled,
    row.sales,
    row.cashVariance
  ]);
  return [headers, ...body].map((cells) => cells.map(escapeCsvCell).join(",")).join("\r\n");
}

function buildShiftHistoryPrintHtml(args: {
  rows: ShiftHistoryTableRow[];
  labels: ShiftHistoryTableLabels;
  includeBranch: boolean;
  generatedAt: string;
}) {
  const headers = [
    args.labels.shiftName,
    ...(args.includeBranch ? [args.labels.branch] : []),
    args.labels.openedAt,
    args.labels.closedAt,
    args.labels.status,
    args.labels.orders,
    args.labels.cancelled,
    args.labels.sales,
    args.labels.cashVariance
  ];
  const rows = args.rows.map((row) => [
    row.shiftName,
    ...(args.includeBranch ? [row.branch] : []),
    row.openedAt,
    row.closedAt,
    row.status,
    row.orders,
    row.cancelled,
    row.sales,
    row.cashVariance
  ]);
  return `<!doctype html>
<html><head><meta charset="utf-8"/>
<title>${escapeHtml(args.labels.title)}</title>
<style>
@page{size:A4 landscape;margin:10mm;}
*{box-sizing:border-box;}
html,body{margin:0;padding:0;color:#0f172a;font:11px/1.45 Tahoma,'Noto Sans Thai','Segoe UI',sans-serif;}
main{width:100%;}
h1{margin:0 0 3mm;font-size:18px;}
.meta{margin:0 0 4mm;color:#475569;font-size:10px;}
table{width:100%;border-collapse:collapse;table-layout:auto;}
th,td{border:1px solid #cbd5e1;padding:5px 6px;vertical-align:top;}
th{background:#f1f5f9;text-align:left;font-weight:800;}
td.num,th.num{text-align:right;}
</style></head>
<body><main>
  <h1>${escapeHtml(args.labels.title)}</h1>
  <p class="meta">${escapeHtml(args.generatedAt)}</p>
  <table>
    <thead><tr>${headers
      .map((header, index) => `<th class="${index >= headers.length - 4 ? "num" : ""}">${escapeHtml(header)}</th>`)
      .join("")}</tr></thead>
    <tbody>${rows
      .map(
        (row) =>
          `<tr>${row
            .map((cell, index) => `<td class="${index >= row.length - 4 ? "num" : ""}">${escapeHtml(cell)}</td>`)
            .join("")}</tr>`
      )
      .join("")}</tbody>
  </table>
</main><script>window.addEventListener('load',()=>setTimeout(()=>window.print(),80));</script></body></html>`;
}

function buildShiftDetailReceiptHtml(args: {
  shift: ShiftHistoryItem;
  lang: Lang;
  labels: {
    title: string;
    shiftName: string;
    openedBy: string;
    closedBy: string;
    openedAt: string;
    closedAt: string;
    sales: string;
    cash: string;
    transfer: string;
    variance: string;
    actual: string;
  };
}) {
  const { shift, lang, labels } = args;
  const cycle = resolveShiftCycle(shift.opened_at);
  const dt = (value: string) => escapeHtml(formatDateTime(value, lang));
  const money = (value: number) => escapeHtml(formatMoney(value, lang));
  const cashVariance = shift.actual_cash === null ? null : Number((shift.actual_cash - shift.metrics.cash_total).toFixed(2));
  const line = (left: string, right: string) =>
    `<p style="margin:0;display:flex;justify-content:space-between;gap:6px;"><span>${escapeHtml(left)}</span><strong>${right}</strong></p>`;

  return `<!doctype html>
<html><head><meta charset="utf-8"/>
<style>
@page{size:58mm auto;margin:2mm;}
html,body{width:58mm;margin:0;padding:0;color:#000;font:11px/1.35 Tahoma,'Noto Sans Thai','Segoe UI',sans-serif;}
main{width:54mm;margin:0 auto;padding:0.8mm 0;}
h1,p{margin:0;}
.head{text-align:center;display:grid;gap:0.8mm}
.divider{border-top:1px dashed #000;margin:1.3mm 0}
.summary{display:grid;gap:0.7mm}
.brand{padding-top:0.6mm;margin-top:0.6mm;border-top:1px solid #000;font-weight:900;text-align:center}
</style></head>
<body><main>
  <header class="head">
    <h1>${escapeHtml(labels.title)}</h1>
  </header>
  <div class="divider"></div>
  <section class="summary">
    ${line(labels.shiftName, escapeHtml(cycle ? slotLabel(cycle.slot, lang) : "-"))}
    ${line(labels.openedBy, escapeHtml(shift.opened_by_name ?? "-"))}
    ${line(labels.closedBy, escapeHtml(shift.closed_by_name ?? "-"))}
    ${line(labels.openedAt, dt(shift.opened_at))}
    ${line(labels.closedAt, shift.closed_at ? dt(shift.closed_at) : "-")}
  </section>
  <div class="divider"></div>
  <section class="summary">
    ${line(labels.sales, money(shift.metrics.sales_total))}
    ${line(labels.cash, money(shift.metrics.cash_total))}
    ${line(labels.transfer, money(shift.metrics.transfer_total))}
    ${line(labels.variance, cashVariance === null ? "-" : escapeHtml(formatSignedMoney(cashVariance, lang)))}
    ${line(labels.actual, shift.actual_cash === null ? "-" : money(shift.actual_cash))}
  </section>
  <p class="brand">CpIPOS</p>
</main><script>window.print();</script></body></html>`;
}

export function PosShiftHistoryModule({ lang }: { lang: Lang }) {
  const [days, setDays] = useState(30);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [page, setPage] = useState(1);
  const [branchFilter, setBranchFilter] = useState<string>(() => {
    if (typeof window === "undefined") return "all";
    const stored = window.sessionStorage.getItem(BRANCH_FILTER_STORAGE_KEY);
    return stored && stored.trim() ? stored : "all";
  });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<BusyState>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [openingCash, setOpeningCash] = useState("");
  const [closingCash, setClosingCash] = useState("");
  const [sessionShift, setSessionShift] = useState<SessionShift>(null);
  const [payload, setPayload] = useState<ShiftHistoryResponse["data"]>(null);
  const [closeReceipt, setCloseReceipt] = useState<ShiftCloseReceiptData | null>(null);
  const [receiptPrintJobs, setReceiptPrintJobs] = useState<BluetoothPrintJob[]>([]);
  const [receiptPrinted, setReceiptPrinted] = useState(false);
  const [, setReceiptPrintStatus] = useState<"idle" | "printing" | "printed" | "failed">("idle");
  const [receiptPrintError, setReceiptPrintError] = useState<string | null>(null);
  const [modalKind, setModalKind] = useState<ModalKind>(null);
  const [selectedShift, setSelectedShift] = useState<ShiftHistoryItem | null>(null);
  const [modalMounted, setModalMounted] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const closeTimerRef = useRef<number | null>(null);

  const text = useMemo(
    () =>
      lang === "th"
        ? {
            title: "เปิด/ปิดกะย้อนหลัง",
            subtitle: "ดูประวัติกะ ยอดขาย ยอดเงินสด/โอน จำนวนบิล และจำนวนบิลยกเลิก",
            activeShift: "กะที่เปิดอยู่",
            noActiveShift: "ยังไม่มีกะที่เปิดอยู่",
            openingCash: "เงินตั้งต้น",
            closingCash: "เงินสดปลายกะ",
            period: "ช่วงเวลา",
            branchFilter: "สาขา",
            print: "พิมพ์รายงาน",
            exportCsv: "Export CSV",
            reload: "รีเฟรช",
            shifts: "จำนวนกะ",
            orders: "จำนวนบิล",
            cancelled: "บิลยกเลิก",
            sales: "ยอดขายรวม",
            cash: "เงินสด",
            transfer: "โอน",
            openedAt: "เปิดกะ",
            closedAt: "ปิดกะ",
            shiftName: "ชื่อกะ",
            status: "สถานะ",
            opening: "เงินตั้งต้น",
            expected: "ผลต่างเงินสด",
            actual: "เงินนับจริง",
            open: "เปิด",
            closed: "ปิด",
            noData: "ไม่พบข้อมูลกะในช่วงเวลาที่เลือก",
            invalidMoney: "กรุณากรอกจำนวนเงินให้ถูกต้อง",
            shiftOpened: "เปิดกะสำเร็จ กำลังพาไปหน้าขาย...",
            shiftClosed: "ปิดกะสำเร็จ",
            openingShiftTitle: "กำลังเปิดกะ",
            openingShiftDesc: "ระบบกำลังบันทึกเงินตั้งต้นและเตรียมพาไปหน้าขาย...",
            popupTitleOpen: "ยืนยันเปิดกะ",
            popupTitleClose: "ยืนยันปิดกะ",
            popupTitleActive: "รายละเอียดกะที่เปิดอยู่",
            popupTitleReceipt: "ใบสรุปปิดกะ (58mm)",
            popupDescOpen: "กรอกเงินตั้งต้นก่อนเปิดกะ",
            popupDescClose: "กรอกเงินสดปลายกะก่อนปิดกะ",
            popupDescActive: "ตรวจสอบสถานะกะปัจจุบันก่อนดำเนินการ",
            popupDescReceipt: "ปิดกะสำเร็จแล้ว สามารถพิมพ์ใบสรุปหรือกดเสร็จสิ้นเพื่อปิดหน้าต่างได้ทันที",
            confirm: "ยืนยัน",
            cancel: "ยกเลิก",
            close: "ปิด",
            allBranches: "ทุกสาขา",
            finishAndExit: "เสร็จสิ้น",
            printing: "กำลังพิมพ์...",
            printReceipt: "พิมพ์ใบสรุปผ่าน Bluetooth",
            printRequiredHint: "ต้องมีสถานะพิมพ์ Bluetooth สำเร็จก่อน จึงจะไปหน้าเลือกสาขาได้",
            printSuccessHint: "พิมพ์ Bluetooth สำเร็จแล้ว สามารถออกไปหน้าเลือกสาขาได้",
            printPendingHint: "กำลังตรวจสอบสถานะพิมพ์จากเครื่องจริง...",
            printFailedHint: "ยังไม่พบผลพิมพ์สำเร็จจาก Bluetooth กรุณาลองพิมพ์อีกครั้ง",
            printJobStatus: "สถานะพิมพ์",
            receiptStore: "ร้าน",
            receiptBranch: "สาขา",
            receiptSeller: "ผู้ขาย",
            receiptOpenedAt: "เปิดกะ",
            receiptClosedAt: "ปิดกะ",
            receiptCutoffAt: "ตัดยอดถึง",
            receiptOpeningCash: "เงินตั้งต้น",
            receiptClosingCash: "เงินสดปลายกะ",
            receiptExpectedCash: "เงินคาดหวัง",
            receiptActualCash: "เงินนับจริง"
          }
        : {
            title: "Open/Close Shift History",
            subtitle: "Review shift history, sales, cash/transfer totals, bill volume, and cancellations.",
            activeShift: "Active Shift",
            noActiveShift: "No active shift",
            openingCash: "Opening cash",
            closingCash: "Closing cash",
            period: "Period",
            branchFilter: "Branch",
            print: "Print report",
            exportCsv: "Export CSV",
            reload: "Reload",
            shifts: "Shifts",
            orders: "Bills",
            cancelled: "Cancelled",
            sales: "Sales",
            cash: "Cash",
            transfer: "Transfer",
            openedAt: "Opened At",
            closedAt: "Closed At",
            shiftName: "Shift",
            status: "Status",
            opening: "Opening",
            expected: "Cash variance",
            actual: "Actual",
            open: "Open",
            closed: "Closed",
            noData: "No shift data found for this period.",
            invalidMoney: "Please enter a valid amount.",
            shiftOpened: "Shift opened. Redirecting to sales...",
            shiftClosed: "Shift closed successfully.",
            openingShiftTitle: "Opening shift",
            openingShiftDesc: "Saving opening cash and preparing the sales screen...",
            popupTitleOpen: "Confirm Open Shift",
            popupTitleClose: "Confirm Close Shift",
            popupTitleActive: "Active Shift Details",
            popupTitleReceipt: "Close Shift Receipt (58mm)",
            popupDescOpen: "Enter opening cash before opening this shift.",
            popupDescClose: "Enter closing cash before closing this shift.",
            popupDescActive: "Review current active shift status.",
            popupDescReceipt: "Shift is closed. You can print the summary or finish to close this popup.",
            confirm: "Confirm",
            cancel: "Cancel",
            close: "Close",
            allBranches: "All branches",
            finishAndExit: "Done",
            printing: "Printing...",
            printReceipt: "Print 58mm",
            printRequiredHint: "Bluetooth printing is optional. The shift is already closed.",
            printSuccessHint: "Bluetooth print succeeded. You can continue to branch selection.",
            printPendingHint: "Checking live printer status...",
            printFailedHint: "No successful Bluetooth print yet. Please retry printing.",
            printJobStatus: "Print jobs",
            receiptStore: "Store",
            receiptBranch: "Branch",
            receiptSeller: "Seller",
            receiptOpenedAt: "Opened",
            receiptClosedAt: "Closed",
            receiptCutoffAt: "Cutoff",
            receiptOpeningCash: "Opening cash",
            receiptClosingCash: "Closing cash",
            receiptExpectedCash: "Expected cash",
            receiptActualCash: "Actual cash"
          },
    [lang]
  );

  const currentCycle = useMemo(() => {
    if (!sessionShift?.opened_at || sessionShift.status !== "open") return null;
    return resolveShiftCycle(sessionShift.opened_at);
  }, [sessionShift?.opened_at, sessionShift?.status]);
  const activeShiftMetrics = useMemo(() => {
    if (!sessionShift?.id) return null;
    return payload?.shifts.find((shift) => shift.id === sessionShift.id)?.metrics ?? null;
  }, [payload?.shifts, sessionShift?.id]);
  const hasClosingCashInput = closingCash.trim().length > 0;
  const closingCashAmount = Number(closingCash.trim() || "0");
  const closingCashIsValid = Number.isFinite(closingCashAmount) && closingCashAmount >= 0;
  const closingCashExpected = activeShiftMetrics?.cash_total ?? 0;
  const closingCashVariance = closingCashIsValid ? Number((closingCashAmount - closingCashExpected).toFixed(2)) : 0;
  const cashFloatLabel = lang === "th" ? "ใส่เงินทอน" : "Cash float";
  const cashVarianceLabel = lang === "th" ? "สถานะเงินสด" : "Cash status";
  const cashWaitingLabel = lang === "th" ? "รอกรอกเงินสด" : "Waiting for cash input";
  const cashBalancedLabel = lang === "th" ? "ผ่าน" : "Balanced";
  const cashShortLabel = lang === "th" ? "ติดลบ" : "Short";
  const cashOverLabel = lang === "th" ? "เกิน" : "Over";
  const dateFromLabel = lang === "th" ? "ตั้งแต่วันที่" : "From date";
  const dateToLabel = lang === "th" ? "ถึงวันที่" : "To date";
  const openedByLabel = lang === "th" ? "ผู้เปิดกะ" : "Opened by";
  const closedByLabel = lang === "th" ? "ผู้ปิดกะ" : "Closed by";
  const detailsLabel = lang === "th" ? "อ่าน" : "View";
  const detailsTitle = lang === "th" ? "รายละเอียดกะ" : "Shift details";
  const previousLabel = lang === "th" ? "ก่อนหน้า" : "Previous";
  const nextLabel = lang === "th" ? "ถัดไป" : "Next";
  const pageLabel = lang === "th" ? "หน้า" : "Page";
  const shiftTableLabels = useMemo<ShiftHistoryTableLabels>(
    () => ({
      title: text.title,
      branch: text.branchFilter,
      shiftName: text.shiftName,
      openedAt: text.openedAt,
      closedAt: text.closedAt,
      status: text.status,
      orders: text.orders,
      cancelled: text.cancelled,
      sales: text.sales,
      cashVariance: text.expected
    }),
    [text]
  );
  const rowsPerPage = 12;
  const pagedShifts = payload?.shifts.slice((page - 1) * rowsPerPage, page * rowsPerPage) ?? [];
  const totalPages = Math.max(1, Math.ceil((payload?.shifts.length ?? 0) / rowsPerPage));

  const openModal = useCallback((kind: Exclude<ModalKind, null>) => {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setModalKind(kind);
    setModalMounted(true);
    window.requestAnimationFrame(() => {
      setModalVisible(true);
    });
  }, []);

  const closeModal = useCallback(() => {
    setModalVisible(false);
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
    }
    closeTimerRef.current = window.setTimeout(() => {
      setModalMounted(false);
      setModalKind(null);
      closeTimerRef.current = null;
    }, MODAL_TRANSITION_MS);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [sessionRes, historyRes] = await Promise.all([
        fetch("/api/pos/session/current", { cache: "no-store" }),
        fetch(
          `/api/pos/shifts/history?days=${days}&view=all&branch_id=${encodeURIComponent(branchFilter)}&start_date=${encodeURIComponent(startDate)}&end_date=${encodeURIComponent(endDate)}`,
          {
          cache: "no-store"
          }
        )
      ]);
      const sessionBody = (await sessionRes.json().catch(() => null)) as SessionCurrentResponse | null;
      const historyBody = (await historyRes.json().catch(() => null)) as ShiftHistoryResponse | null;
      if (!sessionRes.ok || !sessionBody?.data) {
        throw new Error(sessionBody?.error?.message ?? "Unable to load shift session.");
      }
      if (!historyRes.ok || !historyBody?.data) {
        throw new Error(historyBody?.error?.message ?? "Unable to load shift history.");
      }

      const activeShift =
        sessionBody.data.has_active_shift && sessionBody.data.shift?.status === "open" ? sessionBody.data.shift : null;
      setSessionShift(activeShift);
      setPayload(historyBody.data);

      if (historyBody.data.filters.can_view_branch_wide) {
        const available = new Set((historyBody.data.filters.branch_options ?? []).map((branch) => branch.id));
        if (branchFilter !== "all" && !available.has(branchFilter)) {
          setBranchFilter("all");
        }
      } else if (branchFilter !== "all") {
        setBranchFilter("all");
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unknown error.");
    } finally {
      setLoading(false);
    }
  }, [branchFilter, days, endDate, startDate]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.sessionStorage.setItem(BRANCH_FILTER_STORAGE_KEY, branchFilter);
  }, [branchFilter]);

  useEffect(() => {
    if (!modalMounted) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [modalMounted]);

  useEffect(() => {
    if (!modalMounted) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy && modalKind !== "receipt") {
        closeModal();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, closeModal, modalKind, modalMounted]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [branchFilter, days, endDate, startDate]);

  async function openShiftNow() {
    if (busy) return;
    const parsed = Number(openingCash.trim() || "0");
    if (!Number.isFinite(parsed) || parsed < 0) {
      setError(text.invalidMoney);
      return;
    }
    setBusy("open");
    setError(null);
    setMessage(null);
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch("/api/pos/shifts/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ opening_cash: parsed }),
        signal: controller.signal
      });
      const body = (await response.json().catch(() => null)) as { error?: { message?: string } | null } | null;
      if (!response.ok) {
        throw new Error(body?.error?.message ?? "Open shift failed.");
      }
      setMessage(text.shiftOpened);
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem(POS_SKIP_ENTRY_GATE_SPLASH_KEY, "1");
      }
      window.location.assign("/preview/pos");
    } catch (openError) {
      const isTimeout = openError instanceof DOMException && openError.name === "AbortError";
      if (isTimeout) {
        setMessage(lang === "th" ? "กำลังตรวจสอบว่ากะเปิดสำเร็จแล้วหรือไม่..." : "Checking whether the shift opened successfully...");
        try {
          const confirmController = new AbortController();
          const confirmTimeoutId = window.setTimeout(() => confirmController.abort(), 5000);
          const sessionRes = await fetch("/api/pos/session/current", {
            cache: "no-store",
            signal: confirmController.signal
          });
          window.clearTimeout(confirmTimeoutId);
          const sessionBody = (await sessionRes.json().catch(() => null)) as SessionCurrentResponse | null;
          if (sessionRes.ok && sessionBody?.data?.has_active_shift) {
            if (typeof window !== "undefined") {
              window.sessionStorage.setItem(POS_SKIP_ENTRY_GATE_SPLASH_KEY, "1");
            }
            window.location.assign("/preview/pos");
            return;
          }
        } catch {
          // The first open request may still be finishing; retry remains protected by server idempotency.
        }
      }
      setError(isTimeout ? (lang === "th" ? "เปิดกะใช้เวลานานเกินไป กรุณาลองอีกครั้ง" : "Opening shift timed out. Please try again.") : openError instanceof Error ? openError.message : "Open shift failed.");
      setBusy(null);
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  async function closeShiftNow() {
    if (busy || !sessionShift?.id) return;
    const parsed = Number(closingCash.trim() || "0");
    if (!Number.isFinite(parsed) || parsed < 0) {
      setError(text.invalidMoney);
      return;
    }
    setBusy("close");
    setError(null);
    setMessage(null);
    try {
      const closeRes = await fetch("/api/pos/shifts/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ closing_cash: parsed })
      });
      const closeBody = (await closeRes.json().catch(() => null)) as CloseShiftResponse | null;
      if (!closeRes.ok || !closeBody?.data) {
        const code = String(closeBody?.error?.code ?? "");
        if (code === "shift_has_open_bills") {
          throw new Error(
            lang === "th"
              ? "ยังมีบิลค้างอยู่ในหน้าขาย กรุณากลับไปเคลียร์หรือยกเลิกบิลให้เรียบร้อยก่อนปิดกะ"
              : "There are open bills in sales. Please clear or cancel them before closing this shift."
          );
        }
        throw new Error(closeBody?.error?.message ?? "Close shift failed.");
      }
      setMessage(text.shiftClosed);
      setCloseReceipt(closeBody.data);
      setReceiptPrintJobs([]);
      setReceiptPrinted(false);
      setReceiptPrintStatus("idle");
      setReceiptPrintError(null);
      openModal("receipt");
      await load();
      setClosingCash("");
    } catch (closeError) {
      setError(closeError instanceof Error ? closeError.message : "Close shift failed.");
    } finally {
      setBusy(null);
    }
  }

  function exportShiftHistoryCsv() {
    if (!payload?.shifts.length) return;
    const rows = getShiftHistoryTableRows(payload.shifts, lang);
    const csv = buildShiftHistoryCsv({
      rows,
      labels: shiftTableLabels,
      includeBranch: payload.filters.can_view_branch_wide
    });
    const fileDate = new Date().toISOString().slice(0, 10);
    const rangePart = startDate || endDate ? `${startDate || "from"}-${endDate || "to"}` : `${days}d`;
    const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `shift-history-${rangePart}-${fileDate}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.URL.revokeObjectURL(url);
  }

  function printShiftHistoryReport() {
    if (!payload?.shifts.length) return;
    const rows = getShiftHistoryTableRows(payload.shifts, lang);
    const printHtml = buildShiftHistoryPrintHtml({
      rows,
      labels: shiftTableLabels,
      includeBranch: payload.filters.can_view_branch_wide,
      generatedAt: formatDateTime(new Date().toISOString(), lang)
    });
    const printWindow = window.open("", "_blank", "width=1120,height=760");
    if (!printWindow) {
      setError(lang === "th" ? "ไม่สามารถเปิดหน้าพิมพ์ได้" : "Unable to open print window.");
      return;
    }
    printWindow.document.open();
    printWindow.document.write(printHtml);
    printWindow.document.close();
  }

  async function printCloseReceipt() {
    if (!closeReceipt || busy === "print") return;

    setBusy("print");
    setReceiptPrintError(null);
    setReceiptPrinted(false);
    setReceiptPrintStatus("printing");
    setReceiptPrintJobs([]);

    try {
      const receiptHtml = buildShiftCloseReceiptHtml({
        receipt: closeReceipt,
        lang,
        labels: {
          orders: text.orders,
          cancelled: text.cancelled,
          sales: text.sales,
          cash: text.cash,
          transfer: text.transfer,
          receiptOpenedAt: text.receiptOpenedAt,
          receiptClosedAt: text.receiptClosedAt,
          receiptCutoffAt: text.receiptCutoffAt,
          receiptSeller: text.receiptSeller,
          receiptClosingCash: text.receiptClosingCash
        }
      });

      const response = await fetch("/api/pos/receipts/bluetooth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order_id: null,
          order_no: `SHIFT-CLOSE-${closeReceipt.shift_id.slice(0, 8)}`,
          receipt_html: receiptHtml
        })
      });
      const body = (await response.json().catch(() => null)) as BluetoothReceiptPrintResponseBody | null;
      const envelope = body?.data ?? null;
      const jobs = Array.isArray(envelope?.data?.jobs) ? envelope.data.jobs : [];
      setReceiptPrintJobs(jobs);

      const printedCount = jobs.filter((job) => job.status === "printed").length;
      const failedCount = jobs.filter((job) => job.status === "failed").length;
      const unsettledCount = jobs.filter((job) => job.status === "pending" || job.status === "printing" || job.status === "retrying").length;
      const isSuccess = response.ok && !body?.error && envelope?.ok === true && printedCount > 0 && failedCount === 0 && unsettledCount === 0;

      if (isSuccess) {
        setReceiptPrinted(true);
        setReceiptPrintStatus("printed");
        return;
      }

      const noPrinterCode = envelope?.code === "bluetooth_printer_not_configured";
      const messageFromApi =
        body?.error?.message ??
        envelope?.message ??
        (noPrinterCode
          ? lang === "th"
            ? "ยังไม่ได้ตั้งค่าเครื่องพิมพ์ Bluetooth สำหรับใบเสร็จ"
            : "Receipt printer is not configured."
          : lang === "th"
            ? "พิมพ์ Bluetooth ไม่สำเร็จ"
            : "Receipt print failed.");
      setReceiptPrintStatus("failed");
      setReceiptPrintError(messageFromApi);
    } catch (printError) {
      setReceiptPrintStatus("failed");
      setReceiptPrintError(
        printError instanceof Error
          ? printError.message
          : lang === "th"
            ? "พิมพ์ Bluetooth ไม่สำเร็จ"
            : "Receipt print failed."
      );
    } finally {
      setBusy((current) => (current === "print" ? null : current));
    }
  }

  function printSelectedShiftDetail58() {
    if (!selectedShift) return;
    const receiptHtml = buildShiftDetailReceiptHtml({
      shift: selectedShift,
      lang,
      labels: {
        title: detailsTitle,
        shiftName: text.shiftName,
        openedBy: openedByLabel,
        closedBy: closedByLabel,
        openedAt: text.openedAt,
        closedAt: text.closedAt,
        sales: text.sales,
        cash: text.cash,
        transfer: text.transfer,
        variance: text.expected,
        actual: text.actual
      }
    });
    const printWindow = window.open("", "_blank", "width=320,height=640");
    if (!printWindow) {
      setError(lang === "th" ? "ไม่สามารถเปิดหน้าพิมพ์ได้" : "Unable to open print window.");
      return;
    }
    printWindow.document.open();
    printWindow.document.write(receiptHtml);
    printWindow.document.close();
  }

  return (
    <section className="min-h-0 w-full overflow-auto pb-6 pr-2">
      <div className="mx-auto w-full max-w-[1240px] space-y-4">
        <header className="rounded-3xl border border-slate-200 bg-[linear-gradient(140deg,#ffffff_0%,#f5f8ff_55%,#eef4ff_100%)] p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-xl font-black text-slate-900">{text.title}</h1>
              <p className="mt-1 text-sm text-slate-600">{text.subtitle}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => openModal("active")}
                className="h-10 rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 hover:bg-slate-50"
              >
                {text.activeShift}
              </button>
              <button
                type="button"
                onClick={() => openModal("open")}
                disabled={Boolean(sessionShift)}
                className="h-10 rounded-xl bg-blue-600 px-4 text-sm font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {toActionLabel("open", lang)}
              </button>
              <button
                type="button"
                onClick={() => openModal("close")}
                disabled={!sessionShift}
                className="h-10 rounded-xl bg-slate-900 px-4 text-sm font-bold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {toActionLabel("close", lang)}
              </button>
              <button
                type="button"
                onClick={() => exportShiftHistoryCsv()}
                disabled={!payload?.shifts.length}
                className="h-10 rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {text.exportCsv}
              </button>
            </div>
          </div>
        </header>

        {message ? (
          <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">
            {message}
          </p>
        ) : null}
        {error ? (
          <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</p>
        ) : null}

        <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
            <div className="flex flex-wrap items-end gap-2">
              <label className="grid gap-1">
                <span className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">{text.period}</span>
                <select
                  value={days}
                  onChange={(event) => setDays(Number(event.target.value))}
                  className="h-10 rounded-xl border border-slate-300 px-3"
                >
                  <option value={7}>7</option>
                  <option value={30}>30</option>
                  <option value={60}>60</option>
                </select>
              </label>
              <label className="grid gap-1">
                <span className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">{dateFromLabel}</span>
                <input
                  type="date"
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                  className="h-10 rounded-xl border border-slate-300 px-3"
                />
              </label>
              <label className="grid gap-1">
                <span className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">{dateToLabel}</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(event) => setEndDate(event.target.value)}
                  className="h-10 rounded-xl border border-slate-300 px-3"
                />
              </label>

              {payload?.filters.can_view_branch_wide ? (
                <label className="grid gap-1">
                  <span className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">{text.branchFilter}</span>
                  <select
                    value={branchFilter}
                    onChange={(event) => setBranchFilter(event.target.value)}
                    className="h-10 rounded-xl border border-slate-300 px-3"
                  >
                    <option value="all">{text.allBranches}</option>
                    {(payload.filters.branch_options ?? []).map((branch) => (
                      <option key={branch.id} value={branch.id}>
                        {branch.name ?? branch.code ?? branch.id}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => openModal("summary")}
                className="h-10 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700"
              >
                {lang === "th" ? "ดูยอด" : "View totals"}
              </button>
              <button
                type="button"
                onClick={() => printShiftHistoryReport()}
                disabled={!payload?.shifts.length}
                className="h-10 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {text.print}
              </button>
              <button
                type="button"
                onClick={() => void load()}
                className="h-10 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700"
              >
                {text.reload}
              </button>
            </div>
          </div>

          {loading ? <p className="mt-4 text-sm text-slate-500">Loading...</p> : null}
          {!loading && payload && payload.shifts.length === 0 ? <p className="mt-4 text-sm text-slate-500">{text.noData}</p> : null}

          {!loading && payload && payload.shifts.length > 0 ? (
            <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200">
              <table className="min-w-full border-collapse text-sm">
                <thead className="bg-slate-50">
                  <tr className="text-left text-xs uppercase tracking-[0.1em] text-slate-500">
                    <th className="px-3 py-3">{text.shiftName}</th>
                    {payload.filters.can_view_branch_wide ? <th className="px-3 py-3">{text.branchFilter}</th> : null}
                    <th className="px-3 py-3">{text.openedAt}</th>
                    <th className="px-3 py-3">{text.closedAt}</th>
                    <th className="px-3 py-3">{text.status}</th>
                    <th className="px-3 py-3 text-right">{text.orders}</th>
                    <th className="px-3 py-3 text-right">{text.cancelled}</th>
                    <th className="px-3 py-3 text-right">{text.sales}</th>
                    <th className="px-3 py-3 text-right">{text.expected}</th>
                    <th className="px-3 py-3 text-center">{detailsLabel}</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedShifts.map((shift) => {
                    const cycle = resolveShiftCycle(shift.opened_at);
                    const cashVariance = getShiftCashVariance(shift);
                    const cashVarianceClass =
                      cashVariance === null
                        ? "text-slate-400"
                        : Math.abs(cashVariance) < 0.01
                          ? "text-emerald-700"
                          : cashVariance < 0
                            ? "text-rose-700"
                            : "text-orange-600";
                    return (
                      <tr key={shift.id} className="border-t border-slate-200">
                        <td className="px-3 py-3 font-semibold text-slate-700">{cycle ? slotLabel(cycle.slot, lang) : "-"}</td>
                        {payload.filters.can_view_branch_wide ? (
                          <td className="px-3 py-3 text-slate-600">{shift.branch_name ?? shift.branch_code ?? "-"}</td>
                        ) : null}
                        <td className="px-3 py-3 text-slate-600">{formatDateTime(shift.opened_at, lang)}</td>
                        <td className="px-3 py-3 text-slate-600">{shift.closed_at ? formatDateTime(shift.closed_at, lang) : "-"}</td>
                        <td className="px-3 py-3">
                          {(() => {
                            const statusBadge = shiftStatusBadge(shift, lang);
                            return (
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-bold ${statusBadge.className}`}
                          >
                            {statusBadge.label}
                          </span>
                            );
                          })()}
                        </td>
                        <td className="px-3 py-3 text-right">{shift.metrics.order_count}</td>
                        <td className="px-3 py-3 text-right">{shift.metrics.cancelled_order_count}</td>
                        <td className="px-3 py-3 text-right">{formatMoney(shift.metrics.sales_total, lang)}</td>
                        <td className={`px-3 py-3 text-right font-bold ${cashVarianceClass}`}>
                          {cashVariance === null ? "-" : formatSignedMoney(cashVariance, lang)}
                        </td>
                        <td className="px-3 py-3 text-center">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedShift(shift);
                              openModal("details");
                            }}
                            className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-bold text-slate-700 hover:bg-slate-50"
                          >
                            {detailsLabel}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
          {!loading && payload && payload.shifts.length > rowsPerPage ? (
            <div className="mt-3 flex flex-wrap items-center justify-end gap-2 text-sm text-slate-600">
              <span className="font-semibold">
                {pageLabel} {page} / {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={page <= 1}
                className="h-9 rounded-xl border border-slate-300 bg-white px-3 font-semibold disabled:opacity-50"
              >
                {previousLabel}
              </button>
              <button
                type="button"
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                disabled={page >= totalPages}
                className="h-9 rounded-xl border border-slate-300 bg-white px-3 font-semibold disabled:opacity-50"
              >
                {nextLabel}
              </button>
            </div>
          ) : null}
        </section>
      </div>

      {modalMounted && modalKind ? (
        <div className="fixed inset-0 z-[110] grid place-items-center overflow-y-auto p-3 sm:p-4">
          <div
            className={`absolute inset-0 bg-slate-950/55 transition-opacity duration-200 ${
              modalVisible ? "opacity-100" : "opacity-0"
            }`}
            onClick={() => {
              if (!busy) closeModal();
            }}
          />
          <section
            className={`relative w-full rounded-2xl border border-slate-200 bg-white shadow-2xl transition-all duration-200 ${
              modalKind === "receipt"
                ? "max-h-[calc(100dvh-1.5rem)] max-w-[440px] overflow-y-auto p-3 sm:max-h-[calc(100dvh-2rem)] sm:p-4"
                : "max-w-md p-4"
            } ${
              modalVisible ? "translate-y-0 scale-100 opacity-100" : "translate-y-2 scale-95 opacity-0"
            }`}
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className={modalKind === "receipt" ? "text-base font-extrabold text-slate-900 sm:text-lg" : "text-lg font-extrabold text-slate-900"}>
              {busy === "open"
                ? text.openingShiftTitle
                : modalKind === "open"
                ? text.popupTitleOpen
                : modalKind === "close"
                  ? text.popupTitleClose
                  : modalKind === "active"
                    ? text.popupTitleActive
                    : modalKind === "details"
                      ? detailsTitle
                    : modalKind === "summary"
                      ? lang === "th" ? "ยอดสรุป" : "Summary totals"
                    : text.popupTitleReceipt}
            </h3>
            <p className={modalKind === "receipt" ? "mt-1 text-xs leading-5 text-slate-600 sm:text-sm" : "mt-1 text-sm text-slate-600"}>
              {busy === "open"
                ? text.openingShiftDesc
                : modalKind === "open"
                ? text.popupDescOpen
                : modalKind === "close"
                  ? text.popupDescClose
                  : modalKind === "active"
                    ? text.popupDescActive
                    : modalKind === "details"
                      ? detailsTitle
                    : modalKind === "summary"
                      ? lang === "th" ? "ดูยอดรวมตามช่วงเวลาและสาขาที่เลือก" : "Totals for the selected period and branch."
                    : text.popupDescReceipt}
            </p>

            {busy === "open" ? (
              <div className="mt-4 flex items-center gap-3 rounded-xl border border-blue-100 bg-blue-50 px-3 py-3 text-sm font-semibold text-blue-800">
                <span className="h-5 w-5 animate-spin rounded-full border-2 border-blue-200 border-t-blue-700" aria-hidden />
                <span>{text.openingShiftDesc}</span>
              </div>
            ) : null}

            {error ? (
              <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold leading-5 text-rose-700">
                {error}
              </p>
            ) : null}

            {modalKind === "summary" ? (
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <article className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs text-slate-500">{text.shifts}</p>
                  <p className="text-lg font-black">{payload?.summary.shift_count ?? 0}</p>
                </article>
                <article className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs text-slate-500">{text.orders}</p>
                  <p className="text-lg font-black">{payload?.summary.order_count ?? 0}</p>
                </article>
                <article className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs text-slate-500">{text.cancelled}</p>
                  <p className="text-lg font-black">{payload?.summary.cancelled_order_count ?? 0}</p>
                </article>
                <article className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs text-slate-500">{text.sales}</p>
                  <p className="text-lg font-black">{formatMoney(payload?.summary.sales_total ?? 0, lang)}</p>
                </article>
                <article className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs text-slate-500">{text.cash}</p>
                  <p className="text-lg font-black">{formatMoney(payload?.summary.cash_total ?? 0, lang)}</p>
                </article>
                <article className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs text-slate-500">{text.transfer}</p>
                  <p className="text-lg font-black">{formatMoney(payload?.summary.transfer_total ?? 0, lang)}</p>
                </article>
              </div>
            ) : null}

            {modalKind === "active" ? (
              <>
                {!sessionShift ? (
                  <p className="mt-4 text-sm text-slate-600">{text.noActiveShift}</p>
                ) : (
                  <div className="mt-4 grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                    <p>
                      {text.shiftName}: <strong>{currentCycle ? slotLabel(currentCycle.slot, lang) : "-"}</strong>
                    </p>
                    {currentCycle ? (
                      <p>
                        {text.period}: <strong>{slotWindowLabel(currentCycle.slot, lang)}</strong>
                      </p>
                    ) : null}
                    <p>
                      {text.openedAt}: <strong>{formatDateTime(sessionShift.opened_at, lang)}</strong>
                    </p>
                    <p>
                      {text.status}: <strong>{sessionShift.status === "open" ? text.open : text.closed}</strong>
                    </p>
                  </div>
                )}
              </>
            ) : null}

            {(modalKind === "open" || modalKind === "close") ? (
              <label className="mt-4 grid gap-1 text-sm font-semibold text-slate-700">
                {modalKind === "open" ? cashFloatLabel : text.closingCash}
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={modalKind === "open" ? openingCash : closingCash}
                  disabled={Boolean(busy)}
                  onChange={(event) => {
                    if (modalKind === "open") setOpeningCash(event.target.value);
                    if (modalKind === "close") setClosingCash(event.target.value);
                    if (error) setError(null);
                  }}
                  className="h-11 rounded-xl border border-slate-300 px-3 disabled:bg-slate-100 disabled:text-slate-500"
                  placeholder="0.00"
                />
              </label>
            ) : null}

            {modalKind === "close" ? (
              <div className="mt-4 grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                <p className="flex items-center justify-between gap-3">
                  <span>{text.cash}</span>
                  <strong>{formatMoney(closingCashExpected, lang)}</strong>
                </p>
                <p className="flex items-center justify-between gap-3">
                  <span>{text.transfer}</span>
                  <strong>{formatMoney(activeShiftMetrics?.transfer_total ?? 0, lang)}</strong>
                </p>
                <p className="flex items-center justify-between gap-3 border-t border-slate-200 pt-2">
                  <span>{cashVarianceLabel}</span>
                  <strong
                    className={
                      !hasClosingCashInput
                        ? "text-slate-600"
                        : !closingCashIsValid || Math.abs(closingCashVariance) < 0.01
                        ? "text-emerald-700"
                        : closingCashVariance < 0
                          ? "text-rose-700"
                          : "text-orange-600"
                    }
                  >
                    {!hasClosingCashInput
                      ? cashWaitingLabel
                      : !closingCashIsValid || Math.abs(closingCashVariance) < 0.01
                      ? cashBalancedLabel
                      : `${closingCashVariance < 0 ? cashShortLabel : cashOverLabel} ${formatMoney(Math.abs(closingCashVariance), lang)}`}
                  </strong>
                </p>
              </div>
            ) : null}

            {modalKind === "details" && selectedShift ? (
              <div className="mt-4 grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                {(() => {
                  const cycle = resolveShiftCycle(selectedShift.opened_at);
                  const cashVariance =
                    selectedShift.actual_cash === null
                      ? null
                      : Number((selectedShift.actual_cash - selectedShift.metrics.cash_total).toFixed(2));
                  const cashVarianceClass =
                    cashVariance === null
                      ? "text-slate-500"
                      : Math.abs(cashVariance) < 0.01
                        ? "text-emerald-700"
                        : cashVariance < 0
                          ? "text-rose-700"
                          : "text-orange-600";
                  return (
                    <>
                      <p className="flex justify-between gap-3">
                        <span>{text.shiftName}</span>
                        <strong>{cycle ? slotLabel(cycle.slot, lang) : "-"}</strong>
                      </p>
                      <p className="flex justify-between gap-3">
                        <span>{openedByLabel}</span>
                        <strong className="text-right">{selectedShift.opened_by_name ?? "-"}</strong>
                      </p>
                      <p className="flex justify-between gap-3">
                        <span>{closedByLabel}</span>
                        <strong className="text-right">{selectedShift.closed_by_name ?? "-"}</strong>
                      </p>
                      <p className="flex justify-between gap-3">
                        <span>{text.openedAt}</span>
                        <strong className="text-right">{formatDateTime(selectedShift.opened_at, lang)}</strong>
                      </p>
                      <p className="flex justify-between gap-3">
                        <span>{text.closedAt}</span>
                        <strong className="text-right">{selectedShift.closed_at ? formatDateTime(selectedShift.closed_at, lang) : "-"}</strong>
                      </p>
                      <hr className="border-slate-200" />
                      <p className="flex justify-between gap-3">
                        <span>{text.sales}</span>
                        <strong>{formatMoney(selectedShift.metrics.sales_total, lang)}</strong>
                      </p>
                      <p className="flex justify-between gap-3">
                        <span>{text.cash}</span>
                        <strong>{formatMoney(selectedShift.metrics.cash_total, lang)}</strong>
                      </p>
                      <p className="flex justify-between gap-3">
                        <span>{text.transfer}</span>
                        <strong>{formatMoney(selectedShift.metrics.transfer_total, lang)}</strong>
                      </p>
                      <p className="flex justify-between gap-3">
                        <span>{text.expected}</span>
                        <strong className={cashVarianceClass}>
                          {cashVariance === null ? "-" : formatSignedMoney(cashVariance, lang)}
                        </strong>
                      </p>
                      <p className="flex justify-between gap-3">
                        <span>{text.actual}</span>
                        <strong>{selectedShift.actual_cash === null ? "-" : formatMoney(selectedShift.actual_cash, lang)}</strong>
                      </p>
                    </>
                  );
                })()}
              </div>
            ) : null}

            {modalKind === "receipt" && closeReceipt ? (
              <div className="mt-3 max-h-[min(58dvh,520px)] overflow-y-auto rounded-xl border border-slate-200 bg-slate-100 p-3">
                <article className="posui-print-receipt58 mx-auto bg-white shadow-sm" style={{ width: "58mm", minHeight: "auto", color: "#000" }}>
                  <header className="posui-print-receipt58__head">
                    <h1>{closeReceipt.receipt.tenant_name}</h1>
                    <p>{closeReceipt.receipt.branch_name}</p>
                  </header>
                  <div className="posui-print-receipt58__divider" />
                  <dl className="posui-print-receipt58__meta">
                    <div><dt>{text.receiptSeller}</dt><dd>{closeReceipt.receipt.seller_name}</dd></div>
                    <div><dt>{text.receiptOpenedAt}</dt><dd>{formatDateTime(closeReceipt.receipt.opened_at, lang)}</dd></div>
                    <div><dt>{text.receiptClosedAt}</dt><dd>{formatDateTime(closeReceipt.closed_at, lang)}</dd></div>
                    <div><dt>{text.receiptCutoffAt}</dt><dd>{formatDateTime(closeReceipt.summary_cutoff_at, lang)}</dd></div>
                  </dl>
                  <div className="posui-print-receipt58__divider" />
                  <div className="posui-print-receipt58__summary">
                    <p className="is-heading"><span>{text.orders}</span><strong>{closeReceipt.summary.order_count}</strong></p>
                    <p className="is-muted"><span>{text.cancelled}</span><strong>{closeReceipt.summary.cancelled_order_count}</strong></p>
                    <p className="is-aux"><span>{text.sales}</span><strong>{formatMoney(closeReceipt.summary.sales_total, lang)}</strong></p>
                    <p className="is-aux"><span>{text.cash}</span><strong>{formatMoney(closeReceipt.summary.cash_total, lang)}</strong></p>
                    <p className="is-aux"><span>{text.transfer}</span><strong>{formatMoney(closeReceipt.summary.transfer_total, lang)}</strong></p>
                    <p className="is-due"><span>{text.receiptClosingCash}</span><strong>{formatMoney(closeReceipt.receipt.closing_cash, lang)}</strong></p>
                    <p className="is-aux"><span>{cashFloatLabel}</span><strong>{formatMoney(closeReceipt.receipt.opening_cash, lang)}</strong></p>
                    <p className="is-aux"><span>{text.receiptExpectedCash}</span><strong>{formatMoney(closeReceipt.receipt.expected_cash, lang)}</strong></p>
                    <p className="is-aux"><span>{text.receiptActualCash}</span><strong>{formatMoney(closeReceipt.receipt.actual_cash, lang)}</strong></p>
                  </div>
                  <div className="posui-print-receipt58__divider" />
                  <p className="posui-print-receipt58__footer">CpIPOS</p>
                </article>
              </div>
            ) : null}

            <div className={modalKind === "receipt" ? "mt-4 grid gap-2 sm:grid-cols-[0.8fr_1.35fr_1fr]" : "mt-4 flex justify-end gap-2"}>
              {modalKind === "receipt" ? (
                <>
                  {receiptPrintError ? (
                    <p className="rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700 sm:col-span-3">
                      {receiptPrintError}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => closeModal()}
                    disabled={Boolean(busy)}
                    className="min-h-10 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold leading-5 text-slate-700 disabled:opacity-60"
                  >
                    {text.close}
                  </button>
                  <button
                    type="button"
                    onClick={() => void printCloseReceipt()}
                    disabled={busy === "print"}
                    className="min-h-10 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold leading-5 text-slate-700 disabled:opacity-60"
                  >
                    {busy === "print" ? text.printing : text.printReceipt}
                  </button>
                  <button
                    type="button"
                    onClick={() => closeModal()}
                    disabled={Boolean(busy)}
                    className="min-h-10 w-full rounded-xl bg-slate-900 px-3 py-2 text-sm font-bold leading-5 text-white disabled:opacity-60"
                  >
                    {text.finishAndExit}
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => closeModal()}
                    disabled={Boolean(busy)}
                    className="h-10 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 disabled:opacity-60"
                  >
                    {modalKind === "active" || modalKind === "details" || modalKind === "summary" ? text.close : text.cancel}
                  </button>
                  {modalKind === "details" ? (
                    <button
                      type="button"
                      onClick={() => printSelectedShiftDetail58()}
                      className="h-10 rounded-xl bg-slate-900 px-4 text-sm font-bold text-white disabled:opacity-60"
                    >
                      {lang === "th" ? "พิมพ์ 58mm" : "Print 58mm"}
                    </button>
                  ) : null}
                  {modalKind !== "active" && modalKind !== "details" && modalKind !== "summary" ? (
                    <button
                      type="button"
                      onClick={() => void (modalKind === "open" ? openShiftNow() : closeShiftNow())}
                      disabled={Boolean(busy)}
                      className="h-10 rounded-xl bg-slate-900 px-4 text-sm font-bold text-white disabled:opacity-60"
                    >
                      {busy === "open" ? text.openingShiftTitle : busy === "close" ? "..." : text.confirm}
                    </button>
                  ) : null}
                </>
              )}
            </div>

            {modalKind === "receipt" && receiptPrintJobs.length > 0 ? (
              <div className="mt-3 rounded-xl border border-slate-200 bg-white p-2">
                <p className="mb-2 text-xs font-bold uppercase tracking-[0.08em] text-slate-500">{text.printJobStatus}</p>
                <ul className="grid gap-1 text-xs text-slate-700">
                  {receiptPrintJobs.map((job) => (
                    <li key={job.id} className="flex items-center justify-between gap-2">
                      <span className="truncate">{job.id.slice(0, 8)}</span>
                      <span className="font-semibold">{job.status}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}

      {closeReceipt ? (
        <section className="posui-print-receipt-root" aria-hidden="true">
          <article className="posui-print-receipt58">
            <header className="posui-print-receipt58__head">
              <h1>{closeReceipt.receipt.tenant_name}</h1>
              <p>{closeReceipt.receipt.branch_name}</p>
            </header>
            <div className="posui-print-receipt58__divider" />
            <dl className="posui-print-receipt58__meta">
              <div>
                <dt>{text.receiptSeller}</dt>
                <dd>{closeReceipt.receipt.seller_name}</dd>
              </div>
              <div>
                <dt>{text.receiptOpenedAt}</dt>
                <dd>{formatDateTime(closeReceipt.receipt.opened_at, lang)}</dd>
              </div>
              <div>
                <dt>{text.receiptClosedAt}</dt>
                <dd>{formatDateTime(closeReceipt.closed_at, lang)}</dd>
              </div>
              <div>
                <dt>{text.receiptCutoffAt}</dt>
                <dd>{formatDateTime(closeReceipt.summary_cutoff_at, lang)}</dd>
              </div>
            </dl>
            <div className="posui-print-receipt58__divider" />
            <div className="posui-print-receipt58__summary">
              <p className="is-heading">
                <span>{text.orders}</span>
                <strong>{closeReceipt.summary.order_count}</strong>
              </p>
              <p className="is-muted">
                <span>{text.cancelled}</span>
                <strong>{closeReceipt.summary.cancelled_order_count}</strong>
              </p>
              <p className="is-aux">
                <span>{text.sales}</span>
                <strong>{formatMoney(closeReceipt.summary.sales_total, lang)}</strong>
              </p>
              <p className="is-aux">
                <span>{text.cash}</span>
                <strong>{formatMoney(closeReceipt.summary.cash_total, lang)}</strong>
              </p>
              <p className="is-aux">
                <span>{text.transfer}</span>
                <strong>{formatMoney(closeReceipt.summary.transfer_total, lang)}</strong>
              </p>
              <p className="is-due">
                <span>{text.receiptClosingCash}</span>
                <strong>{formatMoney(closeReceipt.receipt.closing_cash, lang)}</strong>
              </p>
              <p className="is-aux">
                <span>{cashFloatLabel}</span>
                <strong>{formatMoney(closeReceipt.receipt.opening_cash, lang)}</strong>
              </p>
              <p className="is-aux">
                <span>{text.receiptExpectedCash}</span>
                <strong>{formatMoney(closeReceipt.receipt.expected_cash, lang)}</strong>
              </p>
              <p className="is-aux">
                <span>{text.receiptActualCash}</span>
                <strong>{formatMoney(closeReceipt.receipt.actual_cash, lang)}</strong>
              </p>
            </div>
            <div className="posui-print-receipt58__divider" />
            <p className="posui-print-receipt58__footer">CpIPOS</p>
          </article>
        </section>
      ) : null}
    </section>
  );
}
