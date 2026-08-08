"use client";

import type { ApprovalAction, BranchRole, PaymentMethod, PlatformRole } from "@pos/shared-types";
import { useEffect, useMemo, useState } from "react";
import { PosManagerApprovalModal } from "@/components/pos-ui/pos-manager-approval-modal";
import { downloadExcelCsv } from "@/lib/excel-csv";
import { t, type Language, type TranslationKey } from "@/lib/i18n";
import type { PosSalesBranchOption, PosSalesListRecord, PosSalesShiftOption } from "@/lib/services/pos-sales-list-service";

type SaleStatus = "open" | "paid" | "void";
type PaymentReceiptStatus = "unpaid" | PaymentMethod;
type SalesChannel = "counter" | "dine_in" | "delivery";
type EffectiveRole = BranchRole | "it_admin";

type Props = {
  lang: Language;
  initialRole: BranchRole | null;
  platformRole: PlatformRole;
  initialBranchId: string | null;
  initialRecords: PosSalesListRecord[];
  branchOptions: PosSalesBranchOption[];
  shiftOptions: PosSalesShiftOption[];
  refreshEndpoint?: string;
};

type PinAction = {
  type: "edit" | "delete";
  rowId: string;
  approvalAction: ApprovalAction;
};

type EditTarget = {
  row: PosSalesListRecord;
  approvalId: string | null;
};

type LocalText = {
  exportCsv: string;
  editTitle: string;
  save: string;
  saving: string;
  note: string;
  successEdit: string;
  successDelete: string;
  genericError: string;
  paidNeedsPayment: string;
  tableOnlyCsvNotice: string;
};

export function PosSalesListWorkspace({
  lang,
  initialRole,
  platformRole,
  initialBranchId,
  initialRecords,
  branchOptions,
  shiftOptions,
  refreshEndpoint = "/api/pos/sales-list"
}: Props) {
  const PAGE_SIZE = 20;
  const tt = (key: TranslationKey) => t(lang, key);

  const [records, setRecords] = useState<PosSalesListRecord[]>(initialRecords);
  const [liveBranchOptions, setLiveBranchOptions] = useState<PosSalesBranchOption[]>(branchOptions);
  const [liveShiftOptions, setLiveShiftOptions] = useState<PosSalesShiftOption[]>(shiftOptions);
  const [selectedBranchId, setSelectedBranchId] = useState<string>("all");
  const [filterPopupOpen, setFilterPopupOpen] = useState(false);
  const [totalsVisible, setTotalsVisible] = useState(false);
  const [selectedDetailRow, setSelectedDetailRow] = useState<PosSalesListRecord | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | SaleStatus>("all");
  const [paymentFilter, setPaymentFilter] = useState<"all" | PaymentReceiptStatus>("all");
  const [channelFilter, setChannelFilter] = useState<"all" | SalesChannel>("all");
  const [shiftFilter, setShiftFilter] = useState<"all" | string>("all");
  const [dateFilter, setDateFilter] = useState("");
  const [timeFromFilter, setTimeFromFilter] = useState("");
  const [timeToFilter, setTimeToFilter] = useState("");
  const [pinAction, setPinAction] = useState<PinAction | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [quickRange, setQuickRange] = useState<"none" | "day" | "month" | "year">("day");
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [editSaleStatus, setEditSaleStatus] = useState<SaleStatus>("open");
  const [editPaymentStatus, setEditPaymentStatus] = useState<PaymentReceiptStatus>("unpaid");
  const [editNotes, setEditNotes] = useState("");
  const [mutationBusy, setMutationBusy] = useState(false);
  const [mutationError, setMutationError] = useState("");
  const [notice, setNotice] = useState("");

  const fallbackBranchId = liveBranchOptions[0]?.id ?? "";
  const normalizedBranchId =
    initialBranchId && liveBranchOptions.some((branch) => branch.id === initialBranchId) ? initialBranchId : fallbackBranchId;
  const effectiveRole: EffectiveRole = platformRole === "it_admin" ? "it_admin" : (initialRole ?? "staff");
  const canManage = effectiveRole === "owner" || effectiveRole === "manager" || effectiveRole === "it_admin";
  const requiresPin = effectiveRole === "owner" || effectiveRole === "manager";
  const canViewAllBranches = effectiveRole === "owner" || effectiveRole === "manager" || effectiveRole === "it_admin";
  const effectiveBranchId = canViewAllBranches ? selectedBranchId : normalizedBranchId;
  const branchMap = useMemo(() => new Map(liveBranchOptions.map((branch) => [branch.id, branch])), [liveBranchOptions]);
  const pauseLiveRefresh = Boolean(selectedDetailRow || pinAction || editTarget || filterPopupOpen);
  const localText = useMemo<LocalText>(
    () =>
      lang === "th"
        ? {
            exportCsv: "Export CSV",
            editTitle: "แก้ไขรายการขาย",
            save: "บันทึก",
            saving: "กำลังบันทึก...",
            note: "หมายเหตุ",
            successEdit: "บันทึกการแก้ไขรายการขายแล้ว",
            successDelete: "ลบรายการขายออกจากตารางแล้ว",
            genericError: "ทำรายการไม่สำเร็จ กรุณาลองใหม่",
            paidNeedsPayment: "บิลที่ปิดแล้วต้องเลือกวิธีชำระเงิน",
            tableOnlyCsvNotice: "บันทึก CSV เฉพาะตารางหน้านี้แล้ว"
          }
        : {
            exportCsv: "Export CSV",
            editTitle: "Edit Sales Record",
            save: "Save",
            saving: "Saving...",
            note: "Note",
            successEdit: "Sales record updated.",
            successDelete: "Sales record removed from the table.",
            genericError: "Action failed. Please try again.",
            paidNeedsPayment: "Paid bills require a payment method.",
            tableOnlyCsvNotice: "CSV saved for the visible table page only."
          },
    [lang]
  );

  useEffect(() => {
    setRecords(initialRecords);
  }, [initialRecords]);

  useEffect(() => {
    setLiveBranchOptions(branchOptions);
  }, [branchOptions]);

  useEffect(() => {
    setLiveShiftOptions(shiftOptions);
  }, [shiftOptions]);

  useEffect(() => {
    if (!selectedDetailRow) return;
    const latestRow = records.find((row) => row.id === selectedDetailRow.id) ?? null;
    setSelectedDetailRow(latestRow);
  }, [records, selectedDetailRow?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let mounted = true;
    let inFlight = false;
    const timer = setInterval(async () => {
      if (inFlight || document.hidden || pauseLiveRefresh) return;
      inFlight = true;
      try {
        const response = await fetch(refreshEndpoint, { cache: "no-store" });
        const body = (await response.json()) as {
          data?: {
            records?: PosSalesListRecord[];
            branchOptions?: PosSalesBranchOption[];
            shiftOptions?: PosSalesShiftOption[];
          } | null;
        };
        if (!mounted || !response.ok || !body?.data) return;
        const nextRecords = body.data.records ?? [];
        const nextBranches = body.data.branchOptions ?? [];
        const nextShifts = body.data.shiftOptions ?? [];

        setRecords((prev) => (nextRecords.length === 0 && prev.length > 0 ? prev : nextRecords));
        setLiveBranchOptions((prev) => (nextBranches.length === 0 && prev.length > 0 ? prev : nextBranches));
        setLiveShiftOptions((prev) => (nextShifts.length === 0 && prev.length > 0 ? prev : nextShifts));
      } catch {
      } finally {
        inFlight = false;
      }
    }, 5000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [pauseLiveRefresh, refreshEndpoint]);

  const statusLabel: Record<SaleStatus, string> = {
    open: tt("sales_list_status_open"),
    paid: tt("sales_list_status_paid"),
    void: tt("sales_list_status_void")
  };
  const paymentLabel: Record<PaymentReceiptStatus, string> = {
    unpaid: tt("sales_list_payment_unpaid"),
    cash: tt("sales_list_payment_cash"),
    bank_transfer: tt("sales_list_payment_transfer")
  };
  const channelLabel: Record<SalesChannel, string> = {
    counter: tt("sales_list_channel_counter"),
    dine_in: tt("sales_list_channel_dine_in"),
    delivery: tt("sales_list_channel_delivery")
  };
  const orderTypeLabel: Record<PosSalesListRecord["orderType"], string> = {
    dine_in: tt("sales_list_mode_dine_in"),
    takeaway: tt("sales_list_mode_takeaway"),
    delivery_manual: tt("sales_list_mode_delivery")
  };

  const filteredRows = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const today = getBangkokTodayDate();
    const thisMonth = today.slice(0, 7);
    const thisYear = today.slice(0, 4);
    return records.filter((row) => {
      const matchesBranch = effectiveBranchId === "all" || row.branchId === effectiveBranchId;
      const matchesQuery =
        normalized.length === 0 ||
        row.billNo.toLowerCase().includes(normalized) ||
        row.tableLabel.toLowerCase().includes(normalized) ||
        row.customerName.toLowerCase().includes(normalized) ||
        row.cashier.toLowerCase().includes(normalized);
      const matchesStatus = statusFilter === "all" || row.saleStatus === statusFilter;
      const matchesPayment = paymentFilter === "all" || row.paymentStatus === paymentFilter;
      const matchesChannel = channelFilter === "all" || row.channel === channelFilter;
      const matchesShift = shiftFilter === "all" || row.shiftId === shiftFilter;
      const rowDate = toBangkokDate(row.openedAt);
      const rowTime = toBangkokTime(row.openedAt);
      const matchesDate = !dateFilter || rowDate === dateFilter;
      const matchesQuickRange =
        quickRange === "none"
          ? true
          : quickRange === "day"
            ? rowDate === today
            : quickRange === "month"
              ? rowDate.startsWith(thisMonth)
              : rowDate.startsWith(thisYear);
      const matchesTimeFrom = !timeFromFilter || rowTime >= timeFromFilter;
      const matchesTimeTo = !timeToFilter || rowTime <= timeToFilter;
      return (
        matchesBranch &&
        matchesQuery &&
        matchesStatus &&
        matchesPayment &&
        matchesChannel &&
        matchesShift &&
        matchesDate &&
        matchesQuickRange &&
        matchesTimeFrom &&
        matchesTimeTo
      );
    });
  }, [channelFilter, dateFilter, effectiveBranchId, paymentFilter, query, quickRange, records, shiftFilter, statusFilter, timeFromFilter, timeToFilter]);

  const sortedFilteredRows = useMemo(
    () =>
      [...filteredRows].sort((a, b) => {
        return new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime();
      }),
    [filteredRows]
  );

  const totalPages = Math.max(1, Math.ceil(sortedFilteredRows.length / PAGE_SIZE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const pagedRows = useMemo(() => {
    const start = (safeCurrentPage - 1) * PAGE_SIZE;
    return sortedFilteredRows.slice(start, start + PAGE_SIZE);
  }, [safeCurrentPage, sortedFilteredRows]);

  const pageStartIndex = sortedFilteredRows.length === 0 ? 0 : (safeCurrentPage - 1) * PAGE_SIZE + 1;
  const pageEndIndex = sortedFilteredRows.length === 0 ? 0 : Math.min(safeCurrentPage * PAGE_SIZE, sortedFilteredRows.length);

  const metrics = useMemo(() => {
    const totalBills = filteredRows.length;
    const paidBills = filteredRows.filter((row) => row.paymentStatus !== "unpaid").length;
    const openBills = filteredRows.filter((row) => row.saleStatus === "open").length;
    const totalAmount = filteredRows.reduce((sum, row) => sum + row.total, 0);
    return { totalBills, paidBills, openBills, totalAmount };
  }, [filteredRows]);

  useEffect(() => {
    setCurrentPage(1);
  }, [query, statusFilter, paymentFilter, channelFilter, shiftFilter, dateFilter, timeFromFilter, timeToFilter, selectedBranchId, quickRange]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 2200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const dateTimeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(lang === "th" ? "th-TH" : "en-US", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "Asia/Bangkok"
      }),
    [lang]
  );
  const amountFormatter = useMemo(
    () => new Intl.NumberFormat(lang === "th" ? "th-TH" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    [lang]
  );

  function openEditDialog(row: PosSalesListRecord, approvalId: string | null) {
    setMutationError("");
    setEditTarget({ row, approvalId });
    setEditSaleStatus(row.saleStatus);
    setEditPaymentStatus(row.paymentStatus);
    setEditNotes(row.notes ?? "");
  }

  function patchLocalRecord(rowId: string, changes: Partial<PosSalesListRecord>) {
    setRecords((prev) => prev.map((row) => (row.id === rowId ? { ...row, ...changes } : row)));
    setSelectedDetailRow((prev) => (prev?.id === rowId ? { ...prev, ...changes } : prev));
  }

  async function readApiError(response: Response) {
    const body = (await response.json().catch(() => null)) as { error?: { message?: string }; message?: string } | null;
    return body?.error?.message ?? body?.message ?? localText.genericError;
  }

  async function saveEditRecord() {
    if (!editTarget || mutationBusy) return;
    if (editSaleStatus === "paid" && editPaymentStatus === "unpaid") {
      setMutationError(localText.paidNeedsPayment);
      return;
    }

    setMutationBusy(true);
    setMutationError("");
    try {
      const response = await fetch(refreshEndpoint, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          order_id: editTarget.row.id,
          approval_id: editTarget.approvalId,
          sale_status: editSaleStatus,
          payment_status: editSaleStatus === "paid" ? editPaymentStatus : "unpaid",
          notes: editNotes
        })
      });
      if (!response.ok) throw new Error(await readApiError(response));
      patchLocalRecord(editTarget.row.id, {
        saleStatus: editSaleStatus,
        paymentStatus: editSaleStatus === "paid" ? editPaymentStatus : "unpaid",
        notes: editNotes || null,
        cashReceived: editSaleStatus === "paid" && editPaymentStatus === "cash" ? editTarget.row.total : null,
        changeAmount: editSaleStatus === "paid" && editPaymentStatus === "cash" ? 0 : null,
        paymentReceivedTotal: editSaleStatus === "paid" ? editTarget.row.total : 0
      });
      setEditTarget(null);
      setNotice(localText.successEdit);
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : localText.genericError);
    } finally {
      setMutationBusy(false);
    }
  }

  async function deleteSalesRecord(rowId: string, approvalId: string | null) {
    if (mutationBusy) return;
    setMutationBusy(true);
    setMutationError("");
    try {
      const response = await fetch(refreshEndpoint, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ order_id: rowId, approval_id: approvalId })
      });
      if (!response.ok) throw new Error(await readApiError(response));
      setRecords((prev) => prev.filter((row) => row.id !== rowId));
      setSelectedDetailRow((prev) => (prev?.id === rowId ? null : prev));
      setNotice(localText.successDelete);
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : localText.genericError);
    } finally {
      setMutationBusy(false);
    }
  }

  function exportVisibleTableCsv() {
    const headers =
      lang === "th"
        ? ["เลขบิล", "เวลาเปิดบิล", "โต๊ะ/ช่องทาง", "จำนวนรายการ", "สาขา", "ยอดรวม", "ชำระเงิน", "สถานะบิล", "ผู้ทำรายการ"]
        : ["Bill No.", "Opened At", "Table / Channel", "Items", "Branch", "Total", "Payment", "Bill Status", "Cashier"];
    const rows = pagedRows.map((row) => {
      const branch = branchMap.get(row.branchId);
      return [
        row.billNo,
        dateTimeFormatter.format(new Date(row.openedAt)),
        `${row.tableLabel} / ${channelLabel[row.channel]}`,
        row.items,
        `${branch?.name ?? "-"} (${branch?.code ?? "-"})`,
        amountFormatter.format(row.total),
        paymentLabel[row.paymentStatus],
        statusLabel[row.saleStatus],
        row.cashier || "-"
      ];
    });
    downloadExcelCsv(`sales-list-page-${safeCurrentPage}-${getBangkokTodayDate()}.csv`, [headers, ...rows]);
    setNotice(localText.tableOnlyCsvNotice);
  }

  function runAuthorizedAction(action: PinAction, approvalId: string | null) {
    const row = records.find((record) => record.id === action.rowId);
    if (!row) return;
    if (action.type === "edit") {
      openEditDialog(row, approvalId);
      return;
    }
    void deleteSalesRecord(row.id, approvalId);
  }

  function requestAction(action: PinAction) {
    if (!canManage) return;
    if (requiresPin) {
      setPinAction(action);
      return;
    }
    runAuthorizedAction(action, null);
  }

  function clearFilters() {
    setQuickRange("day");
    setQuery("");
    setStatusFilter("all");
    setPaymentFilter("all");
    setChannelFilter("all");
    setShiftFilter("all");
    setDateFilter("");
    setTimeFromFilter("");
    setTimeToFilter("");
  }

  return (
    <section className="w-full rounded-2xl border border-slate-300 bg-white p-4 pb-8 lg:p-5 lg:pb-10">
      <div className="rounded-2xl border border-slate-200 bg-[linear-gradient(130deg,#f8fbff_0%,#f2f7ff_34%,#fff7ed_100%)] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-2xl font-extrabold text-slate-900">{tt("sales_list_title")}</h2>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <button
              type="button"
              onClick={() => setTotalsVisible((prev) => !prev)}
              aria-expanded={totalsVisible}
              className={`h-10 rounded-lg border px-4 text-sm font-semibold transition ${
                totalsVisible ? "border-blue-600 bg-blue-600 text-white shadow-sm" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              {totalsVisible ? tt("sales_list_hide_totals") : tt("sales_list_view_totals")}
            </button>
            <button
              type="button"
              onClick={() => {
                setQuickRange("day");
              }}
              className={`h-10 rounded-lg border px-4 text-sm font-semibold transition ${
                quickRange === "day" ? "border-orange-500 bg-orange-500 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              {tt("sales_list_daily")}
            </button>
            <button
              type="button"
              onClick={() => {
                setQuickRange("month");
              }}
              className={`h-10 rounded-lg border px-4 text-sm font-semibold transition ${
                quickRange === "month" ? "border-orange-500 bg-orange-500 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              {tt("sales_list_monthly")}
            </button>
            <button
              type="button"
              onClick={() => {
                setQuickRange("year");
              }}
              className={`h-10 rounded-lg border px-4 text-sm font-semibold transition ${
                quickRange === "year" ? "border-orange-500 bg-orange-500 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              {tt("sales_list_yearly")}
            </button>
            <button type="button" onClick={() => setFilterPopupOpen(true)} className="h-10 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">
              {tt("sales_list_filter")}
            </button>
            <button
              type="button"
              onClick={exportVisibleTableCsv}
              disabled={pagedRows.length === 0}
              className="h-10 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-900 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {localText.exportCsv}
            </button>
            <select
              value={canViewAllBranches ? selectedBranchId : normalizedBranchId}
              onChange={(event) => setSelectedBranchId(event.target.value)}
              disabled={!canViewAllBranches}
              className="h-10 min-w-[180px] rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-blue-400 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
            >
              <option value="all">{tt("sales_list_all_branches")}</option>
              {liveBranchOptions.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name} ({branch.code || branch.id})
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {totalsVisible ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard label={tt("sales_list_total_bills")} value={String(metrics.totalBills)} />
          <MetricCard label={tt("sales_list_paid_bills")} value={String(metrics.paidBills)} />
          <MetricCard label={tt("sales_list_open_bills")} value={String(metrics.openBills)} />
          <MetricCard label={tt("sales_list_total_amount")} value={amountFormatter.format(metrics.totalAmount)} />
        </div>
      ) : null}

      {notice || mutationError ? (
        <div
          className={`mt-3 rounded-xl border px-3 py-2 text-sm font-semibold ${
            mutationError ? "border-red-200 bg-red-50 text-red-700" : "border-green-200 bg-green-50 text-green-700"
          }`}
        >
          {mutationError || notice}
        </div>
      ) : null}

      <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
        <div className="max-h-[460px] overflow-auto lg:max-h-[500px]">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="sticky top-0 z-10 bg-slate-100 text-left">
              <tr className="text-xs uppercase tracking-wide text-slate-600">
                <th className="px-3 py-2">{tt("sales_list_bill_no")}</th>
                <th className="px-3 py-2">{tt("sales_list_opened_at")}</th>
                <th className="px-3 py-2">{tt("sales_list_table_channel")}</th>
                <th className="px-3 py-2">{tt("sales_list_items")}</th>
                <th className="px-3 py-2">{tt("sales_list_branch")}</th>
                <th className="px-3 py-2 text-right">{tt("sales_list_total")}</th>
                <th className="px-3 py-2">{tt("sales_list_payment")}</th>
                <th className="px-3 py-2">{tt("sales_list_status")}</th>
                <th className="px-3 py-2">{tt("sales_list_cashier")}</th>
                <th className="px-3 py-2 text-right">{tt("sales_list_actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white text-sm">
              {sortedFilteredRows.length === 0 ? (
                <tr><td colSpan={10} className="px-3 py-10 text-center text-slate-500">{tt("sales_list_no_records")}</td></tr>
              ) : (
                pagedRows.map((row) => {
                  const branch = branchMap.get(row.branchId);
                  return (
                    <tr key={row.id} role="button" tabIndex={0} onClick={() => setSelectedDetailRow(row)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedDetailRow(row);} }} className="cursor-pointer transition hover:bg-slate-50">
                      <td className="px-3 py-2 font-semibold text-slate-900">{row.billNo}</td>
                      <td className="px-3 py-2 text-slate-700">{dateTimeFormatter.format(new Date(row.openedAt))}</td>
                      <td className="px-3 py-2 text-slate-700"><p>{row.tableLabel}</p><p className="text-xs text-slate-500">{channelLabel[row.channel]}</p></td>
                      <td className="px-3 py-2 text-slate-700">{row.items}</td>
                      <td className="px-3 py-2 text-slate-700">{branch?.name ?? "-"}<p className="text-xs text-slate-500">{branch?.code ?? "-"}</p></td>
                      <td className="px-3 py-2 text-right font-semibold text-slate-900">{amountFormatter.format(row.total)}</td>
                      <td className="px-3 py-2"><Badge tone={row.paymentStatus === "unpaid" ? "slate" : "green"}>{paymentLabel[row.paymentStatus]}</Badge></td>
                      <td className="px-3 py-2"><Badge tone={row.saleStatus === "paid" ? "blue" : row.saleStatus === "void" ? "red" : "orange"}>{statusLabel[row.saleStatus]}</Badge></td>
                      <td className="px-3 py-2 text-slate-700">{row.cashier}</td>
                      <td className="px-3 py-2">
                        <div className="flex justify-end gap-1">
                          <button type="button" disabled={!canManage} onClick={(event) => { event.stopPropagation(); requestAction({ type: "edit", rowId: row.id, approvalAction: "sales_record_edit" }); }} className="h-8 rounded-md border border-blue-200 bg-blue-50 px-2 text-xs font-semibold text-blue-700 disabled:cursor-not-allowed disabled:opacity-45">{tt("sales_list_edit")}</button>
                          <button type="button" disabled={!canManage} onClick={(event) => { event.stopPropagation(); requestAction({ type: "delete", rowId: row.id, approvalAction: "sales_record_delete" }); }} className="h-8 rounded-md border border-red-200 bg-red-50 px-2 text-xs font-semibold text-red-700 disabled:cursor-not-allowed disabled:opacity-45">{tt("sales_list_delete")}</button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {sortedFilteredRows.length > 0 ? (
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-white px-3 py-3">
            <p className="text-xs text-slate-500">
              {tt("sales_list_pagination_showing").replace("{start}", String(pageStartIndex)).replace("{end}", String(pageEndIndex)).replace("{total}", String(sortedFilteredRows.length))}
            </p>
            {totalPages > 1 ? (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                  disabled={safeCurrentPage === 1}
                  className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {tt("sales_list_pagination_prev")}
                </button>
                {getVisiblePageNumbers(safeCurrentPage, totalPages).map((page) => (
                  <button
                    key={page}
                    type="button"
                    onClick={() => setCurrentPage(page)}
                    className={`h-8 min-w-8 rounded-md border px-2 text-xs font-semibold ${
                      page === safeCurrentPage
                        ? "border-orange-500 bg-orange-500 text-white"
                        : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    {page}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                  disabled={safeCurrentPage === totalPages}
                  className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {tt("sales_list_pagination_next")}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {selectedDetailRow ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
          <div className="w-full max-w-3xl rounded-2xl border border-slate-200 bg-white p-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-extrabold text-slate-900">{tt("sales_list_detail_title")} {selectedDetailRow.billNo}</h3>
              <button type="button" onClick={() => setSelectedDetailRow(null)} className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700">{tt("sales_list_close")}</button>
            </div>
            <div className="mt-4 grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 md:grid-cols-2 xl:grid-cols-3">
              <DetailField label={tt("sales_list_bill_no")} value={selectedDetailRow.billNo} />
              <DetailField label={tt("sales_list_opened_at")} value={dateTimeFormatter.format(new Date(selectedDetailRow.openedAt))} />
              <DetailField label={tt("sales_list_order_mode")} value={orderTypeLabel[selectedDetailRow.orderType]} />
              <DetailField label={tt("sales_list_table_channel")} value={selectedDetailRow.tableLabel} />
              <DetailField label={tt("sales_list_customer")} value={selectedDetailRow.customerName || "-"} />
              <DetailField label={tt("sales_list_external_order")} value={selectedDetailRow.externalOrderCode || "-"} />
              <DetailField label={tt("sales_list_subtotal_before_discount")} value={amountFormatter.format(selectedDetailRow.total + selectedDetailRow.discountAmount)} />
              <DetailField label={tt("sales_list_discount")} value={amountFormatter.format(selectedDetailRow.discountAmount)} />
              <DetailField label={tt("sales_list_net_total")} value={amountFormatter.format(selectedDetailRow.total)} />
              <DetailField label={tt("sales_list_cash_received")} value={selectedDetailRow.cashReceived == null ? "-" : amountFormatter.format(selectedDetailRow.cashReceived)} />
              <DetailField label={tt("sales_list_change_amount")} value={selectedDetailRow.changeAmount == null ? "-" : amountFormatter.format(selectedDetailRow.changeAmount)} />
              <DetailField label={tt("sales_list_paid_total")} value={amountFormatter.format(selectedDetailRow.paymentReceivedTotal)} />
              <DetailField label={tt("sales_list_payment")} value={paymentLabel[selectedDetailRow.paymentStatus]} />
              <DetailField label={tt("sales_list_status")} value={statusLabel[selectedDetailRow.saleStatus]} />
              <DetailField label={tt("sales_list_items")} value={String(selectedDetailRow.items)} />
              <DetailField label={tt("sales_list_cashier")} value={selectedDetailRow.cashier || "-"} />
              <DetailField label={tt("sales_list_note")} value={selectedDetailRow.notes || "-"} />
            </div>
          </div>
        </div>
      ) : null}

      {pinAction ? (
        <PosManagerApprovalModal
          open
          title={tt("sales_list_pin_title")}
          action={pinAction.approvalAction}
          targetTable="orders"
          targetId={pinAction.rowId}
          lang={lang}
          labels={{
            pinLabel: tt("sales_list_pin"),
            pinKeypadHint: tt("sales_list_pin_keypad_hint"),
            pinLengthError: tt("sales_list_pin_length_error"),
            pinRejected: tt("sales_list_pin_invalid"),
            checkingAccess: tt("sales_list_pin_checking_access"),
            clear: tt("sales_list_pin_clear"),
            remove: tt("sales_list_pin_remove"),
            closeAriaLabel: tt("sales_list_pin_close_aria")
          }}
          onClose={() => setPinAction(null)}
          onApproved={(approvalId) => {
            const action = pinAction;
            setPinAction(null);
            runAuthorizedAction(action, approvalId);
          }}
        />
      ) : null}

      {editTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
          <div className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-4 shadow-xl">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-extrabold text-slate-900">{localText.editTitle}</h3>
                <p className="mt-1 text-sm font-semibold text-slate-600">{editTarget.row.billNo}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!mutationBusy) setEditTarget(null);
                }}
                className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700"
              >
                {tt("sales_list_close")}
              </button>
            </div>
            <div className="mt-4 grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <SelectField
                label={tt("sales_list_bill_status")}
                value={editSaleStatus}
                onChange={(value) => {
                  const nextStatus = value as SaleStatus;
                  setEditSaleStatus(nextStatus);
                  if (nextStatus !== "paid") {
                    setEditPaymentStatus("unpaid");
                    return;
                  }
                  if (editPaymentStatus === "unpaid") setEditPaymentStatus("cash");
                }}
                options={[
                  { value: "open", label: statusLabel.open },
                  { value: "paid", label: statusLabel.paid },
                  { value: "void", label: statusLabel.void }
                ]}
                disabled={mutationBusy}
              />
              <SelectField
                label={tt("sales_list_payment_method")}
                value={editPaymentStatus}
                onChange={(value) => setEditPaymentStatus(value as PaymentReceiptStatus)}
                options={[
                  { value: "unpaid", label: paymentLabel.unpaid },
                  { value: "cash", label: paymentLabel.cash },
                  { value: "bank_transfer", label: paymentLabel.bank_transfer }
                ]}
                disabled={mutationBusy || editSaleStatus !== "paid"}
              />
              <label className="grid gap-1 text-xs font-semibold text-slate-600">
                {localText.note}
                <textarea
                  value={editNotes}
                  onChange={(event) => setEditNotes(event.target.value)}
                  disabled={mutationBusy}
                  rows={3}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-blue-400 disabled:cursor-not-allowed disabled:bg-slate-100"
                />
              </label>
            </div>
            {mutationError ? <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{mutationError}</p> : null}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditTarget(null)}
                disabled={mutationBusy}
                className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {tt("sales_list_cancel")}
              </button>
              <button
                type="button"
                onClick={saveEditRecord}
                disabled={mutationBusy || (editSaleStatus === "paid" && editPaymentStatus === "unpaid")}
                className="h-9 rounded-lg bg-blue-600 px-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {mutationBusy ? localText.saving : localText.save}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {filterPopupOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/45 p-4">
          <div className="w-full max-w-6xl rounded-2xl border border-slate-200 bg-white p-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-extrabold text-slate-900">{tt("sales_list_filters_title")}</h3>
              <button type="button" onClick={() => setFilterPopupOpen(false)} className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700">{tt("sales_list_close")}</button>
            </div>
            <div className="mt-4 grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 md:grid-cols-2 xl:grid-cols-4">
              <label className="grid gap-1 text-xs font-semibold text-slate-600">
                {tt("sales_list_search")}
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tt("sales_list_search_placeholder")} className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-blue-400" />
              </label>
              <SelectField label={tt("sales_list_bill_status")} value={statusFilter} onChange={(value) => setStatusFilter(value as "all" | SaleStatus)} options={[{ value: "all", label: tt("sales_list_all") }, { value: "open", label: statusLabel.open }, { value: "paid", label: statusLabel.paid }, { value: "void", label: statusLabel.void }]} />
              <SelectField label={tt("sales_list_payment_method")} value={paymentFilter} onChange={(value) => setPaymentFilter(value as "all" | PaymentReceiptStatus)} options={[{ value: "all", label: tt("sales_list_all") }, { value: "unpaid", label: paymentLabel.unpaid }, { value: "cash", label: paymentLabel.cash }, { value: "bank_transfer", label: paymentLabel.bank_transfer }]} />
              <SelectField label={tt("sales_list_channel")} value={channelFilter} onChange={(value) => setChannelFilter(value as "all" | SalesChannel)} options={[{ value: "all", label: tt("sales_list_all") }, { value: "counter", label: channelLabel.counter }, { value: "dine_in", label: channelLabel.dine_in }, { value: "delivery", label: channelLabel.delivery }]} />
              <SelectField
                label={tt("sales_list_shift")}
                value={shiftFilter}
                onChange={(value) => setShiftFilter(value as "all" | string)}
                options={[{ value: "all", label: tt("sales_list_all_shifts") }, ...liveShiftOptions.map((shift) => ({ value: shift.id, label: `${shift.id.slice(0, 8)} | ${shift.openedAt ? dateTimeFormatter.format(new Date(shift.openedAt)) : "-"}` }))]}
              />
              <label className="grid min-w-[200px] gap-1 text-xs font-semibold text-slate-600">
                {tt("sales_list_date")}
                <input type="date" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} className="h-10 rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none transition focus:border-blue-400" />
              </label>
              <label className="grid min-w-[200px] gap-1 text-xs font-semibold text-slate-600">
                {tt("sales_list_time_from")}
                <input type="time" value={timeFromFilter} onChange={(event) => setTimeFromFilter(event.target.value)} className="h-10 rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none transition focus:border-blue-400" />
              </label>
              <label className="grid min-w-[200px] gap-1 text-xs font-semibold text-slate-600">
                {tt("sales_list_time_to")}
                <input type="time" value={timeToFilter} onChange={(event) => setTimeToFilter(event.target.value)} className="h-10 rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none transition focus:border-blue-400" />
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={clearFilters} className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700">{tt("sales_list_reset")}</button>
              <button type="button" onClick={() => setFilterPopupOpen(false)} className="h-9 rounded-lg bg-orange-500 px-3 text-sm font-semibold text-white">{tt("sales_list_apply")}</button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function getBangkokTodayDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function getVisiblePageNumbers(currentPage: number, totalPages: number) {
  const maxButtons = 7;
  if (totalPages <= maxButtons) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const half = Math.floor(maxButtons / 2);
  let start = Math.max(1, currentPage - half);
  let end = Math.min(totalPages, start + maxButtons - 1);

  if (end - start + 1 < maxButtons) {
    start = Math.max(1, end - maxButtons + 1);
  }

  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function toBangkokDate(iso: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

function toBangkokTime(iso: string) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Bangkok", hour12: false, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-extrabold leading-none text-slate-900">{value}</p>
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
  disabled = false
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean;
}) {
  return (
    <label className="grid min-w-[200px] gap-1 text-xs font-semibold text-slate-600">
      {label}
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none transition focus:border-blue-400 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Badge({ tone, children }: { tone: "green" | "blue" | "orange" | "red" | "amber" | "slate"; children: string }) {
  const toneClass: Record<string, string> = {
    green: "border-green-200 bg-green-50 text-green-700",
    blue: "border-blue-200 bg-blue-50 text-blue-700",
    orange: "border-orange-200 bg-orange-50 text-orange-700",
    red: "border-red-200 bg-red-50 text-red-700",
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    slate: "border-slate-200 bg-slate-100 text-slate-600"
  };
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${toneClass[tone]}`}>{children}</span>;
}
