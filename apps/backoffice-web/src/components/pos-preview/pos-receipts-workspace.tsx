"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { PosBackButton } from "@/components/pos-preview/pos-back-button";
import type { Language } from "@/lib/i18n";

type ReceiptItem = {
  product_id: string;
  product_code: string;
  name: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  notes?: string | null;
};

type ReceiptStoreProfile = {
  display_name?: string | null;
  name?: string | null;
  logo_url?: string | null;
  company_address?: string | null;
  contact_phone?: string | null;
};

type ReceiptTaxLine = {
  id: string;
  label: string;
  rate_pct: number;
  mode: string;
  amount: number;
};

type ReceiptRecord = {
  id: string;
  orderNo: string;
  orderType: string;
  channel: string;
  tableLabel: string;
  customerName: string;
  memberName: string | null;
  memberPhone: string | null;
  externalOrderCode: string | null;
  subtotal: number;
  discountAmount: number;
  gpAmount: number;
  taxTotal: number;
  taxLines: ReceiptTaxLine[];
  totalAmount: number;
  paidTotal: number;
  status: string;
  createdAt: string;
  paidAt: string | null;
  cashierName: string;
  sellerName: string;
  paymentMethods: string[];
  itemCount: number;
  items: ReceiptItem[];
  cashReceived: number;
  changeAmount: number;
  notes: string | null;
};

type ReceiptPayload = {
  branch: { id: string; name: string; store_profile?: ReceiptStoreProfile | null };
  range: { label: string };
  records: ReceiptRecord[];
  summary: {
    receiptCount: number;
    completedCount: number;
    grossTotal: number;
    paidTotal: number;
  };
  pagination: {
    page: number;
    page_size: number;
    total: number;
    total_pages: number;
  };
};

type DateMode = "day" | "month" | "year" | "custom";

type ReprintState = {
  order: ReceiptRecord;
  pin: string;
  note: string;
  status: "idle" | "printing" | "printed" | "failed";
  message: string | null;
};

type BluetoothReprintResponseBody = {
  data?: {
    mode?: string;
    fallback_to_browser_print?: boolean;
    jobs?: Array<{ id: string; status: string; last_error?: string | null; printed_at?: string | null }>;
    message?: string;
  } | null;
  error?: { message?: string } | null;
};

function getBangkokToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function formatDateTime(value: string | null, lang: Language) {
  if (!value) return "-";
  return new Intl.DateTimeFormat(lang === "th" ? "th-TH" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok"
  }).format(new Date(value));
}

function formatMoney(value: number, lang: Language) {
  return new Intl.NumberFormat(lang === "th" ? "th-TH" : "en-US", {
    style: "currency",
    currency: "THB",
    maximumFractionDigits: 2
  }).format(Number(value || 0));
}

function formatMoneyPlain(value: number): string {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

function formatSignedMoneyPlain(amount: number): string {
  const sign = amount < 0 ? "-" : "+";
  return `${sign}฿${formatMoneyPlain(Math.abs(amount))}`;
}

function formatQuantity(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getAbsoluteAssetUrl(path: string): string {
  if (typeof window === "undefined") return path;
  return new URL(path, window.location.origin).toString();
}

function normalizeReceiptLogoPath(value: unknown): string | null {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("/") || trimmed.startsWith("data:image/")) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return null;
}

function parseReceiptItemDetails(notes?: string | null) {
  const raw = String(notes ?? "").trim();
  if (!raw) return { choices: [] as string[], note: null as string | null };
  const parts = raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length > 1) return { choices: parts, note: null };
  return { choices: [], note: raw };
}

function normalizeTaxLines(value: unknown): ReceiptTaxLine[] {
  if (!Array.isArray(value)) return [];
  return value
    .map<ReceiptTaxLine | null>((entry, index) => {
      if (!entry || typeof entry !== "object") return null;
      const source = entry as Partial<ReceiptTaxLine>;
      const amount = Number(source.amount ?? 0);
      if (!Number.isFinite(amount) || Math.abs(amount) < 0.005) return null;
      return {
        id: typeof source.id === "string" && source.id.trim() ? source.id.trim() : `tax-line-${index + 1}`,
        label: typeof source.label === "string" && source.label.trim() ? source.label.trim() : `Tax ${index + 1}`,
        rate_pct: Number.isFinite(Number(source.rate_pct)) ? Number(source.rate_pct) : 0,
        mode: source.mode === "deduct_from_bill" ? "deduct_from_bill" : "add_to_bill",
        amount: Number(amount.toFixed(2))
      };
    })
    .filter((entry): entry is ReceiptTaxLine => Boolean(entry));
}

function resolveReceiptTaxLines(record: ReceiptRecord, fallbackLabel: string): ReceiptTaxLine[] {
  const explicitLines = normalizeTaxLines(record.taxLines);
  if (explicitLines.length > 0) return explicitLines;
  const taxTotal = Number(record.taxTotal ?? 0);
  if (!Number.isFinite(taxTotal) || Math.abs(taxTotal) < 0.005) return [];
  return [
    {
      id: "tax-total",
      label: fallbackLabel,
      rate_pct: 0,
      mode: taxTotal < 0 ? "deduct_from_bill" : "add_to_bill",
      amount: Number(taxTotal.toFixed(2))
    }
  ];
}

function paymentLabel(methods: string[], lang: Language) {
  if (methods.length === 0) return lang === "th" ? "ยังไม่ชำระ" : "Unpaid";
  const labels = methods.map((method) => {
    if (method === "cash") return lang === "th" ? "เงินสด" : "Cash";
    if (method === "bank_transfer") return lang === "th" ? "โอนเงิน" : "Transfer";
    if (method === "card") return lang === "th" ? "บัตร" : "Card";
    return method;
  });
  return Array.from(new Set(labels)).join(" + ");
}

function statusLabel(status: string, lang: Language) {
  if (status === "completed") return lang === "th" ? "ชำระแล้ว" : "Paid";
  if (status === "cancelled") return lang === "th" ? "ยกเลิก" : "Cancelled";
  if (status === "queued") return lang === "th" ? "รอชำระ" : "Queued";
  return status;
}

function orderTypeLabel(type: string, lang: Language) {
  if (type === "dine_in") return lang === "th" ? "ทานที่ร้าน" : "Dine-in";
  if (type === "delivery_manual") return lang === "th" ? "เดลิเวอรี่" : "Delivery";
  return lang === "th" ? "กลับบ้าน" : "Takeaway";
}

function memberLabel(record: Pick<ReceiptRecord, "memberName" | "memberPhone">) {
  if (record.memberName && record.memberPhone) return `${record.memberName} / ${record.memberPhone}`;
  return record.memberName ?? record.memberPhone ?? "-";
}

function receiptMemberLabel(record: Pick<ReceiptRecord, "memberName" | "memberPhone">) {
  const member = memberLabel(record);
  return member === "-" ? null : member;
}

function resolveReceiptPaymentMethod(record: ReceiptRecord, lang: Language) {
  const firstMethod = record.paymentMethods[0] ?? "";
  if (firstMethod === "cash") return lang === "th" ? "เงินสด" : "Cash";
  if (firstMethod === "bank_transfer") return lang === "th" ? "โอนเงิน" : "Transfer";
  if (firstMethod === "card") return lang === "th" ? "บัตร" : "Card";
  return paymentLabel(record.paymentMethods, lang);
}

function buildReceiptPrintHtml(args: {
  record: ReceiptRecord;
  branchName: string;
  storeProfile?: ReceiptStoreProfile | null;
  lang: Language;
  autoPrint?: boolean;
}) {
  const { record, branchName, lang, autoPrint = false } = args;
  const storeProfile = args.storeProfile ?? null;
  const storeName = String(storeProfile?.display_name ?? storeProfile?.name ?? "").trim() || (lang === "th" ? "ร้านค้า" : "Store");
  const storeAddress = String(storeProfile?.company_address ?? "").trim();
  const storePhone = String(storeProfile?.contact_phone ?? "").trim();
  const logoPath = normalizeReceiptLogoPath(storeProfile?.logo_url) ?? "/brand/cpipos-logo.png";
  const logoUrl = getAbsoluteAssetUrl(logoPath);
  const labels =
    lang === "th"
      ? {
          seller: "ชื่อผู้ขาย",
          shift: "กะ",
          mode: "โหมด",
          billNo: "เลขที่บิล",
          externalCode: "รหัสออเดอร์",
          member: "สมาชิก",
          date: "วันที่",
          note: "หมายเหตุ",
          discount: "ส่วนลด",
          tax: "ภาษี",
          paymentMethod: "ชำระเงิน",
          totalDue: "ยอดที่ต้องชำระ",
          cashReceived: "รับเงินจากลูกค้า",
          change: "เงินทอน"
        }
      : {
          seller: "Seller",
          shift: "Shift",
          mode: "Mode",
          billNo: "Bill No.",
          externalCode: "Order code",
          member: "Member",
          date: "Date",
          note: "Note",
          discount: "Discount",
          tax: "Tax",
          paymentMethod: "Payment",
          totalDue: "Total due",
          cashReceived: "Cash received",
          change: "Change"
        };
  const pageHeightMm = Math.min(700, Math.max(120, 78 + record.items.length * 10));
  const printableWidthMm = 48;
  const itemRows = record.items
    .map((item) => {
      const details = parseReceiptItemDetails(item.notes);
      const detailRows = [
        ...details.choices.map((choice) => `<div class="choice">+ ${escapeHtml(choice)}</div>`),
        details.note ? `<div class="note">${escapeHtml(labels.note)}: ${escapeHtml(details.note)}</div>` : ""
      ].join("");
      return `
        <tr>
          <td class="col-name">
            <div class="name">${escapeHtml(item.name)}</div>
            <div class="unit">x ${escapeHtml(formatMoneyPlain(item.unit_price))}</div>
            ${detailRows}
          </td>
          <td class="col-qty">${escapeHtml(formatQuantity(item.quantity))}</td>
          <td class="col-total">${escapeHtml(formatMoneyPlain(item.line_total))}</td>
        </tr>
      `;
    })
    .join("");
  const member = receiptMemberLabel(record);
  const externalOrderCodeMeta = record.externalOrderCode?.trim()
    ? `<div class="meta-line"><span>${escapeHtml(labels.externalCode)}</span><span>${escapeHtml(record.externalOrderCode)}</span></div>`
    : "";
  const receiptMemberMeta = member
    ? `<div class="meta-line"><span>${escapeHtml(labels.member)}</span><span>${escapeHtml(member)}</span></div>`
    : "";
  const storeAddressLine = storeAddress ? `<div class="muted">${escapeHtml(storeAddress)}</div>` : "";
  const storePhoneLine = storePhone ? `<div class="muted">${escapeHtml(storePhone)}</div>` : "";
  const taxSummaryLines = resolveReceiptTaxLines(record, labels.tax)
    .map(
      (line) =>
        `<div class="summary-line is-muted"><span>${escapeHtml(line.label)}</span><strong>${escapeHtml(formatSignedMoneyPlain(line.amount))}</strong></div>`
    )
    .join("");
  const cashSummaryLines =
    record.paymentMethods.includes("cash")
      ? `
    <div class="summary-line is-aux"><span>${escapeHtml(labels.cashReceived)}</span><strong>฿${escapeHtml(formatMoneyPlain(record.cashReceived))}</strong></div>
    <div class="summary-line is-aux"><span>${escapeHtml(labels.change)}</span><strong>฿${escapeHtml(formatMoneyPlain(record.changeAmount))}</strong></div>`
      : "";
  const autoPrintScript = autoPrint ? "<script>window.addEventListener('load',()=>setTimeout(()=>window.print(),120));</script>" : "";

  return `<!doctype html>
<html lang="${lang}">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(storeName)} - ${escapeHtml(record.orderNo)}</title>
  <style>
    @page { size: 58mm ${pageHeightMm}mm; margin: 0; }
    html, body { margin: 0; padding: 0; width: 58mm !important; min-height: ${pageHeightMm}mm; background: #fff; color: #000; font-family: "Noto Sans Thai", "Tahoma", "Segoe UI", sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    * { box-sizing: border-box; }
    .receipt58 { width: ${printableWidthMm}mm; margin: 0 auto; padding: 1.2mm 0 1.8mm; min-height: ${Math.max(90, pageHeightMm - 4)}mm; font-size: 11px; line-height: 1.28; }
    .logo-wrap { text-align: center; margin-bottom: 0.8mm; }
    .logo-wrap img { max-width: 28mm; max-height: 9mm; object-fit: contain; }
    .head-title { font-weight: 900; font-size: 14px; margin-bottom: 0.6mm; text-align: center; }
    .muted { color: #222; font-size: 12px; font-weight: 800; text-align: center; }
    .hr { border-top: 1px dashed #111; margin: 1.4mm 0; }
    .meta-line { display: flex; justify-content: space-between; gap: 1mm; margin: 0.5mm 0; }
    .meta-line span:last-child { text-align: right; }
    table { width: 100%; border-collapse: collapse; margin-top: 0.6mm; }
    th, td { padding: 0.6mm 0; vertical-align: top; }
    .col-qty { width: 8mm; text-align: center; }
    .col-total { width: 16mm; text-align: right; white-space: nowrap; }
    .name { font-weight: 700; line-height: 1.25; }
    .unit { font-size: 10px; color: #333; line-height: 1.2; }
    .choice, .note { margin-top: 0.4mm; padding-left: 1.5mm; color: #111; font-size: 9.4px; line-height: 1.18; }
    .note { color: #333; font-style: italic; }
    .summary-line { display: flex; justify-content: space-between; align-items: baseline; gap: 1mm; margin: 0.72mm 0; font-size: 10px; }
    .summary-line span { font-weight: 600; }
    .summary-line strong { font-weight: 700; white-space: nowrap; }
    .summary-line.is-heading { padding-bottom: 0.8mm; margin-bottom: 0.7mm; border-bottom: 1px dashed #111; font-size: 9.6px; }
    .summary-line.is-muted { font-size: 9.6px; }
    .summary-line.is-aux { font-size: 9.7px; }
    .summary-line.grand { margin: 1.1mm 0 0.9mm; padding: 0.7mm 0; border-top: 1px solid #111; border-bottom: 1px solid #111; font-size: 13px; }
    .summary-line.grand span, .summary-line.grand strong { font-weight: 900; }
    .summary-line.grand strong { font-size: 14.5px; line-height: 1; }
    .foot { margin-top: 1.5mm; font-size: 10px; text-align: center; }
    @media print {
      html, body { width: 58mm !important; margin: 0 !important; padding: 0 !important; overflow: hidden; }
      .receipt58 { width: ${printableWidthMm}mm; margin: 0 auto; }
    }
  </style>
</head>
<body>
  <main class="receipt58">
    <div class="logo-wrap"><img src="${escapeHtml(logoUrl)}" alt="receipt logo" /></div>
    <div class="head-title">${escapeHtml(storeName)}</div>
    ${storeAddressLine}
    ${storePhoneLine}
    <div class="muted">${escapeHtml(branchName)}</div>
    <div class="hr"></div>
    <div class="meta-line"><span>${escapeHtml(labels.seller)}</span><span>${escapeHtml(record.sellerName)}</span></div>
    <div class="meta-line"><span>${escapeHtml(labels.shift)}</span><span>${escapeHtml(statusLabel(record.status, lang))}</span></div>
    <div class="meta-line"><span>${escapeHtml(labels.mode)}</span><span>${escapeHtml(orderTypeLabel(record.orderType, lang))}</span></div>
    <div class="meta-line"><span>${escapeHtml(labels.billNo)}</span><span>${escapeHtml(record.orderNo)}</span></div>
    ${externalOrderCodeMeta}
    ${receiptMemberMeta}
    <div class="meta-line"><span>${escapeHtml(labels.date)}</span><span>${escapeHtml(formatDateTime(record.createdAt, lang))}</span></div>
    <div class="hr"></div>
    <table><tbody>${itemRows}</tbody></table>
    <div class="hr"></div>
    <div class="summary-line is-heading"><span>${escapeHtml(labels.paymentMethod)}</span><strong>${escapeHtml(resolveReceiptPaymentMethod(record, lang))}</strong></div>
    <div class="summary-line is-muted"><span>${escapeHtml(labels.discount)}</span><strong>฿${escapeHtml(formatMoneyPlain(record.discountAmount))}</strong></div>
    ${taxSummaryLines}
    <div class="summary-line grand"><span>${escapeHtml(labels.totalDue)}</span><strong>฿${escapeHtml(formatMoneyPlain(record.totalAmount))}</strong></div>
    ${cashSummaryLines}
    <div class="hr"></div>
    <div class="foot">CpIPOS</div>
  </main>
  ${autoPrintScript}
</body>
</html>`;
}

function buildQuery(params: {
  mode: DateMode;
  date: string;
  month: string;
  year: string;
  from: string;
  to: string;
  q: string;
  status: string;
  page: number;
}) {
  const search = new URLSearchParams();
  search.set("mode", params.mode);
  search.set("status", params.status);
  search.set("page", String(params.page));
  search.set("page_size", "20");
  if (params.mode === "day") search.set("date", params.date);
  if (params.mode === "month") search.set("month", params.month);
  if (params.mode === "year") search.set("year", params.year);
  if (params.mode === "custom") {
    search.set("from", params.from);
    search.set("to", params.to);
  }
  if (params.q.trim()) search.set("q", params.q.trim());
  return search.toString();
}

export function PosReceiptsWorkspace({ lang }: { lang: Language }) {
  const today = useMemo(() => getBangkokToday(), []);
  const [mode, setMode] = useState<DateMode>("day");
  const [date, setDate] = useState(today);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [year, setYear] = useState(today.slice(0, 4));
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("completed");
  const [page, setPage] = useState(1);
  const [payload, setPayload] = useState<ReceiptPayload | null>(null);
  const [selected, setSelected] = useState<ReceiptRecord | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reprint, setReprint] = useState<ReprintState | null>(null);

  const copy = lang === "th"
    ? {
        title: "ใบเสร็จย้อนหลัง",
        desc: "ค้นหาใบเสร็จตามวัน เดือน ปี หรือเลขบิล แล้วพิมพ์ย้อนหลังขนาด 58mm ด้วย PIN ผู้จัดการหรือเจ้าของร้าน",
        search: "ค้นหาเลขบิล / ลูกค้า / แอปเดลิเวอรี่",
        day: "รายวัน",
        month: "รายเดือน",
        year: "รายปี",
        custom: "กำหนดเอง",
        statusAll: "ทุกสถานะ",
        statusPaid: "ชำระแล้ว",
        statusQueued: "รอชำระ",
        statusCancelled: "ยกเลิก",
        refresh: "รีเฟรช",
        receipts: "ใบเสร็จ",
        completed: "ชำระแล้ว",
        gross: "ยอดรวม",
        paid: "รับชำระ",
        bill: "เลขบิล",
        time: "เวลา",
        customer: "ลูกค้า/โต๊ะ",
        payment: "ชำระเงิน",
        total: "ยอดสุทธิ",
        action: "จัดการ",
        detail: "รายละเอียดใบเสร็จ",
        choose: "เลือกใบเสร็จเพื่อดูรายละเอียดและพิมพ์ย้อนหลัง",
        print: "พิมพ์ใบเสร็จ 58mm",
        pinTitle: "ยืนยัน PIN เพื่อพิมพ์ย้อนหลัง",
        pinDesc: "ใช้ได้เฉพาะ PIN ของผู้จัดการหรือเจ้าของร้าน",
        pin: "PIN",
        note: "หมายเหตุ",
        cancel: "ยกเลิก",
        confirmPrint: "ยืนยันพิมพ์",
        printing: "กำลังส่งพิมพ์...",
        printed: "ส่งพิมพ์แล้ว",
        noData: "ยังไม่พบใบเสร็จในช่วงเวลานี้",
        prev: "ก่อนหน้า",
        next: "ถัดไป"
      }
    : {
        title: "Receipt History",
        desc: "Search receipts by day, month, year, or bill number, then reprint 58mm receipts with manager/owner PIN.",
        search: "Search bill / customer / delivery code",
        day: "Day",
        month: "Month",
        year: "Year",
        custom: "Custom",
        statusAll: "All status",
        statusPaid: "Paid",
        statusQueued: "Queued",
        statusCancelled: "Cancelled",
        refresh: "Refresh",
        receipts: "Receipts",
        completed: "Paid",
        gross: "Gross",
        paid: "Paid total",
        bill: "Bill",
        time: "Time",
        customer: "Customer/Table",
        payment: "Payment",
        total: "Net",
        action: "Action",
        detail: "Receipt detail",
        choose: "Select a receipt to inspect and reprint.",
        print: "Print 58mm receipt",
        pinTitle: "Confirm PIN to reprint",
        pinDesc: "Manager or owner PIN only.",
        pin: "PIN",
        note: "Note",
        cancel: "Cancel",
        confirmPrint: "Confirm print",
        printing: "Sending print...",
        printed: "Print queued",
        noData: "No receipts in this range.",
        prev: "Previous",
        next: "Next"
      };

  async function load(nextPage = page) {
    setLoading(true);
    setError(null);
    try {
      const query = buildQuery({ mode, date, month, year, from, to, q, status, page: nextPage });
      const response = await fetch(`/api/pos/receipts?${query}`, { cache: "no-store" });
      const body = (await response.json()) as { data?: ReceiptPayload | null; error?: { message?: string } | null };
      if (!response.ok || !body.data) {
        throw new Error(body.error?.message ?? "Cannot load receipts.");
      }
      const nextData = body.data;
      setPayload(nextData);
      setSelected((current) => {
        if (!current) return nextData.records[0] ?? null;
        return nextData.records.find((record) => record.id === current.id) ?? nextData.records[0] ?? null;
      });
      setPage(nextPage);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Cannot load receipts.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, status]);

  function openBrowserReceiptPrint(record: ReceiptRecord) {
    const receiptHtml = buildReceiptPrintHtml({
      record,
      branchName: payload?.branch.name ?? "-",
      storeProfile: payload?.branch.store_profile ?? null,
      lang,
      autoPrint: true
    });
    const printWindow = window.open("", "_blank", "width=360,height=720");
    if (!printWindow) {
      setError(lang === "th" ? "ไม่สามารถเปิดหน้าพิมพ์ได้" : "Unable to open print window.");
      return;
    }
    printWindow.document.open();
    printWindow.document.write(receiptHtml);
    printWindow.document.close();
  }

  async function submitReprint() {
    if (!reprint) return;
    setReprint({ ...reprint, status: "printing", message: null });
    try {
      const receiptHtml = buildReceiptPrintHtml({
        record: reprint.order,
        branchName: payload?.branch.name ?? "-",
        storeProfile: payload?.branch.store_profile ?? null,
        lang
      });
      const response = await fetch(`/api/pos/receipts/${reprint.order.id}/reprint`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          manager_pin: reprint.pin,
          note: reprint.note,
          order_no: reprint.order.orderNo,
          receipt_html: receiptHtml
        })
      });
      const body = (await response.json().catch(() => null)) as BluetoothReprintResponseBody | null;
      if (!response.ok) {
        throw new Error(body?.error?.message ?? "Reprint failed.");
      }
      if (body?.data?.fallback_to_browser_print) {
        openBrowserReceiptPrint(reprint.order);
      }
      setReprint({ ...reprint, status: "printed", message: copy.printed, pin: "" });
    } catch (printError) {
      setReprint({
        ...reprint,
        status: "failed",
        message: printError instanceof Error ? printError.message : "Reprint failed."
      });
    }
  }

  const records = payload?.records ?? [];
  const pagination = payload?.pagination;

  return (
    <main className="min-h-full bg-slate-50 px-4 py-4 text-slate-950 xl:px-6">
      <section className="mx-auto grid max-w-[1480px] gap-4">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <PosBackButton lang={lang} href="/preview/pos/more" label={lang === "th" ? "กลับเมนูเพิ่มเติม" : "Back to More"} className="mb-3" />
            <h1 className="m-0 text-[26px] font-black tracking-normal text-slate-950">{copy.title}</h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-600">{copy.desc}</p>
          </div>
          <button
            type="button"
            onClick={() => void load(1)}
            className="h-10 rounded-lg border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-100"
          >
            {copy.refresh}
          </button>
        </header>

        <section className="grid gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
          <div className="flex flex-wrap gap-2">
            {([
              ["day", copy.day],
              ["month", copy.month],
              ["year", copy.year],
              ["custom", copy.custom]
            ] as Array<[DateMode, string]>).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setMode(value);
                  setPage(1);
                }}
                className={`h-9 rounded-lg px-3 text-sm font-bold ${
                  mode === value ? "bg-blue-600 text-white" : "border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="grid gap-2 lg:grid-cols-[1fr_180px_180px_auto]">
            <input
              value={q}
              onChange={(event) => setQ(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void load(1);
              }}
              placeholder={copy.search}
              className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold outline-none focus:border-blue-500"
            />
            {mode === "day" ? (
              <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="h-10 rounded-lg border border-slate-300 px-3 text-sm font-semibold" />
            ) : null}
            {mode === "month" ? (
              <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} className="h-10 rounded-lg border border-slate-300 px-3 text-sm font-semibold" />
            ) : null}
            {mode === "year" ? (
              <input type="number" value={year} onChange={(event) => setYear(event.target.value)} className="h-10 rounded-lg border border-slate-300 px-3 text-sm font-semibold" min="2020" max="2100" />
            ) : null}
            {mode === "custom" ? (
              <>
                <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="h-10 rounded-lg border border-slate-300 px-3 text-sm font-semibold" />
                <input type="date" value={to} onChange={(event) => setTo(event.target.value)} className="h-10 rounded-lg border border-slate-300 px-3 text-sm font-semibold" />
              </>
            ) : null}
            <select value={status} onChange={(event) => setStatus(event.target.value)} className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold">
              <option value="completed">{copy.statusPaid}</option>
              <option value="queued">{copy.statusQueued}</option>
              <option value="cancelled">{copy.statusCancelled}</option>
              <option value="all">{copy.statusAll}</option>
            </select>
            <button type="button" onClick={() => void load(1)} className="h-10 rounded-lg bg-slate-900 px-4 text-sm font-bold text-white hover:bg-slate-800">
              {copy.refresh}
            </button>
          </div>
        </section>

        <section className="grid gap-3 md:grid-cols-4">
          <Metric label={copy.receipts} value={String(payload?.summary.receiptCount ?? 0)} />
          <Metric label={copy.completed} value={String(payload?.summary.completedCount ?? 0)} />
          <Metric label={copy.gross} value={formatMoney(payload?.summary.grossTotal ?? 0, lang)} />
          <Metric label={copy.paid} value={formatMoney(payload?.summary.paidTotal ?? 0, lang)} />
        </section>

        {error ? <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-700">{error}</p> : null}

        <section>
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="max-h-[58vh] overflow-auto">
              <table className="w-full min-w-[920px] border-collapse text-left text-sm">
                <thead className="sticky top-0 bg-slate-100 text-xs uppercase text-slate-500">
                  <tr>
                    <Th>{copy.bill}</Th>
                    <Th>{copy.time}</Th>
                    <Th>{copy.customer}</Th>
                    <Th>{copy.payment}</Th>
                    <Th>{copy.total}</Th>
                    <Th>{copy.action}</Th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((record) => (
                    <tr key={record.id} className={`border-t border-slate-100 ${selected?.id === record.id ? "bg-blue-50" : "hover:bg-slate-50"}`}>
                      <Td>
                        <button type="button" onClick={() => setSelected(record)} className="text-left font-black text-slate-950">
                          {record.orderNo}
                        </button>
                        <p className="mt-1 text-xs text-slate-500">{orderTypeLabel(record.orderType, lang)} | {statusLabel(record.status, lang)}</p>
                      </Td>
                      <Td>{formatDateTime(record.createdAt, lang)}</Td>
                      <Td>
                        <strong className="block text-slate-800">{record.customerName}</strong>
                        {memberLabel(record) !== "-" ? (
                          <span className="block text-xs font-semibold text-blue-700">{memberLabel(record)}</span>
                        ) : null}
                        <span className="text-xs text-slate-500">{record.tableLabel}</span>
                      </Td>
                      <Td>{paymentLabel(record.paymentMethods, lang)}</Td>
                      <Td strong>{formatMoney(record.totalAmount, lang)}</Td>
                      <Td>
                        <button
                          type="button"
                          onClick={() => {
                            setSelected(record);
                            setDetailOpen(true);
                          }}
                          className="h-8 rounded-lg border border-slate-300 px-3 text-xs font-bold text-slate-700 hover:bg-slate-100"
                        >
                          {copy.detail}
                        </button>
                      </Td>
                    </tr>
                  ))}
                  {!loading && records.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-10 text-center text-sm font-semibold text-slate-500">
                        {copy.noData}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between border-t border-slate-200 px-3 py-2 text-sm text-slate-600">
              <span>
                {pagination ? `${pagination.page} / ${Math.max(1, pagination.total_pages)}` : "-"}
              </span>
              <div className="flex gap-2">
                <button disabled={!pagination || pagination.page <= 1} onClick={() => void load(page - 1)} className="h-8 rounded-lg border border-slate-300 px-3 font-bold disabled:opacity-40">
                  {copy.prev}
                </button>
                <button disabled={!pagination || pagination.page >= pagination.total_pages} onClick={() => void load(page + 1)} className="h-8 rounded-lg border border-slate-300 px-3 font-bold disabled:opacity-40">
                  {copy.next}
                </button>
              </div>
            </div>
          </div>
        </section>
      </section>

      {detailOpen && selected ? (
        <div className="fixed inset-0 z-[95] bg-slate-950/35" role="presentation" onClick={() => setDetailOpen(false)}>
          <aside
            className="ml-auto flex h-full w-full max-w-[430px] translate-x-0 flex-col border-l border-slate-200 bg-white shadow-2xl transition-transform"
            role="dialog"
            aria-modal="true"
            aria-label={copy.detail}
            onClick={(event) => event.stopPropagation()}
          >
            <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <h2 className="m-0 text-lg font-black text-slate-950">{copy.detail}</h2>
              <button
                type="button"
                onClick={() => setDetailOpen(false)}
                className="grid h-9 w-9 place-items-center rounded-lg border border-slate-300 text-lg font-black text-slate-600 hover:bg-slate-100"
                aria-label={copy.cancel}
              >
                x
              </button>
            </header>
            <div className="flex flex-1 justify-center overflow-auto bg-slate-100 px-4 py-5">
              <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                <iframe
                  title={`${copy.detail} ${selected.orderNo}`}
                  srcDoc={buildReceiptPrintHtml({
                    record: selected,
                    branchName: payload?.branch.name ?? "-",
                    storeProfile: payload?.branch.store_profile ?? null,
                    lang
                  })}
                  className="h-[calc(100vh-190px)] w-[58mm] border-0 bg-white"
                  sandbox=""
                />
              </div>
            </div>
            <footer className="border-t border-slate-200 p-4">
              <button
                type="button"
                onClick={() => setReprint({ order: selected, pin: "", note: "", status: "idle", message: null })}
                className="h-11 w-full rounded-lg bg-blue-600 px-4 text-sm font-black text-white shadow-sm hover:bg-blue-700"
              >
                {copy.print}
              </button>
            </footer>
          </aside>
        </div>
      ) : null}

      {reprint ? (
        <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/50 p-4" role="dialog" aria-modal="true">
          <section className="w-full max-w-md rounded-lg bg-white p-4 shadow-2xl">
            <h3 className="m-0 text-lg font-black text-slate-950">{copy.pinTitle}</h3>
            <p className="mt-1 text-sm text-slate-600">{copy.pinDesc}</p>
            <div className="mt-4 grid gap-3">
              <label className="grid gap-1 text-sm font-bold text-slate-700">
                {copy.pin}
                <input
                  value={reprint.pin}
                  onChange={(event) => setReprint({ ...reprint, pin: event.target.value })}
                  type="password"
                  inputMode="numeric"
                  className="h-10 rounded-lg border border-slate-300 px-3 text-lg font-black tracking-[0.18em]"
                />
              </label>
              <label className="grid gap-1 text-sm font-bold text-slate-700">
                {copy.note}
                <input
                  value={reprint.note}
                  onChange={(event) => setReprint({ ...reprint, note: event.target.value })}
                  className="h-10 rounded-lg border border-slate-300 px-3 text-sm font-semibold"
                />
              </label>
              {reprint.message ? (
                <p className={`m-0 rounded-lg px-3 py-2 text-sm font-bold ${reprint.status === "failed" ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>
                  {reprint.message}
                </p>
              ) : null}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setReprint(null)} className="h-10 rounded-lg border border-slate-300 px-4 text-sm font-bold text-slate-700">
                {copy.cancel}
              </button>
              <button
                type="button"
                onClick={() => void submitReprint()}
                disabled={reprint.status === "printing"}
                className="h-10 rounded-lg bg-blue-600 px-4 text-sm font-black text-white disabled:opacity-60"
              >
                {reprint.status === "printing" ? copy.printing : copy.confirmPrint}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      <p className="m-0 text-xs font-bold uppercase text-slate-500">{label}</p>
      <strong className="mt-1 block text-xl font-black text-slate-950">{value}</strong>
    </div>
  );
}

function Th({ children }: { children: ReactNode }) {
  return <th className="px-4 py-3 font-black">{children}</th>;
}

function Td({ children, strong = false }: { children: ReactNode; strong?: boolean }) {
  return <td className={`px-4 py-3 align-top ${strong ? "font-black text-slate-950" : "text-slate-700"}`}>{children}</td>;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-2 last:border-0">
      <dt className="text-slate-500">{label}</dt>
      <dd className="m-0 text-right font-black text-slate-900">{value}</dd>
    </div>
  );
}
