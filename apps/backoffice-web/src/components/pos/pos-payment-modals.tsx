"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import type { ReactNode, RefObject } from "react";

type QuickMode = "home" | "dine_in" | "delivery";

type CartItem = {
  product_id: string;
  name: string;
  quantity: number;
  price: number;
  notes?: string | null;
};

type TaxLineSnapshot = {
  id: string;
  label: string;
  rate_pct: number;
  mode: string;
  amount: number;
};

type CheckoutReviewOrder = {
  order_id: string;
  order_no: string;
  external_order_code?: string | null;
  member_name?: string | null;
  member_phone?: string | null;
  member_code?: string | null;
  member_points?: number | null;
  member_stamps?: number | null;
  table_id?: string | null;
  created_at: string;
  items: CartItem[];
  total_amount: number;
  discount_amount?: number;
  tax_total?: number;
  tax_lines?: TaxLineSnapshot[];
};

type ReceiptSession = CheckoutReviewOrder & {
  payment_method: "cash" | "bank_transfer";
  cash_received: number;
  change_amount: number;
};

type TakeawayCreatingPreview = {
  items: CartItem[];
  total_amount: number;
};

type SlipExtractPayload = {
  payer_name: string | null;
  payee_name: string | null;
  amount: number | null;
  transfer_datetime: string | null;
  transaction_id: string | null;
  confidence: number | null;
};

type SlipVerifyChecks = {
  amount_match: boolean;
  payee_match: boolean;
  datetime_present: boolean;
  confidence_pass: boolean;
};

type TransferVerification = {
  id: string;
  verification_status: "passed" | "failed" | "override_passed" | "error";
  expected_amount: number;
  parsed_amount: number | null;
  parsed_reference_no: string | null;
  parsed_transaction_id: string | null;
  issues?: unknown;
  error_message: string | null;
  verified_at: string;
};

type TransferPaymentMode = "manual" | "inet_nops";
const SYSTEM_RECEIPT_LOGO_PATH = "/brand/cpipos-logo.png";

function ReceiptLogoImage({ src, alt, className }: { src: string; alt: string; className: string }) {
  const [currentSrc, setCurrentSrc] = useState(src || SYSTEM_RECEIPT_LOGO_PATH);

  useEffect(() => {
    setCurrentSrc(src || SYSTEM_RECEIPT_LOGO_PATH);
  }, [src]);

  return (
    <Image
      src={currentSrc}
      alt={alt}
      className={className}
      width={196}
      height={78}
      unoptimized
      onError={() => {
        if (currentSrc !== SYSTEM_RECEIPT_LOGO_PATH) setCurrentSrc(SYSTEM_RECEIPT_LOGO_PATH);
      }}
    />
  );
}

function parseReceiptItemNotes(notes?: string | null) {
  const raw = String(notes ?? "").trim();
  if (!raw) return { choices: [] as string[], note: null as string | null };
  const parts = raw.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length > 1) return { choices: parts, note: null };
  return { choices: [] as string[], note: raw };
}

type Props = {
  text: any;
  lang: "th" | "en";
  shiftStatus: string | undefined;
  sellerName: string;
  quickMode: QuickMode;
  receiptLogoPath: string;
  receiptStoreName: string;
  receiptStoreAddress: string;
  receiptStorePhone: string;
  receiptBranchLabel: string;
  takeawayCreatingPreview: TakeawayCreatingPreview | null;
  reviewOrder: CheckoutReviewOrder | null;
  cashReviewOrder: CheckoutReviewOrder | null;
  transferReviewOrder: CheckoutReviewOrder | null;
  receiptSession: ReceiptSession | null;
  receiptSaving: boolean;
  cashSubmitting: boolean;
  transferSubmitting: boolean;
  transferSlipChecking: boolean;
  transferSlipFile: File | null;
  transferSlipPreviewUrl: string | null;
  transferSlipParsed: SlipExtractPayload | null;
  transferSlipChecks: SlipVerifyChecks | null;
  transferSlipIssues: string[];
  transferSlipVerified: boolean;
  transferSlipReverifyRequired: boolean;
  transferNeedsOverride: boolean;
  transferCanSubmit: boolean;
  transferError: string | null;
  transferReference: string;
  transferPaymentMode: TransferPaymentMode;
  inetQrEnabled: boolean;
  inetQrUrl: string | null;
  inetQrStatus: "idle" | "creating" | "pending" | "paid" | "failed";
  inetProviderOrderId: string | null;
  promptPayQrUrl: string | null;
  promptPayPhoneDisplay: string;
  promptPayQrMode: "promptpay_link" | "qr_image";
  paymentAccountLabel: string;
  expectedPayeeName: string;
  transferVerificationHistory: TransferVerification[];
  cashReceivedInput: string;
  cashReceivedDisplay: string;
  cashDiff: number;
  cashQuickAmounts: number[];
  cashKeypadKeys: string[];
  cashError: string | null;
  cashConfirmNeedsAttention: boolean;
  transferSlipInputRef: RefObject<HTMLInputElement | null>;
  formatMoney: (value: number) => string;
  formatQuantity: (value: number) => string;
  formatReceiptDateTime: (value: string, lang: "th" | "en") => string;
  renderExternalOrderCode: (order: CheckoutReviewOrder) => ReactNode;
  renderDineInPaymentIdentity: (tableId?: string | null) => ReactNode;
  getQuickModeLabel: () => string;
  getReceiptPaymentMethodLabel: (session: ReceiptSession) => string;
  getTransferVerificationStatusTone: (status: TransferVerification["verification_status"]) => "pass" | "fail" | "warn";
  getTransferVerificationStatusLabel: (status: TransferVerification["verification_status"]) => string;
  normalizeTransferVerificationIssues: (value: unknown) => string[];
  canDeductIngredientForItem: (productId: string) => boolean;
  ingredientDeductingKey: string | null;
  ingredientDeductingMode: "deduct" | "restore" | null;
  onCloseReview: () => void;
  onCancelFromReview: (order: CheckoutReviewOrder) => void;
  onCancelFromCash: (order: CheckoutReviewOrder) => void;
  onCancelFromTransfer: (order: CheckoutReviewOrder) => void;
  onDeductIngredientForItem: (order: CheckoutReviewOrder, item: CartItem) => void;
  onOpenCash: (order: CheckoutReviewOrder) => void;
  onOpenTransfer: (order: CheckoutReviewOrder) => void;
  onCloseCash: () => void;
  onConfirmCash: () => Promise<void> | void;
  onApplyQuickCashAmount: (amount: number) => void;
  onAppendCashKeypadValue: (value: string) => void;
  onClearCashInput: () => void;
  onBackspaceCashInput: () => void;
  onCloseTransfer: () => void;
  onSelectTransferPaymentMode: (mode: TransferPaymentMode) => void;
  onCreateInetQrPayment: () => Promise<void> | void;
  onTransferSlipFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onVerifyTransferSlip: () => Promise<void> | void;
  onRequestTransferOverride: () => void;
  onTransferReferenceChange: (value: string) => void;
  onConfirmTransfer: () => Promise<void> | void;
  onPrintReceipt: () => void;
  onCloseReceipt: () => void;
  receiptAutoPrinted?: boolean;
};

export function PosPaymentModals({
  text,
  lang,
  shiftStatus,
  sellerName,
  receiptLogoPath,
  receiptStoreName,
  receiptStoreAddress,
  receiptStorePhone,
  receiptBranchLabel,
  takeawayCreatingPreview,
  reviewOrder,
  cashReviewOrder,
  transferReviewOrder,
  receiptSession,
  receiptSaving,
  receiptAutoPrinted = false,
  cashSubmitting,
  transferSubmitting,
  transferError,
  transferPaymentMode,
  inetQrEnabled,
  inetQrUrl,
  inetQrStatus,
  inetProviderOrderId,
  promptPayQrUrl,
  cashReceivedInput,
  cashReceivedDisplay,
  cashDiff,
  cashQuickAmounts,
  cashKeypadKeys,
  cashError,
  cashConfirmNeedsAttention,
  formatMoney,
  formatQuantity,
  formatReceiptDateTime,
  renderExternalOrderCode,
  getQuickModeLabel,
  getReceiptPaymentMethodLabel,
  canDeductIngredientForItem,
  ingredientDeductingKey,
  ingredientDeductingMode,
  onCloseReview,
  onCancelFromReview,
  onCancelFromCash,
  onDeductIngredientForItem,
  onOpenCash,
  onOpenTransfer,
  onCloseCash,
  onConfirmCash,
  onApplyQuickCashAmount,
  onAppendCashKeypadValue,
  onClearCashInput,
  onBackspaceCashInput,
  onCloseTransfer,
  onSelectTransferPaymentMode,
  onCreateInetQrPayment,
  onConfirmTransfer,
  onPrintReceipt,
  onCloseReceipt
}: Props) {
  function resolveReceiptDiscountAmount(session: ReceiptSession): number {
    const explicitDiscount = Number(session.discount_amount ?? 0);
    if (Number.isFinite(explicitDiscount) && explicitDiscount > 0) {
      return Number(Math.max(0, explicitDiscount).toFixed(2));
    }
    const cartSubtotal = session.items.reduce((sum, item) => sum + item.quantity * item.price, 0);
    const fallbackDiscount = Math.max(0, cartSubtotal - Number(session.total_amount ?? 0));
    return Number(fallbackDiscount.toFixed(2));
  }

  function getReceiptMemberLabel(session: ReceiptSession): string | null {
    const memberName = session.member_name?.trim();
    const memberPhone = session.member_phone?.trim();
    const memberCode = session.member_code?.trim();
    const points = Number(session.member_points);
    const stamps = Number(session.member_stamps);
    const pointText = Number.isFinite(points) ? `${points} ${lang === "th" ? "คะแนน" : "pts"}` : "";
    const stampText = Number.isFinite(stamps) ? `${stamps} ${lang === "th" ? "แต้ม" : "stamps"}` : "";
    const identity = [memberName, memberCode ? `#${memberCode}` : "", memberPhone].filter(Boolean).join(" / ");
    const balances = [pointText, stampText].filter(Boolean).join(" / ");
    if (!identity && !balances) return null;
    return [identity, balances].filter(Boolean).join(" | ");
  }

  function resolveTaxLines(order: Pick<CheckoutReviewOrder, "tax_lines" | "tax_total"> | null | undefined): TaxLineSnapshot[] {
    if (!order) return [];
    const explicitLines = Array.isArray(order.tax_lines)
      ? order.tax_lines.filter((line) => Number.isFinite(Number(line.amount)) && Math.abs(Number(line.amount)) >= 0.005)
      : [];
    if (explicitLines.length > 0) return explicitLines;
    const taxTotal = Number(order.tax_total ?? 0);
    if (!Number.isFinite(taxTotal) || Math.abs(taxTotal) < 0.005) return [];
    return [
      {
        id: "tax-total",
        label: text.tax ?? (lang === "th" ? "ภาษี" : "Tax"),
        rate_pct: 0,
        mode: taxTotal < 0 ? "deduct_from_bill" : "add_to_bill",
        amount: Number(taxTotal.toFixed(2))
      }
    ];
  }

  function renderTaxSummaryRows(
    order: Pick<CheckoutReviewOrder, "tax_lines" | "tax_total"> | null | undefined,
    className: string,
    element: "div" | "p" = "div"
  ) {
    const Tag = element;
    return resolveTaxLines(order).map((line) => (
      <Tag key={`tax-${line.id}`} className={className}>
        <span>{line.label}</span>
        <strong>
          {line.amount < 0 ? "-" : "+"}
          {formatMoney(Math.abs(line.amount))}
        </strong>
      </Tag>
    ));
  }

  return (
    <>
      {takeawayCreatingPreview ? (
        <div className="posui-payment-modal-backdrop" role="dialog" aria-modal="true" aria-label={text.creatingOrderTitle}>
          <section className="posui-payment-modal posui-payment-modal--review posui-payment-modal--creating">
            <header className="posui-payment-modal__header">
              <h3>{text.creatingOrderTitle}</h3>
            </header>
            <p className="posui-payment-modal__hint">{text.creatingOrderHint}</p>
            <div className="posui-payment-receipt-card">
              <div className="posui-payment-modal__items">
                {takeawayCreatingPreview.items.map((item) => (
                  <div key={`creating-${item.product_id}`} className="posui-payment-modal__item-row">
                    <div className="posui-payment-modal__item-main">
                      <strong className="posui-payment-modal__item-name">{item.name}</strong>
                      <small className="posui-payment-modal__item-meta">
                        {text.reviewQtyPriceLabel}: {formatQuantity(item.quantity)} x {formatMoney(item.price)}
                      </small>
                    </div>
                    <strong className="posui-payment-modal__item-total">{formatMoney(item.price * item.quantity)}</strong>
                  </div>
                ))}
              </div>
              <div className="posui-payment-modal__total">
                <span>{text.reviewGrandTotalLabel}</span>
                <strong>{formatMoney(takeawayCreatingPreview.total_amount)}</strong>
              </div>
            </div>
            <div className="posui-payment-modal__creating-progress" aria-hidden="true" />
          </section>
        </div>
      ) : null}

      {reviewOrder ? (
        <div className="posui-payment-modal-backdrop" role="dialog" aria-modal="true" aria-label={text.reviewBillTitle}>
          <section className="posui-payment-modal posui-payment-modal--review posui-payment-modal--review-bill" onClick={(event) => event.stopPropagation()}>
            <header className="posui-payment-modal__header posui-payment-modal__header--review-bill">
              <div className="posui-payment-modal__title-wrap">
                <span className="posui-payment-modal__review-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none">
                    <path d="M7.25 3.5h9.5a2.75 2.75 0 0 1 2.75 2.75v11.5a2.75 2.75 0 0 1-2.75 2.75h-9.5a2.75 2.75 0 0 1-2.75-2.75V6.25A2.75 2.75 0 0 1 7.25 3.5Z" stroke="currentColor" strokeWidth="1.5" />
                    <path d="M8.5 8h7M8.5 11.5h7M8.5 15h3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </span>
                <div>
                  <h3>{text.reviewBillTitle}</h3>
                  <p className="posui-payment-modal__hint">{text.reviewBillHint}</p>
                </div>
              </div>
              <button type="button" className="posui-btn posui-btn--review-close" onClick={onCloseReview}>
                {text.close}
              </button>
            </header>
            <div className="posui-payment-modal__review-content">
              {renderExternalOrderCode(reviewOrder)}
              <div className="posui-payment-receipt-card">
                <div className="posui-payment-modal__items">
                  <div className="posui-payment-modal__items-head">
                    <span>{text.reviewItemsHeader}</span>
                    <span>{text.reviewQtyHeader ?? "Qty"}</span>
                    <span>{text.reviewLineTotalLabel}</span>
                  </div>
                  {reviewOrder.items.map((item) => (
                    <div key={`${reviewOrder.order_id}-${item.product_id}`} className="posui-payment-modal__item-row">
                      {(() => {
                        const lineKey = `${reviewOrder.order_id}:${item.product_id}`;
                        const isBusy = ingredientDeductingKey === lineKey;
                        const actionLabel = isBusy
                          ? ingredientDeductingMode === "restore"
                            ? text.reviewItemIngredientRestoring
                            : text.reviewItemIngredientDeducting
                          : text.reviewItemIngredientDeductAction;
                        return (
                          <>
                      <div className="posui-payment-modal__item-main">
                        <strong className="posui-payment-modal__item-name">{item.name}</strong>
                        <small className="posui-payment-modal__item-meta">
                          {text.reviewQtyPriceLabel}: {formatQuantity(item.quantity)} x {formatMoney(item.price)}
                        </small>
                        {canDeductIngredientForItem(item.product_id) ? (
                          <button
                            type="button"
                            className="posui-payment-modal__item-ingredient-btn"
                            disabled={isBusy}
                            onClick={() => onDeductIngredientForItem(reviewOrder, item)}
                          >
                            {actionLabel}
                          </button>
                        ) : null}
                      </div>
                      <span className="posui-payment-modal__item-qty">{formatQuantity(item.quantity)}</span>
                      <strong className="posui-payment-modal__item-total">{formatMoney(item.price * item.quantity)}</strong>
                          </>
                        );
                      })()}
                    </div>
                  ))}
                </div>
                {renderTaxSummaryRows(reviewOrder, "posui-payment-modal__tax-row")}
                <div className="posui-payment-modal__total">
                  <span>{text.reviewGrandTotalLabel}</span>
                  <strong>{formatMoney(reviewOrder.total_amount)}</strong>
                </div>
              </div>
            </div>
            <div className="posui-payment-modal__actions posui-payment-modal__actions--review-bill">
              <button type="button" className="posui-btn posui-btn--review-cancel" onClick={() => onCancelFromReview(reviewOrder)}>
                {text.cancelBill}
              </button>
              <button type="button" className="posui-btn posui-btn--review-cash" onClick={() => onOpenCash(reviewOrder)}>
                {text.paymentCash}
              </button>
              <button type="button" className="posui-btn posui-btn--review-transfer" onClick={() => onOpenTransfer(reviewOrder)}>
                {text.paymentTransfer}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {cashReviewOrder ? (
        <div className="posui-payment-modal-backdrop" role="dialog" aria-modal="true" aria-label={text.cashReceiveTitle}>
          <section className="posui-payment-modal posui-payment-modal--cash" onClick={(event) => event.stopPropagation()}>
            <header className="posui-payment-modal__header">
              <h3>{text.cashReceiveTitle}</h3>
              <button type="button" className="posui-btn" onClick={onCloseCash} disabled={cashSubmitting}>
                {text.close}
              </button>
            </header>
            <p className="posui-payment-modal__hint">{text.cashReceiveHint}</p>
            {renderExternalOrderCode(cashReviewOrder)}
            <div className="posui-cash-layout">
              <section className="posui-cash-panel">
                <div className="posui-cash-summary-row posui-cash-summary-row--due">
                  <span>{text.paymentTotalDue}</span>
                  <strong>{formatMoney(cashReviewOrder.total_amount)}</strong>
                </div>
                {renderTaxSummaryRows(cashReviewOrder, "posui-cash-summary-row posui-cash-summary-row--tax")}
                <div className="posui-cash-summary-row posui-cash-summary-row--received" aria-live="polite" aria-label={text.cashReceivedLabel}>
                  <span>{text.cashReceivedLabel}</span>
                  <strong className={cashReceivedInput ? "" : "is-placeholder"}>{cashReceivedDisplay}</strong>
                </div>
                <div className="posui-cash-quick">
                  <span>{text.cashQuickBlocksLabel}</span>
                  <div className="posui-cash-quick__grid">
                    {cashQuickAmounts.map((amount) => (
                      <button key={amount} type="button" className="posui-btn posui-cash-quick__btn" onClick={() => onApplyQuickCashAmount(amount)} disabled={cashSubmitting}>
                        {`฿${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="posui-cash-summary-row posui-cash-summary-row--accent">
                  <span>{cashDiff >= 0 ? text.cashChange : text.cashRemaining}</span>
                  <strong>{formatMoney(Math.abs(cashDiff))}</strong>
                </div>
              </section>
              <section className="posui-cash-keypad" aria-label={text.cashKeypadTitle}>
                <p className="posui-cash-keypad__label">{text.cashKeypadTitle}</p>
                <div className="posui-cash-keypad__grid">
                  {cashKeypadKeys.map((key) => (
                    <button key={key} type="button" className="posui-btn posui-cash-keypad__key" onClick={() => onAppendCashKeypadValue(key)} disabled={cashSubmitting}>
                      {key}
                    </button>
                  ))}
                </div>
                <div className="posui-cash-keypad__foot">
                  <button type="button" className="posui-btn posui-cash-keypad__cmd" onClick={onClearCashInput} disabled={cashSubmitting}>
                    {text.cashKeyClear}
                  </button>
                  <button type="button" className="posui-btn posui-cash-keypad__cmd" onClick={onBackspaceCashInput} disabled={cashSubmitting}>
                    {text.cashKeyBackspace}
                  </button>
                </div>
              </section>
            </div>
            {cashError ? <p className="posui-payment-modal__error">{cashError}</p> : null}
            <div className="posui-payment-modal__actions posui-payment-modal__actions--cash">
              <button type="button" className="posui-btn posui-btn--danger posui-btn--cash-cancel" onClick={() => onCancelFromCash(cashReviewOrder)} disabled={cashSubmitting}>
                {text.cancelBill}
              </button>
              <button
                type="button"
                className={`posui-btn posui-btn--primary posui-btn--cash-confirm ${cashConfirmNeedsAttention ? "posui-btn--cash-confirm-warn" : ""}`}
                onClick={() => void onConfirmCash()}
                disabled={cashSubmitting}
              >
                {cashSubmitting ? text.submitting : text.cashConfirm}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {transferReviewOrder ? (
        <div className="posui-payment-modal-backdrop" role="dialog" aria-modal="true" aria-label={text.transferTitle}>
          <section className="posui-payment-modal posui-payment-modal--transfer-qr-only" onClick={(event) => event.stopPropagation()}>
            <header className="posui-payment-modal__header">
              <h3>{text.transferTitle}</h3>
              <button
                type="button"
                className="posui-transfer-modal__close"
                onClick={onCloseTransfer}
                disabled={transferSubmitting}
                aria-label={text.close}
              >
                <span aria-hidden="true">x</span>
              </button>
            </header>
            <div className="posui-transfer-layout">
              <section className="posui-transfer-qr-panel">
                <div className="posui-transfer-amount-card">
                  <span>{text.transferPromptPayAmountLabel}</span>
                  <strong>{formatMoney(transferReviewOrder.total_amount)}</strong>
                  {renderTaxSummaryRows(transferReviewOrder, "posui-transfer-tax-row")}
                </div>
                <h4 className="posui-transfer-section-title">{text.transferQrTitle}</h4>
                {inetQrEnabled ? (
                  <div className="posui-transfer-provider-toggle">
                    <button
                      type="button"
                      className={transferPaymentMode === "manual" ? "is-active" : ""}
                      onClick={() => onSelectTransferPaymentMode("manual")}
                      disabled={transferSubmitting}
                    >
                      {text.transferManualMode}
                    </button>
                    <button
                      type="button"
                      className={transferPaymentMode === "inet_nops" ? "is-active" : ""}
                      onClick={() => onSelectTransferPaymentMode("inet_nops")}
                      disabled={transferSubmitting}
                    >
                      {text.transferInetMode}
                    </button>
                  </div>
                ) : null}
                {transferPaymentMode === "inet_nops" ? (
                  inetQrUrl ? (
                    <div className="posui-transfer-qr-box">
                      <Image
                        src={inetQrUrl}
                        alt={`${text.transferInetQrTitle} ${formatMoney(transferReviewOrder.total_amount)}`}
                        className="posui-transfer-qr-image"
                        width={320}
                        height={320}
                        unoptimized
                      />
                    </div>
                  ) : (
                    <p className="posui-transfer-mobile-hint">{text.transferInetNotCreated}</p>
                  )
                ) : promptPayQrUrl ? (
                  <div className="posui-transfer-qr-box">
                    <Image
                      src={promptPayQrUrl}
                      alt={`${text.transferQrTitle} ${formatMoney(transferReviewOrder.total_amount)}`}
                      className="posui-transfer-qr-image"
                      width={320}
                      height={320}
                      unoptimized
                    />
                  </div>
                ) : (
                  <div className="rounded-2xl border border-orange-200 bg-orange-50 p-5 text-center shadow-sm" role="alert">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-orange-500 text-xl font-black text-white" aria-hidden="true">
                      !
                    </div>
                    <strong className="mt-3 block text-base font-black text-orange-950">{text.transferPaymentSettingsRequiredTitle}</strong>
                    <p className="mt-2 text-sm font-semibold leading-6 text-orange-800">{text.transferPaymentSettingsRequiredBody}</p>
                    <button type="button" className="posui-btn posui-btn--primary mt-4" onClick={onCloseTransfer} disabled={transferSubmitting}>
                      {text.transferPaymentSettingsRequiredClose}
                    </button>
                  </div>
                )}
                {transferPaymentMode === "manual" && !promptPayQrUrl ? null : (
                  <p className="posui-transfer-mobile-hint">
                    {transferPaymentMode === "inet_nops"
                      ? inetQrStatus === "paid"
                        ? text.transferInetPaid
                        : inetQrStatus === "pending"
                          ? text.transferInetWaiting
                          : text.transferInetHint
                      : text.transferScanWithPhone}
                  </p>
                )}
                {transferPaymentMode === "inet_nops" && inetProviderOrderId ? (
                  <p className="posui-transfer-mobile-hint">{`${text.transferInetOrderRef}: ${inetProviderOrderId}`}</p>
                ) : null}
                {transferError ? <p className="posui-payment-modal__error posui-payment-modal__error--transfer">{transferError}</p> : null}
                <div className="posui-payment-modal__actions posui-payment-modal__actions--transfer">
                  {transferPaymentMode === "inet_nops" ? (
                    <button
                      type="button"
                      className="posui-btn posui-btn--primary"
                      onClick={() => void onCreateInetQrPayment()}
                      disabled={transferSubmitting || inetQrStatus === "creating" || inetQrStatus === "pending" || inetQrStatus === "paid"}
                    >
                      {inetQrStatus === "creating" ? text.submitting : inetQrUrl ? text.transferInetRetryQr : text.transferInetCreateQr}
                    </button>
                  ) : (
                    promptPayQrUrl ? (
                      <button type="button" className="posui-btn posui-btn--primary" onClick={() => void onConfirmTransfer()} disabled={transferSubmitting}>
                        {transferSubmitting ? text.submitting : text.transferConfirm}
                      </button>
                    ) : (
                      <button type="button" className="posui-btn" onClick={onCloseTransfer} disabled={transferSubmitting}>
                        {text.transferPaymentSettingsRequiredClose}
                      </button>
                    )
                  )}
                </div>
              </section>
            </div>
          </section>
        </div>
      ) : null}

      {receiptSession ? (
        <div className="posui-payment-modal-backdrop" role="dialog" aria-modal="true" aria-label={text.receiptTitle}>
          <section className="posui-payment-modal posui-payment-modal--receipt" onClick={(event) => event.stopPropagation()}>
            <header className="posui-payment-modal__header">
              <h3>{text.receiptTitle}</h3>
              <button type="button" className="posui-btn" onClick={onCloseReceipt}>
                {text.receiptClose}
              </button>
            </header>
            <article className="posui-receipt-card-preview" aria-label={text.receiptTitle}>
              <header className="posui-receipt-card-preview__head">
                <ReceiptLogoImage src={receiptLogoPath} alt="Receipt logo" className="posui-receipt-card-preview__logo" />
                <h4>{receiptStoreName}</h4>
                {receiptStoreAddress ? <p>{receiptStoreAddress}</p> : null}
                {receiptStorePhone ? <p>{receiptStorePhone}</p> : null}
                <p>{receiptBranchLabel}</p>
              </header>
              <div className="posui-receipt-card-preview__divider" />
              <div className="posui-receipt-card-preview__meta">
                <p><span>{text.sellerName}</span><span>:</span><strong>{sellerName}</strong></p>
                <p><span>{text.shiftName}</span><span>:</span><strong>{shiftStatus ?? "-"}</strong></p>
                <p><span>{text.modeLabel}</span><span>:</span><strong>{getQuickModeLabel()}</strong></p>
                <p><span>{text.billNo}</span><span>:</span><strong>{receiptSession.order_no}</strong></p>
                {receiptSession.external_order_code ? (
                  <p><span>{text.externalCode}</span><span>:</span><strong>{receiptSession.external_order_code}</strong></p>
                ) : null}
                {getReceiptMemberLabel(receiptSession) ? (
                  <p><span>{lang === "th" ? "สมาชิก" : "Member"}</span><span>:</span><strong>{getReceiptMemberLabel(receiptSession)}</strong></p>
                ) : null}
                <p><span>{text.date}</span><span>:</span><strong>{formatReceiptDateTime(receiptSession.created_at, lang)}</strong></p>
              </div>
              <div className="posui-receipt-card-preview__divider" />
              <div className="posui-receipt-card-preview__items">
                <div className="posui-receipt-card-preview__items-head">
                  <span>{lang === "th" ? "รายการสินค้า" : "Item"}</span>
                  <span>{text.reviewQtyHeader ?? "Qty"}</span>
                  <span>{lang === "th" ? "ราคารวม" : "Total"}</span>
                </div>
                {receiptSession.items.map((item) => {
                  const details = parseReceiptItemNotes(item.notes);
                  return (
                    <div key={`receipt-${receiptSession.order_id}-${item.product_id}-${item.notes ?? ""}`} className="posui-receipt-card-preview__item">
                      <div className="posui-receipt-card-preview__item-main">
                        <strong>{item.name}</strong>
                        <small>x {formatMoney(item.price)}</small>
                        {details.choices.map((choice) => (
                          <small key={`receipt-choice-${item.product_id}-${choice}`} className="posui-receipt-card-preview__detail">+ {choice}</small>
                        ))}
                        {details.note ? <small className="posui-receipt-card-preview__detail">{text.notes}: {details.note}</small> : null}
                      </div>
                      <span className="posui-receipt-card-preview__qty">{formatQuantity(item.quantity)}</span>
                      <strong className="posui-receipt-card-preview__item-total">{formatMoney(item.quantity * item.price)}</strong>
                    </div>
                  );
                })}
              </div>
              <div className="posui-receipt-card-preview__divider" />
              <footer className="posui-receipt-card-preview__summary">
                <p><span>{text.paymentMethod}</span><strong>{getReceiptPaymentMethodLabel(receiptSession)}</strong></p>
                <p><span>{text.discount}</span><strong>{formatMoney(resolveReceiptDiscountAmount(receiptSession))}</strong></p>
                {renderTaxSummaryRows(receiptSession, "", "p")}
                <p><span>{text.paymentTotalDue}</span><strong>{formatMoney(receiptSession.total_amount)}</strong></p>
                {receiptSession.payment_method === "cash" ? (
                  <>
                    <p><span>{text.cashReceivedLabel}</span><strong>{formatMoney(receiptSession.cash_received)}</strong></p>
                    <p><span>{text.cashChange}</span><strong>{formatMoney(receiptSession.change_amount)}</strong></p>
                  </>
                ) : null}
              </footer>
            </article>
            {!receiptAutoPrinted ? (
              <div className="posui-payment-modal__actions posui-payment-modal__actions--cash">
                <button
                  type="button"
                  className="posui-btn posui-btn--primary"
                  onClick={onPrintReceipt}
                  disabled={receiptSaving}
                >
                  {text.receiptPrint}
                </button>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}
    </>
  );
}
