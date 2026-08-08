"use client";

import { useEffect, useState } from "react";

type PaymentText = {
  subtotal: string;
  total: string;
  checkout: string;
  retry: string;
  managerOverride: string;
  cancelBill: string;
  holdBill: string;
  member?: string;
  promotion: string;
  billNo: string;
  status: string;
  statusValue: string;
  mode?: string;
  tax?: string;
  paymentMethod?: string;
};

type Props = {
  subtotal: number;
  total: number;
  taxAmount?: number;
  taxLines?: Array<{ id: string; label: string; amount: number }>;
  onCheckout: () => void;
  onRetry?: () => void;
  onManagerOverride?: () => void;
  onCancelBill?: () => void;
  onHoldBill?: () => void;
  onMember?: () => void;
  onTableQrOrder?: () => void;
  onPromotion?: () => void;
  onOpenCashDrawer?: () => void;
  showHoldBill?: boolean;
  showTableQrOrder?: boolean;
  tableQrOrderLabel?: string;
  checkoutLabel?: string;
  checkoutDisabled?: boolean;
  retryDisabled?: boolean;
  retryLabel?: string;
  submitting?: boolean;
  submittingLabel?: string;
  pendingLabel?: string;
  message?: string | null;
  pending?: boolean;
  billNo?: string;
  showBillNo?: boolean;
  showPaymentMethod?: boolean;
  showModeStatus?: boolean;
  showStatus?: boolean;
  showDiscount?: boolean;
  showTax?: boolean;
  actionsDisabled?: boolean;
  cancelBillDisabled?: boolean;
  cancelLabel?: string;
  transferVerificationLabel?: string;
  openCashDrawerLabel?: string;
  openingCashDrawerLabel?: string;
  openCashDrawerDisabled?: boolean;
  openingCashDrawer?: boolean;
  transferVerificationBadge?: {
    label: string;
    tone: "pass" | "fail" | "warn";
  } | null;
  paymentMethodValue?: string;
  modeStatusValue?: string;
  memberSummary?: {
    name: string;
    code?: string | null;
    phone?: string | null;
    points?: number | null;
    stamps?: number | null;
  } | null;
  text: PaymentText;
};

type SecondaryAction = {
  key: string;
  className: string;
  onClick?: () => void;
  disabled: boolean;
  label: string;
};

type LocalBridgeRuntimePayload = {
  bridge_health_url?: string;
  bridge_print_url?: string;
  bridge_token?: string;
  bridge_token_header?: string;
  windows_printer?: string;
};

type LocalBridgeHealthBody = {
  ok?: boolean;
  data?: {
    resolved_printer?: string | null;
    system_default_printer?: string | null;
  } | null;
};

type LocalBridgeCommandBody = {
  ok?: boolean;
  error?: unknown;
};

const ACTIVE_SALES_MODE_LABEL_KEY = "cpipos_active_sales_mode_label";

function formatMoney(value: number): string {
  return `฿${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`;
}

function readWindowsRuntimePayload(): LocalBridgeRuntimePayload | null {
  if (typeof window === "undefined") return null;
  return (window as Window & { CpIPOSWindowsRuntime?: LocalBridgeRuntimePayload }).CpIPOSWindowsRuntime ?? null;
}

function readActiveSalesModeLabel(): string | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(ACTIVE_SALES_MODE_LABEL_KEY);
}

function isDineInModeLabel(value: string | null | undefined): boolean {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "นั่งโต๊ะ" || normalized === "dine in" || normalized === "dine-in" || normalized === "dine_in";
}

function resolveDisplayModeStatusValue(args: {
  modeStatusValue?: string;
  fallbackStatusValue: string;
  activeSalesModeLabel: string | null;
  modeLabel?: string;
}): string {
  const currentValue = args.modeStatusValue ?? args.fallbackStatusValue;
  if (args.activeSalesModeLabel === "buffet_table" && isDineInModeLabel(currentValue)) {
    return args.modeLabel === "โหมด" ? "โต๊ะบุฟเฟ่" : "Buffet table";
  }
  return currentValue;
}

function buildCashDrawerBridgeUrl(printUrl: string): string {
  try {
    const url = new URL(printUrl);
    if (url.pathname.endsWith("/print/test")) {
      url.pathname = url.pathname.replace(/\/print\/test$/u, "/cash-drawer/open");
      return url.toString();
    }
    if (url.pathname.endsWith("/print")) {
      url.pathname = url.pathname.replace(/\/print$/u, "/cash-drawer/open");
      return url.toString();
    }
    url.pathname = "/cash-drawer/open";
    return url.toString();
  } catch {
    return printUrl.replace(/\/print(?:\/test)?\/?$/u, "/cash-drawer/open");
  }
}

async function resolveLocalBridgePrinterName(args: {
  healthUrl: string;
  runtimePrinter?: string | null;
}): Promise<string | undefined> {
  const runtimePrinter = String(args.runtimePrinter ?? "").trim();
  if (runtimePrinter) return runtimePrinter;

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(args.healthUrl, { cache: "no-store", signal: controller.signal });
    if (!response.ok) return undefined;
    const body = (await response.json().catch(() => null)) as LocalBridgeHealthBody | null;
    const resolvedPrinter = String(body?.data?.resolved_printer ?? "").trim();
    if (resolvedPrinter) return resolvedPrinter;
    const systemDefaultPrinter = String(body?.data?.system_default_printer ?? "").trim();
    return systemDefaultPrinter || undefined;
  } catch {
    return undefined;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function tryOpenLocalBridgeCashDrawer(): Promise<boolean> {
  if (typeof window === "undefined") return false;

  const runtime = readWindowsRuntimePayload();
  const token = String(
    window.sessionStorage.getItem("cpi_local_bridge_token_v1") ?? runtime?.bridge_token ?? ""
  ).trim();
  const tokenHeader = String(
    window.sessionStorage.getItem("cpi_local_bridge_token_header_v1") ?? runtime?.bridge_token_header ?? "X-CpIPOS-Bridge-Token"
  ).trim();
  const printUrl = String(
    window.localStorage.getItem("cpi_local_bridge_print_url_v1") ?? runtime?.bridge_print_url ?? ""
  ).trim();
  const healthUrl = String(
    window.localStorage.getItem("cpi_local_bridge_health_url_v1") ?? runtime?.bridge_health_url ?? ""
  ).trim();

  if (!token || !tokenHeader || !printUrl || !healthUrl) return false;

  const printerName = await resolveLocalBridgePrinterName({
    healthUrl,
    runtimePrinter: runtime?.windows_printer
  });
  const body: Record<string, unknown> = {
    drawer_connection_mode: "printer-kick",
    drawer_kick_pin: 0,
    drawer_pulse_on_ms: 80,
    drawer_pulse_off_ms: 250,
    metadata: {
      source: "pos_payment_panel",
      trigger: "manual_cash_drawer_button",
      drawer_connection_mode: "printer-kick",
      drawer_kick_pin: 0,
      drawer_pulse_on_ms: 80,
      drawer_pulse_off_ms: 250
    }
  };
  if (printerName) {
    body.printer_name = printerName;
  }

  try {
    const response = await fetch(buildCashDrawerBridgeUrl(printUrl), {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        [tokenHeader]: token
      },
      body: JSON.stringify(body)
    });
    const result = (await response.json().catch(() => null)) as LocalBridgeCommandBody | null;
    return response.ok && result?.ok !== false && !result?.error;
  } catch {
    return false;
  }
}

export function PosPaymentPanel({
  subtotal,
  total,
  taxAmount,
  taxLines = [],
  onCheckout,
  onRetry,
  onManagerOverride,
  onCancelBill,
  onHoldBill,
  onMember,
  onTableQrOrder,
  onPromotion,
  onOpenCashDrawer,
  showHoldBill = true,
  showTableQrOrder = false,
  tableQrOrderLabel = "QR สั่งอาหาร",
  checkoutLabel,
  checkoutDisabled,
  retryDisabled,
  retryLabel,
  submitting,
  submittingLabel = "Submitting...",
  billNo = "BILL-2026-0001",
  showBillNo = true,
  showPaymentMethod = true,
  showModeStatus = false,
  showStatus = true,
  showDiscount = true,
  showTax = true,
  actionsDisabled = false,
  cancelBillDisabled = false,
  cancelLabel,
  transferVerificationLabel,
  openCashDrawerLabel = "เปิดลิ้นชักเก็บเงิน",
  openingCashDrawerLabel = "กำลังส่งคำสั่ง...",
  openCashDrawerDisabled = false,
  openingCashDrawer = false,
  transferVerificationBadge,
  paymentMethodValue,
  modeStatusValue,
  memberSummary,
  text
}: Props) {
  const [localCashDrawerOpening, setLocalCashDrawerOpening] = useState(false);
  const [activeSalesModeLabel, setActiveSalesModeLabel] = useState<string | null>(() => readActiveSalesModeLabel());
  const cashDrawerBusy = openingCashDrawer || localCashDrawerOpening;
  const displayModeStatusValue = resolveDisplayModeStatusValue({
    modeStatusValue,
    fallbackStatusValue: text.statusValue,
    activeSalesModeLabel,
    modeLabel: text.mode
  });

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const syncActiveSalesModeLabel = () => setActiveSalesModeLabel(readActiveSalesModeLabel());
    window.addEventListener("cpipos:sales-mode-label-change", syncActiveSalesModeLabel);
    window.addEventListener("storage", syncActiveSalesModeLabel);
    syncActiveSalesModeLabel();
    return () => {
      window.removeEventListener("cpipos:sales-mode-label-change", syncActiveSalesModeLabel);
      window.removeEventListener("storage", syncActiveSalesModeLabel);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (activeSalesModeLabel && modeStatusValue && !isDineInModeLabel(modeStatusValue)) {
      window.sessionStorage.removeItem(ACTIVE_SALES_MODE_LABEL_KEY);
      setActiveSalesModeLabel(null);
    }
  }, [activeSalesModeLabel, modeStatusValue]);

  async function handleOpenCashDrawerClick() {
    if (!onOpenCashDrawer || openCashDrawerDisabled || cashDrawerBusy || submitting) return;
    setLocalCashDrawerOpening(true);
    try {
      const openedViaLocalBridge = await tryOpenLocalBridgeCashDrawer();
      if (openedViaLocalBridge) return;
      onOpenCashDrawer();
    } finally {
      setLocalCashDrawerOpening(false);
    }
  }

  const secondaryActions = ([
    showHoldBill
      ? {
          key: "hold",
          className: "posui-btn",
          onClick: onHoldBill,
          disabled: actionsDisabled,
          label: text.holdBill
        }
      : null,
    showTableQrOrder
      ? {
          key: "table-qr",
          className: "posui-btn posui-btn--table-qr",
          onClick: onTableQrOrder,
          disabled: actionsDisabled,
          label: tableQrOrderLabel
        }
      : null,
    onMember
      ? {
          key: "member",
          className: "posui-btn posui-btn--member",
          onClick: onMember,
          disabled: actionsDisabled,
          label: text.member ?? "Member"
        }
      : null,
    {
      key: "promotion",
      className: "posui-btn posui-btn--promo",
      onClick: onPromotion,
      disabled: actionsDisabled,
      label: text.promotion
    },
    onCancelBill
      ? {
          key: "cancel",
          className: "posui-btn posui-btn--cancel-near-checkout",
          onClick: onCancelBill,
          disabled: actionsDisabled || cancelBillDisabled,
          label: cancelLabel ?? text.cancelBill
        }
      : null
  ] as Array<SecondaryAction | null>).filter((action): action is SecondaryAction => Boolean(action));

  return (
    <section className="posui-payment-panel">
      <div className="posui-bill-summary-card">
        {showBillNo ? (
          <p>
            <span>{text.billNo}</span>
            <strong>{billNo}</strong>
          </p>
        ) : null}
        {showPaymentMethod && text.paymentMethod ? (
          <p>
            <span>{text.paymentMethod}</span>
            <strong>{paymentMethodValue ?? "-"}</strong>
          </p>
        ) : null}
        {showModeStatus && text.mode ? (
          <p>
            <span>{text.mode}</span>
            <strong>{displayModeStatusValue}</strong>
          </p>
        ) : null}
        {showStatus ? (
          <p>
            <span>{text.status}</span>
            <strong>{text.statusValue}</strong>
          </p>
        ) : null}
        {memberSummary ? (
          <div className="posui-bill-member-card">
            <span>{text.member ?? "Member"}</span>
            <strong>{memberSummary.name}</strong>
            <small>
              {[memberSummary.code ? `#${memberSummary.code}` : "", memberSummary.phone].filter(Boolean).join(" / ")}
            </small>
            <em>
              {Number(memberSummary.points ?? 0)} คะแนน / {Number(memberSummary.stamps ?? 0)} แต้ม
            </em>
          </div>
        ) : null}
        {transferVerificationBadge && transferVerificationLabel ? (
          <p>
            <span>{transferVerificationLabel}</span>
            <strong className={`posui-transfer-badge is-${transferVerificationBadge.tone}`}>{transferVerificationBadge.label}</strong>
          </p>
        ) : null}
        {showDiscount ? (
          <p>
            <span>{text.subtotal}</span>
            <strong>{formatMoney(Math.max(0, subtotal))}</strong>
          </p>
        ) : null}
        {showTax && taxLines.length > 0 ? taxLines.map((line) => (
          <p key={line.id}>
            <span>{line.label}</span>
            <strong>{line.amount < 0 ? "-" : "+"}{formatMoney(Math.abs(line.amount))}</strong>
          </p>
        )) : showTax && text.tax ? (
          <p>
            <span>{text.tax}</span>
            <strong>{formatMoney(Math.max(0, taxAmount ?? 0))}</strong>
          </p>
        ) : null}
        <p className="is-total">
          <span>{text.total}</span>
          <strong>{formatMoney(total)}</strong>
        </p>
      </div>

      <div
        className={`posui-bill-actions posui-bill-actions--${secondaryActions.length}`}
        style={{ display: "grid", gridTemplateColumns: `repeat(${secondaryActions.length}, minmax(0, 1fr))`, gap: 8 }}
      >
        {secondaryActions.map((action) => (
          <button key={action.key} type="button" className={action.className} onClick={action.onClick} disabled={action.disabled}>
            {action.label}
          </button>
        ))}
      </div>

      <div className="posui-payment-actions posui-payment-actions--single" style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
        {onOpenCashDrawer ? (
          <button
            type="button"
            onClick={handleOpenCashDrawerClick}
            disabled={openCashDrawerDisabled || cashDrawerBusy || submitting}
            className="posui-btn posui-btn--cash-drawer"
          >
            {cashDrawerBusy ? openingCashDrawerLabel : openCashDrawerLabel}
          </button>
        ) : null}
        <button
          type="button"
          onClick={onCheckout}
          disabled={checkoutDisabled || submitting}
          className="posui-btn posui-btn--primary posui-btn--checkout"
        >
          {submitting ? submittingLabel : checkoutLabel ?? text.checkout}
        </button>
        {onRetry ? (
          <button type="button" onClick={onRetry} disabled={retryDisabled || submitting} className="posui-btn posui-btn--retry-emergency">
            {retryLabel ?? text.retry}
          </button>
        ) : null}
        {onManagerOverride ? (
          <button type="button" onClick={onManagerOverride} className="posui-btn">
            {text.managerOverride}
          </button>
        ) : null}
      </div>
    </section>
  );
}
