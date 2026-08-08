"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  resolveShiftCycle,
  resolveShiftGuardPhase,
  slotLabel,
  slotWindowLabel,
  type ShiftGuardPhase
} from "@/lib/pos-shift-schedule";

type Lang = "th" | "en";

type SessionResponse = {
  data?: {
    shift: {
      id: string;
      status: string;
      opened_at: string;
      closed_at: string | null;
      metrics?: {
        order_count: number;
        cancelled_order_count: number;
        sales_total: number;
        cash_total: number;
        transfer_total: number;
      } | null;
    } | null;
    has_active_shift: boolean;
    role?: string | null;
  } | null;
  error?: { code?: string; message?: string } | null;
};

type ApiBody = {
  data?: unknown;
  error?: { code?: string; message?: string } | null;
} | null;

const POS_SESSION_EVENT_NAME = "pos-session-current-updated";
const SHIFT_MUTATION_TIMEOUT_MS = 60_000;

function formatDateTime(value: string, lang: Lang) {
  const d = new Date(value);
  if (Number.isNaN(d.valueOf())) return value;
  return d.toLocaleString(lang === "th" ? "th-TH" : "en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

function formatMoney(value: number, lang: Lang) {
  return new Intl.NumberFormat(lang === "th" ? "th-TH" : "en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

function localizeShiftError(message: string, lang: Lang) {
  const normalized = message.toLowerCase();
  if (lang !== "th") return message;

  const openBillMatch = normalized.match(/please clear\s+(\d+)\s+open bill\(s\) before closing shift(?:\s*\(([^)]+)\))?/i);
  if (openBillMatch) {
    const count = openBillMatch[1] ?? "0";
    const bills = openBillMatch[2] ? ` (${openBillMatch[2]})` : "";
    return `กรุณาเคลียร์บิลที่ยังเปิดอยู่ ${count} บิลก่อนปิดกะ${bills}`;
  }

  const openTableMatch = normalized.match(/please clear\s+(\d+)\s+open table bill session\(s\) before closing shift/i);
  if (openTableMatch) {
    return `กรุณาปิดหรือชำระบิลโต๊ะที่ยังเปิดอยู่ ${openTableMatch[1] ?? "0"} รายการก่อนปิดกะ`;
  }

  if (normalized.includes("unpaid") || normalized.includes("open bill")) {
    return "ยังมีบิลที่ยังไม่ปิด กรุณาเคลียร์บิลก่อนปิดกะ";
  }

  if (normalized.includes("mismatch")) {
    return "ยอดเงินสดไม่ตรงกัน กรุณาตรวจสอบยอดก่อนปิดกะ";
  }

  if (normalized.includes("request_timeout")) {
    return "ระบบใช้เวลานานเกินไป กรุณาลองอีกครั้ง";
  }

  return message;
}

async function fetchJsonWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const body = (await response.json().catch(() => null)) as ApiBody;
    return { response, body };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("request_timeout");
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

class ShiftGuardApiError extends Error {
  code: string | null;

  constructor(code: string | null | undefined, message: string) {
    super(message);
    this.name = "ShiftGuardApiError";
    this.code = code ?? null;
  }
}

export function PosShiftCycleGuard({ lang }: { lang: Lang }) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<null | "continue" | "clear_continue" | "close" | "autoclose">(null);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shiftBlockerCode, setShiftBlockerCode] = useState<string | null>(null);
  const [phase, setPhase] = useState<ShiftGuardPhase>("on_time");
  const [shift, setShift] = useState<{
    id: string;
    opened_at: string;
    status: string;
    metrics: {
      order_count: number;
      cancelled_order_count: number;
      sales_total: number;
      cash_total: number;
      transfer_total: number;
    };
  } | null>(null);
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [closingCash, setClosingCash] = useState("");
  const [managerPin, setManagerPin] = useState("");
  const autoCloseRunRef = useRef<string | null>(null);
  const loadStateInFlightRef = useRef(false);

  const copy = useMemo(
    () =>
      lang === "th"
        ? {
            title: "แจ้งเตือนปิดกะ",
            subtitle: "รอบกะปัจจุบันสิ้นสุดแล้ว กรุณาเลือกการดำเนินการ",
            continueLabel: "ต่อกะ",
            closeLabel: "ปิดกะ",
            logoutLabel: "ออกจากระบบ",
            closeNowTitle: "ปิดกะตอนนี้",
            closeNowDesc: "กรอกเงินสดปลายกะเพื่อบันทึกและปิดรอบขาย",
            closingCash: "เงินสดปลายกะ",
            confirmClose: "ยืนยันปิดกะ",
            print: "พิมพ์รายงาน",
            cancel: "ยกเลิก",
            autoClosing: "ระบบกำลังปิดกะอัตโนมัติ",
            urgentHint: "เกินเวลาแล้ว กรุณาปิดกะทันที",
            logoutHint: "หลังปิดกะ ระบบจะพาไปหน้าเลือกสาขาอัตโนมัติ",
            closingProgress: "กำลังปิดกะและออกจากหน้าขาย...",
            continuingProgress: "กำลังต่อกะและเตรียมหน้าขาย...",
            clearOpenBillsLabel: "เคลียร์บิลค้างและต่อกะ",
            clearOpenBillsProgress: "กำลังเคลียร์บิลค้างและต่อกะ...",
            clearOpenBillsCloseLabel: "เคลียร์บิลค้างและปิดกะ",
            clearOpenBillsCloseProgress: "กำลังเคลียร์บิลค้างและปิดกะ...",
            requestTimeout: "ระบบใช้เวลานานเกินไป กรุณาลองอีกครั้ง",
            managerApprovalRequired: "กะนี้ค้างนานเกินไป ต้องใช้ PIN ผู้จัดการหรือเจ้าของร้าน",
            managerPinLabel: "PIN ผู้จัดการ/เจ้าของ",
            managerPinPlaceholder: "กรอก PIN เพื่ออนุมัติ",
            invalidClosingCash: "กรุณากรอกเงินสดปลายกะให้ถูกต้อง",
            unknownError: "ดำเนินการไม่สำเร็จ",
            opened: "เริ่มกะ",
            windowEnded: "ครบเวลา",
            cashSales: "ยอดขายเงินสด",
            transferSales: "ยอดโอน",
            cashStatus: "สถานะเงินสด",
            waitingCashInput: "รอกรอกเงินสด",
            balanced: "ผ่าน",
            short: "ติดลบ",
            over: "เกิน"
          }
        : {
            title: "Shift Close Reminder",
            subtitle: "Current shift window has ended. Please choose an action.",
            continueLabel: "Continue shift",
            closeLabel: "Close shift",
            logoutLabel: "Sign out",
            closeNowTitle: "Close Shift",
            closeNowDesc: "Enter closing cash to save and close this shift.",
            closingCash: "Closing cash",
            confirmClose: "Confirm close",
            print: "Print report",
            cancel: "Cancel",
            autoClosing: "System is auto-closing this shift.",
            urgentHint: "Shift window has ended. Please close this shift now.",
            logoutHint: "After shift close, you will be redirected to branch selection.",
            closingProgress: "Closing shift and leaving sales screen...",
            continuingProgress: "Continuing shift and preparing sales screen...",
            clearOpenBillsLabel: "Clear open bills and continue",
            clearOpenBillsProgress: "Clearing open bills and continuing shift...",
            clearOpenBillsCloseLabel: "Clear open bills and close",
            clearOpenBillsCloseProgress: "Clearing open bills and closing shift...",
            requestTimeout: "Request took too long. Please try again.",
            managerApprovalRequired: "This overdue shift can be closed automatically without manager approval.",
            managerPinLabel: "Manager / owner PIN",
            managerPinPlaceholder: "Enter approval PIN",
            invalidClosingCash: "Please enter a valid closing cash amount.",
            unknownError: "Unable to complete request.",
            opened: "Opened",
            windowEnded: "Window ended",
            cashSales: "Cash sales",
            transferSales: "Transfer sales",
            cashStatus: "Cash status",
            waitingCashInput: "Waiting for cash input",
            balanced: "Balanced",
            short: "Short",
            over: "Over"
          },
    [lang]
  );

  useEffect(() => {
    if (!error) return;
    const timeout = window.setTimeout(() => setError(null), 4200);
    return () => window.clearTimeout(timeout);
  }, [error]);

  const cycle = useMemo(() => (shift ? resolveShiftCycle(shift.opened_at) : null), [shift]);

  const applySessionState = useCallback((sessionData: SessionResponse["data"]) => {
    const activeShift = sessionData?.has_active_shift && sessionData.shift?.status === "open" ? sessionData.shift : null;
    if (!activeShift) {
      setShift(null);
      setPhase("on_time");
      setLoading(false);
      return;
    }
    setShift({
      id: activeShift.id,
      opened_at: activeShift.opened_at,
      status: activeShift.status,
      metrics: activeShift.metrics ?? {
        order_count: 0,
        cancelled_order_count: 0,
        sales_total: 0,
        cash_total: 0,
        transfer_total: 0
      }
    });
    const nextCycle = resolveShiftCycle(activeShift.opened_at);
    setPhase(nextCycle ? resolveShiftGuardPhase(nextCycle) : "on_time");
    setLoading(false);
  }, []);

  const toErrorMessage = useCallback(
    (unknownError: unknown) => {
      if (unknownError instanceof Error && unknownError.message === "request_timeout") return copy.requestTimeout;
      const message = unknownError instanceof Error ? unknownError.message : copy.unknownError;
      return localizeShiftError(message, lang);
    },
    [copy.requestTimeout, copy.unknownError, lang]
  );

  const loadState = useCallback(async () => {
    if (loadStateInFlightRef.current) return;
    loadStateInFlightRef.current = true;
    try {
      const { response, body } = await fetchJsonWithTimeout("/api/pos/session/current", { cache: "no-store" }, 8000);
      const sessionBody = body as SessionResponse | null;
      if (!response.ok || !sessionBody?.data) {
        setShift(null);
        setPhase("on_time");
        return;
      }
      applySessionState(sessionBody.data);
    } catch {
      if (phase !== "on_time") setError(copy.requestTimeout);
    } finally {
      loadStateInFlightRef.current = false;
      setLoading(false);
    }
  }, [applySessionState, copy.requestTimeout, phase]);

  useEffect(() => {
    const onSessionUpdated = (event: Event) => {
      applySessionState((event as CustomEvent<SessionResponse["data"]>).detail);
    };
    window.addEventListener(POS_SESSION_EVENT_NAME, onSessionUpdated);
    if (!busy) void loadState();
    const timer = window.setInterval(() => {
      if (!busy) void loadState();
    }, 60_000);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(POS_SESSION_EVENT_NAME, onSessionUpdated);
    };
  }, [applySessionState, busy, loadState]);

  const logoutToBranchSelection = useCallback(async () => {
    const { response, body } = await fetchJsonWithTimeout(
      "/api/auth/session/logout",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "switch_branch" })
      },
      15000
    );
    const logoutBody = body as { data?: { redirect_to?: string } | null; error?: { message?: string } | null } | null;
    if (!response.ok) {
      throw new Error(logoutBody?.error?.message ?? copy.unknownError);
    }
    window.location.assign(logoutBody?.data?.redirect_to ?? "/login/branches?flow=multi");
  }, [copy.unknownError]);

  const logoutFully = useCallback(async () => {
    if (logoutBusy) return;
    setLogoutBusy(true);
    setError(null);
    try {
      const { response, body } = await fetchJsonWithTimeout(
        "/api/auth/session/logout",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "full" })
        },
        15000
      );
      const logoutBody = body as { data?: { redirect_to?: string } | null; error?: { message?: string } | null } | null;
      if (!response.ok) {
        throw new Error(logoutBody?.error?.message ?? copy.unknownError);
      }
      window.location.assign(logoutBody?.data?.redirect_to ?? "/login/store");
    } catch (logoutError) {
      setError(toErrorMessage(logoutError));
      setLogoutBusy(false);
    }
  }, [copy.unknownError, logoutBusy, toErrorMessage]);

  const closeShift = useCallback(
    async (closingCashValue: number | null, approvalPin = "", clearOpenBills = true) => {
      if (!shift) return;
      const { response, body } = await fetchJsonWithTimeout(
        "/api/pos/shifts/close",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            closing_cash: closingCashValue ?? undefined,
            quick_close: true,
            clear_open_bills: clearOpenBills,
            manager_pin: approvalPin.trim() || undefined
          })
        },
        SHIFT_MUTATION_TIMEOUT_MS
      );
      if (!response.ok) {
        throw new ShiftGuardApiError(body?.error?.code, body?.error?.message ?? copy.unknownError);
      }
    },
    [copy.unknownError, shift]
  );

  const openNextShift = useCallback(async () => {
    const { response, body } = await fetchJsonWithTimeout(
      "/api/pos/shifts/open",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ opening_cash: 0 })
      },
      SHIFT_MUTATION_TIMEOUT_MS
    );
    if (!response.ok) {
      throw new ShiftGuardApiError(body?.error?.code, body?.error?.message ?? copy.unknownError);
    }
  }, [copy.unknownError]);

  const rememberBlockerFromError = useCallback((unknownError: unknown) => {
    setShiftBlockerCode(unknownError instanceof ShiftGuardApiError ? unknownError.code : null);
  }, []);

  const needsManagerApproval = false;

  function getApprovalPinOrFail() {
    if (!needsManagerApproval) return "";
    const pin = managerPin.trim();
    if (pin.length >= 4) return pin;
    setError(copy.managerApprovalRequired);
    return null;
  }

  async function handleContinueToNextShift() {
    if (!shift || busy) return;
    const approvalPin = getApprovalPinOrFail();
    if (approvalPin === null) return;
    setBusy("continue");
    setError(null);
    setShiftBlockerCode(null);
    try {
      await closeShift(null, approvalPin);
      await openNextShift();
      setManagerPin("");
      await loadState();
    } catch (continueError) {
      rememberBlockerFromError(continueError);
      setError(toErrorMessage(continueError));
      await loadState();
    } finally {
      setBusy(null);
    }
  }

  async function handleClearOpenBillsAndContinue() {
    if (!shift || busy) return;
    const approvalPin = getApprovalPinOrFail();
    if (approvalPin === null) return;
    const shouldCloseOnly = (phase === "urgent" || phase === "auto_close") && !needsManagerApproval;
    setBusy("clear_continue");
    setError(null);
    setShiftBlockerCode(null);
    try {
      await closeShift(null, approvalPin);
      if (shouldCloseOnly) {
        setManagerPin("");
        await logoutToBranchSelection();
        return;
      }
      await openNextShift();
      setManagerPin("");
      await loadState();
    } catch (clearError) {
      rememberBlockerFromError(clearError);
      setError(toErrorMessage(clearError));
      await loadState();
    } finally {
      setBusy(null);
    }
  }

  async function handleManualClose() {
    if (!shift || busy) return;
    const parsed = Number(closingCash.trim() || "0");
    if (!Number.isFinite(parsed) || parsed < 0) {
      setError(copy.invalidClosingCash);
      return;
    }
    const approvalPin = getApprovalPinOrFail();
    if (approvalPin === null) return;
    setBusy("close");
    setError(null);
    setShiftBlockerCode(null);
    try {
      await closeShift(parsed, approvalPin);
      setManagerPin("");
      await logoutToBranchSelection();
    } catch (closeError) {
      rememberBlockerFromError(closeError);
      setError(toErrorMessage(closeError));
      await loadState();
      setBusy(null);
    }
  }

  useEffect(() => {
    if (!shift || !cycle) return;
    if (phase !== "auto_close") return;
    if (needsManagerApproval) return;
    if (autoCloseRunRef.current === shift.id) return;
    autoCloseRunRef.current = shift.id;
    setBusy("autoclose");
    setError(null);
    setShiftBlockerCode(null);
    void closeShift(null, "", true)
      .then(() => logoutToBranchSelection())
      .catch((closeError) => {
        rememberBlockerFromError(closeError);
        setError(toErrorMessage(closeError));
        setBusy(null);
      });
  }, [closeShift, cycle, logoutToBranchSelection, needsManagerApproval, phase, rememberBlockerFromError, shift, toErrorMessage]);

  if (loading || !shift || !cycle || phase === "on_time") return null;

  const forceClose = (phase === "urgent" || phase === "auto_close") && !needsManagerApproval;
  const progressText =
    busy === "continue"
        ? copy.continuingProgress
      : busy === "clear_continue"
        ? forceClose
          ? copy.clearOpenBillsCloseProgress
          : copy.clearOpenBillsProgress
        : busy
          ? copy.closingProgress
          : null;
  const canClearOpenBills = shiftBlockerCode === "shift_has_open_bills" || forceClose;
  const hasClosingCashInput = closingCash.trim().length > 0;
  const closingCashAmount = Number(closingCash.trim() || "0");
  const closingCashIsValid = Number.isFinite(closingCashAmount) && closingCashAmount >= 0;
  const expectedCash = shift.metrics.cash_total;
  const cashVariance = closingCashIsValid ? Number((closingCashAmount - expectedCash).toFixed(2)) : 0;
  const cashStatusClass =
    !hasClosingCashInput
      ? "border-slate-200 bg-white text-slate-600"
      : !closingCashIsValid || Math.abs(cashVariance) < 0.01
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : cashVariance < 0
        ? "border-rose-200 bg-rose-50 text-rose-700"
        : "border-amber-200 bg-amber-50 text-amber-700";
  const cashStatusText =
    !hasClosingCashInput
      ? copy.waitingCashInput
      : !closingCashIsValid || Math.abs(cashVariance) < 0.01
      ? copy.balanced
      : `${cashVariance < 0 ? copy.short : copy.over} ${formatMoney(Math.abs(cashVariance), lang)}`;

  return (
    <>
      <div className="fixed inset-0 z-[95] bg-slate-950/45 backdrop-blur-[2px]" />
      <section className="fixed left-1/2 top-1/2 z-[100] w-[min(560px,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-3xl border border-slate-200 bg-white p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-xl font-black text-slate-900">{copy.title}</h3>
            <p className="mt-1 text-sm text-slate-600">{copy.subtitle}</p>
          </div>
          <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">
            {slotLabel(cycle.slot, lang)} - {slotWindowLabel(cycle.slot, lang)}
          </span>
        </div>

        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
          <p>
            {copy.opened}: <strong>{formatDateTime(shift.opened_at, lang)}</strong>
          </p>
          <p>
            {copy.windowEnded}: <strong>{formatDateTime(cycle.endAt.toISOString(), lang)}</strong>
          </p>
          {phase === "urgent" ? <p className="mt-1 font-bold text-amber-700">{copy.urgentHint}</p> : null}
          {phase === "auto_close" ? <p className="mt-1 font-bold text-rose-700">{copy.autoClosing}</p> : null}
        </div>

        {needsManagerApproval ? (
          <label className="mt-3 grid gap-1 text-sm font-semibold text-slate-700">
            {copy.managerPinLabel}
            <input
              type="password"
              inputMode="numeric"
              autoComplete="current-password"
              value={managerPin}
              disabled={Boolean(busy)}
              onChange={(event) => {
                setManagerPin(event.target.value);
                if (error) setError(null);
              }}
              className="h-11 rounded-xl border border-amber-200 bg-amber-50/60 px-3 text-sm font-semibold outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 disabled:bg-slate-100 disabled:text-slate-500"
              placeholder={copy.managerPinPlaceholder}
            />
            <span className="text-xs font-semibold text-amber-700">{copy.managerApprovalRequired}</span>
          </label>
        ) : null}

        {progressText ? (
          <div className="mt-3 flex items-center gap-3 rounded-xl border border-blue-100 bg-blue-50 px-3 py-3 text-sm font-semibold text-blue-800">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-blue-200 border-t-blue-700" aria-hidden />
            <span>{progressText}</span>
          </div>
        ) : null}

        {error ? (
          <div className="fixed left-1/2 top-5 z-[130] w-[min(480px,calc(100vw-28px))] -translate-x-1/2 rounded-2xl border border-rose-200 bg-white px-4 py-3 text-sm font-semibold text-rose-700 shadow-2xl shift-close-toast" role="status" aria-live="polite">
            <strong className="block text-rose-800">แจ้งเตือน</strong>
            <span className="mt-1 block">{error}</span>
          </div>
        ) : null}
        <p className="mt-4 text-xs text-slate-500">{copy.logoutHint}</p>

        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={() => void logoutFully()}
            disabled={Boolean(busy) || logoutBusy}
            className="h-10 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            {logoutBusy ? copy.closingProgress : copy.logoutLabel}
          </button>
          {!forceClose ? (
            <button
              type="button"
              onClick={() => void handleContinueToNextShift()}
              disabled={Boolean(busy)}
              className="h-10 rounded-xl border border-blue-200 bg-blue-50 px-4 text-sm font-bold text-blue-700 hover:bg-blue-100 disabled:opacity-60"
            >
              {busy === "continue" ? copy.continuingProgress : copy.continueLabel}
            </button>
          ) : null}
          {canClearOpenBills ? (
            <button
              type="button"
              onClick={() => void handleClearOpenBillsAndContinue()}
              disabled={Boolean(busy)}
              className="h-10 rounded-xl border border-amber-300 bg-amber-50 px-4 text-sm font-bold text-amber-800 hover:bg-amber-100 disabled:opacity-60"
            >
              {busy === "clear_continue"
                ? forceClose
                  ? copy.clearOpenBillsCloseProgress
                  : copy.clearOpenBillsProgress
                : forceClose
                  ? copy.clearOpenBillsCloseLabel
                  : copy.clearOpenBillsLabel}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setShowCloseModal(true)}
            disabled={Boolean(busy)}
            className="h-10 rounded-xl bg-slate-900 px-4 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-60"
          >
            {busy && busy !== "continue" ? copy.closingProgress : copy.closeLabel}
          </button>
        </div>
      </section>

      {showCloseModal ? (
        <section className="fixed left-1/2 top-1/2 z-[110] w-[min(460px,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
          <h4 className="text-lg font-black text-slate-900">{busy === "close" ? copy.closingProgress : copy.closeNowTitle}</h4>
          <p className="mt-1 text-sm text-slate-600">{copy.closeNowDesc}</p>
          {busy === "close" ? (
            <div className="mt-3 flex items-center gap-3 rounded-xl border border-blue-100 bg-blue-50 px-3 py-3 text-sm font-semibold text-blue-800">
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-blue-200 border-t-blue-700" aria-hidden />
              <span>{copy.closingProgress}</span>
            </div>
          ) : null}
          {needsManagerApproval ? (
            <label className="mt-3 grid gap-1 text-sm font-semibold text-slate-700">
              {copy.managerPinLabel}
              <input
                type="password"
                inputMode="numeric"
                autoComplete="current-password"
                value={managerPin}
                disabled={Boolean(busy)}
                onChange={(event) => {
                  setManagerPin(event.target.value);
                  if (error) setError(null);
                }}
                className="h-11 rounded-xl border border-amber-200 bg-amber-50/60 px-3 text-sm font-semibold outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 disabled:bg-slate-100 disabled:text-slate-500"
                placeholder={copy.managerPinPlaceholder}
              />
              <span className="text-xs font-semibold text-amber-700">{copy.managerApprovalRequired}</span>
            </label>
          ) : null}
          <label className="mt-3 grid gap-1 text-sm font-semibold text-slate-700">
            {copy.closingCash}
            <input
              type="number"
              step="0.01"
              min={0}
              value={closingCash}
              disabled={Boolean(busy)}
              onChange={(event) => {
                setClosingCash(event.target.value);
                if (error) setError(null);
              }}
              className="h-11 rounded-xl border border-slate-300 px-3 disabled:bg-slate-100 disabled:text-slate-500"
              placeholder="0.00"
            />
          </label>
          <div className="mt-3 grid gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="font-semibold text-slate-600">{copy.cashSales}</span>
              <strong className="text-slate-950">{formatMoney(expectedCash, lang)}</strong>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="font-semibold text-slate-600">{copy.transferSales}</span>
              <strong className="text-slate-950">{formatMoney(shift.metrics.transfer_total, lang)}</strong>
            </div>
            <div className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2 ${cashStatusClass}`}>
              <span className="font-bold">{copy.cashStatus}</span>
              <strong>{cashStatusText}</strong>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              disabled={Boolean(busy) || logoutBusy}
              className="h-10 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {copy.print}
            </button>
            <button
              type="button"
              onClick={() => setShowCloseModal(false)}
              disabled={Boolean(busy) || logoutBusy}
              className="h-10 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {copy.cancel}
            </button>
            <button
              type="button"
              onClick={() => void logoutFully()}
              disabled={Boolean(busy) || logoutBusy}
              className="h-10 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {logoutBusy ? copy.closingProgress : copy.logoutLabel}
            </button>
            <button
              type="button"
              onClick={() => void handleManualClose()}
              disabled={Boolean(busy) || logoutBusy}
              className="h-10 rounded-xl bg-slate-900 px-4 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {busy === "close" ? copy.closingProgress : copy.confirmClose}
            </button>
          </div>
        </section>
      ) : null}
      <style jsx>{`
        .shift-close-toast {
          animation: shiftCloseToastIn 180ms ease-out;
        }

        @keyframes shiftCloseToastIn {
          from {
            opacity: 0;
            transform: translate(-50%, -10px) scale(0.98);
          }
          to {
            opacity: 1;
            transform: translate(-50%, 0) scale(1);
          }
        }
      `}</style>
    </>
  );
}
