"use client";

import { KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApprovalAction } from "@pos/shared-types";

type ManagerOverrideModalLabels = {
  pinLabel: string;
  pinKeypadHint: string;
  pinLengthError: string;
  pinRejected: string;
  checkingAccess: string;
  clear: string;
  remove: string;
  closeAriaLabel: string;
};

type Props = {
  open: boolean;
  title: string;
  action: ApprovalAction;
  targetTable: string;
  targetId: string;
  onClose: () => void;
  onApproved: (approvalId: string) => void;
  onPinSubmit?: (pin: string) => Promise<void>;
  lang?: "th" | "en";
  labels?: Partial<ManagerOverrideModalLabels>;
};

const MODAL_LABELS: Record<"th" | "en", ManagerOverrideModalLabels> = {
  th: {
    pinLabel: "รหัส PIN ผู้อนุมัติ",
    pinKeypadHint: "กรอกรหัสแล้วระบบจะตรวจสอบและอนุมัติทันที",
    pinLengthError: "PIN ต้องมีอย่างน้อย 4 หลัก",
    pinRejected: "รหัส PIN ไม่ถูกต้องหรือไม่มีสิทธิ์อนุมัติ",
    checkingAccess: "กำลังตรวจสอบสิทธิ์...",
    clear: "ล้าง",
    remove: "ลบ",
    closeAriaLabel: "ปิดหน้าต่าง PIN"
  },
  en: {
    pinLabel: "Approver PIN",
    pinKeypadHint: "Enter PIN to auto-verify and approve",
    pinLengthError: "PIN must be at least 4 digits.",
    pinRejected: "PIN is invalid or not authorized for this action.",
    checkingAccess: "Checking access...",
    clear: "Clear",
    remove: "Delete",
    closeAriaLabel: "Close PIN popup"
  }
};

export function ManagerOverrideModal({
  open,
  title: _title,
  action,
  targetTable,
  targetId,
  onClose,
  onApproved,
  onPinSubmit,
  lang,
  labels
}: Props) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const MAX_PIN_LENGTH = 12;
  const MIN_PIN_LENGTH = 4;
  const AUTO_SUBMIT_DELAY_MS = 800;
  const autoSubmitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSubmittedPin = useRef("");
  const keypadDigits = useMemo(() => ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "00"], []);
  const resolvedLang = useMemo<"th" | "en">(() => {
    if (lang) return lang;
    if (typeof document === "undefined") return "th";
    const htmlLang = String(document.documentElement.lang ?? "").toLowerCase();
    return htmlLang.startsWith("en") ? "en" : "th";
  }, [lang]);
  const text = useMemo(() => ({ ...MODAL_LABELS[resolvedLang], ...(labels ?? {}) }), [labels, resolvedLang]);

  const submitApproval = useCallback(
    async (pinToCheck: string) => {
      if (pinToCheck.length < MIN_PIN_LENGTH) {
        setError(text.pinLengthError);
        return;
      }
      lastSubmittedPin.current = pinToCheck;
      setBusy(true);
      setError(null);

      try {
        if (onPinSubmit) {
          await onPinSubmit(pinToCheck);
          setPin("");
          lastSubmittedPin.current = "";
          return;
        }
        const response = await fetch("/api/backoffice/approvals/pin", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tenant_id: "",
            branch_id: "",
            action,
            target_table: targetTable,
            target_id: targetId,
            manager_pin: pinToCheck
          })
        });
        const body = await response.json();
        if (!response.ok || body.error) {
          const code = String(body.error?.code ?? "").trim().toLowerCase();
          if (code === "pin_rejected") {
            throw new Error(text.pinRejected);
          }
          throw new Error(body.error?.message ?? "PIN approval failed.");
        }
        const approvalId = String(body.data?.approval_id ?? "");
        if (!approvalId) {
          throw new Error("Approval ID was not returned.");
        }
        setPin("");
        lastSubmittedPin.current = "";
        onApproved(approvalId);
      } catch (submitError) {
        setError(submitError instanceof Error ? submitError.message : "Unknown error");
      } finally {
        setBusy(false);
      }
    },
    [MIN_PIN_LENGTH, action, onApproved, onPinSubmit, targetId, targetTable, text.pinLengthError, text.pinRejected]
  );

  useEffect(() => {
    if (!open) {
      setPin("");
      setError(null);
      setBusy(false);
      lastSubmittedPin.current = "";
      if (autoSubmitTimer.current) {
        clearTimeout(autoSubmitTimer.current);
        autoSubmitTimer.current = null;
      }
    }
  }, [open]);

  useEffect(() => {
    return () => {
      if (autoSubmitTimer.current) {
        clearTimeout(autoSubmitTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!open || busy || pin.length < MIN_PIN_LENGTH) {
      return;
    }

    if (pin === lastSubmittedPin.current) {
      return;
    }

    if (autoSubmitTimer.current) {
      clearTimeout(autoSubmitTimer.current);
    }

    autoSubmitTimer.current = setTimeout(() => {
      autoSubmitTimer.current = null;
      if (!busy) {
        void submitApproval(pin);
      }
    }, AUTO_SUBMIT_DELAY_MS);

    return () => {
      if (autoSubmitTimer.current) {
        clearTimeout(autoSubmitTimer.current);
        autoSubmitTimer.current = null;
      }
    };
  }, [AUTO_SUBMIT_DELAY_MS, MIN_PIN_LENGTH, busy, open, pin, submitApproval]);

  if (!open) return null;

  const pinMasked = "*".repeat(pin.length);
  const canApprove = pin.length >= MIN_PIN_LENGTH && !busy;

  function appendPinDigit(digit: string) {
    if (busy) return;
    if (!/^\d+$/.test(digit)) return;
    setError(null);
    setPin((current) => {
      if (current.length >= MAX_PIN_LENGTH) return current;
      const remaining = MAX_PIN_LENGTH - current.length;
      const chunk = digit.slice(0, remaining);
      return `${current}${chunk}`;
    });
  }

  function removePinDigit() {
    if (busy) return;
    setError(null);
    setPin((current) => current.slice(0, -1));
  }

  function clearPin() {
    if (busy) return;
    setError(null);
    lastSubmittedPin.current = "";
    setPin("");
  }

  function handlePinHotkeys(event: KeyboardEvent<HTMLDivElement>) {
    if (busy) return;
    if (/^\d$/.test(event.key)) {
      event.preventDefault();
      appendPinDigit(event.key);
      return;
    }
    if (event.key === "Backspace") {
      event.preventDefault();
      removePinDigit();
      return;
    }
    if (event.key === "Delete" || event.key.toLowerCase() === "c") {
      event.preventDefault();
      clearPin();
      return;
    }
    if (event.key === "Enter" && canApprove) {
      event.preventDefault();
      void submitApproval(pin);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="posui-modal-backdrop"
      onClick={() => {
        if (!busy) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.5)",
        display: "grid",
        placeItems: "center",
        zIndex: 80
      }}
    >
      <div
        className="surface posui-modal posui-pin-modal"
        onClick={(event) => event.stopPropagation()}
        style={{ width: "min(520px, calc(100vw - 24px))", maxHeight: "min(90vh, 680px)" }}
      >
        <button type="button" className="posui-pin-modal__close" onClick={onClose} disabled={busy} aria-label={text.closeAriaLabel}>
          x
        </button>
        <div className="grid posui-modal-form" style={{ gap: 10 }}>
          <div className="posui-pin-panel" role="group" aria-label="Approver PIN input" tabIndex={0} onKeyDown={handlePinHotkeys}>
            <label className="posui-pin-panel__label">{text.pinLabel}</label>
            <div className="posui-pin-panel__display" aria-live="polite" aria-label={`PIN length ${pin.length} digits`}>
              {pinMasked || "______"}
            </div>
            <div className="posui-pin-panel__hint">{pin.length}/{MAX_PIN_LENGTH}</div>
            <p className="posui-pin-panel__keypad-title">{text.pinKeypadHint}</p>
            <div className="posui-pin-panel__grid">
              {keypadDigits.map((digit) => (
                <button
                  key={digit}
                  type="button"
                  className="posui-pin-panel__key"
                  onClick={() => appendPinDigit(digit)}
                  disabled={busy || pin.length >= MAX_PIN_LENGTH}
                  aria-label={`PIN ${digit}`}
                >
                  {digit}
                </button>
              ))}
            </div>
            <div className="posui-pin-panel__actions">
              <button type="button" className="posui-pin-panel__key posui-pin-panel__key--warn" onClick={clearPin} disabled={busy || pin.length === 0}>
                {text.clear}
              </button>
              <button type="button" className="posui-pin-panel__key posui-pin-panel__key--warn" onClick={removePinDigit} disabled={busy || pin.length === 0}>
                {text.remove}
              </button>
            </div>
          </div>
          {busy ? <p className="posui-pin-modal__status">{text.checkingAccess}</p> : null}
          {error ? <p className="posui-pin-modal__error">{error}</p> : null}
        </div>
      </div>
    </div>
  );
}
