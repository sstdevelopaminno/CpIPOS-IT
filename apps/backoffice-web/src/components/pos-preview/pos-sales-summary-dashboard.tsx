"use client";

import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { PosBackButton } from "@/components/pos-preview/pos-back-button";
import { downloadExcelCsv, type CsvCellValue } from "@/lib/excel-csv";
import type { Language } from "@/lib/i18n";
import type { PosSalesSummaryPayload } from "@/lib/services/pos-sales-summary-service";

type Props = {
  lang: Language;
  initialPayload: PosSalesSummaryPayload;
};

type ApiBody = {
  data?: PosSalesSummaryPayload | null;
};

type MoreDialogTab = "payments" | "products" | "cashiers";

const SHIFT_ROWS_PER_PAGE = 10;

const statusOptions = [
  { value: "all", label: "ทุกสถานะ" },
  { value: "completed", label: "สำเร็จ" },
  { value: "cancelled", label: "ยกเลิก" },
  { value: "draft", label: "ร่าง" },
  { value: "queued", label: "รอทำ" },
  { value: "preparing", label: "กำลังทำ" }
];

const paymentOptions = [
  { value: "all", label: "ทุกช่องทาง" },
  { value: "cash", label: "เงินสด" },
  { value: "bank_transfer", label: "โอน / QR" },
  { value: "card", label: "บัตรเครดิต / เดบิต" },
  { value: "other", label: "อื่น ๆ" }
];

const inputClass =
  "h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-blue-400 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400";

function money(value: number, lang: Language): string {
  return new Intl.NumberFormat(lang === "th" ? "th-TH" : "en-US", {
    style: "currency",
    currency: "THB",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

function number(value: number, lang: Language): string {
  return new Intl.NumberFormat(lang === "th" ? "th-TH" : "en-US", { maximumFractionDigits: 3 }).format(value);
}

function dateTime(value: string | null, lang: Language): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat(lang === "th" ? "th-TH" : "en-US", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Bangkok"
  }).format(new Date(value));
}

function shiftSummaryCsvHeaders(lang: Language): string[] {
  return lang === "th"
    ? ["เปิดกะ", "ปิดกะ", "สาขา", "พนักงาน", "เงินต้น", "เงินสด", "คาดหวัง", "เงินจริง", "ต่าง"]
    : ["Opened at", "Closed at", "Branch", "Cashier", "Opening cash", "Cash sales", "Expected cash", "Actual cash", "Difference"];
}

function paymentLabel(label: string, method?: string, lang: Language = "th"): string {
  if (method === "cash") return lang === "th" ? "เงินสด" : "Cash";
  if (method === "bank_transfer") return lang === "th" ? "โอน / QR" : "Transfer / QR";
  if (method === "card") return lang === "th" ? "บัตรเครดิต / เดบิต" : "Credit / Debit Card";
  if (label.includes("เธ") || label.includes("เน")) return method === "other" ? (lang === "th" ? "อื่น ๆ" : "Other") : lang === "th" ? "ยังไม่ชำระ" : "Unpaid";
  return label || "-";
}

export function PosSalesSummaryDashboard({ lang, initialPayload }: Props) {
  const [payload, setPayload] = useState(initialPayload);
  const [dateFrom, setDateFrom] = useState(initialPayload.filters.dateFrom);
  const [dateTo, setDateTo] = useState(initialPayload.filters.dateTo);
  const [branchId, setBranchId] = useState(initialPayload.filters.branchId);
  const [shiftId, setShiftId] = useState(initialPayload.filters.shiftId);
  const [cashierId, setCashierId] = useState(initialPayload.filters.cashierId);
  const [paymentMethod, setPaymentMethod] = useState(initialPayload.filters.paymentMethod);
  const [status, setStatus] = useState(initialPayload.filters.status);
  const [error, setError] = useState("");
  const [filterDialogOpen, setFilterDialogOpen] = useState(false);
  const [summaryDialogOpen, setSummaryDialogOpen] = useState(false);
  const [moreDialogOpen, setMoreDialogOpen] = useState(false);
  const [moreDialogTab, setMoreDialogTab] = useState<MoreDialogTab>("payments");
  const [salesRowsDialogOpen, setSalesRowsDialogOpen] = useState(false);
  const [shiftPage, setShiftPage] = useState(1);
  const [isPending, startTransition] = useTransition();

  const maxPaymentAmount = useMemo(() => Math.max(1, ...payload.paymentMethods.map((row) => row.amount)), [payload.paymentMethods]);
  const shiftTotalPages = Math.max(1, Math.ceil(payload.shifts.length / SHIFT_ROWS_PER_PAGE));
  const visibleShifts = useMemo(() => {
    const safePage = Math.min(Math.max(shiftPage, 1), shiftTotalPages);
    const start = (safePage - 1) * SHIFT_ROWS_PER_PAGE;
    return payload.shifts.slice(start, start + SHIFT_ROWS_PER_PAGE);
  }, [payload.shifts, shiftPage, shiftTotalPages]);
  const activeMoreExport = useMemo(() => buildMoreDialogExport(payload, moreDialogTab, lang), [lang, moreDialogTab, payload]);
  const kpis = [
    { label: "ยอดขายรวม", value: money(payload.summary.grossSales, lang), tone: "text-slate-900" },
    { label: "ยอดขายสุทธิ", value: money(payload.summary.netSales, lang), tone: "text-blue-700" },
    { label: "จำนวนบิล", value: number(payload.summary.receiptCount, lang), tone: "text-slate-900" },
    { label: "เงินสด", value: money(payload.summary.cashTotal, lang), tone: "text-green-700" },
    { label: "โอน / QR", value: money(payload.summary.qrTransferTotal, lang), tone: "text-blue-700" },
    { label: "บัตรเครดิต / เดบิต", value: money(payload.summary.cardTotal, lang), tone: "text-violet-700" },
    { label: "ส่วนลด", value: money(payload.summary.discountTotal, lang), tone: "text-amber-700" },
    {
      label: "ยกเลิก / คืนเงิน",
      value: `${money(payload.summary.cancelledTotal + payload.summary.refundTotal, lang)} (${payload.summary.cancelledCount})`,
      tone: "text-red-700"
    }
  ];

  function buildParams() {
    return new URLSearchParams({ dateFrom, dateTo, branchId, shiftId, cashierId, paymentMethod, status });
  }

  function refresh() {
    setError("");
    startTransition(async () => {
      try {
        const response = await fetch(`/api/pos/sales-summary?${buildParams().toString()}`, { cache: "no-store" });
        const body = (await response.json()) as ApiBody;
        if (!response.ok || !body.data) {
          setError("ไม่สามารถโหลดข้อมูลสรุปยอดขายได้ กรุณาลองใหม่อีกครั้ง");
          return;
        }
        setPayload(body.data);
        setBranchId(body.data.filters.branchId);
        setShiftId(body.data.filters.shiftId);
        setCashierId(body.data.filters.cashierId);
        setPaymentMethod(body.data.filters.paymentMethod);
        setStatus(body.data.filters.status);
      } catch {
        setError("ไม่สามารถโหลดข้อมูลสรุปยอดขายได้ กรุณาลองใหม่อีกครั้ง");
      }
    });
  }

  function exportCsv() {
    const rows: CsvCellValue[][] = [
      shiftSummaryCsvHeaders(lang),
      ...visibleShifts.map((shift) => [
        dateTime(shift.openedAt, lang),
        dateTime(shift.closedAt, lang),
        shift.branchName,
        shift.cashierName,
        money(shift.openingCash, lang),
        money(shift.cashSales, lang),
        money(shift.expectedCash, lang),
        shift.actualCash == null ? "-" : money(shift.actualCash, lang),
        shift.difference == null ? "-" : money(shift.difference, lang)
      ])
    ];
    downloadExcelCsv(`shift-summary-${payload.filters.dateFrom}-${payload.filters.dateTo}-page-${shiftPage}.csv`, rows);
  }

  function exportMoreDialogCsv() {
    downloadExcelCsv(`sales-summary-${activeMoreExport.slug}-${payload.filters.dateFrom}-${payload.filters.dateTo}.csv`, activeMoreExport.rows);
  }

  function exportSalesRowsDialogCsv() {
    const rows: CsvCellValue[][] = [
      lang === "th"
        ? ["เลขที่บิล", "วันเวลา", "สาขา", "พนักงาน", "ชำระเงิน", "ยอดรวม", "ส่วนลด", "ภาษี", "สุทธิ", "สถานะ"]
        : ["Receipt No.", "DateTime", "Branch", "Cashier", "Payment", "Gross", "Discount", "Tax", "Net", "Status"],
      ...payload.salesRows.map((row) => [
        row.receiptNo,
        dateTime(row.createdAt, lang),
        row.branchName,
        row.cashierName,
        paymentLabel(row.paymentLabel, row.paymentMethod, lang),
        money(row.grossTotal, lang),
        money(row.discount, lang),
        money(row.tax, lang),
        money(row.netTotal, lang),
        statusLabel(row.status, lang)
      ])
    ];
    downloadExcelCsv(`sales-summary-sales-rows-${payload.filters.dateFrom}-${payload.filters.dateTo}.csv`, rows);
  }

  useEffect(() => {
    setShiftPage(1);
  }, [payload]);

  useEffect(() => {
    if (shiftPage > shiftTotalPages) setShiftPage(shiftTotalPages);
  }, [shiftPage, shiftTotalPages]);

  return (
    <section className="min-h-[calc(100vh-48px)] bg-[#f6f7f9] p-4 lg:p-5">
      <div className="mx-auto grid max-w-[1480px] gap-4">
        <header className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-[260px]">
              <PosBackButton lang={lang} href="/preview/pos/more" label={lang === "th" ? "กลับเมนูเพิ่มเติม" : "Back to More"} className="mb-3" />
              <h1 className="text-2xl font-black text-slate-950 lg:text-3xl">สรุปยอดขาย</h1>
              <p className="mt-1 max-w-3xl text-sm text-slate-600">ดูภาพรวมยอดขายตามวัน กะ พนักงาน ช่องทางชำระเงิน และสาขา</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <ActionButton onClick={() => setSummaryDialogOpen(true)}>สรุปยอดขาย</ActionButton>
              <ActionButton onClick={() => setFilterDialogOpen(true)}>คัดกรอง</ActionButton>
              <ActionButton onClick={() => setMoreDialogOpen(true)}>ดูเพิ่มเติม</ActionButton>
              <ActionButton onClick={() => setSalesRowsDialogOpen(true)}>รายการขาย</ActionButton>
              <button type="button" onClick={refresh} disabled={isPending} className="h-10 rounded-lg border border-blue-200 bg-blue-600 px-4 text-sm font-bold text-white transition hover:bg-blue-700 disabled:cursor-wait disabled:opacity-70">
                {isPending ? "กำลังโหลด" : "รีเฟรช"}
              </button>
              <ActionButton onClick={exportCsv} disabled={visibleShifts.length === 0}>Export CSV</ActionButton>
            </div>
          </div>
        </header>

        {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div> : null}

        <Panel title="สรุปกะ">
          <ScrollTable minWidth="860px">
            <thead>
              <tr>
                <Th>เปิดกะ</Th>
                <Th>ปิดกะ</Th>
                <Th>สาขา</Th>
                <Th>พนักงาน</Th>
                <Th align="right">เงินต้น</Th>
                <Th align="right">เงินสด</Th>
                <Th align="right">คาดหวัง</Th>
                <Th align="right">เงินจริง</Th>
                <Th align="right">ต่าง</Th>
              </tr>
            </thead>
            <tbody>
              {payload.shifts.length === 0 ? (
                <EmptyRow colSpan={9} />
              ) : (
                visibleShifts.map((shift) => (
                  <tr key={shift.id} className="border-t border-slate-100">
                    <Td>{dateTime(shift.openedAt, lang)}</Td>
                    <Td>{dateTime(shift.closedAt, lang)}</Td>
                    <Td>{shift.branchName}</Td>
                    <Td>{shift.cashierName}</Td>
                    <Td align="right">{money(shift.openingCash, lang)}</Td>
                    <Td align="right">{money(shift.cashSales, lang)}</Td>
                    <Td align="right">{money(shift.expectedCash, lang)}</Td>
                    <Td align="right">{shift.actualCash == null ? "-" : money(shift.actualCash, lang)}</Td>
                    <Td align="right" tone={shift.difference == null ? "normal" : shift.difference === 0 ? "good" : "bad"}>{shift.difference == null ? "-" : money(shift.difference, lang)}</Td>
                  </tr>
                ))
              )}
            </tbody>
          </ScrollTable>
          <PaginationControls
            page={Math.min(shiftPage, shiftTotalPages)}
            totalPages={shiftTotalPages}
            totalRows={payload.shifts.length}
            onPrev={() => setShiftPage((page) => Math.max(1, page - 1))}
            onNext={() => setShiftPage((page) => Math.min(shiftTotalPages, page + 1))}
          />
        </Panel>

        <Dialog open={summaryDialogOpen} title="สรุปยอดขาย" onClose={() => setSummaryDialogOpen(false)} wide>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {kpis.map((item) => (
              <article key={item.label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-semibold text-slate-500">{item.label}</p>
                <p className={`mt-2 text-2xl font-black leading-tight ${item.tone}`}>{item.value}</p>
              </article>
            ))}
          </div>
        </Dialog>

        <Dialog open={filterDialogOpen} title="คัดกรองข้อมูล" onClose={() => setFilterDialogOpen(false)}>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <Field label="ตั้งแต่"><input value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} type="date" className={inputClass} /></Field>
            <Field label="ถึง"><input value={dateTo} onChange={(event) => setDateTo(event.target.value)} type="date" className={inputClass} /></Field>
            <Field label="สาขา">
              <select value={branchId} onChange={(event) => setBranchId(event.target.value)} disabled={!payload.access.canViewMultipleBranches} className={inputClass}>
                {payload.access.canViewMultipleBranches ? <option value="all">ทุกสาขา</option> : null}
                {payload.branchOptions.map((branch) => <option key={branch.id} value={branch.id}>{branch.name} ({branch.code})</option>)}
              </select>
            </Field>
            <Field label="กะ"><select value={shiftId} onChange={(event) => setShiftId(event.target.value)} className={inputClass}><option value="all">ทุกกะ</option>{payload.shiftOptions.map((shift) => <option key={shift.id} value={shift.id}>{shift.label}</option>)}</select></Field>
            <Field label="พนักงาน"><select value={cashierId} onChange={(event) => setCashierId(event.target.value)} className={inputClass}><option value="all">ทุกคน</option>{payload.cashierOptions.map((cashier) => <option key={cashier.id} value={cashier.id}>{cashier.label}</option>)}</select></Field>
            <Field label="ชำระเงิน"><select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)} className={inputClass}>{paymentOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field>
            <Field label="สถานะ"><select value={status} onChange={(event) => setStatus(event.target.value)} className={inputClass}>{statusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field>
          </div>
          {payload.access.selfOnly ? <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">สิทธิ์ปัจจุบันดูได้เฉพาะข้อมูลกะ/ผู้ใช้งานของตัวเอง</p> : null}
          <DialogActions>
            <ActionButton onClick={() => setFilterDialogOpen(false)}>ปิด</ActionButton>
            <button type="button" onClick={() => { refresh(); setFilterDialogOpen(false); }} disabled={isPending} className="h-10 rounded-lg border border-blue-200 bg-blue-600 px-4 text-sm font-bold text-white transition hover:bg-blue-700 disabled:cursor-wait disabled:opacity-70">{isPending ? "กำลังโหลด" : "ใช้ตัวกรอง"}</button>
          </DialogActions>
        </Dialog>

        <Dialog
          open={moreDialogOpen}
          title="ดูเพิ่มเติม"
          onClose={() => setMoreDialogOpen(false)}
          headerActions={<ActionButton onClick={exportMoreDialogCsv} disabled={activeMoreExport.rows.length <= 1}>Export CSV: {activeMoreExport.label}</ActionButton>}
          wide
        >
          <div className="grid gap-4">
            <div className="flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-2">
              {[{ id: "payments" as const, label: "ช่องทางชำระเงิน" }, { id: "products" as const, label: "สินค้าขายดี" }, { id: "cashiers" as const, label: "ประสิทธิภาพพนักงาน" }].map((tab) => (
                <button key={tab.id} type="button" onClick={() => setMoreDialogTab(tab.id)} className={`h-10 rounded-xl px-4 text-sm font-black transition ${moreDialogTab === tab.id ? "bg-blue-600 text-white shadow-sm" : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-blue-50"}`}>{tab.label}</button>
              ))}
            </div>
            {moreDialogTab === "payments" ? <PaymentsPanel payload={payload} lang={lang} maxPaymentAmount={maxPaymentAmount} /> : null}
            {moreDialogTab === "products" ? <ProductsPanel payload={payload} lang={lang} /> : null}
            {moreDialogTab === "cashiers" ? <CashiersPanel payload={payload} lang={lang} /> : null}
          </div>
        </Dialog>

        <Dialog
          open={salesRowsDialogOpen}
          title="รายการขาย"
          onClose={() => setSalesRowsDialogOpen(false)}
          headerActions={<ActionButton onClick={exportSalesRowsDialogCsv} disabled={payload.salesRows.length === 0}>Export CSV</ActionButton>}
          wide
        >
          <Panel title="รายการขาย">
            <ScrollTable minWidth="1040px">
              <thead><tr><Th>เลขที่บิล</Th><Th>วันเวลา</Th><Th>สาขา</Th><Th>พนักงาน</Th><Th>ชำระเงิน</Th><Th align="right">ยอดรวม</Th><Th align="right">ส่วนลด</Th><Th align="right">ภาษี</Th><Th align="right">สุทธิ</Th><Th>สถานะ</Th></tr></thead>
              <tbody>{payload.salesRows.length === 0 ? <EmptyRow colSpan={10} /> : payload.salesRows.map((row) => (
                <tr key={row.id} className="border-t border-slate-100">
                  <Td strong>{row.receiptNo}</Td><Td>{dateTime(row.createdAt, lang)}</Td><Td>{row.branchName}</Td><Td>{row.cashierName}</Td><Td>{paymentLabel(row.paymentLabel, row.paymentMethod, lang)}</Td><Td align="right">{money(row.grossTotal, lang)}</Td><Td align="right">{money(row.discount, lang)}</Td><Td align="right">{money(row.tax, lang)}</Td><Td align="right" strong>{money(row.netTotal, lang)}</Td><Td><StatusBadge status={row.status} lang={lang} /></Td>
                </tr>
              ))}</tbody>
            </ScrollTable>
          </Panel>
        </Dialog>
      </div>
    </section>
  );
}

function buildMoreDialogExport(payload: PosSalesSummaryPayload, tab: MoreDialogTab, lang: Language): { label: string; slug: string; rows: CsvCellValue[][] } {
  if (tab === "products") {
    return {
      label: lang === "th" ? "สินค้าขายดี" : "Best Products",
      slug: "best-products",
      rows: [
        lang === "th" ? ["ลำดับ", "สินค้า", "หมวดหมู่", "จำนวน", "ยอดรวม", "ยอดสุทธิ"] : ["No.", "Product", "Category", "Quantity", "Gross", "Net"],
        ...payload.bestSellingProducts.slice(0, 10).map((product, index) => [
          index + 1,
          product.productName,
          product.category,
          number(product.quantitySold, lang),
          money(product.grossAmount, lang),
          money(product.netAmount, lang)
        ])
      ]
    };
  }
  if (tab === "cashiers") {
    return {
      label: lang === "th" ? "ประสิทธิภาพพนักงาน" : "Cashier Performance",
      slug: "cashiers",
      rows: [
        lang === "th" ? ["พนักงาน", "บิล", "ยอดรวม", "ยอดสุทธิ", "ยกเลิก", "เฉลี่ย/บิล"] : ["Cashier", "Bills", "Gross", "Net", "Cancelled", "Average / Bill"],
        ...payload.cashiers.map((cashier) => [
          cashier.cashierName,
          number(cashier.receiptCount, lang),
          money(cashier.grossSales, lang),
          money(cashier.netSales, lang),
          cashier.cancelledCount,
          money(cashier.averageReceiptValue, lang)
        ])
      ]
    };
  }
  return {
    label: lang === "th" ? "ช่องทางชำระเงิน" : "Payment Methods",
    slug: "payments",
    rows: [
      lang === "th" ? ["ช่องทางชำระเงิน", "จำนวนบิล", "ยอดรวม"] : ["Payment Method", "Bills", "Amount"],
      ...payload.paymentMethods.map((method) => [paymentLabel(method.label, method.method, lang), method.receiptCount, money(method.amount, lang)])
    ]
  };
}

function PaymentsPanel({ payload, lang, maxPaymentAmount }: { payload: PosSalesSummaryPayload; lang: Language; maxPaymentAmount: number }) {
  return <Panel title="ช่องทางชำระเงิน">{payload.paymentMethods.length === 0 ? <EmptyState /> : <div className="grid gap-3">{payload.paymentMethods.map((method) => <div key={method.method}><div className="flex items-baseline justify-between gap-3"><span className="text-sm font-bold text-slate-800">{paymentLabel(method.label, method.method, lang)}</span><span className="text-sm font-black text-slate-950">{money(method.amount, lang)}</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-600" style={{ width: `${Math.max(5, (method.amount / maxPaymentAmount) * 100)}%` }} /></div><p className="mt-1 text-xs text-slate-500">{method.receiptCount} บิล</p></div>)}</div>}</Panel>;
}

function ProductsPanel({ payload, lang }: { payload: PosSalesSummaryPayload; lang: Language }) {
  return <Panel title="สินค้าขายดี"><ScrollTable minWidth="680px"><thead><tr><Th>สินค้า</Th><Th>หมวดหมู่</Th><Th align="right">จำนวน</Th><Th align="right">ยอดรวม</Th><Th align="right">ยอดสุทธิ</Th></tr></thead><tbody>{payload.bestSellingProducts.length === 0 ? <EmptyRow colSpan={5} /> : payload.bestSellingProducts.slice(0, 10).map((product, index) => <tr key={product.productId} className="border-t border-slate-100"><Td strong><span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-xs font-black text-slate-700">{index + 1}</span>{product.productName}</Td><Td>{product.category}</Td><Td align="right">{number(product.quantitySold, lang)}</Td><Td align="right">{money(product.grossAmount, lang)}</Td><Td align="right">{money(product.netAmount, lang)}</Td></tr>)}</tbody></ScrollTable></Panel>;
}

function CashiersPanel({ payload, lang }: { payload: PosSalesSummaryPayload; lang: Language }) {
  return <Panel title="ประสิทธิภาพพนักงาน"><ScrollTable minWidth="720px"><thead><tr><Th>พนักงาน</Th><Th align="right">บิล</Th><Th align="right">ยอดรวม</Th><Th align="right">ยอดสุทธิ</Th><Th align="right">ยกเลิก</Th><Th align="right">เฉลี่ย/บิล</Th></tr></thead><tbody>{payload.cashiers.length === 0 ? <EmptyRow colSpan={6} /> : payload.cashiers.map((cashier) => <tr key={cashier.cashierId} className="border-t border-slate-100"><Td strong>{cashier.cashierName}</Td><Td align="right">{number(cashier.receiptCount, lang)}</Td><Td align="right">{money(cashier.grossSales, lang)}</Td><Td align="right">{money(cashier.netSales, lang)}</Td><Td align="right">{cashier.cancelledCount}</Td><Td align="right">{money(cashier.averageReceiptValue, lang)}</Td></tr>)}</tbody></ScrollTable></Panel>;
}

function Dialog({
  open,
  title,
  onClose,
  children,
  headerActions,
  wide = false
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  headerActions?: ReactNode;
  wide?: boolean;
}) {
  if (!open) return null;
  return <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-4" role="presentation" onMouseDown={onClose}><section role="dialog" aria-modal="true" aria-label={title} className={`max-h-[86vh] w-full overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl ${wide ? "max-w-6xl" : "max-w-4xl"}`} onMouseDown={(event) => event.stopPropagation()}><header className="mb-4 flex items-center justify-between gap-3 border-b border-slate-100 pb-3"><h2 className="text-lg font-black text-slate-950">{title}</h2><div className="flex items-center gap-2">{headerActions}<button type="button" onClick={onClose} aria-label="ปิด" className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-sm font-bold text-slate-700 transition hover:bg-slate-50">ปิด</button></div></header>{children}</section></div>;
}

function ActionButton({ children, onClick, disabled = false }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return <button type="button" onClick={onClick} disabled={disabled} className="h-10 rounded-lg border border-slate-300 bg-white px-4 text-sm font-bold text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">{children}</button>;
}

function PaginationControls({
  page,
  totalPages,
  totalRows,
  onPrev,
  onNext
}: {
  page: number;
  totalPages: number;
  totalRows: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
      <span className="font-semibold text-slate-500">
        ทั้งหมด {totalRows} รายการ · หน้า {page}/{totalPages}
      </span>
      <div className="flex gap-2">
        <ActionButton onClick={onPrev} disabled={page <= 1}>ก่อนหน้า</ActionButton>
        <ActionButton onClick={onNext} disabled={page >= totalPages}>ถัดไป</ActionButton>
      </div>
    </div>
  );
}

function DialogActions({ children }: { children: ReactNode }) {
  return <div className="mt-5 flex flex-wrap justify-end gap-2">{children}</div>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="grid gap-1 text-xs font-bold text-slate-600">{label}{children}</label>;
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><h2 className="text-base font-black text-slate-950">{title}</h2><div className="mt-3">{children}</div></section>;
}

function ScrollTable({ minWidth, children }: { minWidth: string; children: ReactNode }) {
  return <div className="overflow-x-auto rounded-xl border border-slate-200"><table className="w-full border-collapse bg-white text-sm" style={{ minWidth }}>{children}</table></div>;
}

function Th({ children, align = "left" }: { children: ReactNode; align?: "left" | "right" }) {
  return <th className={`bg-slate-50 px-3 py-2 text-xs font-black text-slate-500 ${align === "right" ? "text-right" : "text-left"}`}>{children}</th>;
}

function Td({ children, align = "left", strong = false, tone = "normal" }: { children: ReactNode; align?: "left" | "right"; strong?: boolean; tone?: "normal" | "good" | "bad" }) {
  const toneClass = tone === "good" ? "text-green-700" : tone === "bad" ? "text-red-700" : "text-slate-700";
  return <td className={`px-3 py-2 ${align === "right" ? "text-right" : "text-left"} ${strong ? "font-bold text-slate-950" : toneClass}`}>{children}</td>;
}

function EmptyRow({ colSpan }: { colSpan: number }) {
  return <tr><td colSpan={colSpan} className="px-3 py-10 text-center text-sm font-semibold text-slate-500">ยังไม่มีข้อมูลยอดขายในช่วงเวลานี้</td></tr>;
}

function EmptyState() {
  return <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm font-semibold text-slate-500">ยังไม่มีข้อมูลยอดขายในช่วงเวลานี้</div>;
}

function StatusBadge({ status, lang }: { status: string; lang: Language }) {
  const label = statusLabel(status, lang);
  const tone = status === "completed" ? "border-green-200 bg-green-50 text-green-700" : status === "cancelled" ? "border-red-200 bg-red-50 text-red-700" : "border-amber-200 bg-amber-50 text-amber-700";
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-bold ${tone}`}>{label}</span>;
}

function statusLabel(status: string, lang: Language = "th") {
  if (lang !== "th") {
    return status === "completed"
      ? "Completed"
      : status === "cancelled"
        ? "Cancelled"
        : status === "draft"
          ? "Draft"
          : status === "queued"
            ? "Queued"
            : status === "preparing"
              ? "Preparing"
              : status;
  }
  return status === "completed"
    ? "สำเร็จ"
    : status === "cancelled"
      ? "ยกเลิก"
      : status === "draft"
        ? "ร่าง"
        : status === "queued"
          ? "รอทำ"
          : status === "preparing"
            ? "กำลังทำ"
            : status;
}
