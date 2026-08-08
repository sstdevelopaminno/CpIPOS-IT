"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent } from "react";
import Image from "next/image";
import type { OrderType } from "@pos/shared-types";
import { ErrorState, LoadingState } from "@/components/backoffice/list-state";
import { PosHeldBillsModal } from "@/components/pos/pos-held-bills-modal";
import { PosBuffetPricePickerModal } from "@/components/pos/pos-buffet-price-picker-modal";
import { PosBuffetTableModeButton } from "@/components/pos/features/pos-buffet-table-mode-button";
import { PosMemberMaintenanceModal } from "@/components/pos/pos-member-maintenance-modal";
import { PosPaymentModals } from "@/components/pos/pos-payment-modals";
import { PosProductCatalog } from "@/components/pos/pos-product-catalog";
import { PosRealtimeClock } from "@/components/pos/pos-realtime-clock";
import { TableQrOrderModal } from "@/components/pos/table-qr-order-modal";
import { buildCheckoutSubmitPayload, buildReviewOrder, getCheckoutBlockingReason, shouldSkipDineInSubmit } from "@/components/pos/features/checkout-flow";
import { applyStagedDeliveryToHeldBills, buildNewStagedDeliveryHeldBill, getDeliveryStageBlockingReason } from "@/components/pos/features/delivery-flow";
import { runPendingPaymentRetry, runPendingSubmitRetry } from "@/components/pos/features/retry-flow";
import { appendConfirmedBuffetItem, isTableSalesMode, orderTypeForQuickMode, type BuffetTablePickerState } from "@/components/pos/features/buffet-table-sales-wire";
import { extractApiErrorCode, isConflictErrorCode, isConnectivityIssueMessage, localizeApiErrorMessage } from "@/components/pos/pos-sales-errors";
import { dequeuePendingItem, enqueuePendingItem, markPendingItemFailed } from "@/components/pos/features/pending-queue";
import { PosTableBrowser } from "@/components/pos/pos-table-browser";
import { PosCartDrawer } from "@/components/pos-ui/pos-cart-drawer";
import { PosCartPanel } from "@/components/pos-ui/pos-cart-panel";
import { PosCategoryNav } from "@/components/pos-ui/pos-category-nav";
import { PosManagerApprovalModal } from "@/components/pos-ui/pos-manager-approval-modal";
import { PosPaymentPanel } from "@/components/pos-ui/pos-payment-panel";
import { PosShell } from "@/components/pos-ui/pos-shell";
import { PackageLockDialog } from "@/components/pos-preview/package-lock-dialog";
import { sendPendingDeliveryBillNowWithEffects, submitOrderWithEffects, submitTransferPaymentWithEffects } from "@/components/pos/services/pos-sales-service-module";
import { TableZoneTabs } from "@/components/tables/table-zone-tabs";
import type { DiningTableItem, FloorPlanObjectItem, TableZoneItem } from "@/components/tables/types";
import { calculateDeliveryPricingBreakdown } from "@/lib/delivery-pricing";
import { POS_MODE_FEATURES } from "@/lib/pos-feature-map";
import { beginPosActionTrace, clearPosTraceEvents, endPosActionTrace, readPosTraceEvents, usePosRenderProfiler } from "@/lib/pos-ui-profiler";
import { naturalCompareTableCode } from "@/lib/table-management";
import { cachePosSalesOfflineCatalogSnapshot } from "@/lib/pos-offline-catalog-snapshot";

type Lang = "th" | "en";
type QuickMode = "home" | "dine_in" | "delivery" | "buffet_table";
type TableViewMode = "list" | "floor";

const POS_TABLE_VIEW_MODE_STORAGE_KEY = "pos_table_view_mode_v1";
const POS_PRODUCT_ORDER_STORAGE_KEY = "pos_product_order_v1";

type ProductRow = {
  id: string;
  sku: string;
  name: string;
  category: string;
  price: number;
  is_active: boolean;
  stock_deduction_mode?: "unit_only" | "recipe_deduction";
  has_recipe_deduction?: boolean;
  stock_on_hand_units?: number | null;
  is_out_of_stock?: boolean;
};

type DeliveryChannelConfigRow = {
  channel: string;
  commission_rate_pct: number;
  commission_vat_rate_pct: number;
  order_code_rule?: "free_text" | "regex";
  order_code_regex?: string | null;
  source_url?: string | null;
};

type StoreProfile = {
  display_name?: string | null;
  name?: string | null;
  logo_url?: string | null;
  company_address?: string | null;
  contact_phone?: string | null;
};

type PaymentAccountSnapshot = {
  id: string;
  branch_id: string;
  bank_name: string;
  account_name: string;
  account_number: string;
  promptpay_phone: string;
  promptpay_payload: string;
  qr_image_url: string;
  qr_mode: "promptpay_link" | "qr_image";
  applies_to_all_branches: boolean;
  is_active: boolean;
};

type PaymentProvidersSnapshot = {
  inet_nops?: {
    is_active: boolean;
    environment: "uat" | "production";
  } | null;
};

type TaxLineMode = "add_to_bill" | "deduct_from_bill";

type TaxLineSettings = {
  id: string;
  label: string;
  rate_pct: number;
  mode: TaxLineMode;
  is_active: boolean;
};

type TaxLineSnapshot = {
  id: string;
  label: string;
  rate_pct: number;
  mode: string;
  is_active?: boolean;
  amount: number;
};

type TaxSettings = {
  is_enabled: boolean;
  calculation_base: "net_after_discount";
  lines: TaxLineSettings[];
};

type TableQrNotificationSettings = {
  table_qr_popup_enabled: boolean;
  table_qr_sound_enabled: boolean;
  table_qr_sound_volume: number;
};

const DEFAULT_TAX_SETTINGS: TaxSettings = {
  is_enabled: false,
  calculation_base: "net_after_discount",
  lines: []
};

const DEFAULT_TABLE_QR_NOTIFICATION_SETTINGS: TableQrNotificationSettings = {
  table_qr_popup_enabled: true,
  table_qr_sound_enabled: true,
  table_qr_sound_volume: 0.8
};

type PosSalesDevicePolicy = {
  id: string | null;
  code: string | null;
  name: string | null;
  status: "active" | "inactive" | "maintenance" | "unknown";
  block_sales: boolean;
  reason_code: string | null;
};

type PosSalesSnapshot = {
  tenant_id?: string;
  branch_id?: string;
  products?: ProductRow[];
  categories?: string[];
  shift?: ShiftRow;
  operator_name?: string;
  branch_name?: string;
  store_profile?: StoreProfile | null;
  payment_account?: PaymentAccountSnapshot | null;
  payment_providers?: PaymentProvidersSnapshot | null;
  tax_settings?: TaxSettings | null;
  notification_settings?: TableQrNotificationSettings | null;
  inventory_settings?: { allow_negative_stock?: boolean } | null;
  device_policy?: PosSalesDevicePolicy | null;
  delivery_configs?: DeliveryChannelConfigRow[];
  delivery_prices_by_product?: Record<string, Record<string, number>>;
};

type ShiftRow = {
  id: string;
  status: string;
  opened_at: string;
  opening_cash: number;
} | null;

type CartItem = {
  cart_line_id?: string;
  product_id: string;
  name: string;
  quantity: number;
  price: number;
  notes?: string | null;
};

type ReceiptItemDetails = {
  choices: string[];
  note: string | null;
};

type ModifierDraft = {
  product: ProductRow;
  quantity: number;
  notes: string;
  extraPrice: number;
  linkedIngredientQuantity: number;
  editingCartLineId?: string | null;
};

type RecipeIngredientChoice = {
  ingredient_id: string;
  name: string;
  base_unit: string;
  quantity_per_item: number;
  quantity_on_hand: number;
};

type PosMemberChoice = {
  id: string;
  name: string;
  phone: string;
  email?: string;
  member_token?: string;
  points: number;
  stamps: number;
};

type ReviewItemIngredientOption = {
  ingredient_id: string;
  ingredient_name: string;
  required_grams: number;
  restorable_grams?: number;
  available_grams?: number;
};

type PendingSubmit = {
  idempotencyKey: string;
  payload: {
    order_id?: string;
    shift_id: string;
    order_type: OrderType;
    channel: string;
    table_id?: string;
    customer_name?: string;
    external_order_code?: string;
    member_name?: string;
    member_phone?: string;
    member_code?: string;
    member_points?: number;
    member_stamps?: number;
    notes?: string;
    app_total_amount: number;
    discount_amount?: number;
    gp_amount?: number;
    tax_total?: number;
    grand_total?: number;
    tax_lines?: Array<{ id: string; label: string; rate_pct: number; mode: string; amount: number }>;
    items: Array<{ product_id: string; quantity: number; unit_price?: number; notes?: string | null }>;
  };
};

type PendingSubmitQueueItem = PendingSubmit & {
  queued_at: string;
  retry_count: number;
  last_error?: string | null;
};

type PendingPaymentSubmit = {
  idempotencyKey: string;
  payload: {
    order_id: string;
    order_no: string;
    order_type: OrderType;
    total_amount: number;
    method: "bank_transfer";
    reference_no?: string | null;
    transfer_verification_id?: string | null;
    transfer_override_approval_id?: string | null;
    skip_transfer_verification?: boolean;
    receipt_items?: CartItem[];
    discount_amount?: number;
    tax_total?: number;
    tax_lines?: TaxLineSnapshot[];
  };
};

type PendingPaymentQueueItem = PendingPaymentSubmit & {
  queued_at: string;
  retry_count: number;
  last_error?: string | null;
};

type ActiveOrder = {
  id: string;
  order_no: string;
  status: string;
  order_type?: OrderType;
  channel?: string | null;
  external_order_code?: string | null;
  member_name?: string | null;
  member_phone?: string | null;
  member_code?: string | null;
  member_points?: number | null;
  member_stamps?: number | null;
  total_amount?: number;
  tax_total?: number | null;
  tax_lines?: TaxLineSnapshot[];
  table_id?: string | null;
  created_at?: string;
  updated_existing?: boolean;
};

type CheckoutReviewOrder = {
  order_id: string;
  order_no: string;
  order_type?: OrderType;
  channel?: string | null;
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
  store_profile?: StoreProfile | null;
};

type TransferPaymentMode = "manual" | "inet_nops";

type InetPaymentIntentState = {
  payment_intent_id: string;
  provider_order_id: string;
  qr_code: string;
  amount: number;
  status: "pending" | "paid" | "failed" | "expired" | "cancelled";
};

type TakeawayCreatingPreview = {
  items: CartItem[];
  total_amount: number;
};

type BranchMonitor = {
  level: "ok" | "warn" | "critical";
  queued_orders: number;
  queued_orders_stale: number;
  order_queue_limit: number;
  print_queue_depth: number;
  print_queue_limit: number;
  print_failed_recent: number;
  dead_letters_recent: number;
  api_errors_recent_total?: number;
  api_errors_4xx_recent?: number;
  api_errors_409_recent?: number;
  api_errors_5xx_recent?: number;
  api_error_routes_top?: Array<{ route: string; count: number }>;
  latest_payment_at: string | null;
  server_time: string;
};

type DeliveryPendingStatus = "pending" | "editing" | "sending" | "sent" | "cancelled";

type DeliveryPendingStatusHistoryEntry = {
  status: DeliveryPendingStatus;
  at: string;
  note?: string | null;
};

type HeldBill = {
  id: string;
  held_at: string;
  label: string;
  source_order_id?: string | null;
  source_order_status?: string | null;
  order_type: OrderType;
  table_id?: string | null;
  table_code?: string | null;
  delivery_app_id?: DeliveryApp["id"] | null;
  delivery_external_code?: string | null;
  delivery_customer_name?: string | null;
  delivery_notes?: string | null;
  queue_status?: DeliveryPendingStatus;
  status_history?: DeliveryPendingStatusHistoryEntry[];
  items: CartItem[];
  subtotal: number;
  discount_amount?: number;
};

type DeliveryApp = {
  id: "lineman" | "grabfood" | "shopeefood";
  nameTh: string;
  nameEn: string;
  orderPrefix: string;
  logoOfficial: string;
  logoFallback: string;
};

type DeliveryFlowState = "create" | "edit" | "confirm_payment" | "cancelled" | "pending_dispatch" | "completed";
type BillPaymentMethod = "cash" | "bank_transfer" | null;

type ApiErrorBody = {
  error?: {
    code?: string;
    message?: string;
  };
};

type PosPaymentResponseBody = ApiErrorBody & {
  data?: {
    print_jobs_queued?: number | null;
  };
};

type SlipExtractPayload = {
  payer_name: string | null;
  payee_name: string | null;
  amount: number | null;
  transfer_datetime: string | null;
  transaction_id: string | null;
  reference_no: string | null;
  confidence: number | null;
};

type SlipVerifyChecks = {
  amount_match: boolean;
  payee_match: boolean;
  datetime_present: boolean;
  confidence_pass: boolean;
  passed: boolean;
  issues: string[];
};

type SlipVerifyResponseBody = ApiErrorBody & {
  data?: {
    verification_id: string;
    parsed: SlipExtractPayload;
    checks: SlipVerifyChecks;
  };
};

type BluetoothReceiptPrintResponseBody = ApiErrorBody & {
  data?: {
    ok?: boolean;
    code?: string;
    message?: string;
    action?: string;
    timestamp?: string;
    data?: {
      fallback_to_browser_print?: boolean;
      jobs?: Array<{
        id: string;
        status: "pending" | "printing" | "printed" | "failed" | "retrying";
        last_error: string | null;
        printed_at: string | null;
      }>;
    };
  };
};

type TableBillSessionPayload = {
  id: string;
  table_id: string;
  order_id: string | null;
  status: "open" | "ordering" | "pending_payment" | "closed" | "cancelled";
  opened_at: string;
  closed_at: string | null;
  metadata?: Record<string, unknown>;
};

type TableBillOrderPayload = {
  id: string;
  order_no: string;
  order_type?: OrderType;
  channel?: string | null;
  external_order_code?: string | null;
  total_amount?: number;
  tax_total?: number | null;
  metadata?: Record<string, unknown> | null;
  status: string;
  table_id: string | null;
  created_at: string;
};

type TableBillItemPayload = {
  id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  notes: string | null;
  products?: { name?: string | null } | Array<{ name?: string | null }> | null;
};

type TableBillTransferVerificationPayload = {
  id: string;
  order_id: string;
  verification_status: "passed" | "failed" | "override_passed" | "error";
  expected_amount: number;
  parsed_amount: number | null;
  parsed_reference_no: string | null;
  parsed_transaction_id: string | null;
  parsed_payer_name: string | null;
  parsed_payee_name: string | null;
  expected_payee_name: string | null;
  checks?: Record<string, unknown> | null;
  issues?: unknown;
  error_message: string | null;
  override_approval_id: string | null;
  verified_at: string;
};

type TableBillPaymentPayload = {
  id: string;
  method?: string | null;
  amount?: number;
  reference_no?: string | null;
  received_at?: string;
};

type TableBillResponseBody = ApiErrorBody & {
  data?: {
    session: TableBillSessionPayload | null;
    order: TableBillOrderPayload | null;
    items: TableBillItemPayload[];
    payments: TableBillPaymentPayload[];
    transfer_verifications: TableBillTransferVerificationPayload[];
  };
};

type TableBillDataPayload = NonNullable<TableBillResponseBody["data"]>;
type PosRecipeProductsResponseBody = ApiErrorBody & {
  data?: {
    product_ids?: string[];
  };
};

const CART_KEY = "pos_sales_cart_v012";
const PENDING_KEY = "pos_pending_submit_v012";
const PENDING_QUEUE_KEY = "pos_pending_submit_queue_v001";
const PENDING_PAYMENT_QUEUE_KEY = "pos_pending_payment_queue_v001";
const HELD_BILLS_KEY = "pos_held_bills_v001";
const SALES_SNAPSHOT_KEY = "pos_sales_snapshot_v001";
const ACTIVE_ORDER_KEY = "pos_active_order_v001";
const DINE_IN_DRAFT_KEY = "pos_dine_in_draft_v001";
const DINE_IN_SELECTED_TABLE_KEY = "pos_dine_in_selected_table_v001";
const TABLE_QR_ACTIVITY_SEEN_KEY = "pos_table_qr_activity_seen_v001";
const TABLE_QR_ORDER_POLL_LOOKBACK_MS = 15_000;
const TABLE_QR_ORDER_CURSOR_SKEW_MS = 2_000;

function buildTableQrOrderPollCursor(latestEventAt?: string | null): string {
  const latestEventMs = latestEventAt ? new Date(latestEventAt).getTime() : Number.NaN;
  if (Number.isFinite(latestEventMs)) {
    return new Date(Math.max(0, latestEventMs - TABLE_QR_ORDER_CURSOR_SKEW_MS)).toISOString();
  }
  return new Date(Date.now() - TABLE_QR_ORDER_POLL_LOOKBACK_MS).toISOString();
}
const POS_SCOPE_KEY = "pos_scope_v001";
const POS_PROMPTPAY_PHONE_KEY = "pos_promptpay_phone_v001";
const POS_TAX_SETTINGS_UPDATED_EVENT = "pos:tax-settings-updated";
const POS_TAX_SETTINGS_UPDATED_KEY = "pos_tax_settings_updated_at_v001";
const POS_PAYMENT_SETTINGS_UPDATED_EVENT = "pos:payment-settings-updated";
const POS_PAYMENT_SETTINGS_UPDATED_KEY = "pos_payment_settings_updated_at_v001";
const DEFAULT_PROMPTPAY_PHONE = process.env.NEXT_PUBLIC_PROMPTPAY_PHONE ?? "0843374982";
const DEFAULT_PROMPTPAY_PAYEE = process.env.NEXT_PUBLIC_PROMPTPAY_PAYEE_NAME ?? "";
const DELIVERY_ACTION_DEBOUNCE_MS = 450;
const DELIVERY_ACTION_RETRY_LIMIT = 2;
const DELIVERY_ACTION_BACKOFF_MS = 300;
const DELIVERY_ACTION_BUSY_ERROR = "POS_DELIVERY_ACTION_BUSY";

function normalizeProductId(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

function parseIngredientApiMessage(message: string): {
  kind: "insufficient_stock" | "restore_exceeds_deducted" | "ingredient_not_found" | null;
  ingredientId: string;
} {
  const raw = String(message ?? "");
  const readToken = (token: string) => {
    const regex = new RegExp(`${token}:([^\\s,()]+)`, "i");
    const matched = raw.match(regex);
    return matched?.[1]?.trim() ?? "";
  };
  const insufficientId = readToken("INSUFFICIENT_STOCK");
  if (insufficientId) {
    return { kind: "insufficient_stock", ingredientId: insufficientId };
  }
  const restoreId = readToken("RESTORE_EXCEEDS_DEDUCTED");
  if (restoreId) {
    return { kind: "restore_exceeds_deducted", ingredientId: restoreId };
  }
  const missingId = readToken("INGREDIENT_NOT_FOUND");
  if (missingId) {
    return { kind: "ingredient_not_found", ingredientId: missingId };
  }
  return { kind: null, ingredientId: "" };
}

function formatIngredientAdjustApiError(args: {
  message: string;
  mode: "deduct" | "restore";
  options: ReviewItemIngredientOption[];
  text: any;
}): string {
  const { message, mode, options, text } = args;
  const raw = String(message ?? "");
  const parsed = parseIngredientApiMessage(raw);
  if (!parsed.kind) return raw;
  const option = options.find((entry) => String(entry.ingredient_id) === parsed.ingredientId);
  const ingredientLabel = option?.ingredient_name?.trim() || "";
  if (parsed.kind === "insufficient_stock") {
    return ingredientLabel ? `${text.reviewItemIngredientInsufficientStock}: ${ingredientLabel}` : text.reviewItemIngredientInsufficientStock;
  }
  if (parsed.kind === "restore_exceeds_deducted") {
    return ingredientLabel ? `${text.reviewItemIngredientRestoreExceeds}: ${ingredientLabel}` : text.reviewItemIngredientRestoreExceeds;
  }
  if (parsed.kind === "ingredient_not_found") {
    return ingredientLabel ? `INGREDIENT_NOT_FOUND: ${ingredientLabel}` : "INGREDIENT_NOT_FOUND";
  }
  return mode === "restore" ? text.reviewItemIngredientRestoreExceeds : raw;
}

function sanitizeSubmitMessage(args: {
  message: string | null;
  text: any;
  ingredientOptions: ReviewItemIngredientOption[];
}): string | null {
  const { message, text, ingredientOptions } = args;
  if (!message) return message;
  const raw = String(message);
  const parsed = parseIngredientApiMessage(raw);
  if (!parsed.kind) return message;
  const ingredient = ingredientOptions.find((entry) => String(entry.ingredient_id) === parsed.ingredientId);
  const ingredientLabel = ingredient?.ingredient_name?.trim() || "";
  if (parsed.kind === "insufficient_stock") {
    return ingredientLabel ? `${text.reviewItemIngredientInsufficientStock}: ${ingredientLabel}` : text.reviewItemIngredientInsufficientStock;
  }
  if (parsed.kind === "restore_exceeds_deducted") {
    return ingredientLabel ? `${text.reviewItemIngredientRestoreExceeds}: ${ingredientLabel}` : text.reviewItemIngredientRestoreExceeds;
  }
  if (parsed.kind === "ingredient_not_found") {
    return ingredientLabel ? `INGREDIENT_NOT_FOUND: ${ingredientLabel}` : "INGREDIENT_NOT_FOUND";
  }
  return message;
}

const uiText = {
  th: {
    modeLabel: "โหมด",
    salesInfoTitle: "ข้อมูลการขาย",
    sellerName: "ชื่อผู้ขาย",
    branchName: "สาขา",
    shiftName: "กะ",
    cashierDeviceCode: "รหัสเครื่องแคช",
    date: "วันที่",
    time: "เวลา",
    goHome: "กลับบ้าน",
    dineIn: "นั่งโต๊ะ",
    delivery: "เดลิเวอรี่",
    deliveryMaintenanceTitle: "เดลิเวอรี่",
    deliveryMaintenanceMessage: "อยู่ระหว่างพัฒนาระบบร่วมกับฝ่ายเดลิเวอรี่",
    switchMode: "เลือกโหมด",
    selectMode: "เลือกโหมดการขาย",
    selectModeHint: "เลือกวิธีรับออเดอร์ที่ต้องการใช้งาน",
    currentMode: "โหมดปัจจุบัน",
    previewMode: "หน้าขาย POS",
    shift: "กะ",
    noShift: "ยังไม่เปิดกะ",
    deviceBlockedInactiveTitle: "เครื่องแคชเชียร์ถูกปิดใช้งาน",
    deviceBlockedInactiveBody: "สถานะเครื่องนี้ถูกตั้งเป็นปิดใช้งานจากเมนูเพิ่มเครื่องแคชเชียร์ ระบบจึงปิดการกดขายและชำระเงินทั้งหมดบนเครื่องนี้",
    deviceBlockedMaintenanceTitle: "เครื่องแคชเชียร์อยู่ระหว่างบำรุงรักษา",
    deviceBlockedMaintenanceBody: "สถานะเครื่องนี้ถูกตั้งเป็นบำรุงรักษา ระบบจึงพักหน้าขายไว้ชั่วคราวจนกว่าผู้ดูแลจะเปิดใช้งานอีกครั้ง",
    deviceBlockedStatusLabel: "สถานะเครื่อง",
    deviceBlockedCodeLabel: "รหัสเครื่อง",
    deviceBlockedActionHint: "กลับไปที่ตั้งค่า > เพิ่มเครื่องแคชเชียร์ เพื่อเปลี่ยนสถานะเครื่อง หรือใช้งานเครื่องอื่น",
    network: "เครือข่าย",
    online: "ออนไลน์",
    offline: "ออฟไลน์",
    customerName: "ชื่อลูกค้า",
    externalCode: "รหัสออเดอร์ภายนอก",
    manageMenu: "จัดการเมนู",
    cart: "รายการสินค้า",
    items: "รายการ",
    clear: "ล้างรายการ",
    noItems: "ยังไม่มีสินค้าในตะกร้า",
    remove: "ลบสินค้า",
    checkout: "สร้างออเดอร์ POS",
    openCashDrawer: "เปิดลิ้นชักเก็บเงิน",
    openingCashDrawer: "กำลังส่งคำสั่ง...",
    cashDrawerReasonPrompt: "ระบุเหตุผลในการเปิดลิ้นชัก",
    cashDrawerReasonDefault: "แลกเงิน",
    cashDrawerCommandSent: "ส่งคำสั่งเปิดลิ้นชักแล้ว",
    cashDrawerUnsupportedStatus: "เครื่องนี้ไม่รองรับสถานะเปิด/ปิดจริง",
    cashDrawerNotConfigured: "ยังไม่ได้ตั้งค่าลิ้นชักกับเครื่องพิมพ์ใบเสร็จ",
    cashDrawerPermissionDenied: "เฉพาะเจ้าของหรือผู้จัดการที่เปิดลิ้นชักได้",
    cashDrawerCooldown: "กรุณารอสักครู่ก่อนเปิดลิ้นชักอีกครั้ง",
    cashDrawerOpenFailed: "เปิดลิ้นชักไม่สำเร็จ",
    deliveryQueueCheckout: "รอส่งออเดอร์",
    deliveryQueueProcessing: "กำลังบันทึกบิลรอส่งออเดอร์...",
    tableQrOrder: "QR สั่งอาหาร",
    tableQrOrderReceived: "ได้รับรายการสั่งอาหารจาก QR",
    tableQrCallStaff: "โต๊ะเรียกพนักงาน",
    tableQrRequestCheckout: "โต๊ะแจ้งต้องการชำระบิล",
    dineInCheckout: "ชำระเงิน",
    orderCreated: "สร้างบิลแล้ว",
    orderUpdated: "อัปเดตบิลเดิมแล้ว",
    retry: "ลองส่งใหม่",
    managerOverride: "อนุมัติผู้จัดการ",
    discount: "ส่วนลด",
    tax: "ภาษี",
    gp: "GP",
    notes: "หมายเหตุ",
    notesPlaceholder: "หมายเหตุออเดอร์",
    subtotal: "ส่วนลด",
    total: "ยอดรวม",
    cancelBill: "ยกเลิกบิล",
    holdBill: "พักบิล",
    promotion: "ส่วนลด",
    discountPopupTitle: "ตั้งค่าส่วนลด",
    discountPopupHint: "ใส่ส่วนลดเป็นเปอร์เซ็นต์หรือจำนวนเงิน ระบบจะคำนวณให้อัตโนมัติ",
    discountPercentLabel: "ส่วนลด (%)",
    discountAmountLabel: "ส่วนลด (บาท)",
    discountApply: "ยืนยันส่วนลด",
    discountClear: "ล้างส่วนลด",
    billNo: "เลขที่บิล",
    status: "สถานะ",
    paymentMethod: "การชำระเงิน",
    paymentMethodNone: "ยังไม่ชำระ",
    statusValue: "เปิดโต๊ะ",
    statusReady: "พร้อมขาย",
    statusDelivery: "เดลิเวอรี่",
    monitorHealthy: "ระบบเสถียร",
    monitorWatch: "เฝ้าระวัง",
    monitorCritical: "ภาระสูง",
    monitorQueue: "คิวบิล",
    monitorPrintQueue: "คิวพิมพ์",
    monitorDeadLetters: "งานตกค้าง",
    monitorLag: "บิลค้างนาน",
    pendingSync: "รอซิงก์",
    emergencyRetry: "ลองส่งใหม่",
    cartSummary: "ตะกร้า",
    cartDrawerTitle: "ตะกร้าและชำระเงิน",
    close: "ปิด",
    submitting: "กำลังส่ง...",
    pendingSaved: "บันทึกรายการรอส่งไว้แล้ว",
    loading: "กำลังโหลดหน้าขาย...",
    processing: "กำลังประมวลผล...",
    openingTableBill: "กำลังเปิดบิลโต๊ะ...",
    paymentProcessing: "กำลังบันทึกการชำระเงิน...",
    openShiftRequired: "ต้องเปิดกะก่อนสร้างออเดอร์",
    addItemsFirst: "กรุณาเพิ่มสินค้าเข้าตะกร้าก่อน",
    offlineStaged: "ออฟไลน์อยู่: บันทึกรายการรอส่งไว้แล้ว",
    submitFailed: "ส่งออเดอร์ไม่สำเร็จ",
    retrySafe: "สามารถกดส่งซ้ำได้อย่างปลอดภัย",
    stillOffline: "ยังออฟไลน์อยู่ กรุณาลองใหม่เมื่อออนไลน์",
    retryFailed: "ลองส่งซ้ำไม่สำเร็จ",
    stockAdjusted: "ปรับสต็อกสำเร็จ",
    managerOverrideTitle: "อนุมัติผู้จัดการ: ปรับสต็อก",
    pinModalLabel: "รหัส PIN ผู้อนุมัติ",
    pinModalHint: "กรอกรหัสแล้วระบบจะตรวจสอบและอนุมัติทันที",
    pinModalPinLengthError: "PIN ต้องมีอย่างน้อย 4 หลัก",
    pinModalPinRejected: "รหัส PIN ไม่ถูกต้องหรือไม่มีสิทธิ์อนุมัติ",
    pinModalCheckingAccess: "กำลังตรวจสอบสิทธิ์...",
    pinModalClear: "ล้าง",
    pinModalRemove: "ลบ",
    pinModalCloseAria: "ปิดหน้าต่าง PIN",
    applyingStock: "กำลังปรับสต็อก...",
    storefront: "หน้าร้าน",
    takeawayChannel: "กลับบ้าน",
    otherChannel: "อื่น ๆ",
    selectTable: "เลือกโต๊ะ",
    tableSelectTitle: "เปิดบิล / เลือกโต๊ะ",
    tableSelectHint: "เมื่ออยู่ในโหมดนี้ รายการสินค้าในแถบจะถูกซ่อนจนกว่าจะเลือกโต๊ะเสร็จ",
    tableListMode: "รายการโต๊ะ",
    tableFloorMode: "แผนผังร้าน",
    tableListModeSub: "เลือกจากรายการ",
    tableFloorModeSub: "เลือกจากผังร้าน",
    deliveryAppTitle: "ช่องทางเดลิเวอรี่",
    deliveryAppHint: "เลือกแอป แล้วเปิดออเดอร์ก่อนเลือกสินค้า",
    deliveryMetaTitle: "รายละเอียดออเดอร์เดลิเวอรี่",
    deliveryMetaHint: "ใส่รหัสออเดอร์ภายนอกและหมายเหตุ (ถ้ามี) ก่อนเปิดออเดอร์",
    deliverySelectAppRequired: "กรุณาเลือกแอปเดลิเวอรี่",
    deliveryExternalCodeRequired: "กรุณาระบุรหัสออเดอร์จากแอป",
    deliveryExternalDigitsRequired: "กรุณาระบุตัวเลขรหัสออเดอร์",
    deliveryOrderCodeDigitsLabel: "เลขรหัสออเดอร์",
    deliveryOpenOrder: "เปิดออเดอร์",
    deliveryDraftOpened: "เปิดออเดอร์เดลิเวอรี่แล้ว",
    deliveryDraftClearAction: "ล้างดราฟต์เดลิเวอรี่",
    deliveryDraftCleared: "ล้างดราฟต์เดลิเวอรี่แล้ว",
    deliveryOpenCatalog: "เลือกเมนูสินค้า",
    deliveryOpenSetup: "บิลรอรับออเดอร์",
    deliveryPendingBillsTitle: "บิลรอรับออเดอร์",
    deliveryPendingBillsOpen: "ดูบิลรอรับออเดอร์",
    deliveryPendingBillSaved: "บันทึกบิลรอรับออเดอร์แล้ว",
    deliveryPendingBillNeedOrder: "กรุณาเปิดออเดอร์เดลิเวอรี่ก่อน",
    deliveryPendingBillSend: "ส่ง",
    deliveryPendingBillEdit: "แก้ไข",
    deliveryPendingBillCancel: "ยกเลิก",
    deliveryPendingBillCancelled: "ยกเลิกบิลรอรับออเดอร์แล้ว",
    deliveryPendingStatusLabel: "สถานะบิล",
    deliveryPendingStatusPending: "รอส่ง",
    deliveryPendingStatusEditing: "กำลังแก้ไข",
    deliveryPendingStatusSending: "กำลังส่ง",
    deliveryPendingStatusSent: "ส่งแล้ว",
    deliveryPendingStatusCancelled: "ยกเลิกแล้ว",
    deliveryPendingHistoryLabel: "ประวัติสถานะ",
    deliveryPendingStatusChangedAt: "ล่าสุด",
    deliveryPendingBillApp: "แอป",
    deliveryPendingBillCode: "รหัสภายนอก",
    deliveryPendingBillNoMatch: "ไม่พบบิลรอรับออเดอร์ที่ค้นหา",
    deliveryStateLabel: "สถานะเดลิเวอรี่",
    deliveryStateCreate: "สร้างออเดอร์",
    deliveryStateEdit: "แก้ไขออเดอร์",
    deliveryStateConfirmPayment: "ยืนยันชำระเงิน",
    deliveryStateCancelled: "ยกเลิกแล้ว",
    deliveryStatePendingDispatch: "ค้างส่ง",
    deliveryStateCompleted: "ชำระแล้ว",
    backToMenu: "กลับไปเมนูสินค้า",
    tableActionSelect: "เลือกโต๊ะ",
    tableActionOpenBill: "เปิดบิล",
    tableSelected: "เลือกโต๊ะแล้ว",
    tableNotReady: "โต๊ะนี้ยังไม่พร้อมใช้งาน",
    tableEmpty: "ยังไม่พบรายการโต๊ะในสาขานี้",
    tableLoading: "กำลังโหลดรายการโต๊ะ...",
    tableOpenSuccess: "เปิดบิลโต๊ะแล้ว",
    tableMove: "ย้ายโต๊ะ",
    tableMoveTitle: "ย้ายบิลไปโต๊ะใหม่",
    tableMoveHint: "เลือกโต๊ะปลายทางที่ว่าง แล้วกดยืนยันเพื่อย้ายบิลได้ทันที",
    tableMoveTargetLabel: "โต๊ะปลายทาง",
    tableMoveReasonLabel: "เหตุผล (ถ้ามี)",
    tableMoveNoTarget: "กรุณาเลือกโต๊ะปลายทางก่อน",
    tableMoveNoAvailable: "ไม่มีโต๊ะว่างสำหรับย้ายตอนนี้",
    tableMoveNeedBill: "ต้องมีบิลโต๊ะที่เปิดอยู่ก่อนจึงจะย้ายโต๊ะได้",
    tableMoveConfirm: "ยืนยันย้ายโต๊ะ",
    tableMoveSubmitting: "กำลังย้ายโต๊ะ...",
    tableMoveSuccess: "ย้ายโต๊ะสำเร็จ",
    openBillRequired: "กรุณาเปิดบิลโต๊ะก่อนสร้างออเดอร์ทานในร้าน",
    cancelBillNeedOrder: "ต้องมีออเดอร์ก่อนจึงยกเลิกบิลได้",
    cancelBillCartCleared: "ล้างรายการในตะกร้าแล้ว",
    cancelBillApprovalTitle: "อนุมัติผู้จัดการ: ยกเลิกบิล",
    cancelBillProcessing: "กำลังยกเลิกบิล...",
    cancelBillSuccess: "ยกเลิกบิลเรียบร้อยแล้ว",
    cancelBillPinRequired: "ต้องยืนยัน PIN ก่อนยกเลิกบิล",
    holdBillComingSoon: "กำลังเชื่อมพักบิลเข้าฐานข้อมูลในอัปเดตถัดไป",
    cancelBillNotAllowed: "สถานะบิลนี้ยังยกเลิกไม่ได้",
    tableLabel: "โต๊ะ",
    billLabel: "บิล",
    retryLoad: "โหลดใหม่",
    heldBills: "พักบิล",
    heldBillsOpen: "ดูบิลพัก",
    heldBillsEmpty: "ยังไม่มีบิลพัก",
    heldBillsRestore: "เรียกกลับ",
    heldBillsDelete: "ลบบิลพัก",
    heldBillsTitle: "รายการบิลพัก",
    heldBillsSaved: "พักบิลแล้ว",
    heldBillsNeedItems: "ต้องมีรายการสินค้าอย่างน้อย 1 รายการเพื่อพักบิล",
    heldBillsNumbersLabel: "เลขพักบิล",
    heldBillsSearchPlaceholder: "ค้นหาเลขบิลพัก",
    deliveryPendingSearchPlaceholder: "ค้นหารหัสออเดอร์ภายนอก",
    heldBillsRestoreLatest: "เรียกบิลล่าสุด",
    heldBillsHeldAt: "เวลาพักบิล",
    heldBillsNoMatch: "ไม่พบบิลพักที่ค้นหา",
    requestTimeout: "คำขอใช้เวลานานเกินไป กรุณาตรวจสอบเครือข่าย/API แล้วลองใหม่",
    reviewBillTitle: "รายการก่อนชำระเงิน",
    reviewBillHint: "ตรวจสอบรายการสินค้าและยอดรวมก่อนเลือกวิธีชำระเงิน",
    reviewItemsHeader: "รายการสินค้า",
    reviewQtyHeader: "จำนวน",
    reviewQtyPriceLabel: "จำนวน x ราคาต่อหน่วย",
    reviewLineTotalLabel: "รวมต่อรายการ",
    reviewItemIngredientDeductAction: "ตัดวัตถุดิบ",
    reviewItemIngredientDeducting: "กำลังตัดวัตถุดิบ...",
    reviewItemIngredientDeducted: "ตัดแล้ว",
    reviewItemIngredientRestoreAction: "คืนวัตถุดิบต่อรายการ",
    reviewItemIngredientRestoring: "กำลังคืนวัตถุดิบ...",
    reviewItemIngredientRestored: "คืนแล้ว",
    reviewItemIngredientModalTitle: "จัดการวัตถุดิบต่อรายการ",
    reviewItemIngredientModalHint: "เลือกวัตถุดิบที่ต้องการ แล้วกดตัดหรือคืนเฉพาะที่เลือก",
    reviewItemIngredientModeLabel: "โหมดการปรับวัตถุดิบ",
    reviewItemIngredientModeDeduct: "ตัดวัตถุดิบ",
    reviewItemIngredientModeRestore: "คืนวัตถุดิบ",
    reviewItemIngredientSelectHint: "เลือกวัตถุดิบที่ต้องการปรับเฉพาะรายการนี้",
    reviewItemIngredientSelectLabel: "เลือกวัตถุดิบ",
    reviewItemIngredientRequiredGrams: "ต้องใช้ตามสูตร",
    reviewItemIngredientRestorableGrams: "คืนได้สูงสุด",
    reviewItemIngredientAvailableGrams: "คงเหลือในสต๊อก",
    reviewItemIngredientNone: "ไม่พบวัตถุดิบที่เชื่อมกับรายการนี้",
    reviewItemIngredientLoading: "กำลังโหลดวัตถุดิบ...",
    reviewItemIngredientDeductSelected: "ตัดวัตถุดิบที่เลือก",
    reviewItemIngredientRestoreSelected: "คืนวัตถุดิบที่เลือก",
    reviewItemIngredientSelectRequired: "กรุณาเลือกวัตถุดิบอย่างน้อย 1 รายการ",
    reviewItemIngredientInsufficientStock: "สต๊อกวัตถุดิบไม่พอ",
    reviewItemIngredientRestoreExceeds: "รายการนี้ยังไม่มีวัตถุดิบที่ตัดไว้เพียงพอสำหรับคืน",
    reviewItemIngredientApply: "ยืนยันรายการ",
    reviewItemIngredientModePrompt: "เลือกโหมด: พิมพ์ 1 = ตัดวัตถุดิบ, 2 = คืนวัตถุดิบ",
    reviewItemIngredientDeductConfirm: "ยืนยันตัดวัตถุดิบตามสูตรของรายการนี้หรือไม่",
    reviewItemIngredientRestoreConfirm: "ยืนยันคืนวัตถุดิบตามสูตรของรายการนี้หรือไม่",
    reviewItemIngredientDeductSuccess: "ตัดวัตถุดิบต่อรายการสำเร็จ",
    reviewItemIngredientRestoreSuccess: "คืนวัตถุดิบต่อรายการสำเร็จ",
    reviewGrandTotalLabel: "รวมยอด",
    paymentCash: "ชำระเงินสด",
    paymentTransfer: "ชำระเงินโอน",
    paymentTransferComingSoon: "เงินโอนกำลังพัฒนาต่อ",
    transferTitle: "รับชำระเงินโอน",
    transferHint: "สแกน QR เพื่อชำระเงินตามยอดบิล",
    transferQrTitle: "สแกน QR เพื่อชำระเงิน",
    transferQrHint: "สแกน QR ด้วยแอปธนาคารของลูกค้า",
    transferPromptPaySettingsHint: "QR นี้สร้างจากเบอร์พร้อมเพย์ในตั้งค่าชำระเงิน และเปลี่ยนเฉพาะยอดบิล",
    transferQrImageSettingsHint: "QR นี้ดึงจากภาพ QR ในตั้งค่าชำระเงิน",
    transferPromptPayPhoneLabel: "เบอร์พร้อมเพย์",
    transferPaymentAccountLabel: "บัญชีรับเงิน",
    transferPaymentSettingsRequiredTitle: "โปรดเปิดใช้งานชำระเงินก่อน",
    transferPaymentSettingsRequiredBody: "ยังไม่มีบัญชี QR ที่เปิดใช้งานสำหรับสาขานี้ กรุณาไปที่เมนูตั้งค่าชำระเงิน แล้วเปิดใช้งานบัญชีรับเงินก่อนรับชำระด้วย QR",
    transferPaymentSettingsRequiredClose: "ปิด POP UP",
    transferQrImageModeLabel: "ใช้ภาพ QR จากตั้งค่า",
    transferPromptPayAmountLabel: "ยอดชำระ",
    transferUploadSlipLabel: "อัปโหลดสลิป (รองรับถ่ายจากมือถือ)",
    transferSlipPreview: "ตัวอย่างสลิป",
    transferSlipAnalyze: "อ่านข้อมูลจากสลิป",
    transferSlipAnalyzing: "กำลังอ่านข้อมูลสลิป...",
    transferSlipNeedUpload: "กรุณาแนบสลิปก่อนยืนยันเงินโอน",
    transferSlipNeedVerify: "กรุณาอ่าน/ตรวจสอบสลิปให้ผ่านก่อนยืนยันเงินโอน",
    transferSlipVerifyPassed: "ตรวจสอบสลิปผ่านแล้ว",
    transferSlipVerifyFailed: "ตรวจสอบสลิปไม่ผ่าน",
    transferSlipInfoPayer: "ผู้โอน",
    transferSlipInfoPayee: "ผู้รับโอน",
    transferSlipInfoDateTime: "วันเวลาโอน",
    transferSlipInfoTxn: "เลขที่รายการ",
    transferSlipInfoAmount: "ยอดในสลิป",
    transferVerificationHistoryTitle: "ประวัติการตรวจสอบสลิปในบิลนี้",
    transferVerificationHistoryEmpty: "ยังไม่มีประวัติการตรวจสอบสลิป",
    transferVerificationHistoryAt: "เวลาตรวจสอบ",
    transferVerificationHistoryStatus: "สถานะ",
    transferVerificationHistoryReference: "อ้างอิง",
    transferVerificationHistoryExpectedAmount: "ยอดที่คาดหวัง",
    transferVerificationHistoryParsedAmount: "ยอดจากสลิป",
    transferVerificationHistoryIssues: "ประเด็นที่พบ",
    transferVerificationStatusPassed: "ผ่าน",
    transferVerificationStatusFailed: "ไม่ผ่าน",
    transferVerificationStatusOverridePassed: "ผ่านด้วยการอนุมัติแทน",
    transferVerificationStatusError: "เกิดข้อผิดพลาด",
    paymentTableMismatchBanner: "คำเตือน: โต๊ะที่กำลังเปิดไม่ตรงกับโต๊ะของบิลนี้",
    paymentTableMismatchCurrent: "โต๊ะที่กำลังเปิด",
    paymentTableMismatchOrder: "โต๊ะของบิลนี้",
    transferVerificationSummaryLabel: "ยืนยันสลิป",
    transferReferenceDetected: "เลขอ้างอิงจากสลิป",
    transferPayeeExpected: "ผู้รับที่คาดหวัง",
    transferCheckAmount: "ตรวจยอดตรงบิล",
    transferCheckPayee: "ตรวจชื่อผู้รับ",
    transferCheckDateTime: "ตรวจวันเวลาโอน",
    transferCheckConfidence: "ตรวจความเชื่อมั่น OCR",
    transferScanWithPhone: "สแกน QR ด้วยแอปธนาคารของลูกค้า",
    transferOverrideRequest: "อนุมัติแทนกรณีระบบอ่านสลิปไม่ผ่าน",
    transferOverrideGranted: "อนุมัติแทนเรียบร้อยแล้ว",
    transferOverrideNeedReason: "กรณีอ่านสลิปไม่ผ่าน ต้องให้ผู้จัดการ/เจ้าของ/IT Admin อนุมัติแทน",
    transferOverrideTitle: "อนุมัติแทน: ยืนยันชำระเงินโอน",
    transferReferenceLabel: "เลขอ้างอิง (ถ้ามี)",
    transferReferencePlaceholder: "เช่น TRX-123456",
    transferConfirm: "ยืนยันเงินโอน",
    transferManualMode: "โอนแบบเดิม",
    transferInetMode: "INET QR",
    transferInetQrTitle: "INET NOPS QR",
    transferInetCreateQr: "สร้าง INET QR",
    transferInetRetryQr: "สร้าง QR ใหม่",
    transferInetNotCreated: "กดสร้าง INET QR เพื่อรอชำระอัตโนมัติ",
    transferInetHint: "ลูกค้าสแกน INET QR แล้วระบบจะรอ callback อัตโนมัติ",
    transferInetWaiting: "กำลังรอผลชำระจาก INET...",
    transferInetPaid: "รับชำระผ่าน INET สำเร็จ",
    transferInetOrderRef: "เลขอ้างอิง INET",
    transferInetDisabled: "ยังไม่ได้เปิดใช้ INET NOPS สำหรับสาขานี้",
    transferInetFailed: "ชำระ INET ไม่สำเร็จ กรุณาลองใหม่หรือใช้โอนแบบเดิม",
    transferQueued: "บันทึกเงินโอนรอซิงก์แล้ว",
    paymentTotalDue: "ยอดที่ต้องชำระ",
    cashReceiveTitle: "รับชำระเงินสด",
    cashReceiveHint: "กรอกจำนวนเงินที่รับจากลูกค้า",
    cashReceivedLabel: "รับเงินจากลูกค้า",
    cashInsufficient: "จำนวนเงินที่รับต้องมากกว่าหรือเท่ากับยอดชำระ",
    cashExactRequired: "ต้องใส่จำนวนเงินและต้องมากกว่าหรือเท่ากับยอดที่ต้องชำระก่อนยืนยัน",
    cashRemaining: "ยอดคงเหลือ",
    cashChange: "เงินทอน",
    cashConfirm: "ยืนยันชำระ",
    productOutOfStock: "สินค้าหมด",
    productOutOfStockBody: "ไม่สามารถเพิ่มรายการนี้ได้ เพราะจำนวนคงเหลือไม่พอ",
    productOutOfStockOk: "ตกลง",
    productStockRemaining: "คงเหลือ",
    member: "สมาชิก",
    memberComingSoon: "เปิดหน้าสมาชิก",
    cashQuickBlocksLabel: "บล็อกเงินด่วน",
    cashKeypadTitle: "แป้นตัวเลข",
    cashKeyClear: "ล้าง",
    cashKeyBackspace: "ลบ",
    creatingOrderTitle: "กำลังสร้างออเดอร์ POS",
    storefrontPriceLabel: "หน้าร้าน",
    deliveryPriceLabel: "เดลิเวอรี่",
    creatingOrderHint: "ระบบกำลังสร้างบิล โปรดรอสักครู่",
    receiptTitle: "ใบเสร็จ 58 mm",
    receiptPrint: "พิมพ์ใบเสร็จ",
    receiptSaving: "กำลังบันทึกการชำระและเตรียมใบเสร็จ...",
    receiptSaved: "บันทึกสำเร็จ",
    receiptClose: "ปิดหน้าต่าง"
  },
  en: {
    modeLabel: "Mode",
    salesInfoTitle: "Sales Info",
    sellerName: "Seller",
    branchName: "Branch",
    shiftName: "Shift",
    cashierDeviceCode: "Cashier code",
    date: "Date",
    time: "Time",
    goHome: "Takeaway",
    dineIn: "Dine-in",
    delivery: "Delivery",
    deliveryMaintenanceTitle: "Delivery",
    deliveryMaintenanceMessage: "The delivery workflow is being developed with the delivery team.",
    switchMode: "Select Mode",
    selectMode: "Select Sales Mode",
    selectModeHint: "Choose how this order will be served",
    currentMode: "Current mode",
    previewMode: "POS Sales",
    shift: "Shift",
    noShift: "No open shift",
    deviceBlockedInactiveTitle: "Cashier device is disabled",
    deviceBlockedInactiveBody: "This device was disabled from cashier device settings. Sales and payment actions are locked on this device.",
    deviceBlockedMaintenanceTitle: "Cashier device is under maintenance",
    deviceBlockedMaintenanceBody: "This device is marked for maintenance. The sales screen is paused until an admin switches it back to active.",
    deviceBlockedStatusLabel: "Device status",
    deviceBlockedCodeLabel: "Device code",
    deviceBlockedActionHint: "Go to Settings > Cashier devices to change the device status, or use another active device.",
    network: "Network",
    online: "online",
    offline: "offline",
    customerName: "customer name",
    externalCode: "external order code",
    manageMenu: "Manage Menu",
    cart: "Order Items",
    items: "items",
    clear: "Clear",
    noItems: "No items in cart.",
    remove: "Remove item",
    checkout: "Create POS order",
    openCashDrawer: "Open cash drawer",
    openingCashDrawer: "Sending command...",
    cashDrawerReasonPrompt: "Enter reason for opening the drawer",
    cashDrawerReasonDefault: "Cash exchange",
    cashDrawerCommandSent: "Cash drawer command sent",
    cashDrawerUnsupportedStatus: "This printer does not report physical drawer status",
    cashDrawerNotConfigured: "Cash drawer is not configured on a receipt printer",
    cashDrawerPermissionDenied: "Only owner or manager can open the drawer",
    cashDrawerCooldown: "Please wait before opening the drawer again",
    cashDrawerOpenFailed: "Cash drawer open failed",
    deliveryQueueCheckout: "Queue For Dispatch",
    deliveryQueueProcessing: "Saving pending dispatch bill...",
    tableQrOrder: "Table QR",
    tableQrOrderReceived: "Table QR order received",
    tableQrCallStaff: "Table calls staff",
    tableQrRequestCheckout: "Table requests checkout",
    dineInCheckout: "Pay",
    orderCreated: "Order created",
    orderUpdated: "Order updated",
    retry: "Retry pending submit",
    managerOverride: "Stock adjustment (override)",
    discount: "Discount",
    tax: "Tax",
    gp: "GP",
    notes: "Notes",
    notesPlaceholder: "Order notes",
    subtotal: "Discount",
    total: "Total",
    cancelBill: "Cancel Bill",
    holdBill: "Hold Bill",
    promotion: "Discount",
    discountPopupTitle: "Discount Setup",
    discountPopupHint: "Enter discount by percent or amount. The other field is calculated automatically.",
    discountPercentLabel: "Discount (%)",
    discountAmountLabel: "Discount (THB)",
    discountApply: "Apply Discount",
    discountClear: "Clear Discount",
    billNo: "Bill No.",
    status: "Status",
    paymentMethod: "Payment",
    paymentMethodNone: "Not paid",
    statusValue: "Open Table",
    statusReady: "Ready",
    statusDelivery: "Delivery",
    monitorHealthy: "Healthy",
    monitorWatch: "Watch",
    monitorCritical: "High Load",
    monitorQueue: "Order Queue",
    monitorPrintQueue: "Print Queue",
    monitorDeadLetters: "Dead Letters",
    monitorLag: "Stale Queue",
    pendingSync: "Pending Sync",
    emergencyRetry: "Retry now",
    cartSummary: "Cart",
    cartDrawerTitle: "Cart & Payment",
    close: "Close",
    submitting: "Submitting...",
    pendingSaved: "Pending local submit saved. Safe to retry.",
    loading: "Loading POS sales...",
    processing: "Processing...",
    openingTableBill: "Opening table bill...",
    paymentProcessing: "Saving payment...",
    openShiftRequired: "Open shift is required before creating order.",
    addItemsFirst: "Add items to cart first.",
    offlineStaged: "Offline mode: order is staged locally. Retry when connection is back.",
    submitFailed: "Submit failed",
    retrySafe: "You can retry safely.",
    stillOffline: "Still offline. Retry when online.",
    retryFailed: "Retry failed.",
    stockAdjusted: "Stock adjusted",
    managerOverrideTitle: "Manager Override: Stock Adjustment",
    pinModalLabel: "Manager PIN",
    pinModalHint: "Enter PIN to auto-verify and approve",
    pinModalPinLengthError: "PIN must be at least 4 digits.",
    pinModalPinRejected: "PIN is invalid or not authorized for this action.",
    pinModalCheckingAccess: "Checking access...",
    pinModalClear: "Clear",
    pinModalRemove: "Delete",
    pinModalCloseAria: "Close PIN popup",
    applyingStock: "Applying stock adjustment...",
    storefront: "storefront",
    takeawayChannel: "walk_home",
    otherChannel: "other",
    selectTable: "Select table",
    tableSelectTitle: "Open Bill / Select Table",
    tableSelectHint: "Product list will be hidden until a table is selected.",
    tableListMode: "List",
    tableFloorMode: "Board",
    tableListModeSub: "Table List",
    tableFloorModeSub: "Floor Plan",
    deliveryAppTitle: "Delivery Channels",
    deliveryAppHint: "Choose app and open order before selecting menu",
    deliveryMetaTitle: "Delivery Order Info",
    deliveryMetaHint: "Enter external code and optional notes before opening order.",
    deliverySelectAppRequired: "Please select a delivery app.",
    deliveryExternalCodeRequired: "External order code is required.",
    deliveryExternalDigitsRequired: "Order code digits are required.",
    deliveryOrderCodeDigitsLabel: "Order code digits",
    deliveryOpenOrder: "Open Order",
    deliveryDraftOpened: "Delivery order opened.",
    deliveryDraftClearAction: "Clear delivery draft",
    deliveryDraftCleared: "Delivery draft has been cleared.",
    deliveryOpenCatalog: "Pick Menu Items",
    deliveryOpenSetup: "Pending Delivery Bills",
    deliveryPendingBillsTitle: "Pending Delivery Bills",
    deliveryPendingBillsOpen: "View pending delivery bills",
    deliveryPendingBillSaved: "Pending delivery bill saved",
    deliveryPendingBillNeedOrder: "Please open delivery order first.",
    deliveryPendingBillSend: "Send",
    deliveryPendingBillEdit: "Edit",
    deliveryPendingBillCancel: "Cancel",
    deliveryPendingBillCancelled: "Pending delivery bill cancelled.",
    deliveryPendingStatusLabel: "Bill status",
    deliveryPendingStatusPending: "Pending dispatch",
    deliveryPendingStatusEditing: "Editing",
    deliveryPendingStatusSending: "Sending",
    deliveryPendingStatusSent: "Sent",
    deliveryPendingStatusCancelled: "Cancelled",
    deliveryPendingHistoryLabel: "Status history",
    deliveryPendingStatusChangedAt: "Latest",
    deliveryPendingBillApp: "App",
    deliveryPendingBillCode: "External code",
    deliveryPendingBillNoMatch: "No pending delivery bills match your search",
    deliveryStateLabel: "Delivery State",
    deliveryStateCreate: "Create Order",
    deliveryStateEdit: "Edit Order",
    deliveryStateConfirmPayment: "Confirm Payment",
    deliveryStateCancelled: "Cancelled",
    deliveryStatePendingDispatch: "Pending Dispatch",
    deliveryStateCompleted: "Paid",
    backToMenu: "Back to Menu",
    tableActionSelect: "Select",
    tableActionOpenBill: "Open Bill",
    tableSelected: "Selected table",
    tableNotReady: "This table is not ready.",
    tableEmpty: "No tables found for this branch.",
    tableLoading: "Loading tables...",
    tableOpenSuccess: "Table bill opened",
    tableMove: "Move Table",
    tableMoveTitle: "Move bill to another table",
    tableMoveHint: "Choose an available destination table and confirm to move the bill immediately.",
    tableMoveTargetLabel: "Destination table",
    tableMoveReasonLabel: "Reason (optional)",
    tableMoveNoTarget: "Please select a destination table.",
    tableMoveNoAvailable: "No available table to move right now.",
    tableMoveNeedBill: "An open dine-in bill is required before moving table.",
    tableMoveConfirm: "Confirm move",
    tableMoveSubmitting: "Moving table...",
    tableMoveSuccess: "Table moved successfully",
    openBillRequired: "Open table bill before creating dine-in order.",
    cancelBillNeedOrder: "Create an order before cancelling bill.",
    cancelBillCartCleared: "Cart items cleared.",
    cancelBillApprovalTitle: "Manager Override: Cancel Bill",
    cancelBillProcessing: "Cancelling bill...",
    cancelBillSuccess: "Bill cancelled successfully.",
    cancelBillPinRequired: "PIN approval is required before cancelling this bill.",
    holdBillComingSoon: "Hold bill will be connected to database in next update.",
    cancelBillNotAllowed: "This bill status cannot be cancelled yet.",
    tableLabel: "Table",
    billLabel: "Bill",
    retryLoad: "Retry load",
    heldBills: "Held Bills",
    heldBillsOpen: "View held bills",
    heldBillsEmpty: "No held bills",
    heldBillsRestore: "Restore",
    heldBillsDelete: "Delete",
    heldBillsTitle: "Held bill list",
    heldBillsSaved: "Bill held",
    heldBillsNeedItems: "Add at least one item before holding bill",
    heldBillsNumbersLabel: "Held bill numbers",
    heldBillsSearchPlaceholder: "Search held bill number",
    deliveryPendingSearchPlaceholder: "Search external order code",
    heldBillsRestoreLatest: "Restore latest bill",
    heldBillsHeldAt: "Held at",
    heldBillsNoMatch: "No held bills match your search",
    requestTimeout: "Request timed out. Please check network/API and try again.",
    reviewBillTitle: "Items before payment",
    reviewBillHint: "Double-check items and total before selecting payment method.",
    reviewItemsHeader: "Items",
    reviewQtyHeader: "Qty",
    reviewQtyPriceLabel: "Qty x Unit Price",
    reviewLineTotalLabel: "Line Total",
    reviewItemIngredientDeductAction: "Deduct ingredients",
    reviewItemIngredientDeducting: "Deducting...",
    reviewItemIngredientDeducted: "Deducted",
    reviewItemIngredientRestoreAction: "Restore ingredients",
    reviewItemIngredientRestoring: "Restoring...",
    reviewItemIngredientRestored: "Restored",
    reviewItemIngredientModalTitle: "Adjust line-item ingredients",
    reviewItemIngredientModalHint: "Select ingredients and apply deduct or restore only for selected rows.",
    reviewItemIngredientModeLabel: "Adjustment mode",
    reviewItemIngredientModeDeduct: "Deduct ingredients",
    reviewItemIngredientModeRestore: "Restore ingredients",
    reviewItemIngredientSelectHint: "Select only the ingredients you want to adjust for this line item.",
    reviewItemIngredientSelectLabel: "Ingredients",
    reviewItemIngredientRequiredGrams: "Recipe usage",
    reviewItemIngredientRestorableGrams: "Max restorable",
    reviewItemIngredientAvailableGrams: "Stock on hand",
    reviewItemIngredientNone: "No ingredients linked to this item.",
    reviewItemIngredientLoading: "Loading ingredients...",
    reviewItemIngredientDeductSelected: "Deduct selected",
    reviewItemIngredientRestoreSelected: "Restore selected",
    reviewItemIngredientSelectRequired: "Please select at least one ingredient.",
    reviewItemIngredientInsufficientStock: "Insufficient ingredient stock",
    reviewItemIngredientRestoreExceeds: "No enough deducted amount to restore for this ingredient.",
    reviewItemIngredientApply: "Apply",
    reviewItemIngredientModePrompt: "Select mode: type 1 = deduct, 2 = restore",
    reviewItemIngredientDeductConfirm: "Deduct recipe ingredients for this line item?",
    reviewItemIngredientRestoreConfirm: "Restore recipe ingredients for this line item?",
    reviewItemIngredientDeductSuccess: "Line-item ingredient deduction applied",
    reviewItemIngredientRestoreSuccess: "Line-item ingredient restore applied",
    reviewGrandTotalLabel: "Grand Total",
    paymentCash: "Cash",
    paymentTransfer: "Bank transfer",
    paymentTransferComingSoon: "Transfer is being improved",
    transferTitle: "Transfer payment",
    transferHint: "Scan QR to pay this bill amount.",
    transferQrTitle: "Scan QR to pay",
    transferQrHint: "Scan QR with the customer's banking app",
    transferPromptPaySettingsHint: "This QR is generated from Payment Settings and only the bill amount changes.",
    transferQrImageSettingsHint: "This QR image comes from Payment Settings.",
    transferPromptPayPhoneLabel: "PromptPay phone",
    transferPaymentAccountLabel: "Receiving account",
    transferPaymentSettingsRequiredTitle: "Enable payment settings first",
    transferPaymentSettingsRequiredBody: "No active QR payment account is available for this branch. Open Payment Settings and enable a receiving account before accepting QR transfer payments.",
    transferPaymentSettingsRequiredClose: "Close popup",
    transferQrImageModeLabel: "Settings QR image",
    transferPromptPayAmountLabel: "Amount due",
    transferUploadSlipLabel: "Upload slip (camera supported on mobile)",
    transferSlipPreview: "Slip preview",
    transferSlipAnalyze: "Extract slip info",
    transferSlipAnalyzing: "Extracting slip data...",
    transferSlipNeedUpload: "Please upload slip before confirming transfer.",
    transferSlipNeedVerify: "Please run slip verification and pass checks before confirming.",
    transferSlipVerifyPassed: "Slip verification passed",
    transferSlipVerifyFailed: "Slip verification failed",
    transferSlipInfoPayer: "Payer",
    transferSlipInfoPayee: "Payee",
    transferSlipInfoDateTime: "Transfer date/time",
    transferSlipInfoTxn: "Transaction ID",
    transferSlipInfoAmount: "Slip amount",
    transferVerificationHistoryTitle: "Slip verification history for this bill",
    transferVerificationHistoryEmpty: "No slip verification history yet.",
    transferVerificationHistoryAt: "Verified at",
    transferVerificationHistoryStatus: "Status",
    transferVerificationHistoryReference: "Reference",
    transferVerificationHistoryExpectedAmount: "Expected amount",
    transferVerificationHistoryParsedAmount: "Slip amount",
    transferVerificationHistoryIssues: "Issues",
    transferVerificationStatusPassed: "Passed",
    transferVerificationStatusFailed: "Failed",
    transferVerificationStatusOverridePassed: "Override passed",
    transferVerificationStatusError: "Error",
    paymentTableMismatchBanner: "Warning: current table does not match this bill table.",
    paymentTableMismatchCurrent: "Current table",
    paymentTableMismatchOrder: "Bill table",
    transferVerificationSummaryLabel: "Slip verify",
    transferReferenceDetected: "Slip reference",
    transferPayeeExpected: "Expected payee",
    transferCheckAmount: "Amount match",
    transferCheckPayee: "Payee match",
    transferCheckDateTime: "Datetime found",
    transferCheckConfidence: "OCR confidence",
    transferScanWithPhone: "Scan QR with the customer's banking app.",
    transferOverrideRequest: "Request override when slip verification fails",
    transferOverrideGranted: "Override approved",
    transferOverrideNeedReason: "If slip verification fails, manager/owner/IT Admin override is required.",
    transferOverrideTitle: "Override: confirm transfer payment",
    transferReferenceLabel: "Reference (optional)",
    transferReferencePlaceholder: "e.g. TRX-123456",
    transferConfirm: "Confirm transfer",
    transferManualMode: "Manual transfer",
    transferInetMode: "INET QR",
    transferInetQrTitle: "INET NOPS QR",
    transferInetCreateQr: "Create INET QR",
    transferInetRetryQr: "Create new QR",
    transferInetNotCreated: "Create an INET QR to wait for automatic payment.",
    transferInetHint: "Customer scans INET QR; POS waits for the provider callback.",
    transferInetWaiting: "Waiting for INET payment...",
    transferInetPaid: "INET payment received",
    transferInetOrderRef: "INET reference",
    transferInetDisabled: "INET NOPS is not enabled for this branch.",
    transferInetFailed: "INET payment failed. Try again or use manual transfer.",
    transferQueued: "Transfer payment queued for sync",
    paymentTotalDue: "Total due",
    cashReceiveTitle: "Cash payment",
    cashReceiveHint: "Enter amount received from customer.",
    cashReceivedLabel: "Cash received",
    cashInsufficient: "Cash received must be greater than or equal to total due.",
    cashExactRequired: "Enter cash amount and ensure it is greater than or equal to total due before confirming.",
    cashRemaining: "Remaining",
    cashChange: "Change",
    cashConfirm: "Confirm payment",
    productOutOfStock: "Out of stock",
    productOutOfStockBody: "This item cannot be added because available stock is not enough.",
    productOutOfStockOk: "OK",
    productStockRemaining: "Stock",
    member: "Member",
    memberComingSoon: "Open members",
    cashQuickBlocksLabel: "Quick cash blocks",
    cashKeypadTitle: "Keypad",
    cashKeyClear: "Clear",
    cashKeyBackspace: "Backspace",
    creatingOrderTitle: "Creating POS order",
    storefrontPriceLabel: "Store",
    deliveryPriceLabel: "Delivery",
    creatingOrderHint: "Please wait while the bill is being created.",
    receiptTitle: "58mm receipt",
    receiptPrint: "Print receipt",
    receiptSaving: "Saving payment and preparing receipt...",
    receiptSaved: "Saved",
    receiptClose: "Close"
  }
} as const;
function newIdempotencyKey() {
  return `pos-sale-${crypto.randomUUID()}`;
}

function formatMoney(value: number): string {
  return `฿${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`;
}

function formatMoneyPlain(value: number): string {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

function calculateClientTaxBreakdown(baseAmount: number, settings: TaxSettings) {
  const safeBase = Number(Math.max(0, Number(baseAmount) || 0).toFixed(2));
  if (!settings.is_enabled) return { tax_total: 0, grand_total: safeBase, lines: [] as Array<TaxLineSettings & { amount: number }> };
  const lines = settings.lines
    .filter((line) => line.is_active && Number(line.rate_pct) > 0)
    .map((line) => {
      const amount = Number((safeBase * (Number(line.rate_pct) / 100)).toFixed(2));
      return { ...line, amount: line.mode === "deduct_from_bill" ? -amount : amount };
    });
  const taxTotal = Number(lines.reduce((sum, line) => sum + line.amount, 0).toFixed(2));
  return {
    tax_total: taxTotal,
    grand_total: Number(Math.max(0, safeBase + taxTotal).toFixed(2)),
    lines
  };
}

function normalizeTaxLineSnapshots(value: unknown): TaxLineSnapshot[] {
  if (!Array.isArray(value)) return [];
  return value
    .map<TaxLineSnapshot | null>((entry, index) => {
      if (!entry || typeof entry !== "object") return null;
      const source = entry as Partial<TaxLineSnapshot>;
      const label = typeof source.label === "string" && source.label.trim() ? source.label.trim() : `Tax ${index + 1}`;
      const amount = Number(source.amount ?? 0);
      if (!Number.isFinite(amount) || Math.abs(amount) < 0.005) return null;
      return {
        id: typeof source.id === "string" && source.id.trim() ? source.id.trim() : `tax-line-${index + 1}`,
        label,
        rate_pct: Number.isFinite(Number(source.rate_pct)) ? Number(source.rate_pct) : 0,
        mode: source.mode === "deduct_from_bill" ? "deduct_from_bill" : "add_to_bill",
        is_active: source.is_active !== false,
        amount: Number(amount.toFixed(2))
      };
    })
    .filter((entry): entry is TaxLineSnapshot => Boolean(entry));
}

function resolveTaxLinesForReceipt(session: Pick<CheckoutReviewOrder, "tax_lines" | "tax_total">, fallbackLabel: string): TaxLineSnapshot[] {
  const explicitLines = normalizeTaxLineSnapshots(session.tax_lines);
  if (explicitLines.length > 0) return explicitLines;
  const taxTotal = Number(session.tax_total ?? 0);
  if (!Number.isFinite(taxTotal) || Math.abs(taxTotal) < 0.005) return [];
  return [
    {
      id: "tax-total",
      label: fallbackLabel,
      rate_pct: 0,
      mode: taxTotal < 0 ? "deduct_from_bill" : "add_to_bill",
      is_active: true,
      amount: Number(taxTotal.toFixed(2))
    }
  ];
}

function formatSignedMoneyPlain(amount: number): string {
  const sign = amount < 0 ? "-" : "+";
  return `${sign}฿${formatMoneyPlain(Math.abs(amount))}`;
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

function formatCashBlockAmount(value: number): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

function formatQuantity(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2);
}

function parseReceiptItemDetails(notes?: string | null): ReceiptItemDetails {
  const raw = String(notes ?? "").trim();
  if (!raw) return { choices: [], note: null };
  const parts = raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length > 1) return { choices: parts, note: null };
  return { choices: [], note: raw };
}

function sanitizeCashInput(value: string): string {
  let cleaned = value.replace(/[^\d.]/g, "");
  if (!cleaned) return "";

  const dotIndex = cleaned.indexOf(".");
  if (dotIndex >= 0) {
    const intPart = cleaned.slice(0, dotIndex).replace(/^0+(?=\d)/, "") || "0";
    const decimalPart = cleaned
      .slice(dotIndex + 1)
      .replace(/\./g, "")
      .slice(0, 2);
    return decimalPart.length > 0 ? `${intPart}.${decimalPart}` : `${intPart}.`;
  }

  return cleaned.replace(/^0+(?=\d)/, "") || "0";
}

function sanitizePercentInput(value: string): string {
  let cleaned = value.replace(/[^\d.]/g, "");
  if (!cleaned) return "";

  const dotIndex = cleaned.indexOf(".");
  if (dotIndex >= 0) {
    const intPart = cleaned.slice(0, dotIndex).replace(/^0+(?=\d)/, "") || "0";
    const decimalPart = cleaned
      .slice(dotIndex + 1)
      .replace(/\./g, "")
      .slice(0, 2);
    return decimalPart.length > 0 ? `${intPart}.${decimalPart}` : `${intPart}.`;
  }

  return cleaned.replace(/^0+(?=\d)/, "") || "0";
}

function sanitizePromptPayPhone(value: string): string {
  return value.replace(/[^\d]/g, "").slice(0, 13);
}

function nowMs(): number {
  return Date.now();
}

function randomJitterMs(maxExclusive: number): number {
  return Math.floor(Math.random() * maxExclusive);
}

function formatPromptPayPhoneDisplay(phone: string): string {
  const digits = sanitizePromptPayPhone(phone);
  if (digits.length === 10 && digits.startsWith("0")) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 13 && digits.startsWith("66")) {
    return `${digits.slice(0, 2)}-${digits.slice(2, 5)}-${digits.slice(5, 8)}-${digits.slice(8)}`;
  }
  return digits;
}

function buildDineInSessionBillNo(tableCode: string, openedAt: string, sessionId: string): string {
  const parsedOpenedAt = new Date(openedAt);
  const hh = Number.isNaN(parsedOpenedAt.getTime()) ? "--" : String(parsedOpenedAt.getHours()).padStart(2, "0");
  const mm = Number.isNaN(parsedOpenedAt.getTime()) ? "--" : String(parsedOpenedAt.getMinutes()).padStart(2, "0");
  return `TB-${tableCode || "NA"}-${hh}${mm}-${sessionId.slice(0, 4).toUpperCase()}`;
}

function toPromptPayAmount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Number(Math.max(0, value).toFixed(2));
}

function buildPromptPayQrUrl(phone: string, amount: number): string | null {
  const normalizedPhone = sanitizePromptPayPhone(phone);
  if (!normalizedPhone) return null;
  const amountValue = toPromptPayAmount(amount);
  const amountText = Number.isInteger(amountValue) ? String(amountValue) : amountValue.toFixed(2);
  return `https://promptpay.io/${normalizedPhone}/${amountText}`;
}

function normalizeQrImageSource(value: string | null | undefined): string | null {
  const qr = String(value ?? "").trim();
  if (!qr) return null;
  if (qr.startsWith("http://") || qr.startsWith("https://") || qr.startsWith("data:image/")) return qr;
  return `data:image/png;base64,${qr}`;
}

function readStoredJson<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  const rawValue = localStorage.getItem(key);
  if (!rawValue) return null;
  try {
    return JSON.parse(rawValue) as T;
  } catch {
    localStorage.removeItem(key);
    return null;
  }
}

const apiErrorTelemetrySentAt = new Map<string, number>();

function resolveApiRoute(input: RequestInfo | URL): string | null {
  const value = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (!value) return null;
  try {
    const base = typeof window !== "undefined" ? window.location.origin : "http://localhost";
    const url = new URL(value, base);
    if (!url.pathname.startsWith("/api/")) return null;
    return url.pathname;
  } catch {
    return null;
  }
}

function reportApiErrorTelemetry(args: {
  route: string;
  method: string;
  statusCode: number;
  errorCode?: string | null;
}) {
  if (typeof window === "undefined") return;
  const { route, method, statusCode, errorCode } = args;
  const throttleKey = `${method}:${route}:${statusCode}:${errorCode ?? ""}`;
  const now = Date.now();
  const lastSentAt = apiErrorTelemetrySentAt.get(throttleKey) ?? 0;
  if (now - lastSentAt < 10000) {
    return;
  }
  apiErrorTelemetrySentAt.set(throttleKey, now);
  void fetch("/api/pos/perf", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      route,
      source: "api_error",
      http_method: method,
      status_code: statusCode,
      error_code: errorCode ?? null,
      captured_at: new Date().toISOString()
    })
  }).catch(() => undefined);
}

async function fetchJsonWithTimeout<TBody extends ApiErrorBody>(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 25000,
  retries = 0
): Promise<{ response: Response; body: TBody }> {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const timeoutController = new AbortController();
    const upstreamSignal = init.signal;
    const timeoutId = window.setTimeout(() => timeoutController.abort(), timeoutMs);
    const onUpstreamAbort = () => timeoutController.abort();

    if (upstreamSignal) {
      if (upstreamSignal.aborted) {
        window.clearTimeout(timeoutId);
        throw new Error("Request was aborted.");
      }
      upstreamSignal.addEventListener("abort", onUpstreamAbort, { once: true });
    }

    try {
      const response = await fetch(input, {
        ...init,
        signal: timeoutController.signal
      });
      const rawText = await response.text();
      let body = {} as TBody;
      if (rawText) {
        try {
          body = JSON.parse(rawText) as TBody;
        } catch {
          const message = rawText.trimStart().startsWith("<")
            ? "Server returned an HTML error page instead of JSON. Please refresh the POS session and try again."
            : "Server returned an invalid JSON response. Please try again.";
          body = {
            error: {
              code: "invalid_json_response",
              message
            }
          } as TBody;
        }
      }
      const route = resolveApiRoute(input);
      if (route && response.status >= 400) {
        const method = (init.method ?? "GET").toUpperCase();
        const errorCode = typeof body.error?.code === "string" ? body.error.code : null;
        reportApiErrorTelemetry({
          route,
          method,
          statusCode: response.status,
          errorCode
        });
      }
      return { response, body };
    } catch (error) {
      const isUpstreamAbort = Boolean(upstreamSignal?.aborted);
      const isTimeout = timeoutController.signal.aborted && !isUpstreamAbort;
      const isRetryableNetwork = error instanceof TypeError;
      const canRetry = attempt < retries && (isTimeout || isRetryableNetwork);
      if (canRetry) {
        await new Promise((resolve) => window.setTimeout(resolve, 250 * (attempt + 1)));
        continue;
      }
      if (isTimeout) {
        throw new Error("Request timeout. Please check network/API and try again.");
      }
      if (error instanceof TypeError) {
        throw new Error("Network unavailable. Please check your connection and try again.");
      }
      throw error;
    } finally {
      window.clearTimeout(timeoutId);
      if (upstreamSignal) {
        upstreamSignal.removeEventListener("abort", onUpstreamAbort);
      }
    }
  }
  throw new Error("Failed to fetch data.");
}

function getSalesDeviceStatusLabel(status: PosSalesDevicePolicy["status"] | undefined, lang: Lang) {
  if (status === "inactive") return lang === "th" ? "ปิดใช้งาน" : "Disabled";
  if (status === "maintenance") return lang === "th" ? "บำรุงรักษา" : "Maintenance";
  if (status === "active") return lang === "th" ? "ใช้งาน" : "Active";
  return lang === "th" ? "ไม่ทราบสถานะ" : "Unknown";
}

function DeviceBlockIcon({ status }: { status: PosSalesDevicePolicy["status"] }) {
  if (status === "maintenance") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M14.7 6.3 17.7 3.3l3 3-3 3" />
        <path d="m16.9 8.1-8.8 8.8-3.4.8.8-3.4 8.8-8.8" />
        <path d="M13 19h8" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3v9" />
      <path d="M7.1 6.2a8 8 0 1 0 9.8 0" />
    </svg>
  );
}

function QuickModeIcon({ mode }: { mode: QuickMode }) {
  if (mode === "dine_in") {
    return (
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <path d="M16 47h32" fill="none" stroke="#173b76" strokeLinecap="round" strokeWidth="4" />
        <path d="M19 28h8v19h-8V28Zm18 0h8v19h-8V28Z" fill="#ffffff" stroke="#173b76" strokeLinejoin="round" strokeWidth="4" />
        <path d="M27 39h10" fill="none" stroke="#173b76" strokeLinecap="round" strokeWidth="4" />
        <circle cx="32" cy="20" r="7" fill="#f7c948" stroke="#173b76" strokeWidth="4" />
        <path d="M14 29c5-7 11-11 18-11s13 4 18 11" fill="none" stroke="#2f6fe4" strokeLinecap="round" strokeWidth="4" />
      </svg>
    );
  }

  if (mode === "delivery") {
    return (
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <path d="M13 31H5v-9h15v8" fill="#2f6fe4" stroke="#173b76" strokeLinejoin="round" strokeWidth="4" />
        <path d="M8 27h7" fill="none" stroke="#ffffff" strokeLinecap="round" strokeWidth="3" />
        <path d="M22 44h18l6-13h-9l-4-8h-9l-5 21Z" fill="#ffffff" stroke="#173b76" strokeLinejoin="round" strokeWidth="4" />
        <path d="M40 44h11l5-8-10-5" fill="#ffffff" stroke="#173b76" strokeLinejoin="round" strokeWidth="4" />
        <circle cx="27" cy="46" r="6" fill="#f7c948" stroke="#173b76" strokeWidth="4" />
        <circle cx="49" cy="46" r="6" fill="#f7c948" stroke="#173b76" strokeWidth="4" />
        <circle cx="47" cy="18" r="5" fill="#2f6fe4" stroke="#173b76" strokeWidth="4" />
        <path d="M45 24l-5 9 8 3 3-8" fill="none" stroke="#173b76" strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" />
        <path d="M7 39h8M4 45h9" fill="none" stroke="#2f6fe4" strokeLinecap="round" strokeWidth="4" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <path d="M10 30 32 12l22 18" fill="none" stroke="#173b76" strokeLinecap="round" strokeLinejoin="round" strokeWidth="5" />
      <path d="M16 28v24h32V28" fill="#ffffff" stroke="#173b76" strokeLinejoin="round" strokeWidth="4" />
      <path d="M20 27 32 17l12 10" fill="none" stroke="#2f6fe4" strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" />
      <path d="M26 34h12l3 16H23l3-16Z" fill="#2f6fe4" stroke="#173b76" strokeLinejoin="round" strokeWidth="4" />
      <path d="M29 34v-5a3 3 0 0 1 6 0v5" fill="none" stroke="#ffffff" strokeLinecap="round" strokeWidth="3" />
      <path d="M32 41v3" fill="none" stroke="#f7c948" strokeLinecap="round" strokeWidth="4" />
    </svg>
  );
}

function PosDeviceBlockedOverlay({
  devicePolicy,
  lang,
  text,
  onRetry
}: {
  devicePolicy: PosSalesDevicePolicy;
  lang: Lang;
  text: (typeof uiText)[Lang];
  onRetry: () => void;
}) {
  const isMaintenance = devicePolicy.status === "maintenance";
  const title = isMaintenance ? text.deviceBlockedMaintenanceTitle : text.deviceBlockedInactiveTitle;
  const body = isMaintenance ? text.deviceBlockedMaintenanceBody : text.deviceBlockedInactiveBody;
  const statusLabel = getSalesDeviceStatusLabel(devicePolicy.status, lang);
  const deviceCode = devicePolicy.code || devicePolicy.name || "-";
  return (
    <div
      className={`posui-device-blocker ${isMaintenance ? "posui-device-blocker--maintenance" : "posui-device-blocker--inactive"}`}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="pos-device-blocker-title"
      aria-describedby="pos-device-blocker-body"
    >
      <section className="posui-device-blocker__panel">
        <div className="posui-device-blocker__icon">
          <DeviceBlockIcon status={devicePolicy.status} />
        </div>
        <div className="posui-device-blocker__content">
          <p className="posui-device-blocker__eyebrow">CpIPOS</p>
          <h2 id="pos-device-blocker-title">{title}</h2>
          <p id="pos-device-blocker-body">{body}</p>
          <dl className="posui-device-blocker__meta">
            <div>
              <dt>{text.deviceBlockedStatusLabel}</dt>
              <dd>{statusLabel}</dd>
            </div>
            <div>
              <dt>{text.deviceBlockedCodeLabel}</dt>
              <dd>{deviceCode}</dd>
            </div>
          </dl>
          <p className="posui-device-blocker__hint">{text.deviceBlockedActionHint}</p>
          <button type="button" className="posui-btn posui-btn--primary" onClick={onRetry}>
            {text.retryLoad}
          </button>
        </div>
      </section>
    </div>
  );
}

function formatHeldAt(value: string, lang: Lang): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(lang === "th" ? "th-TH" : "en-US", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "Asia/Bangkok"
  }).format(parsed);
}

function normalizeHeldBillStatusHistory(entry: HeldBill): DeliveryPendingStatusHistoryEntry[] {
  if (entry.order_type !== "delivery_manual") {
    return [];
  }
  if (Array.isArray(entry.status_history) && entry.status_history.length > 0) {
    return entry.status_history;
  }
  return [
    {
      status: entry.queue_status ?? "pending",
      at: entry.held_at,
      note: null
    }
  ];
}

function normalizeHeldBillEntry(entry: HeldBill): HeldBill {
  if (entry.order_type !== "delivery_manual") {
    return entry;
  }
  const history = normalizeHeldBillStatusHistory(entry);
  const latestStatus = history[history.length - 1]?.status ?? entry.queue_status ?? "pending";
  return {
    ...entry,
    queue_status: latestStatus,
    status_history: history
  };
}

function formatReceiptDateTime(value: string, lang: Lang): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(lang === "th" ? "th-TH" : "en-US", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "Asia/Bangkok"
  }).format(parsed);
}

function normalizeTransferVerificationIssues(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0);
}

function getTransferVerificationStatusTone(status: TableBillTransferVerificationPayload["verification_status"]): "pass" | "fail" | "warn" {
  if (status === "passed" || status === "override_passed") {
    return "pass";
  }
  if (status === "failed") {
    return "fail";
  }
  return "warn";
}

function formatIngredientUnit(unit: string | null | undefined, lang: Lang): string {
  const normalized = String(unit ?? "").trim().toLowerCase();
  const thaiUnits: Record<string, string> = {
    g: "กรัม",
    gram: "กรัม",
    grams: "กรัม",
    kg: "กิโลกรัม",
    kilogram: "กิโลกรัม",
    kilograms: "กิโลกรัม",
    khid: "ขีด",
    ml: "มิลลิลิตร",
    milliliter: "มิลลิลิตร",
    milliliters: "มิลลิลิตร",
    l: "ลิตร",
    liter: "ลิตร",
    liters: "ลิตร",
    piece: "ชิ้น",
    pieces: "ชิ้น",
    pcs: "ชิ้น",
    unit: "ชิ้น",
    units: "ชิ้น",
    pack: "แพ็ก",
    packs: "แพ็ก",
    bottle: "ขวด",
    bottles: "ขวด",
    portion: "ส่วน",
    portions: "ส่วน"
  };
  const englishUnits: Record<string, string> = {
    g: "gram",
    gram: "gram",
    grams: "gram",
    kg: "kg",
    kilogram: "kg",
    kilograms: "kg",
    khid: "khid",
    ml: "ml",
    milliliter: "ml",
    milliliters: "ml",
    l: "liter",
    liter: "liter",
    liters: "liter",
    piece: "piece",
    pieces: "piece",
    pcs: "piece",
    unit: "piece",
    units: "piece",
    pack: "pack",
    packs: "pack",
    bottle: "bottle",
    bottles: "bottle",
    portion: "portion",
    portions: "portion"
  };
  if (!normalized) return lang === "th" ? "หน่วย" : "unit";
  return lang === "th" ? thaiUnits[normalized] ?? unit ?? "หน่วย" : englishUnits[normalized] ?? unit ?? "unit";
}

function formatIngredientAmount(value: number, lang: Lang): string {
  return Number(value).toLocaleString(lang === "th" ? "th-TH" : "en-US", {
    maximumFractionDigits: 2
  });
}

function splitModifierNotes(notes: string): string[] {
  return notes
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function stripIngredientNoteQuantity(value: string): string {
  return value
    .replace(/\s*(?:x|X|×)\s*\d+$/u, "")
    .replace(/\s*\((?:x|X|×)\s*\d+\)$/u, "")
    .trim();
}

function formatIngredientNote(name: string, quantity: number): string {
  const normalizedQuantity = Math.max(1, Math.trunc(Number(quantity || 1)));
  return normalizedQuantity > 1 ? `${name} x${normalizedQuantity}` : name;
}

function readIngredientNoteQuantity(notes: string): number {
  for (const part of splitModifierNotes(notes)) {
    const match = part.match(/(?:x|X|×)\s*(\d+)$/u) ?? part.match(/\((?:x|X|×)\s*(\d+)\)$/u);
    const quantity = Number(match?.[1] ?? 0);
    if (Number.isFinite(quantity) && quantity > 0) {
      return Math.trunc(quantity);
    }
  }
  return 1;
}

function isIngredientSelectedInNotes(notes: string, ingredientName: string): boolean {
  const normalizedName = ingredientName.trim().toLowerCase();
  return splitModifierNotes(notes).some((part) => stripIngredientNoteQuantity(part).toLowerCase() === normalizedName);
}

function hasSelectedIngredientInNotes(notes: string, ingredients: RecipeIngredientChoice[]): boolean {
  return ingredients.some((ingredient) => isIngredientSelectedInNotes(notes, ingredient.name));
}

function toggleIngredientInNotes(notes: string, ingredientName: string, quantity: number): string {
  const normalizedName = ingredientName.trim().toLowerCase();
  const parts = splitModifierNotes(notes);
  const exists = parts.some((part) => stripIngredientNoteQuantity(part).toLowerCase() === normalizedName);
  const nextParts = exists
    ? parts.filter((part) => stripIngredientNoteQuantity(part).toLowerCase() !== normalizedName)
    : [...parts, formatIngredientNote(ingredientName.trim(), quantity)];
  return nextParts.join(", ");
}

function updateSelectedIngredientNoteQuantity(notes: string, ingredients: RecipeIngredientChoice[], quantity: number): string {
  const ingredientNames = new Map(ingredients.map((ingredient) => [ingredient.name.trim().toLowerCase(), ingredient.name.trim()]));
  return splitModifierNotes(notes)
    .map((part) => {
      const baseName = stripIngredientNoteQuantity(part);
      const canonicalName = ingredientNames.get(baseName.toLowerCase());
      return canonicalName ? formatIngredientNote(canonicalName, quantity) : part;
    })
    .join(", ");
}

export function PosSalesModule({ lang = "th" }: { lang?: Lang }) {
  const text = uiText[lang];
  const localizeApiMessage = useCallback((message: string) => localizeApiErrorMessage({ message, lang }), [lang]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [productOrderByBranch, setProductOrderByBranch] = useState<Record<string, string[]>>({});
  const [menuManagerOpen, setMenuManagerOpen] = useState(false);
  const [categories, setCategories] = useState<string[]>([]);
  const [allowNegativeStock, setAllowNegativeStock] = useState(false);
  const [shift, setShift] = useState<ShiftRow>(null);
  const [sellerName, setSellerName] = useState(lang === "th" ? "ไม่ทราบชื่อผู้ขาย" : "Unknown Seller");
  const [branchName, setBranchName] = useState(lang === "th" ? "ไม่ทราบสาขา" : "Unknown Branch");
  const [storeProfile, setStoreProfile] = useState<StoreProfile | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string>("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [modifierDraft, setModifierDraft] = useState<ModifierDraft | null>(null);
  const [modifierIngredients, setModifierIngredients] = useState<RecipeIngredientChoice[]>([]);
  const [modifierIngredientsLoading, setModifierIngredientsLoading] = useState(false);
  const [modifierIngredientsError, setModifierIngredientsError] = useState("");
  const [memberPickerOpen, setMemberPickerOpen] = useState(false);
  const [memberMaintenanceOpen, setMemberMaintenanceOpen] = useState(false);
  const [memberSearch, setMemberSearch] = useState("");
  const [memberSearchResults, setMemberSearchResults] = useState<PosMemberChoice[]>([]);
  const [memberSearchLoading, setMemberSearchLoading] = useState(false);
  const [memberSearchError, setMemberSearchError] = useState("");
  const [selectedMember, setSelectedMember] = useState<PosMemberChoice | null>(null);
  const [memberPointsInput, setMemberPointsInput] = useState("0");
  const [memberStampsInput, setMemberStampsInput] = useState("0");
  const [discountModalOpen, setDiscountModalOpen] = useState(false);
  const [discountPercentInput, setDiscountPercentInput] = useState("");
  const [discountAmountInput, setDiscountAmountInput] = useState("");
  const [discountEditMode, setDiscountEditMode] = useState<"percent" | "amount">("percent");
  const [quickMode, setQuickMode] = useState<QuickMode>("home");
  const [modeSelectorOpen, setModeSelectorOpen] = useState(false);
  const [salesTopbarCollapsed, setSalesTopbarCollapsed] = useState(false);
  const [enabledFeatures, setEnabledFeatures] = useState<Record<string, boolean> | null>(null);
  const [packageLockOpen, setPackageLockOpen] = useState(false);
  const [deliveryMaintenanceOpen, setDeliveryMaintenanceOpen] = useState(false);
  const [orderType, setOrderType] = useState<OrderType>("takeaway");
  const [submitting, setSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(true);
  const [pendingQueue, setPendingQueue] = useState<PendingSubmitQueueItem[]>([]);
  const [pendingPaymentQueue, setPendingPaymentQueue] = useState<PendingPaymentQueueItem[]>([]);
  const [stockModalOpen, setStockModalOpen] = useState(false);
  const [stockTargetId, setStockTargetId] = useState("");
  const [stockApprovalId, setStockApprovalId] = useState<string | null>(null);
  const [stockAdjusting, setStockAdjusting] = useState(false);
  const [stockAdjustError, setStockAdjustError] = useState<string | null>(null);
  const [outOfStockNotice, setOutOfStockNotice] = useState<{ productName: string } | null>(null);
  const [reviewItemDeductingKey, setReviewItemDeductingKey] = useState<string | null>(null);
  const [reviewItemDeductingMode, setReviewItemDeductingMode] = useState<"deduct" | "restore" | null>(null);
  const [reviewRecipeProductIds, setReviewRecipeProductIds] = useState<Set<string>>(new Set());
  const [reviewRecipeProductIdsLoaded, setReviewRecipeProductIdsLoaded] = useState(false);
  const [ingredientAdjustDialog, setIngredientAdjustDialog] = useState<{
    order: CheckoutReviewOrder;
    item: CartItem;
    mode: "deduct" | "restore";
  } | null>(null);
  const [ingredientAdjustOptions, setIngredientAdjustOptions] = useState<ReviewItemIngredientOption[]>([]);
  const [ingredientAdjustSelectedIds, setIngredientAdjustSelectedIds] = useState<string[]>([]);
  const [ingredientAdjustLoading, setIngredientAdjustLoading] = useState(false);
  const [ingredientAdjustError, setIngredientAdjustError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [heldBills, setHeldBills] = useState<HeldBill[]>([]);
  const [dineInDraftByTableId, setDineInDraftByTableId] = useState<Record<string, CartItem[]>>({});
  const [heldBillsModalOpen, setHeldBillsModalOpen] = useState(false);
  const [heldBillSearch, setHeldBillSearch] = useState("");
  const [cartDrawerOpen, setCartDrawerOpen] = useState(false);
  const [editingCartQtyLineId, setEditingCartQtyLineId] = useState<string | null>(null);
  const [editingCartQtyInput, setEditingCartQtyInput] = useState("");
  const [tableZones, setTableZones] = useState<TableZoneItem[]>([]);
  const [posTables, setPosTables] = useState<DiningTableItem[]>([]);
  const [tableLayoutObjects, setTableLayoutObjects] = useState<FloorPlanObjectItem[]>([]);
  const [selectedTable, setSelectedTable] = useState<DiningTableItem | null>(null);
  const [buffetPicker, setBuffetPicker] = useState<BuffetTablePickerState>({
    open: false,
    table: null,
    prompted_table_id: null
  });
  const [dineInSessionBillNo, setDineInSessionBillNo] = useState<string | null>(null);
  const [tableBrowserOpen, setTableBrowserOpen] = useState(false);
  const [tableViewMode, setTableViewModeState] = useState<TableViewMode>(() => {
    if (typeof window === "undefined") return "list";
    return window.localStorage.getItem(POS_TABLE_VIEW_MODE_STORAGE_KEY) === "floor" ? "floor" : "list";
  });
  const tableViewModeRef = useRef<TableViewMode>(tableViewMode);
  const [tableZoneFilter, setTableZoneFilter] = useState("all");
  const [tableZoom, setTableZoom] = useState(1);
  const [tablePan, setTablePan] = useState({ x: 0, y: 0 });
  const [pendingRestoreTableId, setPendingRestoreTableId] = useState<string | null>(null);
  const [tableMoveModalOpen, setTableMoveModalOpen] = useState(false);
  const [tableMoveTargetId, setTableMoveTargetId] = useState("");
  const [tableMoveReason, setTableMoveReason] = useState("");
  const [tableMoveBusy, setTableMoveBusy] = useState(false);
  const [tableSwitching, setTableSwitching] = useState(false);
  const [tableQrModalOpen, setTableQrModalOpen] = useState(false);
  const [, setTableQrBusy] = useState(false);
  const [tableMoveError, setTableMoveError] = useState<string | null>(null);
  const [tableLoading, setTableLoading] = useState(false);
  const [tableLoadError, setTableLoadError] = useState<string | null>(null);
  const [tableTransferVerifications, setTableTransferVerifications] = useState<TableBillTransferVerificationPayload[]>([]);
  const [cancelBillApprovalOpen, setCancelBillApprovalOpen] = useState(false);
  const [cancelBillTargetOrder, setCancelBillTargetOrder] = useState<ActiveOrder | null>(null);
  const [activeOrder, setActiveOrder] = useState<ActiveOrder | null>(null);
  const [billPaymentMethod, setBillPaymentMethod] = useState<BillPaymentMethod>(null);
  const [reviewOrder, setReviewOrder] = useState<CheckoutReviewOrder | null>(null);
  const [takeawayCreatingPreview, setTakeawayCreatingPreview] = useState<TakeawayCreatingPreview | null>(null);
  const [cashReviewOrder, setCashReviewOrder] = useState<CheckoutReviewOrder | null>(null);
  const [cashNoticeMessage, setCashNoticeMessage] = useState<string | null>(null);
  const [transferReviewOrder, setTransferReviewOrder] = useState<CheckoutReviewOrder | null>(null);
  const [transferReference, setTransferReference] = useState("");
  const [promptPayPhone, setPromptPayPhone] = useState(DEFAULT_PROMPTPAY_PHONE);
  const [paymentAccount, setPaymentAccount] = useState<PaymentAccountSnapshot | null>(null);
  const [paymentProviders, setPaymentProviders] = useState<PaymentProvidersSnapshot>({});
  const [transferPaymentMode, setTransferPaymentMode] = useState<TransferPaymentMode>("manual");
  const [inetPaymentIntent, setInetPaymentIntent] = useState<InetPaymentIntentState | null>(null);
  const [inetQrStatus, setInetQrStatus] = useState<"idle" | "creating" | "pending" | "paid" | "failed">("idle");
  const [taxSettings, setTaxSettings] = useState<TaxSettings>(DEFAULT_TAX_SETTINGS);
  const [tableQrNotificationSettings, setTableQrNotificationSettings] = useState<TableQrNotificationSettings>(DEFAULT_TABLE_QR_NOTIFICATION_SETTINGS);
  const [tableQrAlert, setTableQrAlert] = useState<{ id: string; type: "call_staff" | "request_checkout"; tableCode: string; note?: string | null } | null>(null);
  const [seenTableQrActivity, setSeenTableQrActivity] = useState<Record<string, string>>(() => readStoredJson<Record<string, string>>(TABLE_QR_ACTIVITY_SEEN_KEY) ?? {});
  const [devicePolicy, setDevicePolicy] = useState<PosSalesDevicePolicy | null>(null);
  const [transferSlipFile, setTransferSlipFile] = useState<File | null>(null);
  const [transferSlipPreviewUrl, setTransferSlipPreviewUrl] = useState<string | null>(null);
  const [transferSlipParsed, setTransferSlipParsed] = useState<SlipExtractPayload | null>(null);
  const [transferSlipChecks, setTransferSlipChecks] = useState<SlipVerifyChecks | null>(null);
  const [transferSlipIssues, setTransferSlipIssues] = useState<string[]>([]);
  const [transferSlipVerified, setTransferSlipVerified] = useState(false);
  const [transferSlipVerifiedAgainst, setTransferSlipVerifiedAgainst] = useState<string | null>(null);
  const [transferSlipVerificationId, setTransferSlipVerificationId] = useState<string | null>(null);
  const [transferOverrideApprovalId, setTransferOverrideApprovalId] = useState<string | null>(null);
  const [transferOverrideModalOpen, setTransferOverrideModalOpen] = useState(false);
  const [transferSlipChecking, setTransferSlipChecking] = useState(false);
  const [transferSubmitting, setTransferSubmitting] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [cashReceivedInput, setCashReceivedInput] = useState("");
  const [cashReplaceOnNextKey, setCashReplaceOnNextKey] = useState(false);
  const [cashSubmitting, setCashSubmitting] = useState(false);
  const [cashError, setCashError] = useState<string | null>(null);
  const [cashDrawerOpening, setCashDrawerOpening] = useState(false);
  const [cashDrawerCoolingDown, setCashDrawerCoolingDown] = useState(false);
  const [cashDrawerConfigured, setCashDrawerConfigured] = useState(false);
  const [receiptSession, setReceiptSession] = useState<ReceiptSession | null>(null);
  const [receiptSaving, setReceiptSaving] = useState(false);
  const [receiptSaved, setReceiptSaved] = useState(false);
  const [receiptAutoPrinted, setReceiptAutoPrinted] = useState(false);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [cancelBillSubmitting, setCancelBillSubmitting] = useState(false);

  const updateTableViewMode = useCallback((value: TableViewMode) => {
    tableViewModeRef.current = value;
    setTableViewModeState(value);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(POS_TABLE_VIEW_MODE_STORAGE_KEY, value);
    }
  }, []);
  const [branchMonitor, setBranchMonitor] = useState<BranchMonitor | null>(null);
  const [hasRenderableData, setHasRenderableData] = useState(false);
  const [selectedDeliveryApp, setSelectedDeliveryApp] = useState<DeliveryApp["id"] | null>(null);
  const [deliveryExternalCode, setDeliveryExternalCode] = useState("");
  const [deliveryCustomerName, setDeliveryCustomerName] = useState("");
  const [deliveryNotes, setDeliveryNotes] = useState("");
  const [deliveryDraftBillNo, setDeliveryDraftBillNo] = useState<string | null>(null);
  const [deliveryEditingHeldBillId, setDeliveryEditingHeldBillId] = useState<string | null>(null);
  const [deliveryPopupAppId, setDeliveryPopupAppId] = useState<DeliveryApp["id"] | null>(null);
  const [deliveryPopupCodeDigits, setDeliveryPopupCodeDigits] = useState("");
  const [deliveryPopupNotes, setDeliveryPopupNotes] = useState("");
  const [deliveryCatalogOpen, setDeliveryCatalogOpen] = useState(false);
  const [deliveryFlowState, setDeliveryFlowState] = useState<DeliveryFlowState>("create");
  const [deliveryConfigs, setDeliveryConfigs] = useState<DeliveryChannelConfigRow[]>([]);
  const [deliveryPricesByProduct, setDeliveryPricesByProduct] = useState<Record<string, Record<string, number>>>({});
  const [deliveryActionBusyById, setDeliveryActionBusyById] = useState<Record<string, "send" | "cancel">>({});
  const [deliveryLogoFallback, setDeliveryLogoFallback] = useState<Record<DeliveryApp["id"], boolean>>({
    lineman: false,
    grabfood: false,
    shopeefood: false
  });
  const pending = pendingQueue[0] ?? null;
  const pendingPayment = pendingPaymentQueue[0] ?? null;
  const deviceSalesBlocked = devicePolicy?.block_sales === true;
  const hasRenderableDataRef = useRef(false);
  const idAppLoginUrl = "/login/store";
  const errorText = error ?? "";
  const needsLogin =
    Boolean(errorText) &&
    !hasRenderableData &&
    /(missing_pos_session|not authenticated|tenant\/branch claims|authentication failed|unauthorized)/i.test(errorText);
  const receiptModalClosedRef = useRef(false);
  const checkoutRequestLockRef = useRef(false);
  const cartPersistTimerRef = useRef<number | null>(null);
  const heldPersistTimerRef = useRef<number | null>(null);
  const dineInDraftPersistTimerRef = useRef<number | null>(null);
  const activeOrderPersistTimerRef = useRef<number | null>(null);
  const pendingQueuePersistTimerRef = useRef<number | null>(null);
  const pendingPaymentQueuePersistTimerRef = useRef<number | null>(null);
  const productOrderLoadedRef = useRef(false);
  const customerDisplayPublishTimerRef = useRef<number | null>(null);
  const customerDisplayPublishedSignatureRef = useRef("");
  const customerDisplayPublishInFlightRef = useRef(false);
  const customerDisplayPendingRef = useRef<{ signature: string; payload: Record<string, unknown> } | null>(null);
  const replayingPendingRef = useRef(false);
  const replayingPendingPaymentRef = useRef(false);
  const receiptPrintFrameRef = useRef<HTMLIFrameElement | null>(null);
  const receiptPrintFrameHtmlRef = useRef("");
  const receiptPrintFrameLoadTokenRef = useRef(0);
  const primeReceiptPrintFrameRef = useRef<(session: ReceiptSession) => Promise<HTMLIFrameElement>>(async () => {
    throw new Error("receipt_print_frame_not_ready");
  });
  const submitOrderRef = useRef<(payload: PendingSubmit, options?: { applyUiResult?: boolean }) => Promise<ActiveOrder | null>>(async () => null);
  const submitTransferPaymentRef = useRef<(pendingPaymentEntry: PendingPaymentQueueItem, applyUiResult: boolean) => Promise<void>>(async () => {});
  const fetchPosTablesRef = useRef(fetchPosTables);
  const pushSubmitMessageRef = useRef(pushSubmitMessage);
  const buildReceiptPrintHtmlRef = useRef<(session: ReceiptSession) => string>(() => "");
  const deliveryActionQueueByBillRef = useRef<Map<string, Promise<void>>>(new Map());
  const deliveryActionLockRef = useRef<Set<string>>(new Set());
  const deliveryActionLastAtRef = useRef<Map<string, number>>(new Map());
  const deliveryActionPendingKeyRef = useRef<Set<string>>(new Set());
  const monitorPollInFlightRef = useRef(false);
  const taxSettingsSyncInFlightRef = useRef<Promise<TaxSettings | null> | null>(null);
  const tableListFetchInFlightRef = useRef<Promise<DiningTableItem[]> | null>(null);
  const tableListCacheRef = useRef<{ at: number; zones: TableZoneItem[]; tables: DiningTableItem[]; objects: FloorPlanObjectItem[] } | null>(null);
  const lastPendingRef = useRef(false);
  const transferSlipInputRef = useRef<HTMLInputElement | null>(null);
  const tableBillLoadRequestRef = useRef(0);
  const tableBillPrefetchCacheRef = useRef<Map<string, TableBillDataPayload>>(new Map());
  const tableBillPrefetchCacheUpdatedAtRef = useRef<Map<string, number>>(new Map());
  const tableBillPrefetchInFlightRef = useRef<Set<string>>(new Set());
  const tableBillLoadInFlightRef = useRef<Set<string>>(new Set());
  const tableBillReloadPendingRef = useRef<Set<string>>(new Set());
  const tableBillIntentPrefetchedAtRef = useRef<Map<string, number>>(new Map());
  const tableQrOrderSeenRef = useRef<Set<string>>(new Set());
  const tableQrOrderPollCursorRef = useRef<string>("");
  const tableQrOrderPollInFlightRef = useRef(false);
  const tableQrLatestEventByTableRef = useRef<Map<string, string>>(new Map());
  const tableQrAudioContextRef = useRef<AudioContext | null>(null);
  const loadTableBillContextRef = useRef<(table: DiningTableItem) => Promise<void>>(async () => {
    throw new Error("table_bill_loader_not_ready");
  });
  const endpointPerfPostLastAtRef = useRef<Map<string, number>>(new Map());
  const tableContextVersionRef = useRef(0);
  const selectedTableRef = useRef<DiningTableItem | null>(null);
  const cartRef = useRef<CartItem[]>([]);
  const dineInDraftByTableIdRef = useRef<Record<string, CartItem[]>>({});
  const committedDineInCartByTableIdRef = useRef<Record<string, CartItem[]>>({});
  const previousOrderTypeRef = useRef<OrderType>("takeaway");

  useEffect(() => {
    let cancelled = false;
    async function loadFeatures() {
      try {
        const response = await fetch("/api/pos/features", { cache: "no-store" });
        const body = (await response.json().catch(() => null)) as { data?: { features?: Record<string, boolean> } | null } | null;
        if (!cancelled && response.ok) {
          setEnabledFeatures(body?.data?.features ?? {});
        }
      } catch {
        if (!cancelled) setEnabledFeatures({});
      }
    }
    void loadFeatures();
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshTaxSettings = useCallback(async (): Promise<TaxSettings | null> => {
    if (typeof window === "undefined" || !navigator.onLine) return null;
    if (taxSettingsSyncInFlightRef.current) return taxSettingsSyncInFlightRef.current;
    const syncRequest = (async (): Promise<TaxSettings | null> => {
      try {
        const taxResponse = await fetchJsonWithTimeout<{ data?: { tax_settings?: TaxSettings }; error?: { message?: string } }>(
          "/api/pos/sales?resource=tax-settings",
          { cache: "no-store" },
          10000,
          0
        );
        if (!taxResponse.response.ok || taxResponse.body.error || !taxResponse.body.data?.tax_settings) return null;
        const nextTaxSettings = taxResponse.body.data.tax_settings;
        setTaxSettings(nextTaxSettings);
        const savedSales = readStoredJson<PosSalesSnapshot>(SALES_SNAPSHOT_KEY);
        if (savedSales) {
          localStorage.setItem(SALES_SNAPSHOT_KEY, JSON.stringify({ ...savedSales, tax_settings: nextTaxSettings }));
        }
        return nextTaxSettings;
      } catch {
        // Keep the current sales screen usable; order submission still recalculates tax on the server.
        return null;
      }
    })();
    taxSettingsSyncInFlightRef.current = syncRequest;
    try {
      return await syncRequest;
    } finally {
      if (taxSettingsSyncInFlightRef.current === syncRequest) {
        taxSettingsSyncInFlightRef.current = null;
      }
    }
  }, []);
  const [lastCommittedCartSignature, setLastCommittedCartSignature] = useState<string | null>(null);
  const productById = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const normalizedDeliveryPricesByProduct = useMemo(() => {
    const nextMap = new Map<string, Map<string, number>>();
    for (const [productId, channelPrices] of Object.entries(deliveryPricesByProduct)) {
      const channelMap = new Map<string, number>();
      for (const [channelKey, rawPrice] of Object.entries(channelPrices ?? {})) {
        const numericPrice = Number(rawPrice);
        if (Number.isFinite(numericPrice)) {
          channelMap.set(String(channelKey).toLowerCase(), numericPrice);
        }
      }
      nextMap.set(productId, channelMap);
    }
    return nextMap;
  }, [deliveryPricesByProduct]);
  function mapDeliveryChannel(appId: DeliveryApp["id"] | null): string {
    if (appId === "lineman") return "line_man";
    if (appId === "grabfood") return "grab";
    if (appId === "shopeefood") return "shopee";
    return "merchant_app";
  }

  function getDeliveryChannelCandidates(appId: DeliveryApp["id"] | null): string[] {
    if (appId === "lineman") {
      return ["line_man", "lineman", "line-man", "line man"];
    }
    if (appId === "grabfood") {
      return ["grab", "grabfood", "grab_food"];
    }
    if (appId === "shopeefood") {
      return ["shopee", "shopeefood", "shopee_food"];
    }
    return ["merchant_app", "merchantapp"];
  }

  const resolveDeliveryMappedPrice = useCallback((productId: string, appId: DeliveryApp["id"] | null): number | null => {
    const channelPrices = normalizedDeliveryPricesByProduct.get(productId);
    if (!channelPrices) return null;
    for (const candidate of getDeliveryChannelCandidates(appId)) {
      const candidatePrice = channelPrices.get(candidate.toLowerCase());
      if (Number.isFinite(candidatePrice)) {
        return Number(candidatePrice);
      }
    }
    return null;
  }, [normalizedDeliveryPricesByProduct]);

  function invalidateTableUiContext() {
    tableContextVersionRef.current += 1;
    tableBillLoadRequestRef.current += 1;
  }

  function normalizeBillPaymentMethod(value: unknown): BillPaymentMethod {
    const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (normalized === "cash") return "cash";
    if (normalized === "bank_transfer") return "bank_transfer";
    return null;
  }

  function getBillPaymentMethodLabel(method: BillPaymentMethod): string {
    if (method === "cash") return text.paymentCash;
    if (method === "bank_transfer") return text.paymentTransfer;
    return text.paymentMethodNone;
  }

  function getReceiptPaymentMethodLabel(session: ReceiptSession): string {
    return getBillPaymentMethodLabel(session.payment_method);
  }

  function getReceiptMemberLabel(session: ReceiptSession): string | null {
    const memberName = session.member_name?.trim();
    const memberPhone = session.member_phone?.trim();
    const memberCode = session.member_code?.trim();
    const pointText = Number.isFinite(Number(session.member_points)) ? `${Number(session.member_points)} ${lang === "th" ? "คะแนน" : "pts"}` : "";
    const stampText = Number.isFinite(Number(session.member_stamps)) ? `${Number(session.member_stamps)} ${lang === "th" ? "แต้ม" : "stamps"}` : "";
    const identity = [memberName, memberCode ? `#${memberCode}` : "", memberPhone].filter(Boolean).join(" / ");
    const balances = [pointText, stampText].filter(Boolean).join(" / ");
    if (!identity && !balances) return null;
    return [identity, balances].filter(Boolean).join(" | ");
  }

  function parseServerDurationMs(response: Response, headerName: string): number | null {
    const rawValue = response.headers.get(headerName);
    if (!rawValue) return null;
    const parsed = Number(rawValue);
    return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : null;
  }

  function reportEndpointPerf(route: string, clientDurationMs: number, serverDurationMs: number | null, source: string) {
    const now = nowMs();
    const lastSentAt = endpointPerfPostLastAtRef.current.get(route) ?? 0;
    const shouldSend = clientDurationMs >= 700 || now - lastSentAt >= 45000;
    if (!shouldSend) return;
    endpointPerfPostLastAtRef.current.set(route, now);
    void fetch("/api/pos/perf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        route,
        source,
        nav_duration_ms: Number(clientDurationMs.toFixed(2)),
        ttfb_ms: serverDurationMs,
        captured_at: new Date().toISOString()
      })
    }).catch(() => undefined);
  }

  useEffect(() => {
    selectedTableRef.current = selectedTable;
    cartRef.current = cart;
  }, [selectedTable, cart]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let disposed = false;

    const checkActiveShift = async () => {
      try {
        const response = await fetch("/api/pos/session/current", { cache: "no-store" });
        const body = (await response.json().catch(() => null)) as {
          error?: { code?: string; message?: string } | null;
          data?: { has_active_shift?: boolean; shift?: ShiftRow | null } | null;
        } | null;
        if (disposed) return;
        if (!response.ok) {
          if (body?.error?.code === "shift_lookup_degraded") return;
          throw new Error(body?.error?.message ?? "Unable to confirm active shift.");
        }
        const activeShift = body?.data?.has_active_shift && body.data.shift?.status === "open" ? body.data.shift : null;
        if (activeShift) {
          setShift((prev) =>
            prev &&
            prev.id === activeShift.id &&
            prev.status === activeShift.status &&
            prev.opened_at === activeShift.opened_at &&
            prev.opening_cash === activeShift.opening_cash
              ? prev
              : activeShift
          );
          return;
        }
        setShift(null);
        if (window.location.pathname.includes("/preview/pos") && !window.location.pathname.includes("/preview/pos/shift")) {
          setSubmitMessage(text.openShiftRequired);
          window.location.href = "/preview/pos/shift";
        }
      } catch {
        // Guarded APIs still block sales if the shift was closed while this screen is open.
      }
    };

    const intervalId = window.setInterval(() => {
      void checkActiveShift();
    }, 15000);
    window.addEventListener("focus", checkActiveShift);

    return () => {
      disposed = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", checkActiveShift);
    };
  }, [text.openShiftRequired]);

  useEffect(() => {
    dineInDraftByTableIdRef.current = dineInDraftByTableId;
  }, [dineInDraftByTableId]);

  useEffect(() => {
    if (orderType !== "dine_in" || tableBrowserOpen || !selectedTable?.active_session_id) {
      setTableQrModalOpen(false);
    }
  }, [orderType, selectedTable?.active_session_id, tableBrowserOpen]);

  const playTableQrAlertSound = useCallback((alert: { type: "call_staff" | "request_checkout"; tableCode: string }) => {
    const settings = tableQrNotificationSettings;
    if (!settings.table_qr_sound_enabled || typeof window === "undefined") return;
    const phrase = alert.type === "call_staff"
      ? `เรียกโต๊ะ ${alert.tableCode}`
      : `โต๊ะ ${alert.tableCode} ต้องการชำระบิล`;
    try {
      if ("speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined") {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(phrase);
        utterance.lang = "th-TH";
        utterance.rate = 0.95;
        utterance.pitch = 1;
        utterance.volume = Math.max(0, Math.min(1, settings.table_qr_sound_volume));
        const thaiVoice = window.speechSynthesis
          .getVoices()
          .find((voice) => voice.lang.toLowerCase().startsWith("th"));
        if (thaiVoice) utterance.voice = thaiVoice;
        window.speechSynthesis.speak(utterance);
        return;
      }

      const AudioContextConstructor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextConstructor) return;
      const audioContext = tableQrAudioContextRef.current ?? new AudioContextConstructor();
      tableQrAudioContextRef.current = audioContext;
      const now = audioContext.currentTime;
      const volume = Math.max(0, Math.min(1, settings.table_qr_sound_volume));
      for (let index = 0; index < 2; index += 1) {
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        const startAt = now + index * 0.18;
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(index === 0 ? 880 : 1120, startAt);
        gain.gain.setValueAtTime(0.001, startAt);
        gain.gain.linearRampToValueAtTime(0.18 * volume, startAt + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, startAt + 0.14);
        oscillator.connect(gain);
        gain.connect(audioContext.destination);
        oscillator.start(startAt);
        oscillator.stop(startAt + 0.15);
      }
    } catch {
      // Some browsers block audio until a user gesture. Popup notification remains available.
    }
  }, [tableQrNotificationSettings]);

  const notifyTableQrServiceRequest = useCallback(
    (alert: { id: string; type: "call_staff" | "request_checkout"; tableCode: string; note?: string | null }) => {
      if (tableQrNotificationSettings.table_qr_popup_enabled) {
        setTableQrAlert(alert);
        window.setTimeout(() => {
          setTableQrAlert((current) => (current?.id === alert.id ? null : current));
        }, 9000);
      }
      playTableQrAlertSound(alert);
    },
    [playTableQrAlertSound, tableQrNotificationSettings.table_qr_popup_enabled]
  );

  function rememberDineInDraft(tableId: string | null | undefined, items: CartItem[]) {
    if (!tableId) return;
    const normalizedItems = items.map((entry) => ({ ...entry }));
    const nextDraftMap = { ...dineInDraftByTableIdRef.current };
    if (normalizedItems.length === 0) {
      delete nextDraftMap[tableId];
    } else {
      nextDraftMap[tableId] = normalizedItems;
    }
    dineInDraftByTableIdRef.current = nextDraftMap;
    setDineInDraftByTableId((current) => {
      const next = { ...current };
      if (items.length === 0) {
        delete next[tableId];
      } else {
        next[tableId] = normalizedItems;
      }
      return next;
    });
  }

  function invalidateTableBillCache(tableId: string) {
    tableBillPrefetchCacheRef.current.delete(tableId);
    tableBillPrefetchCacheUpdatedAtRef.current.delete(tableId);
  }
  function markTableQrActivitySeen(table: DiningTableItem) {
    const latestEventId = table.qr_activity?.latest_event_id;
    if (!latestEventId) return;
    setSeenTableQrActivity((current) => {
      if (current[table.id] === latestEventId) return current;
      const next = { ...current, [table.id]: latestEventId };
      if (typeof window !== "undefined") {
        window.localStorage.setItem(TABLE_QR_ACTIVITY_SEEN_KEY, JSON.stringify(next));
      }
      return next;
    });
  }

  function readTakeawayCartDraft(): CartItem[] {
    if (typeof window === "undefined") return [];
    const savedCart = readStoredJson<CartItem[]>(CART_KEY);
    return Array.isArray(savedCart) ? savedCart.map((entry) => ({ ...entry })) : [];
  }

  function persistTakeawayCartDraft(items: CartItem[]) {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(CART_KEY, JSON.stringify(items.map((entry) => ({ ...entry }))));
  }

  function areCartItemsEqual(left: CartItem[], right: CartItem[]): boolean {
    if (left === right) return true;
    if (left.length !== right.length) return false;
    for (let index = 0; index < left.length; index += 1) {
      const leftItem = left[index];
      const rightItem = right[index];
      if (
        leftItem.product_id !== rightItem.product_id ||
        leftItem.quantity !== rightItem.quantity ||
        leftItem.price !== rightItem.price
      ) {
        return false;
      }
    }
    return true;
  }

  useEffect(() => {
    const table = selectedTable;
    if (
      !isHydrated ||
      orderType !== "dine_in" ||
      tableBrowserOpen ||
      !table?.id ||
      !table.active_session_id
    ) {
      tableQrOrderSeenRef.current.clear();
      tableQrOrderPollCursorRef.current = buildTableQrOrderPollCursor();
      return;
    }

    let disposed = false;
    tableQrOrderSeenRef.current.clear();
    tableQrOrderPollCursorRef.current = buildTableQrOrderPollCursor(table.qr_activity?.latest_event_at);

    const pollTableQrOrders = async () => {
      if (disposed || tableQrOrderPollInFlightRef.current || document.visibilityState !== "visible") return;
      tableQrOrderPollInFlightRef.current = true;
      try {
        const after = encodeURIComponent(tableQrOrderPollCursorRef.current);
        const response = await fetch(`/api/pos/tables/${table.id}/qr-orders?after=${after}`, { cache: "no-store" });
        const body = (await response.json()) as {
          data?: {
            items?: Array<{
              id: string;
              event_type?: "order" | "call_staff" | "request_checkout";
              payload?: {
                note?: string | null;
                items?: Array<{ product_id?: string; quantity?: number }>;
              };
            }>;
            server_time?: string;
          };
        };
        if (!response.ok || disposed) return;
        const unseen = (body.data?.items ?? []).filter((entry) => {
          if (!entry.id || tableQrOrderSeenRef.current.has(entry.id)) return false;
          tableQrOrderSeenRef.current.add(entry.id);
          return true;
        });
        if (body.data?.server_time) {
          tableQrOrderPollCursorRef.current = body.data.server_time;
        }
        if (unseen.length === 0) return;

        for (const entry of unseen) {
          if (entry.event_type === "call_staff") {
            pushSubmitMessageRef.current(`${text.tableQrCallStaff}: ${table.table_code}`);
            notifyTableQrServiceRequest({ id: entry.id, type: "call_staff", tableCode: table.table_code, note: entry.payload?.note ?? null });
          } else if (entry.event_type === "request_checkout") {
            pushSubmitMessageRef.current(`${text.tableQrRequestCheckout}: ${table.table_code}`);
            notifyTableQrServiceRequest({ id: entry.id, type: "request_checkout", tableCode: table.table_code, note: entry.payload?.note ?? null });
          }
        }

        const orderEvents = unseen.filter((entry) => !entry.event_type || entry.event_type === "order");
        if (orderEvents.length === 0) return;

        invalidateTableBillCache(table.id);
        pushSubmitMessageRef.current(`${text.tableQrOrderReceived}: ${table.table_code}`);
        void loadTableBillContextRef.current(table).catch(() => undefined);
        void fetchPosTablesRef.current({ timeoutMs: 8000, retries: 0, silent: true }).catch(() => undefined);
      } catch {
        // QR polling is best-effort; normal table bill loading remains available.
      } finally {
        tableQrOrderPollInFlightRef.current = false;
      }
    };

    const firstPoll = window.setTimeout(() => void pollTableQrOrders(), 1200);
    const interval = window.setInterval(() => void pollTableQrOrders(), 4000);
    return () => {
      disposed = true;
      window.clearTimeout(firstPoll);
      window.clearInterval(interval);
      tableQrOrderPollInFlightRef.current = false;
    };
  }, [
    isHydrated,
    notifyTableQrServiceRequest,
    orderType,
    productById,
    selectedTable,
    tableBrowserOpen,
    text.tableQrCallStaff,
    text.tableQrOrderReceived,
    text.tableQrRequestCheckout
  ]);

  useEffect(() => {
    if (orderType !== "dine_in") return;
    if (tableBrowserOpen) return;
    if (activeOrder?.id) return;
    const tableId = selectedTable?.id;
    if (!tableId) return;
    const currentDraft = dineInDraftByTableIdRef.current[tableId] ?? [];
    if (areCartItemsEqual(currentDraft, cart)) return;
    rememberDineInDraft(tableId, cart);
  }, [activeOrder?.id, cart, orderType, selectedTable?.id, tableBrowserOpen]);

  useEffect(() => {
    if (orderType !== "delivery_manual") return;
    if (!selectedDeliveryApp) return;
    setCart((current) =>
      current.map((item) => {
        const product = productById.get(item.product_id);
        if (!product) return item;
        const mappedPrice = resolveDeliveryMappedPrice(product.id, selectedDeliveryApp);
        return {
          ...item,
          price: Number.isFinite(mappedPrice) ? Number(mappedPrice) : Number(product.price)
        };
      })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deliveryPricesByProduct, orderType, productById, selectedDeliveryApp]);

  async function fetchPosTables(options?: {
    signal?: AbortSignal;
    timeoutMs?: number;
    retries?: number;
    silent?: boolean;
  }) {
    const timeoutMs = options?.timeoutMs ?? 25000;
    const retries = options?.retries ?? 2;
    const signal = options?.signal;
    const silent = options?.silent ?? false;
    const canReuseClientRequest = !signal;
    const cachedTableList = tableListCacheRef.current;
    if (canReuseClientRequest && cachedTableList && nowMs() - cachedTableList.at <= 1500) {
      setTableZones(cachedTableList.zones);
      setPosTables(cachedTableList.tables);
      setTableLayoutObjects(cachedTableList.objects);
      setTableLoadError(null);
      return cachedTableList.tables;
    }
    if (canReuseClientRequest && tableListFetchInFlightRef.current) {
      return tableListFetchInFlightRef.current;
    }

    const loadPromise = (async () => {
      const requestStartedAt = nowMs();
      if (!silent) setTableLoading(true);
      setTableLoadError(null);
      const { response, body } = await fetchJsonWithTimeout<
        { data: { zones?: TableZoneItem[]; tables?: DiningTableItem[]; objects?: FloorPlanObjectItem[] } } & ApiErrorBody
      >(
        "/api/pos/tables",
        { cache: "no-store", signal },
        timeoutMs,
        retries
      );
      const clientDurationMs = nowMs() - requestStartedAt;
      const serverDurationMs = parseServerDurationMs(response, "x-pos-tables-ms");
      reportEndpointPerf("/api/pos/tables", clientDurationMs, serverDurationMs, "dine_in_tables_load");
      if (!response.ok || body.error) {
        const nextMessage = body.error?.message ?? "Failed to load table layout.";
        setTableLoadError(nextMessage);
        throw new Error(nextMessage);
      }
      setIsOnline(true);
      setTableLoadError(null);
      const zones = (body.data?.zones ?? []) as TableZoneItem[];
      const tables = (body.data?.tables ?? []) as DiningTableItem[];
      const objects = (body.data?.objects ?? []) as FloorPlanObjectItem[];
      const tableIds = new Set(tables.map((table) => table.id));
      for (const cachedTableId of tableBillPrefetchCacheRef.current.keys()) {
        if (!tableIds.has(cachedTableId)) {
          tableBillPrefetchCacheRef.current.delete(cachedTableId);
          tableBillPrefetchCacheUpdatedAtRef.current.delete(cachedTableId);
        }
      }
      const changedSelectedQrTable = syncTableQrActivityCache(tables);
      setTableZones(zones);
      setPosTables(tables);
      setTableLayoutObjects(objects);
      tableListCacheRef.current = { at: nowMs(), zones, tables, objects };
      setSelectedTable((current) => {
        if (!current) return null;
        return tables.find((table) => table.id === current.id) ?? null;
      });
      if (changedSelectedQrTable && orderType === "dine_in" && !tableBrowserOpen) {
        void loadTableBillContextRef.current(changedSelectedQrTable).catch(() => undefined);
      }
      // Avoid aggressive background prefetch storms after table list loads.
      // We only prefetch on user intent (hover/focus) to keep table clicks responsive.
      return tables;
    })();

    if (canReuseClientRequest) {
      tableListFetchInFlightRef.current = loadPromise;
    }

    try {
      return await loadPromise;
    } catch (error) {
      const nextMessage = error instanceof Error ? error.message : "Failed to load table layout.";
      setTableLoadError(nextMessage);
      throw error;
    } finally {
      if (canReuseClientRequest && tableListFetchInFlightRef.current === loadPromise) {
        tableListFetchInFlightRef.current = null;
      }
      if (!signal?.aborted && !silent) {
        setTableLoading(false);
      }
    }
  }

  function buildCartSignature(items: CartItem[]): string {
    return items
      .map((item) => ({
        cart_line_id: item.cart_line_id ?? item.product_id,
        product_id: item.product_id,
        quantity: Number(item.quantity),
        price: Number(item.price),
        notes: item.notes ?? ""
      }))
      .sort((left, right) => {
        if (left.cart_line_id === right.cart_line_id) {
          if (left.price === right.price) {
            return left.quantity - right.quantity;
          }
          return left.price - right.price;
        }
        return left.cart_line_id.localeCompare(right.cart_line_id);
      })
      .map((item) => `${item.cart_line_id}:${item.product_id}:${item.quantity}:${item.price}:${item.notes}`)
      .join("|");
  }

  function cloneCartItems(items: CartItem[]): CartItem[] {
    return items.map((item) => ({ ...item }));
  }

  function buildCartMergeKey(item: CartItem): string {
    return `${item.product_id}:${Number(item.price)}:${item.notes ?? ""}`;
  }

  function mergeServerCartWithLocalDraft(args: {
    serverItems: CartItem[];
    localDraft: CartItem[];
    committedBaseline: CartItem[];
  }): CartItem[] {
    const { serverItems, localDraft, committedBaseline } = args;
    if (localDraft.length === 0) return cloneCartItems(serverItems);
    if (committedBaseline.length === 0 && serverItems.length === 0) return cloneCartItems(localDraft);

    const committedQtyByKey = new Map<string, number>();
    for (const item of committedBaseline) {
      const key = buildCartMergeKey(item);
      committedQtyByKey.set(key, (committedQtyByKey.get(key) ?? 0) + Number(item.quantity ?? 0));
    }

    const next = cloneCartItems(serverItems);
    const nextIndexByKey = new Map<string, number>();
    next.forEach((item, index) => nextIndexByKey.set(buildCartMergeKey(item), index));

    for (const localItem of localDraft) {
      const key = buildCartMergeKey(localItem);
      const extraQuantity = Number(localItem.quantity ?? 0) - (committedQtyByKey.get(key) ?? 0);
      if (!Number.isFinite(extraQuantity) || extraQuantity <= 0) continue;
      const existingIndex = nextIndexByKey.get(key);
      if (existingIndex !== undefined) {
        next[existingIndex] = {
          ...next[existingIndex],
          quantity: next[existingIndex].quantity + extraQuantity
        };
      } else {
        nextIndexByKey.set(key, next.length);
        next.push({ ...localItem, quantity: extraQuantity });
      }
    }

    return next;
  }


  function syncTableQrActivityCache(tables: DiningTableItem[]): DiningTableItem | null {
    const previous = tableQrLatestEventByTableRef.current;
    const next = new Map<string, string>();
    let changedSelectedTable: DiningTableItem | null = null;
    const selectedId = selectedTableRef.current?.id ?? null;

    for (const table of tables) {
      const latestEventId = table.qr_activity?.latest_event_id ?? null;
      if (!latestEventId) continue;
      next.set(table.id, latestEventId);
      const previousEventId = previous.get(table.id) ?? null;
      const latestEventAt = table.qr_activity?.latest_event_at;
      const latestEventMs = latestEventAt ? new Date(latestEventAt).getTime() : Number.NaN;
      const cachedAt = tableBillPrefetchCacheUpdatedAtRef.current.get(table.id) ?? 0;
      const cacheIsOlderThanQr = cachedAt > 0 && Number.isFinite(latestEventMs) && latestEventMs > cachedAt;
      if (previousEventId !== latestEventId || cacheIsOlderThanQr) {
        invalidateTableBillCache(table.id);
        if (selectedId === table.id) changedSelectedTable = table;
      }
    }

    tableQrLatestEventByTableRef.current = next;
    return changedSelectedTable;
  }
  function returnToDineInTableBrowserAfterPayment() {
    invalidateTableUiContext();
    const lastSelectedTableId = selectedTableRef.current?.id ?? null;
    setDineInSessionBillNo(null);
    setSelectedTable(null);
    setActiveOrder(null);
    setCart([]);
    setTableTransferVerifications([]);
    setBillPaymentMethod(null);
    setQuickMode("dine_in");
    setOrderType("dine_in");
    setTableViewModeState(tableViewModeRef.current);
    setTableBrowserOpen(true);
    setLastCommittedCartSignature(null);
    if (lastSelectedTableId) {
      setPosTables((current) =>
        current.map((table) =>
          table.id === lastSelectedTableId
            ? { ...table, status: "available", active_session_id: null, active_order_id: null }
            : table
        )
      );
    }
    if (typeof window !== "undefined") {
      localStorage.removeItem(DINE_IN_SELECTED_TABLE_KEY);
    }
    window.setTimeout(() => {
      void fetchPosTablesRef.current({ timeoutMs: 10000, retries: 0 }).catch(() => undefined);
    }, 450);
  }

  function resetDeliveryDraft() {
    setSelectedDeliveryApp(null);
    setDeliveryExternalCode("");
    setDeliveryCustomerName("");
    setDeliveryNotes("");
    setDeliveryDraftBillNo(null);
    setDeliveryEditingHeldBillId(null);
    setDeliveryPopupAppId(null);
    setDeliveryPopupCodeDigits("");
    setDeliveryPopupNotes("");
    setDeliveryCatalogOpen(false);
  }

  function clearClosedBillUiState(options: { clearReceipt?: boolean; tableId?: string | null; resetDelivery?: boolean } = {}) {
    const tableId = options.tableId ?? selectedTableRef.current?.id ?? null;
    setActiveOrder(null);
    setLastCommittedCartSignature(null);
    setCart([]);
    persistTakeawayCartDraft([]);
    if (tableId) {
      rememberDineInDraft(tableId, []);
    }
    setTakeawayCreatingPreview(null);
    setReviewOrder(null);
    setCashReviewOrder(null);
    setTransferReviewOrder(null);
    setTransferReference("");
    setTransferError(null);
    setTransferSlipFile(null);
    if (transferSlipPreviewUrl) {
      URL.revokeObjectURL(transferSlipPreviewUrl);
    }
    setTransferSlipPreviewUrl(null);
    setTransferSlipParsed(null);
    setTransferSlipChecks(null);
    setTransferSlipIssues([]);
    setTransferSlipVerified(false);
    setTransferSlipVerifiedAgainst(null);
    setTransferSlipVerificationId(null);
    setTransferOverrideApprovalId(null);
    setTransferOverrideModalOpen(false);
    setCashReceivedInput("");
    setCashReplaceOnNextKey(false);
    setCashError(null);
    setReceiptError(null);
    setReceiptSaving(false);
    setTableTransferVerifications([]);
    setBillPaymentMethod(null);
    setCancelBillApprovalOpen(false);
    setCancelBillTargetOrder(null);
    if (options.clearReceipt !== false) {
      setReceiptSession(null);
      setReceiptSaved(false);
    }
    if (options.resetDelivery !== false && (orderType === "delivery_manual" || quickMode === "delivery")) {
      resetDeliveryDraft();
    }
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(CART_KEY);
      window.localStorage.removeItem(DINE_IN_SELECTED_TABLE_KEY);
    }
  }

  function getDeliveryOrderPrefix(appId: DeliveryApp["id"] | null): string {
    if (appId === "lineman") return "LM";
    if (appId === "grabfood") return "GF";
    if (appId === "shopeefood") return "SF";
    return "DL";
  }

  function extractDeliveryCodeDigits(appId: DeliveryApp["id"] | null, code: string): string {
    const trimmed = code.trim();
    if (!trimmed) return "";
    const prefix = getDeliveryOrderPrefix(appId);
    if (trimmed.toUpperCase().startsWith(`${prefix}-`)) {
      return trimmed.slice(prefix.length + 1).replace(/\D/g, "");
    }
    return trimmed.replace(/\D/g, "");
  }

  function buildDeliveryExternalCode(appId: DeliveryApp["id"] | null, digits: string): string {
    const cleanedDigits = digits.replace(/\D/g, "");
    return `${getDeliveryOrderPrefix(appId)}-${cleanedDigits}`;
  }

  function buildDeliveryDraftBillNo(appId: DeliveryApp["id"], externalCode: string): string {
    const digits = extractDeliveryCodeDigits(appId, externalCode).slice(-6).padStart(6, "0");
    const suffix = getDeliveryOrderPrefix(appId);
    return `DEL-${suffix}-${digits}`;
  }

  const getProductPriceForCurrentMode = useCallback((product: ProductRow): number => {
    if (orderType !== "delivery_manual") {
      return Number(product.price);
    }
    const mappedPrice = resolveDeliveryMappedPrice(product.id, selectedDeliveryApp);
    if (Number.isFinite(mappedPrice)) {
      return Number(mappedPrice);
    }
    return Number(product.price);
  }, [orderType, resolveDeliveryMappedPrice, selectedDeliveryApp]);

  function normalizeDeliveryCartItemsForApp(items: CartItem[], appId: DeliveryApp["id"] | null): CartItem[] {
    return items.map((item) => {
      const product = productById.get(item.product_id);
      if (!product) return item;
      const mappedPrice = resolveDeliveryMappedPrice(product.id, appId);
      const nextPrice = Number.isFinite(mappedPrice) ? Number(mappedPrice) : Number(product.price);
      if (item.price === nextPrice) return item;
      return {
        ...item,
        price: nextPrice
      };
    });
  }

  function getTableBillItemName(item: TableBillItemPayload): string {
    const relation = item.products;
    const relationName =
      Array.isArray(relation) ? relation[0]?.name : relation && typeof relation === "object" ? relation.name : undefined;
    if (typeof relationName === "string" && relationName.trim()) {
      return relationName.trim();
    }
    const fromCatalog = products.find((product) => product.id === item.product_id)?.name;
    if (typeof fromCatalog === "string" && fromCatalog.trim()) {
      return fromCatalog;
    }
    return item.product_id;
  }

  function applyTableBillPayload(table: DiningTableItem, data: TableBillDataPayload) {
    const session = data.session ?? null;
    const order = data.order ?? null;
    const items = (data.items ?? []) as TableBillItemPayload[];
    const payments = (data.payments ?? []) as TableBillPaymentPayload[];
    const transferVerifications = (data.transfer_verifications ?? []) as TableBillTransferVerificationPayload[];
    const draftItems = dineInDraftByTableIdRef.current[table.id] ?? [];
    const isActiveSelectedTable = selectedTableRef.current?.id === table.id;
    const activeCartSnapshot = isActiveSelectedTable ? cartRef.current.map((item) => ({ ...item })) : [];
    const orderTaxLines = normalizeTaxLineSnapshots(order?.metadata?.tax_lines);
    const orderTaxTotal = Number(order?.tax_total ?? orderTaxLines.reduce((sum, line) => sum + line.amount, 0));
    const mappedOrderItems = items.map((item) => ({
      product_id: item.product_id,
      quantity: Math.max(1, Number(item.quantity || 0)),
      price: Number(item.unit_price ?? 0),
      name: getTableBillItemName(item),
      notes: item.notes ?? null
    }));
    setTableTransferVerifications(transferVerifications);
    const latestPaymentMethod = normalizeBillPaymentMethod(payments[0]?.method ?? null);
    setBillPaymentMethod(latestPaymentMethod);
    const nextBillNo =
      order?.order_no ??
      (session ? buildDineInSessionBillNo(table.table_code, session.opened_at, session.id) : null);
    setDineInSessionBillNo(nextBillNo);

    const nextTableWithSession: DiningTableItem = {
      ...table,
      active_session_id: session?.id ?? table.active_session_id ?? null,
      active_order_id: order?.id ?? table.active_order_id ?? null
    };
    setSelectedTable(nextTableWithSession);
    setPosTables((current) =>
      current.map((tableRow) => (tableRow.id === nextTableWithSession.id ? { ...tableRow, ...nextTableWithSession } : tableRow))
    );

    if (!order?.id || !order.order_no || !order.status) {
      setActiveOrder(null);
      setLastCommittedCartSignature(null);
      if (draftItems.length > 0) {
        setCart(draftItems);
      } else {
        setCart(activeCartSnapshot);
      }
      return;
    }

    setActiveOrder({
      id: order.id,
      order_no: order.order_no,
      status: order.status,
      order_type: order.order_type,
      channel: order.channel ?? null,
      external_order_code: order.external_order_code ?? null,
      total_amount: Number(order.total_amount ?? 0),
      tax_total: Number.isFinite(orderTaxTotal) ? Number(orderTaxTotal.toFixed(2)) : 0,
      tax_lines: orderTaxLines,
      table_id: order.table_id,
      created_at: order.created_at
    });
    const committedBaseline = committedDineInCartByTableIdRef.current[table.id] ?? [];
    const localDraftCandidate = activeCartSnapshot.length > 0 ? activeCartSnapshot : draftItems;
    const nextCartFromServer = mergeServerCartWithLocalDraft({
      serverItems: mappedOrderItems,
      localDraft: localDraftCandidate,
      committedBaseline
    });
    committedDineInCartByTableIdRef.current = {
      ...committedDineInCartByTableIdRef.current,
      [table.id]: cloneCartItems(mappedOrderItems)
    };
    setLastCommittedCartSignature(buildCartSignature(mappedOrderItems));

    if (nextCartFromServer.length > 0) {
      rememberDineInDraft(table.id, nextCartFromServer);
      setCart(nextCartFromServer);
      return;
    }
    const normalizedStatus = String(order.status ?? "").toLowerCase();
    const isClosedOrder = normalizedStatus === "cancelled" || normalizedStatus === "completed" || normalizedStatus === "paid";
    if (isClosedOrder) {
      setCart([]);
      return;
    }

    // Avoid clearing cashier-entered items when a slow open-table response returns after product taps.
    if (activeCartSnapshot.length > 0) {
      rememberDineInDraft(table.id, activeCartSnapshot);
      setCart(activeCartSnapshot);
      return;
    }

    setCart([]);
  }

  function buildTableBillContextUrl(tableId: string, options?: { lite?: boolean }): string {
    if (options?.lite) {
      return `/api/pos/tables/${tableId}/bill?lite=1`;
    }
    return `/api/pos/tables/${tableId}/bill`;
  }

  async function prefetchTableBillsForFastSwitch(tables: DiningTableItem[]) {
    if (!tableBrowserOpen) return;
    const hotCandidates = tables.filter((table) => table.status === "occupied" || table.status === "ordering");
    const warmCandidates = tables.filter(
      (table) =>
        !hotCandidates.some((candidate) => candidate.id === table.id) &&
        (table.active_session_id || table.status === "pending_payment")
    );
    const candidates = [...hotCandidates, ...warmCandidates].slice(0, 8);
    const batchSize = 4;
    for (let offset = 0; offset < candidates.length; offset += batchSize) {
      const batch = candidates.slice(offset, offset + batchSize);
      await Promise.allSettled(
        batch.map(async (table) => {
        const cachedAt = tableBillPrefetchCacheUpdatedAtRef.current.get(table.id) ?? 0;
        if (cachedAt > 0 && nowMs() - cachedAt < 45000) {
          return;
        }
        if (tableBillPrefetchInFlightRef.current.has(table.id)) {
          return;
        }
        tableBillPrefetchInFlightRef.current.add(table.id);
        try {
          const { response, body } = await fetchJsonWithTimeout<TableBillResponseBody>(
            buildTableBillContextUrl(table.id, { lite: true }),
            { cache: "no-store" },
            7000,
            0
          );
          if (!response.ok || body.error || !body.data) {
            return;
          }
          tableBillPrefetchCacheRef.current.set(table.id, body.data);
          tableBillPrefetchCacheUpdatedAtRef.current.set(table.id, nowMs());
        } finally {
          tableBillPrefetchInFlightRef.current.delete(table.id);
        }
      })
      );
    }
  }

  function prefetchTableBillOnIntent(table: DiningTableItem) {
    if (orderType !== "dine_in") return;
    if (!tableBrowserOpen || tableSwitching || tableLoading) return;
    const shouldPrefetch = table.status === "occupied" || table.status === "ordering" || Boolean(table.active_session_id);
    if (!shouldPrefetch) return;
    const cachedAt = tableBillPrefetchCacheUpdatedAtRef.current.get(table.id) ?? 0;
    if (cachedAt > 0 && nowMs() - cachedAt < 20000) return;
    if (tableBillPrefetchInFlightRef.current.has(table.id)) return;
    const now = nowMs();
    const lastPrefetchedAt = tableBillIntentPrefetchedAtRef.current.get(table.id) ?? 0;
    if (now - lastPrefetchedAt < 6000) return;
    tableBillIntentPrefetchedAtRef.current.set(table.id, now);
    tableBillPrefetchInFlightRef.current.add(table.id);
    void fetchJsonWithTimeout<TableBillResponseBody>(buildTableBillContextUrl(table.id, { lite: true }), { cache: "no-store" }, 6000, 0)
      .then(({ response, body }) => {
        if (!response.ok || body.error || !body.data) return;
        tableBillPrefetchCacheRef.current.set(table.id, body.data);
        tableBillPrefetchCacheUpdatedAtRef.current.set(table.id, nowMs());
      })
      .finally(() => {
        tableBillPrefetchInFlightRef.current.delete(table.id);
      });
  }

  async function loadTableBillContext(table: DiningTableItem) {
    if (tableBillLoadInFlightRef.current.has(table.id)) {
      tableBillReloadPendingRef.current.add(table.id);
      return;
    }
    const contextVersion = tableContextVersionRef.current;
    const requestId = ++tableBillLoadRequestRef.current;
    const requestStartedAt = nowMs();
    tableBillLoadInFlightRef.current.add(table.id);
    tableBillReloadPendingRef.current.delete(table.id);
    try {
      const { response, body } = await fetchJsonWithTimeout<TableBillResponseBody>(
        buildTableBillContextUrl(table.id),
        { cache: "no-store" },
        12000,
        0
      );
      const clientDurationMs = nowMs() - requestStartedAt;
      const serverDurationMs = parseServerDurationMs(response, "x-pos-table-bill-ms");
      reportEndpointPerf("/api/pos/tables/[tableId]/bill", clientDurationMs, serverDurationMs, "dine_in_table_bill_load");
      if (!response.ok || body.error) {
        throw new Error(body.error?.message ?? "Failed to load table bill details.");
      }
      if (requestId !== tableBillLoadRequestRef.current) {
        return;
      }
      if (contextVersion !== tableContextVersionRef.current) {
        return;
      }
      const payload = body.data;
      if (!payload) {
        throw new Error("Missing table bill payload.");
      }
      tableBillPrefetchCacheRef.current.set(table.id, payload);
      tableBillPrefetchCacheUpdatedAtRef.current.set(table.id, nowMs());
      applyTableBillPayload(table, payload);
    } finally {
      tableBillLoadInFlightRef.current.delete(table.id);
      if (tableBillReloadPendingRef.current.has(table.id) && selectedTableRef.current?.id === table.id) {
        tableBillReloadPendingRef.current.delete(table.id);
        window.setTimeout(() => {
          void loadTableBillContextRef.current(selectedTableRef.current ?? table).catch(() => undefined);
        }, 150);
      }
    }
  }

  async function fetchBranchMonitor(signal?: AbortSignal) {
    const { response, body } = await fetchJsonWithTimeout<{ data?: BranchMonitor } & ApiErrorBody>(
      "/api/pos/monitor",
      { cache: "no-store", signal },
      10000,
      0
    );
    if (!response.ok || body.error || !body.data) {
      throw new Error(body.error?.message ?? "Failed to load POS monitor.");
    }
    setIsOnline(true);
    setBranchMonitor(body.data);
    return body.data;
  }

  function markConnectivityFromError(error: unknown) {
    const message = error instanceof Error ? error.message : "";
    if (isConnectivityIssueMessage(message)) {
      setIsOnline(false);
    }
  }

  function enqueuePendingSubmit(payload: PendingSubmit, lastError?: string) {
    setPendingQueue((current) =>
      enqueuePendingItem(current, { ...payload, last_error: lastError ?? null }, new Date().toISOString())
    );
  }

  function dequeuePendingSubmit(idempotencyKey: string) {
    setPendingQueue((current) => dequeuePendingItem(current, idempotencyKey));
  }

  function markPendingSubmitFailed(idempotencyKey: string, errorMessage: string) {
    setPendingQueue((current) => markPendingItemFailed(current, idempotencyKey, errorMessage, new Date().toISOString()));
  }

  function enqueuePendingPayment(payload: PendingPaymentSubmit, lastError?: string) {
    setPendingPaymentQueue((current) =>
      enqueuePendingItem(current, { ...payload, last_error: lastError ?? null }, new Date().toISOString())
    );
  }

  function dequeuePendingPayment(idempotencyKey: string) {
    setPendingPaymentQueue((current) => dequeuePendingItem(current, idempotencyKey));
  }

  function markPendingPaymentFailed(idempotencyKey: string, errorMessage: string) {
    setPendingPaymentQueue((current) => markPendingItemFailed(current, idempotencyKey, errorMessage, new Date().toISOString()));
  }

  useEffect(() => {
    const updateOnline = () => {
      setIsOnline(navigator.onLine);
    };
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    return () => {
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const savedSelectedDineInTableId = localStorage.getItem(DINE_IN_SELECTED_TABLE_KEY);
    const savedCart = readStoredJson<CartItem[]>(CART_KEY);
    if (savedCart && !savedSelectedDineInTableId) {
      setCart(savedCart);
    }

    const savedPendingQueue = readStoredJson<PendingSubmitQueueItem[]>(PENDING_QUEUE_KEY);
    if (savedPendingQueue && Array.isArray(savedPendingQueue) && savedPendingQueue.length > 0) {
      setPendingQueue(savedPendingQueue);
    } else {
      const savedPendingLegacy = readStoredJson<PendingSubmit>(PENDING_KEY);
      if (savedPendingLegacy) {
        setPendingQueue([
          {
            ...savedPendingLegacy,
            queued_at: new Date().toISOString(),
            retry_count: 0,
            last_error: null
          }
        ]);
        localStorage.removeItem(PENDING_KEY);
      }
    }

    const savedPendingPaymentQueue = readStoredJson<PendingPaymentQueueItem[]>(PENDING_PAYMENT_QUEUE_KEY);
    if (savedPendingPaymentQueue && Array.isArray(savedPendingPaymentQueue) && savedPendingPaymentQueue.length > 0) {
      setPendingPaymentQueue(savedPendingPaymentQueue);
    }

    const savedHeldBills = readStoredJson<HeldBill[]>(HELD_BILLS_KEY);
    if (savedHeldBills) {
      setHeldBills(savedHeldBills.map((entry) => normalizeHeldBillEntry(entry)));
    }

    const savedDineInDraft = readStoredJson<Record<string, CartItem[]>>(DINE_IN_DRAFT_KEY);
    if (savedDineInDraft && typeof savedDineInDraft === "object") {
      dineInDraftByTableIdRef.current = savedDineInDraft;
      setDineInDraftByTableId(savedDineInDraft);
    }

    if (savedSelectedDineInTableId) {
      setQuickMode("dine_in");
      setOrderType("dine_in");
      setTableBrowserOpen(false);
      setPendingRestoreTableId(savedSelectedDineInTableId);
    }

    const savedActiveOrder = readStoredJson<ActiveOrder>(ACTIVE_ORDER_KEY);
    if (savedActiveOrder?.id && savedActiveOrder.order_no && savedActiveOrder.status) {
      setActiveOrder(savedActiveOrder);
    }

    const savedPromptPayPhone = localStorage.getItem(POS_PROMPTPAY_PHONE_KEY);
    if (savedPromptPayPhone) {
      setPromptPayPhone(sanitizePromptPayPhone(savedPromptPayPhone));
    }

    const savedSales = readStoredJson<PosSalesSnapshot>(SALES_SNAPSHOT_KEY);
    if (savedSales) {
      const nextProducts = Array.isArray(savedSales.products) ? savedSales.products : [];
      setProducts(nextProducts);
      const nextCategories = savedSales.categories ?? [];
      setCategories(nextCategories);
      setShift((savedSales.shift ?? null) as ShiftRow);
      setSellerName(String(savedSales.operator_name ?? "Unknown Seller"));
      setBranchName(String(savedSales.branch_name ?? "Unknown Branch"));
      setStoreProfile(savedSales.store_profile ?? null);
      setPaymentAccount(savedSales.payment_account ?? null);
      setPaymentProviders(savedSales.payment_providers ?? {});
      setTaxSettings(savedSales.tax_settings ?? DEFAULT_TAX_SETTINGS);
      setAllowNegativeStock(Boolean(savedSales.inventory_settings?.allow_negative_stock ?? false));
      setTableQrNotificationSettings(savedSales.notification_settings ?? DEFAULT_TABLE_QR_NOTIFICATION_SETTINGS);
      setDevicePolicy(savedSales.device_policy ?? null);
      if (savedSales.payment_account?.promptpay_phone) {
        setPromptPayPhone(sanitizePromptPayPhone(savedSales.payment_account.promptpay_phone));
      }
      setDeliveryConfigs(Array.isArray(savedSales.delivery_configs) ? savedSales.delivery_configs : []);
      setDeliveryPricesByProduct(savedSales.delivery_prices_by_product ?? {});
      setActiveCategory((current) => current || nextCategories[0] || "");
      hasRenderableDataRef.current = true;
      setHasRenderableData(true);
      setLoading(false);
    }

    setIsOnline(navigator.onLine);
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    if (!isHydrated || typeof window === "undefined") return;
    localStorage.setItem(POS_PROMPTPAY_PHONE_KEY, sanitizePromptPayPhone(promptPayPhone));
  }, [isHydrated, promptPayPhone]);

  useEffect(() => {
    if (!isHydrated || typeof window === "undefined") return;

    const syncTaxSettings = () => {
      void refreshTaxSettings();
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === POS_TAX_SETTINGS_UPDATED_KEY) syncTaxSettings();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") syncTaxSettings();
    };

    window.addEventListener(POS_TAX_SETTINGS_UPDATED_EVENT, syncTaxSettings);
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", syncTaxSettings);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener(POS_TAX_SETTINGS_UPDATED_EVENT, syncTaxSettings);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", syncTaxSettings);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [isHydrated, refreshTaxSettings]);

  useEffect(() => {
    if (!isHydrated || typeof window === "undefined") return;

    const syncPaymentSettings = () => {
      setReloadToken((current) => current + 1);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === POS_PAYMENT_SETTINGS_UPDATED_KEY) syncPaymentSettings();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") syncPaymentSettings();
    };

    window.addEventListener(POS_PAYMENT_SETTINGS_UPDATED_EVENT, syncPaymentSettings);
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", syncPaymentSettings);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener(POS_PAYMENT_SETTINGS_UPDATED_EVENT, syncPaymentSettings);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", syncPaymentSettings);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [isHydrated]);

  useEffect(() => {
    if (!isHydrated || typeof window === "undefined") return;
    void refreshTaxSettings();
  }, [isHydrated, refreshTaxSettings]);

  useEffect(() => {
    if (!isHydrated || typeof window === "undefined") return;
    if (orderType === "dine_in" && selectedTable?.id && !tableBrowserOpen) {
      localStorage.setItem(DINE_IN_SELECTED_TABLE_KEY, selectedTable.id);
      return;
    }
    localStorage.removeItem(DINE_IN_SELECTED_TABLE_KEY);
  }, [isHydrated, orderType, selectedTable?.id, tableBrowserOpen]);

  useEffect(() => {
    return () => {
      if (transferSlipPreviewUrl) {
        URL.revokeObjectURL(transferSlipPreviewUrl);
      }
    };
  }, [transferSlipPreviewUrl]);

  useEffect(() => {
    if (!isHydrated || typeof window === "undefined") return;
    if (cartPersistTimerRef.current !== null) {
      window.clearTimeout(cartPersistTimerRef.current);
      cartPersistTimerRef.current = null;
    }
    if (orderType !== "takeaway") return;
    cartPersistTimerRef.current = window.setTimeout(() => {
      localStorage.setItem(CART_KEY, JSON.stringify(cart));
    }, 120);
  }, [cart, isHydrated, orderType]);

  useEffect(() => {
    if (!isHydrated || typeof window === "undefined") return;
    if (heldPersistTimerRef.current !== null) {
      window.clearTimeout(heldPersistTimerRef.current);
    }
    heldPersistTimerRef.current = window.setTimeout(() => {
      localStorage.setItem(HELD_BILLS_KEY, JSON.stringify(heldBills));
    }, 180);
  }, [heldBills, isHydrated]);

  useEffect(() => {
    if (!isHydrated || typeof window === "undefined") return;
    if (dineInDraftPersistTimerRef.current !== null) {
      window.clearTimeout(dineInDraftPersistTimerRef.current);
    }
    dineInDraftPersistTimerRef.current = window.setTimeout(() => {
      if (Object.keys(dineInDraftByTableId).length > 0) {
        localStorage.setItem(DINE_IN_DRAFT_KEY, JSON.stringify(dineInDraftByTableId));
      } else {
        localStorage.removeItem(DINE_IN_DRAFT_KEY);
      }
    }, 140);
  }, [dineInDraftByTableId, isHydrated]);

  useEffect(() => {
    if (!isHydrated || typeof window === "undefined") return;
    if (pendingQueuePersistTimerRef.current !== null) {
      window.clearTimeout(pendingQueuePersistTimerRef.current);
    }
    pendingQueuePersistTimerRef.current = window.setTimeout(() => {
      if (pendingQueue.length > 0) {
        localStorage.setItem(PENDING_QUEUE_KEY, JSON.stringify(pendingQueue));
      } else {
        localStorage.removeItem(PENDING_QUEUE_KEY);
        localStorage.removeItem(PENDING_KEY);
      }
    }, 120);
  }, [pendingQueue, isHydrated]);

  useEffect(() => {
    if (!isHydrated || typeof window === "undefined") return;
    if (pendingPaymentQueuePersistTimerRef.current !== null) {
      window.clearTimeout(pendingPaymentQueuePersistTimerRef.current);
    }
    pendingPaymentQueuePersistTimerRef.current = window.setTimeout(() => {
      if (pendingPaymentQueue.length > 0) {
        localStorage.setItem(PENDING_PAYMENT_QUEUE_KEY, JSON.stringify(pendingPaymentQueue));
      } else {
        localStorage.removeItem(PENDING_PAYMENT_QUEUE_KEY);
      }
    }, 120);
  }, [pendingPaymentQueue, isHydrated]);

  useEffect(() => {
    if (!isHydrated || typeof window === "undefined") return;
    if (activeOrderPersistTimerRef.current !== null) {
      window.clearTimeout(activeOrderPersistTimerRef.current);
    }
    activeOrderPersistTimerRef.current = window.setTimeout(() => {
      if (activeOrder && activeOrder.id && activeOrder.order_no && activeOrder.status) {
        localStorage.setItem(ACTIVE_ORDER_KEY, JSON.stringify(activeOrder));
      } else {
        localStorage.removeItem(ACTIVE_ORDER_KEY);
      }
    }, 120);
  }, [activeOrder, isHydrated]);

  useEffect(() => {
    if (!isHydrated || typeof window === "undefined") return;
    if (enabledFeatures?.customer_facing_display !== true) {
      if (customerDisplayPublishTimerRef.current !== null) {
        window.clearTimeout(customerDisplayPublishTimerRef.current);
        customerDisplayPublishTimerRef.current = null;
      }
      customerDisplayPendingRef.current = null;
      customerDisplayPublishInFlightRef.current = false;
      return;
    }
    if (customerDisplayPublishTimerRef.current !== null) {
      window.clearTimeout(customerDisplayPublishTimerRef.current);
    }
    customerDisplayPublishTimerRef.current = window.setTimeout(() => {
      const cartSubtotal = Number(cart.reduce((sum, item) => sum + item.quantity * item.price, 0).toFixed(2));
      const displayTaxBreakdown = calculateClientTaxBreakdown(cartSubtotal, taxSettings);
      const payload: Record<string, unknown> = {
        order_no: activeOrder?.order_no ?? null,
        order_type: orderType,
        table_code: selectedTable?.table_code ?? null,
        branch_name: branchName,
        operator_name: sellerName,
        subtotal: cartSubtotal,
        discount_amount: 0,
        tax_total: displayTaxBreakdown.tax_total,
        total_amount: displayTaxBreakdown.grand_total,
        item_count: cart.reduce((sum, item) => sum + item.quantity, 0),
        items: cart.map((item) => ({
          product_id: item.product_id,
          name: item.name,
          quantity: item.quantity,
          price: item.price,
          notes: item.notes ?? null
        })),
        updated_at: new Date().toISOString()
      };
      const signature = JSON.stringify(payload);
      const publish = (nextPayload: Record<string, unknown>, nextSignature: string) => {
        if (customerDisplayPublishedSignatureRef.current === nextSignature && !customerDisplayPublishInFlightRef.current) {
          return;
        }
        if (customerDisplayPublishInFlightRef.current) {
          customerDisplayPendingRef.current = { payload: nextPayload, signature: nextSignature };
          return;
        }

        customerDisplayPublishInFlightRef.current = true;
        customerDisplayPublishedSignatureRef.current = nextSignature;
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), 4000);
        void fetch("/api/pos/customer-display", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            channel: "main",
            payload: nextPayload
          }),
          keepalive: true,
          signal: controller.signal
        })
          .catch(() => undefined)
          .finally(() => {
            window.clearTimeout(timeoutId);
            customerDisplayPublishInFlightRef.current = false;
            const pending = customerDisplayPendingRef.current;
            customerDisplayPendingRef.current = null;
            if (pending && pending.signature !== customerDisplayPublishedSignatureRef.current) {
              publish(pending.payload, pending.signature);
            }
          });
      };

      publish(payload, signature);
    }, 450);
  }, [
    activeOrder?.order_no,
    branchName,
    cart,
    enabledFeatures,
    isHydrated,
    orderType,
    selectedTable?.table_code,
    sellerName,
    taxSettings
  ]);

  useEffect(() => {
    if (!cartDrawerOpen) return;
    if (typeof window === "undefined") return;

    const closeIfDesktop = () => {
      if (window.innerWidth >= 1024) {
        setCartDrawerOpen(false);
      }
    };

    window.addEventListener("resize", closeIfDesktop);
    return () => window.removeEventListener("resize", closeIfDesktop);
  }, [cartDrawerOpen]);

  useEffect(() => {
    if (!modifierDraft?.product.id) {
      setModifierIngredients([]);
      setModifierIngredientsError("");
      setModifierIngredientsLoading(false);
      return;
    }
    let cancelled = false;
    setModifierIngredientsLoading(true);
    setModifierIngredientsError("");
    fetch(`/api/pos/recipe-products?product_ids=${encodeURIComponent(modifierDraft.product.id)}`, { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as
          | { data?: { ingredients_by_product?: Record<string, RecipeIngredientChoice[]> } | null; error?: { message?: string } | null }
          | null;
        if (!response.ok || body?.error) {
          throw new Error(body?.error?.message ?? "Failed to load recipe ingredients.");
        }
        if (!cancelled) {
          setModifierIngredients(body?.data?.ingredients_by_product?.[modifierDraft.product.id] ?? []);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setModifierIngredients([]);
          setModifierIngredientsError(error instanceof Error ? error.message : "Failed to load recipe ingredients.");
        }
      })
      .finally(() => {
        if (!cancelled) setModifierIngredientsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [modifierDraft?.product.id]);

  useEffect(() => {
    return () => {
      if (cartPersistTimerRef.current !== null) {
        window.clearTimeout(cartPersistTimerRef.current);
      }
      if (heldPersistTimerRef.current !== null) {
        window.clearTimeout(heldPersistTimerRef.current);
      }
      if (dineInDraftPersistTimerRef.current !== null) {
        window.clearTimeout(dineInDraftPersistTimerRef.current);
      }
      if (activeOrderPersistTimerRef.current !== null) {
        window.clearTimeout(activeOrderPersistTimerRef.current);
      }
      if (pendingQueuePersistTimerRef.current !== null) {
        window.clearTimeout(pendingQueuePersistTimerRef.current);
      }
      if (pendingPaymentQueuePersistTimerRef.current !== null) {
        window.clearTimeout(pendingPaymentQueuePersistTimerRef.current);
      }
      if (customerDisplayPublishTimerRef.current !== null) {
        window.clearTimeout(customerDisplayPublishTimerRef.current);
      }
      customerDisplayPendingRef.current = null;
      customerDisplayPublishInFlightRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!isHydrated) return;
    const controller = new AbortController();
    const pollMsRaw = Number(process.env.NEXT_PUBLIC_POS_MONITOR_POLL_MS ?? "30000");
    const pollMs = Number.isFinite(pollMsRaw) ? Math.min(120000, Math.max(15000, Math.trunc(pollMsRaw))) : 30000;

    const canPollMonitor = () => typeof document === "undefined" || document.visibilityState === "visible";

    const loadMonitor = () => {
      if (!canPollMonitor()) return;
      if (!navigator.onLine) return;
      if (monitorPollInFlightRef.current) return;
      monitorPollInFlightRef.current = true;
      void fetchBranchMonitor(controller.signal)
        .catch(() => {
          // Keep UI responsive even if monitor endpoint is temporarily unavailable.
        })
        .finally(() => {
          monitorPollInFlightRef.current = false;
        });
    };

    loadMonitor();
    const timer = window.setInterval(loadMonitor, pollMs);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        loadMonitor();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      controller.abort();
      monitorPollInFlightRef.current = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [isHydrated, reloadToken]);

  function pushSubmitMessage(message: string | null) {
    setSubmitMessage(
      sanitizeSubmitMessage({
        message,
        text,
        ingredientOptions: ingredientAdjustOptions
      })
    );
  }

  function mapCashDrawerError(body: ApiErrorBody | null | undefined, fallback: string) {
    const code = body?.error?.code ?? "";
    if (code === "drawer_not_configured" || code === "printer_not_configured") return text.cashDrawerNotConfigured;
    if (code === "permission_denied") return text.cashDrawerPermissionDenied;
    if (code === "drawer_cooldown") return text.cashDrawerCooldown;
    return body?.error?.message ?? fallback;
  }

  async function openCashDrawerManually() {
    if (cashDrawerOpening || cashDrawerCoolingDown) return;
    if (!cashDrawerConfigured) {
      pushSubmitMessage(text.cashDrawerNotConfigured);
      return;
    }
    const reason = window.prompt(text.cashDrawerReasonPrompt, text.cashDrawerReasonDefault);
    if (reason === null) return;
    const normalizedReason = reason.trim();
    if (!normalizedReason) {
      pushSubmitMessage(text.cashDrawerReasonPrompt);
      return;
    }

    setCashDrawerOpening(true);
    try {
      const { response, body } = await fetchJsonWithTimeout<ApiErrorBody & { data?: { physical_status?: string } }>(
        "/api/pos/cash-drawer/open",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: normalizedReason })
        },
        12000,
        0
      );
      if (!response.ok || body.error) {
        throw new Error(mapCashDrawerError(body, text.cashDrawerOpenFailed));
      }
      const suffix = body.data?.physical_status === "unsupported" ? ` (${text.cashDrawerUnsupportedStatus})` : "";
      pushSubmitMessage(`${text.cashDrawerCommandSent}${suffix}`);
      setCashDrawerCoolingDown(true);
      window.setTimeout(() => {
        setCashDrawerCoolingDown(false);
      }, 3100);
    } catch (error) {
      pushSubmitMessage(error instanceof Error ? error.message : text.cashDrawerOpenFailed);
    } finally {
      setCashDrawerOpening(false);
    }
  }

  useEffect(() => {
    if (!isHydrated || typeof window === "undefined") return;
    let active = true;
    void fetchJsonWithTimeout<ApiErrorBody & { data?: { configured?: boolean } }>("/api/pos/cash-drawer/open", { cache: "no-store" }, 8000, 0)
      .then(({ response, body }) => {
        if (!active) return;
        setCashDrawerConfigured(Boolean(response.ok && !body.error && body.data?.configured));
      })
      .catch(() => {
        if (active) setCashDrawerConfigured(false);
      });
    return () => {
      active = false;
    };
  }, [isHydrated]);

  useEffect(() => {
    fetchPosTablesRef.current = fetchPosTables;
    loadTableBillContextRef.current = loadTableBillContext;
    pushSubmitMessageRef.current = pushSubmitMessage;
  });

  useEffect(() => {
    if (
      transferPaymentMode !== "inet_nops" ||
      !transferReviewOrder ||
      !inetPaymentIntent?.payment_intent_id ||
      inetQrStatus !== "pending"
    ) {
      return;
    }

    let cancelled = false;
    const pollStatus = async () => {
      try {
        const { response, body } = await fetchJsonWithTimeout<
          ApiErrorBody & {
            data?: {
              status: "pending" | "paid" | "failed" | "expired" | "cancelled";
              order_id: string;
              amount: number;
              paid_at: string | null;
              provider_order_id: string;
            };
          }
        >(
          `/api/pos/payments/inet/status?payment_intent_id=${encodeURIComponent(inetPaymentIntent.payment_intent_id)}`,
          { credentials: "include", cache: "no-store" },
          12000,
          0
        );
        if (cancelled || !response.ok || body.error || !body.data) return;
        if (body.data.status === "pending") return;
        setInetPaymentIntent((current) =>
          current?.payment_intent_id === inetPaymentIntent.payment_intent_id
            ? { ...current, status: body.data!.status }
            : current
        );
        if (body.data.status === "paid") {
          setInetQrStatus("paid");
          setActiveOrder((current) => (current?.id === transferReviewOrder.order_id ? null : current));
          setCart([]);
          setTakeawayCreatingPreview(null);
          setReviewOrder(null);
          setCashReviewOrder(null);
          setTransferReviewOrder(null);
          setTransferReference("");
          setTransferError(null);
          setReceiptSession({
            order_id: transferReviewOrder.order_id,
            order_no: transferReviewOrder.order_no,
            external_order_code: transferReviewOrder.external_order_code,
            table_id: transferReviewOrder.table_id,
            created_at: body.data.paid_at ?? new Date().toISOString(),
            items: transferReviewOrder.items.map((item) => ({ ...item })),
            total_amount: Number(body.data.amount),
            discount_amount: transferReviewOrder.discount_amount ?? 0,
            tax_total: transferReviewOrder.tax_total ?? 0,
            tax_lines: transferReviewOrder.tax_lines ?? [],
            payment_method: "bank_transfer",
            cash_received: Number(body.data.amount),
            change_amount: 0,
            store_profile: storeProfile
          });
          setReceiptSaving(false);
          setReceiptSaved(true);
          setBillPaymentMethod("bank_transfer");
          setReceiptError(null);
          pushSubmitMessageRef.current(`${text.receiptSaved}: ${transferReviewOrder.order_no}`);
          if (orderType === "dine_in" && selectedTable) {
            void loadTableBillContextRef.current(selectedTable).catch(() => undefined);
            void fetchPosTablesRef.current({ timeoutMs: 10000, retries: 0 }).catch(() => undefined);
          }
        } else {
          setInetQrStatus("failed");
          setTransferError(text.transferInetFailed);
        }
      } catch {
        // Keep polling; transient network failures should not close the payment modal.
      }
    };

    void pollStatus();
    const timer = window.setInterval(() => void pollStatus(), 2500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    inetPaymentIntent?.payment_intent_id,
    inetQrStatus,
    orderType,
    selectedTable,
    storeProfile,
    text,
    transferPaymentMode,
    transferReviewOrder
  ]);

  useEffect(() => {
    const nowPending = pendingQueue.length + pendingPaymentQueue.length > 0;
    if (nowPending && !lastPendingRef.current) setSubmitMessage(text.pendingSaved);
    lastPendingRef.current = nowPending;
  }, [pendingQueue.length, pendingPaymentQueue.length, text.pendingSaved]);

  useEffect(() => {
    if (deviceSalesBlocked) return;
    if (!isHydrated || !isOnline || pendingQueue.length === 0 || replayingPendingRef.current) return;
    if (submitting || cancelBillSubmitting || cashSubmitting || receiptSaving || stockAdjusting) return;
    const nextPending = pendingQueue[0];
    if (!nextPending) return;
    const queuedAtMs = new Date(nextPending.queued_at).getTime();
    const retryDelayMs = Math.min(30000, Math.max(1000, 1000 * 2 ** Math.min(6, nextPending.retry_count)));
    if (nextPending.retry_count > 0 && Number.isFinite(queuedAtMs) && nowMs() - queuedAtMs < retryDelayMs) {
      return;
    }

    replayingPendingRef.current = true;
    setSubmitting(true);
    void submitOrderRef.current(nextPending, { applyUiResult: false })
      .then(() => {
        setIsOnline(true);
      })
      .catch((replayError) => {
        const replayMessage = replayError instanceof Error ? replayError.message : text.retryFailed;
        const replayCode = extractApiErrorCode(replayMessage);
        if (isConflictErrorCode(replayCode)) {
          dequeuePendingSubmit(nextPending.idempotencyKey);
          if (replayCode === "table_not_available") {
            void fetchPosTablesRef.current({ timeoutMs: 10000, retries: 0 }).catch(() => undefined);
            setTableBrowserOpen(true);
            setSelectedTable(null);
            setActiveOrder(null);
          }
          if (replayCode === "shift_not_open") {
            setReloadToken((current) => current + 1);
          }
          pushSubmitMessageRef.current(replayMessage);
          return;
        }
        markPendingSubmitFailed(nextPending.idempotencyKey, replayMessage);
        markConnectivityFromError(replayError);
      })
      .finally(() => {
        replayingPendingRef.current = false;
        setSubmitting(false);
      });
  }, [
    isHydrated,
    isOnline,
    pendingQueue,
    submitting,
    cancelBillSubmitting,
    cashSubmitting,
    deviceSalesBlocked,
    receiptSaving,
    stockAdjusting,
    text.retryFailed
  ]);

  useEffect(() => {
    if (deviceSalesBlocked) return;
    if (!isHydrated || !isOnline || pendingPaymentQueue.length === 0 || replayingPendingPaymentRef.current) return;
    if (submitting || cancelBillSubmitting || cashSubmitting || transferSubmitting || receiptSaving || stockAdjusting) return;
    const nextPending = pendingPaymentQueue[0];
    if (!nextPending) return;
    const queuedAtMs = new Date(nextPending.queued_at).getTime();
    const retryDelayMs = Math.min(30000, Math.max(1000, 1000 * 2 ** Math.min(6, nextPending.retry_count)));
    if (nextPending.retry_count > 0 && Number.isFinite(queuedAtMs) && nowMs() - queuedAtMs < retryDelayMs) {
      return;
    }

    replayingPendingPaymentRef.current = true;
    setTransferSubmitting(true);
    void submitTransferPaymentRef.current(nextPending, false)
      .then(() => {
        setIsOnline(true);
      })
      .catch((replayError) => {
        const replayMessage = replayError instanceof Error ? replayError.message : text.retryFailed;
        markPendingPaymentFailed(nextPending.idempotencyKey, replayMessage);
        markConnectivityFromError(replayError);
      })
      .finally(() => {
        replayingPendingPaymentRef.current = false;
        setTransferSubmitting(false);
      });
  }, [
    isHydrated,
    isOnline,
    pendingPaymentQueue,
    submitting,
    cancelBillSubmitting,
    cashSubmitting,
    deviceSalesBlocked,
    transferSubmitting,
    receiptSaving,
    stockAdjusting,
    text.retryFailed
  ]);

  useEffect(() => {
    if (!submitting && !cancelBillSubmitting && !cashSubmitting && !transferSubmitting && !receiptSaving && !stockAdjusting) {
      checkoutRequestLockRef.current = false;
    }
  }, [submitting, cancelBillSubmitting, cashSubmitting, transferSubmitting, receiptSaving, stockAdjusting]);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      if (!hasRenderableDataRef.current) {
        setLoading(true);
      }
      setError(null);
      try {
        // Load sales first so UI can render quickly, then load table data in background.
        const salesResponse = await fetchJsonWithTimeout<{ data: PosSalesSnapshot } & ApiErrorBody>(
          "/api/pos/sales",
          { cache: "no-store", signal: controller.signal },
          process.env.NODE_ENV === "development" ? 30000 : 18000,
          0
        );
        if (!salesResponse.response.ok || salesResponse.body.error) {
          throw new Error(salesResponse.body.error?.message ?? "Failed to load POS data.");
        }
        if (controller.signal.aborted) return;
        setIsOnline(true);

        const nextProducts = salesResponse.body.data?.products ?? [];
        const nextCategories = salesResponse.body.data?.categories ?? [];
        const nextShift = (salesResponse.body.data?.shift ?? null) as ShiftRow;
        const nextOperatorName = String(salesResponse.body.data?.operator_name ?? (lang === "th" ? "ไม่ทราบชื่อผู้ขาย" : "Unknown Seller"));
        const nextBranchName = String(salesResponse.body.data?.branch_name ?? (lang === "th" ? "ไม่ทราบสาขา" : "Unknown Branch"));
        const nextStoreProfile = salesResponse.body.data?.store_profile ?? null;
        const nextPaymentAccount = salesResponse.body.data?.payment_account ?? null;
        const nextPaymentProviders = salesResponse.body.data?.payment_providers ?? {};
        const nextTaxSettings = salesResponse.body.data?.tax_settings ?? DEFAULT_TAX_SETTINGS;
        const nextAllowNegativeStock = Boolean(salesResponse.body.data?.inventory_settings?.allow_negative_stock ?? false);
        const nextNotificationSettings = salesResponse.body.data?.notification_settings ?? DEFAULT_TABLE_QR_NOTIFICATION_SETTINGS;
        const nextDevicePolicy = salesResponse.body.data?.device_policy ?? null;
        const nextDeliveryConfigs = Array.isArray(salesResponse.body.data?.delivery_configs)
          ? salesResponse.body.data.delivery_configs
          : [];
        const nextDeliveryPricesByProduct = salesResponse.body.data?.delivery_prices_by_product ?? {};
        const tenantId = String(salesResponse.body.data?.tenant_id ?? "");
        const branchId = String(salesResponse.body.data?.branch_id ?? "");
        if (tenantId && branchId) {
          const nextScope = `${tenantId}:${branchId}`;
          const prevScope = localStorage.getItem(POS_SCOPE_KEY);
          if (prevScope && prevScope !== nextScope) {
            localStorage.removeItem(CART_KEY);
            localStorage.removeItem(PENDING_KEY);
            localStorage.removeItem(PENDING_QUEUE_KEY);
            localStorage.removeItem(PENDING_PAYMENT_QUEUE_KEY);
            localStorage.removeItem(HELD_BILLS_KEY);
            localStorage.removeItem(DINE_IN_DRAFT_KEY);
            localStorage.removeItem(DINE_IN_SELECTED_TABLE_KEY);
            localStorage.removeItem(TABLE_QR_ACTIVITY_SEEN_KEY);
            localStorage.removeItem(ACTIVE_ORDER_KEY);
            setSeenTableQrActivity({});
            setCart([]);
            setPendingQueue([]);
            setPendingPaymentQueue([]);
            setHeldBills([]);
            setDineInDraftByTableId({});
            setActiveOrder(null);
            setBillPaymentMethod(null);
            setReviewOrder(null);
            setCashReviewOrder(null);
            setReceiptSession(null);
            resetDeliveryDraft();
            setDeliveryFlowState("create");
          }
          localStorage.setItem(POS_SCOPE_KEY, nextScope);
        }

        setProducts(nextProducts);
        setCategories(nextCategories);
        setAllowNegativeStock(nextAllowNegativeStock);
        setShift(nextShift);
        setSellerName(nextOperatorName);
        setBranchName(nextBranchName);
        setStoreProfile(nextStoreProfile);
        setPaymentAccount(nextPaymentAccount);
        setPaymentProviders(nextPaymentProviders);
        setTaxSettings(nextTaxSettings);
        setTableQrNotificationSettings(nextNotificationSettings);
        setDevicePolicy(nextDevicePolicy);
        if (nextPaymentAccount?.promptpay_phone) {
          setPromptPayPhone(sanitizePromptPayPhone(nextPaymentAccount.promptpay_phone));
        }
        setDeliveryConfigs(nextDeliveryConfigs);
        setDeliveryPricesByProduct(nextDeliveryPricesByProduct);
        if (tenantId && branchId) {
          void cachePosSalesOfflineCatalogSnapshot({
            tenant_id: tenantId,
            branch_id: branchId,
            branch_code: null,
            device_code: null,
            products: nextProducts,
            categories: nextCategories,
            tax_settings: nextTaxSettings,
            inventory_settings: { allow_negative_stock: nextAllowNegativeStock },
            store_profile: nextStoreProfile,
            payment_account: nextPaymentAccount,
            payment_providers: nextPaymentProviders,
            notification_settings: nextNotificationSettings,
            device_policy: nextDevicePolicy,
            delivery_configs: nextDeliveryConfigs,
            delivery_prices_by_product: nextDeliveryPricesByProduct
          }).catch(() => undefined);
        }
        setActiveCategory((current) => current || nextCategories[0] || "");
        hasRenderableDataRef.current = true;
        setHasRenderableData(true);
        setError(null);

        try {
          localStorage.setItem(
            SALES_SNAPSHOT_KEY,
            JSON.stringify({
              products: nextProducts,
              categories: nextCategories,
              shift: nextShift,
              operator_name: nextOperatorName,
              branch_name: nextBranchName,
              store_profile: nextStoreProfile,
              payment_account: nextPaymentAccount,
              payment_providers: nextPaymentProviders,
              tax_settings: nextTaxSettings,
              inventory_settings: { allow_negative_stock: nextAllowNegativeStock },
              notification_settings: nextNotificationSettings,
              device_policy: nextDevicePolicy,
              delivery_configs: nextDeliveryConfigs,
              delivery_prices_by_product: nextDeliveryPricesByProduct,
              tenant_id: tenantId,
              branch_id: branchId
            })
          );
        } catch {
          // Ignore storage quota/private mode errors; live data is already applied.
        }

        setTableLoading(false);
        setTableLoadError(null);
      } catch (loadError) {
        if (controller.signal.aborted) return;
        markConnectivityFromError(loadError);
        const nextMessage = loadError instanceof Error ? loadError.message : "Unknown error";
        if (hasRenderableDataRef.current) {
          setSubmitMessage(nextMessage);
        } else {
          setError(nextMessage);
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => controller.abort();
  }, [lang, reloadToken]);

  useEffect(() => {
    const previousOrderType = previousOrderTypeRef.current;
    previousOrderTypeRef.current = orderType;
    if (orderType === "dine_in" || previousOrderType !== "dine_in") return;

    invalidateTableUiContext();
    const currentSelectedTable = selectedTableRef.current;
    if (currentSelectedTable?.id) {
      rememberDineInDraft(currentSelectedTable.id, cartRef.current);
    }
    setSelectedTable(null);
    setTableBrowserOpen(false);
    setDineInSessionBillNo(null);
    setTableTransferVerifications([]);
    setBillPaymentMethod(null);
    setActiveOrder(null);
    setLastCommittedCartSignature(null);
    setCart(orderType === "takeaway" ? readTakeawayCartDraft() : []);
    tableBillPrefetchCacheRef.current.clear();
    tableBillPrefetchCacheUpdatedAtRef.current.clear();
  }, [orderType]);

  useEffect(() => {
    if (orderType !== "dine_in" || !tableBrowserOpen || posTables.length === 0) {
      return;
    }
    void prefetchTableBillsForFastSwitch(posTables);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderType, posTables, tableBrowserOpen]);

  useEffect(() => {
    if (!isHydrated || orderType !== "dine_in") return;
    let disposed = false;
    const refreshTables = () => {
      if (disposed || document.visibilityState !== "visible") return;
      void fetchPosTablesRef.current({ timeoutMs: 8000, retries: 0, silent: true }).catch(() => undefined);
    };
    const interval = window.setInterval(refreshTables, tableBrowserOpen ? 3000 : 3500);
    window.addEventListener("focus", refreshTables);
    return () => {
      disposed = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshTables);
    };
  }, [isHydrated, orderType, tableBrowserOpen]);

  async function setTablePaymentLock(order: CheckoutReviewOrder, locked: boolean) {
    const tableId = order.table_id ?? selectedTableRef.current?.id ?? null;
    if (!tableId) return;
    try {
      const { response, body } = await fetchJsonWithTimeout<ApiErrorBody>(
        `/api/pos/tables/${tableId}/payment-lock`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ order_id: order.order_id, locked })
        },
        10000,
        0
      );
      if (!response.ok || body.error) {
        throw new Error(body.error?.message ?? "Failed to update table payment status.");
      }
      const status = locked ? "pending_payment" : "ordering";
      tableListCacheRef.current = null;
      setSelectedTable((current) => (current?.id === tableId ? { ...current, status } : current));
      setPosTables((current) =>
        current.map((table) => (table.id === tableId ? { ...table, status } : table))
      );
    } catch (lockError) {
      const message = lockError instanceof Error ? lockError.message : "Failed to update table payment status.";
      if (locked) pushSubmitMessage(localizeApiMessage(message));
      else console.warn("[pos-sales] table payment unlock failed", lockError);
    }
  }


  useEffect(() => {
    if (!reviewOrder?.table_id) return;
    void setTablePaymentLock(reviewOrder, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewOrder?.order_id, reviewOrder?.table_id]);

  useEffect(() => {
    if (cart.length > 0) return;
    setDiscountPercentInput("");
    setDiscountAmountInput("");
    setDiscountEditMode("percent");
  }, [cart.length]);

  useEffect(() => {
    if (!isHydrated || typeof window === "undefined") return;
    try {
      const saved = window.localStorage.getItem(POS_PRODUCT_ORDER_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          setProductOrderByBranch(parsed as Record<string, string[]>);
        }
      }
    } catch {
      setProductOrderByBranch({});
    } finally {
      productOrderLoadedRef.current = true;
    }
  }, [isHydrated]);

  useEffect(() => {
    if (!isHydrated || typeof window === "undefined") return;
    if (!productOrderLoadedRef.current) return;
    window.localStorage.setItem(POS_PRODUCT_ORDER_STORAGE_KEY, JSON.stringify(productOrderByBranch));
  }, [isHydrated, productOrderByBranch]);

  useEffect(() => {
    if (orderType !== "dine_in") return;
    if (!pendingRestoreTableId) return;
    if (posTables.length === 0) return;

    const tableToRestore = posTables.find((table) => table.id === pendingRestoreTableId) ?? null;
    setPendingRestoreTableId(null);

    if (!tableToRestore) {
      setTableBrowserOpen(true);
      return;
    }

    setQuickMode("dine_in");
    setOrderType("dine_in");
    setTableBrowserOpen(false);
    setSelectedTable(tableToRestore);
    setCart(dineInDraftByTableIdRef.current[tableToRestore.id] ?? []);
    setTableTransferVerifications([]);
    setBillPaymentMethod(null);
    void loadTableBillContext(tableToRestore).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderType, pendingRestoreTableId, posTables]);

  const menuOrderKey = `${branchName || "branch"}:${activeCategory || "all"}`;
  const visibleProducts = useMemo(() => {
    const filtered = activeCategory ? products.filter((product) => product.category === activeCategory) : products;
    const order = productOrderByBranch[menuOrderKey] ?? [];
    if (order.length === 0) return filtered;
    const orderIndex = new Map(order.map((id, index) => [id, index]));
    return [...filtered].sort((left, right) => {
      const leftIndex = orderIndex.get(left.id) ?? Number.MAX_SAFE_INTEGER;
      const rightIndex = orderIndex.get(right.id) ?? Number.MAX_SAFE_INTEGER;
      if (leftIndex !== rightIndex) return leftIndex - rightIndex;
      return left.name.localeCompare(right.name, lang === "th" ? "th" : "en");
    });
  }, [activeCategory, lang, menuOrderKey, productOrderByBranch, products]);

  const visibleTables = useMemo(() => {
    const filtered = tableZoneFilter === "all" ? posTables : posTables.filter((table) => table.zone_id === tableZoneFilter);
    return filtered
      .map((table) => {
        const latestEventId = table.qr_activity?.latest_event_id;
        if (!latestEventId || seenTableQrActivity[table.id] !== latestEventId) return table;
        return {
          ...table,
          qr_activity: {
            latest_event_id: null,
            latest_event_at: null,
            latest_event_type: null,
            order_event_count: 0,
            pending_item_count: 0,
            subtotal: 0
          }
        };
      })
      .sort((left, right) => naturalCompareTableCode(left.table_code, right.table_code));
  }, [posTables, seenTableQrActivity, tableZoneFilter]);

  const visibleFloorObjects = useMemo(() => {
    if (tableZoneFilter === "all") return tableLayoutObjects;
    return tableLayoutObjects.filter((item) => item.zone_id === tableZoneFilter);
  }, [tableLayoutObjects, tableZoneFilter]);

  const subtotal = useMemo(() => cart.reduce((sum, item) => sum + item.quantity * item.price, 0), [cart]);
  const discountAmount = useMemo(() => {
    const safeSubtotal = Math.max(0, subtotal);
    if (safeSubtotal <= 0) return 0;

    if (discountEditMode === "amount") {
      const amountValue = Number(discountAmountInput);
      if (!Number.isFinite(amountValue) || amountValue <= 0) return 0;
      return Number(Math.min(safeSubtotal, Math.max(0, amountValue)).toFixed(2));
    }

    const percentValue = Number(discountPercentInput);
    if (!Number.isFinite(percentValue) || percentValue <= 0) return 0;
    const normalizedPercent = Math.min(100, Math.max(0, percentValue));
    return Number((safeSubtotal * (normalizedPercent / 100)).toFixed(2));
  }, [discountAmountInput, discountEditMode, discountPercentInput, subtotal]);
  const selectedDeliveryChannel = useMemo(() => mapDeliveryChannel(selectedDeliveryApp), [selectedDeliveryApp]);
  const selectedDeliveryConfig = useMemo(
    () => deliveryConfigs.find((config) => config.channel === selectedDeliveryChannel) ?? null,
    [deliveryConfigs, selectedDeliveryChannel]
  );
  const deliveryPayoutPreview = useMemo(() => {
    if (orderType !== "delivery_manual" || !selectedDeliveryConfig) return null;
    return calculateDeliveryPricingBreakdown({
      appSubtotal: subtotal,
      commissionRatePct: Number(selectedDeliveryConfig.commission_rate_pct ?? 0),
      commissionVatRatePct: Number(selectedDeliveryConfig.commission_vat_rate_pct ?? 7)
    });
  }, [orderType, selectedDeliveryConfig, subtotal]);
  const taxBaseTotal = Number(Math.max(0, subtotal - discountAmount).toFixed(2));
  const taxBreakdown = useMemo(() => calculateClientTaxBreakdown(taxBaseTotal, taxSettings), [taxBaseTotal, taxSettings]);
  const total = taxBreakdown.grand_total;
  const summaryDiscount = discountAmount;
  const isBusy =
    submitting ||
    cancelBillSubmitting ||
    stockAdjusting ||
    cashSubmitting ||
    transferSubmitting ||
    receiptSaving ||
    tableSwitching;
  const processingOverlayLabel = tableSwitching
    ? text.openingTableBill
    : cashSubmitting || transferSubmitting || receiptSaving
      ? text.paymentProcessing
      : submitting && !takeawayCreatingPreview
        ? orderType === "delivery_manual"
          ? text.deliveryQueueProcessing
          : text.processing
        : null;
  const hasBlockingPaymentOverlay =
    Boolean(takeawayCreatingPreview) ||
    Boolean(reviewOrder) ||
    Boolean(cashReviewOrder) ||
    Boolean(transferReviewOrder) ||
    Boolean(receiptSession) ||
    receiptSaving;
  const hasOpenDineInSession = isTableSalesMode(quickMode) && Boolean(selectedTable?.active_session_id);
  const activeBillNo = activeOrder?.order_no ?? (orderType === "delivery_manual" ? deliveryDraftBillNo : null) ?? dineInSessionBillNo ?? "-";
  const pendingSyncCount = pendingQueue.length + pendingPaymentQueue.length;
  const hasRetryablePending = useMemo(
    () => pendingQueue.some((entry) => Boolean(entry.last_error)) || pendingPaymentQueue.some((entry) => Boolean(entry.last_error)),
    [pendingPaymentQueue, pendingQueue]
  );
  const hasRetryErrorSignal = useMemo(() => {
    if (!hasRetryablePending) return false;
    if (!isOnline) return true;
    const normalizedMessage = submitMessage?.toLowerCase() ?? "";
    return (
      normalizedMessage.includes("ไม่สำเร็จ") ||
      normalizedMessage.includes("ผิดพลาด") ||
      normalizedMessage.includes("ออฟไลน์") ||
      normalizedMessage.includes("failed") ||
      normalizedMessage.includes("error") ||
      normalizedMessage.includes("offline") ||
      normalizedMessage.includes("network") ||
      normalizedMessage.includes("timeout") ||
      normalizedMessage.includes("connection")
    );
  }, [hasRetryablePending, isOnline, submitMessage]);
  const showEmergencyRetry = pendingSyncCount > 0 && hasRetryErrorSignal;
  const cashTargetTotal = cashReviewOrder?.total_amount ?? 0;
  const cashReceivedValue = Number(cashReceivedInput);
  const cashReceived = Number.isFinite(cashReceivedValue) ? cashReceivedValue : 0;
  const cashReceivedDisplay = cashReceivedInput ? formatCashBlockAmount(cashReceived) : "0.00";
  const cashDiff = cashReceived - cashTargetTotal;
  const cashHasReceivedAmount = cashReceivedInput.trim().length > 0 && cashReceived > 0;
  const cashHasEnoughAmount = cashHasReceivedAmount && cashReceived + 0.009 >= cashTargetTotal;
  const cashConfirmNeedsAttention = Boolean(cashReviewOrder) && !cashHasEnoughAmount && !cashSubmitting;
  const transferPromptPayAmount = toPromptPayAmount(transferReviewOrder?.total_amount ?? 0);
  const activePromptPayPhone = paymentAccount?.promptpay_phone ? sanitizePromptPayPhone(paymentAccount.promptpay_phone) : "";
  const activePaymentQrMode = paymentAccount?.qr_mode ?? "promptpay_link";
  const promptPayQrUrl =
    paymentAccount && activePaymentQrMode === "qr_image" && paymentAccount.qr_image_url
      ? paymentAccount.qr_image_url
      : paymentAccount
        ? buildPromptPayQrUrl(activePromptPayPhone, transferPromptPayAmount)
        : null;
  const inetQrEnabled = paymentProviders.inet_nops?.is_active === true;
  const visibleTransferPaymentMode = inetQrEnabled ? transferPaymentMode : "manual";
  const inetQrUrl = normalizeQrImageSource(inetPaymentIntent?.qr_code);
  const promptPayPhoneDisplay = formatPromptPayPhoneDisplay(activePromptPayPhone);
  const expectedPayeeName = (paymentAccount?.account_name || DEFAULT_PROMPTPAY_PAYEE).trim();
  const currentTransferSlipSignature = `${activePaymentQrMode}:${activePaymentQrMode === "qr_image" ? paymentAccount?.qr_image_url ?? "" : activePromptPayPhone}:${transferPromptPayAmount}`;
  const transferSlipReverifyRequired =
    transferSlipVerified && transferSlipVerifiedAgainst !== null && transferSlipVerifiedAgainst !== currentTransferSlipSignature;
  const transferSlipReadyToSubmit =
    Boolean(transferSlipFile) && transferSlipVerified && transferSlipVerifiedAgainst === currentTransferSlipSignature;
  const transferFallbackOverrideActive = Boolean(transferOverrideApprovalId);
  const transferNeedsOverride = !transferSlipReadyToSubmit && (Boolean(transferSlipChecks) || Boolean(transferError));
  const transferCanSubmit = transferSlipReadyToSubmit || transferFallbackOverrideActive;
  const transferVerificationHistory = useMemo(() => {
    if (!transferReviewOrder?.order_id) {
      return [];
    }
    return tableTransferVerifications.filter((entry) => entry.order_id === transferReviewOrder.order_id);
  }, [tableTransferVerifications, transferReviewOrder?.order_id]);

  useEffect(() => {
    if (inetQrEnabled || transferPaymentMode !== "inet_nops") return;
    setTransferPaymentMode("manual");
    setInetPaymentIntent(null);
    setInetQrStatus("idle");
    setTransferError(null);
  }, [inetQrEnabled, transferPaymentMode]);
  const sidebarTransferVerificationHistory = useMemo(() => {
    if (!activeOrder?.id) {
      return [];
    }
    return tableTransferVerifications.filter((entry) => entry.order_id === activeOrder.id);
  }, [tableTransferVerifications, activeOrder?.id]);
  const latestSidebarTransferVerification = sidebarTransferVerificationHistory[0] ?? null;
  const receiptDiscountAmount = useMemo(
    () => (receiptSession ? resolveReceiptDiscountAmount(receiptSession) : 0),
    [receiptSession]
  );
  const receiptTaxLines = useMemo(
    () => (receiptSession ? resolveTaxLinesForReceipt(receiptSession, text.tax) : []),
    [receiptSession, text.tax]
  );
  const reviewOrderId = reviewOrder?.order_id ?? null;
  const reviewOrderItemProductIds = useMemo(() => {
    if (!reviewOrderId || !reviewOrder) return [];
    return Array.from(
      new Set(
        reviewOrder.items
          .map((item) => normalizeProductId(item.product_id))
          .filter(Boolean)
      )
    );
  }, [reviewOrder, reviewOrderId]);
  useEffect(() => {
    if (!reviewOrderId) {
      setReviewItemDeductingKey(null);
      setReviewItemDeductingMode(null);
      setIngredientAdjustDialog(null);
      setIngredientAdjustOptions([]);
      setIngredientAdjustSelectedIds([]);
      setIngredientAdjustLoading(false);
      setIngredientAdjustError(null);
      setReviewRecipeProductIds(new Set());
      setReviewRecipeProductIdsLoaded(false);
      return;
    }
    setReviewItemDeductingKey(null);
    setReviewItemDeductingMode(null);
    setIngredientAdjustDialog(null);
    setIngredientAdjustOptions([]);
    setIngredientAdjustSelectedIds([]);
    setIngredientAdjustLoading(false);
    setIngredientAdjustError(null);
    setReviewRecipeProductIds(new Set());
    setReviewRecipeProductIdsLoaded(false);
  }, [reviewOrderId]);
  useEffect(() => {
    if (!reviewOrderId) return;
    let cancelled = false;

    async function loadReviewRecipeProducts() {
      if (reviewOrderItemProductIds.length === 0) {
        if (!cancelled) {
          setReviewRecipeProductIds(new Set());
          setReviewRecipeProductIdsLoaded(true);
        }
        return;
      }

      try {
        const query = encodeURIComponent(reviewOrderItemProductIds.join(","));
        const { response, body } = await fetchJsonWithTimeout<PosRecipeProductsResponseBody>(
          `/api/pos/recipe-products?product_ids=${query}`,
          { cache: "no-store" },
          12000
        );

        if (!response.ok || body.error) {
          throw new Error(body.error?.message ?? "Failed to load review recipe products.");
        }

        const productIds = Array.isArray(body.data?.product_ids)
          ? body.data!.product_ids!.map((id) => normalizeProductId(id)).filter(Boolean)
          : [];

        if (!cancelled) {
          setReviewRecipeProductIds(new Set(productIds));
          setReviewRecipeProductIdsLoaded(true);
        }
      } catch {
        if (!cancelled) {
          setReviewRecipeProductIds(new Set());
          setReviewRecipeProductIdsLoaded(true);
        }
      }
    }

    void loadReviewRecipeProducts();
    return () => {
      cancelled = true;
    };
  }, [reviewOrderId, reviewOrderItemProductIds]);
  const canDeductIngredientForItem = useCallback(
    (productId: string) => {
      const normalizedProductId = normalizeProductId(productId);
      if (!normalizedProductId) return false;
      if (!reviewRecipeProductIdsLoaded) return false;
      return reviewRecipeProductIds.has(normalizedProductId);
    },
    [reviewRecipeProductIds, reviewRecipeProductIdsLoaded]
  );
  const ingredientAdjustLineKey = ingredientAdjustDialog
    ? `${ingredientAdjustDialog.order.order_id}:${ingredientAdjustDialog.item.product_id}`
    : null;
  const ingredientAdjustBusy = ingredientAdjustLineKey !== null && reviewItemDeductingKey === ingredientAdjustLineKey;
  const ingredientAdjustSelectedSet = useMemo(() => new Set(ingredientAdjustSelectedIds), [ingredientAdjustSelectedIds]);
  const ingredientAdjustSelectableRestoreIds = useMemo(
    () =>
      ingredientAdjustOptions
        .filter((entry) => Number(entry.restorable_grams ?? 0) > 0)
        .map((entry) => String(entry.ingredient_id)),
    [ingredientAdjustOptions]
  );
  const ingredientAdjustCanDeduct = ingredientAdjustSelectedIds.length > 0;
  const ingredientAdjustCanRestore = ingredientAdjustSelectableRestoreIds.some((id) => ingredientAdjustSelectedSet.has(id));
  const sidebarPaymentMethod: BillPaymentMethod = receiptSession?.payment_method ?? (transferReviewOrder ? "bank_transfer" : cashReviewOrder ? "cash" : billPaymentMethod);
  const cashQuickAmounts = [500, 1000, 1500];
  const cashKeypadKeys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "00", "."];
  const activeReceiptStoreProfile = receiptSession?.store_profile ?? storeProfile;
  const receiptStoreName = String(activeReceiptStoreProfile?.display_name ?? activeReceiptStoreProfile?.name ?? "").trim() || (lang === "th" ? "ร้านค้า" : "Store");
  const receiptStoreAddress = String(activeReceiptStoreProfile?.company_address ?? "").trim();
  const receiptStorePhone = String(activeReceiptStoreProfile?.contact_phone ?? "").trim();
  const receiptBranchLabel = branchName;
  const receiptFallbackLogoPath = "/brand/cpipos-logo.png";
  const receiptStoreLogoPath = normalizeReceiptLogoPath(activeReceiptStoreProfile?.logo_url);
  const receiptLogoPath = receiptStoreLogoPath ?? receiptFallbackLogoPath;
  const showTableBrowser = isTableSalesMode(quickMode) && tableBrowserOpen;
  const showDeliverySetup = quickMode === "delivery" && !deliveryCatalogOpen;
  const isDeliveryMode = quickMode === "delivery" || orderType === "delivery_manual";
  const deliveryDraftTouched =
    isDeliveryMode &&
    (Boolean(selectedDeliveryApp) ||
      deliveryExternalCode.trim().length > 0 ||
      deliveryNotes.trim().length > 0);
  const tableZoneNameMap = useMemo(() => new Map(tableZones.map((zone) => [zone.id, zone.zone_name])), [tableZones]);
  const moveTableCandidates = useMemo(
    () => {
      const candidates = posTables.filter(
        (table) =>
          table.id !== selectedTable?.id &&
          table.status !== "disabled" &&
          table.status !== "reserved" &&
          !table.active_session_id &&
          table.status !== "occupied" &&
          table.status !== "ordering" &&
          table.status !== "pending_payment"
      );
      return [...candidates].sort((left, right) => naturalCompareTableCode(left.table_code, right.table_code));
    },
    [posTables, selectedTable?.id]
  );
  usePosRenderProfiler("PosSalesModule", [
    quickMode,
    orderType,
    cart.length,
    pendingSyncCount,
    Boolean(loading),
    Boolean(isBusy),
    Boolean(tableBrowserOpen),
    Boolean(heldBillsModalOpen)
  ]);
  useEffect(() => {
    if (!tableMoveModalOpen) return;
    if (!tableMoveTargetId) return;
    if (moveTableCandidates.some((table) => table.id === tableMoveTargetId)) return;
    setTableMoveTargetId("");
    setTableMoveError(text.tableMoveNoTarget);
  }, [moveTableCandidates, tableMoveModalOpen, tableMoveTargetId, text.tableMoveNoTarget]);
  const canCancelActiveOrder = Boolean(activeOrder && activeOrder.status === "queued");
  const canClearWorkingCart = cart.length > 0 || deliveryDraftTouched;
  const canCancelFromSidebar = canCancelActiveOrder || canClearWorkingCart;
  const showSidebarOrderSummary = Boolean(
    (activeOrder || hasOpenDineInSession || (orderType === "delivery_manual" && deliveryDraftBillNo)) &&
      (orderType !== "takeaway" ||
        cart.length > 0 ||
        reviewOrder ||
        cashReviewOrder ||
        transferReviewOrder ||
        receiptSession ||
        receiptSaving ||
        hasOpenDineInSession)
  );
  const isTableSelectionSummaryIdle = isTableSalesMode(quickMode) && tableBrowserOpen;
  const hasTaxSummaryEnabled = taxSettings.is_enabled && taxSettings.lines.some((line) => line.is_active && Number(line.rate_pct) > 0);
  const showSummaryBillNo = !isTableSelectionSummaryIdle && showSidebarOrderSummary && activeBillNo !== "-";
  const showSummaryPaymentMethod = showSummaryBillNo;
  const showSummaryStatus = !isTableSelectionSummaryIdle && (showSummaryBillNo || (orderType === "delivery_manual" && deliveryDraftTouched));
  const showSummaryDiscount = !isTableSelectionSummaryIdle && summaryDiscount > 0;
  const showSummaryTax = !isTableSelectionSummaryIdle && hasTaxSummaryEnabled;
  const isDeliveryPendingPanelMode = quickMode === "delivery";
  const heldBillPool = useMemo(
    () =>
      (isDeliveryPendingPanelMode ? heldBills.filter((entry) => entry.order_type === "delivery_manual") : heldBills).map((entry) =>
        normalizeHeldBillEntry(entry)
      ),
    [heldBills, isDeliveryPendingPanelMode]
  );
  const normalizedHeldBillSearch = heldBillSearch.trim().toLowerCase();
  const filteredHeldBills = useMemo(() => {
    if (!normalizedHeldBillSearch) return heldBillPool;
    return heldBillPool.filter((entry) => {
      const labelHit = entry.label.toLowerCase().includes(normalizedHeldBillSearch);
      const codeHit = entry.delivery_external_code?.toLowerCase().includes(normalizedHeldBillSearch) ?? false;
      return labelHit || codeHit;
    });
  }, [heldBillPool, normalizedHeldBillSearch]);
  useEffect(() => {
    if (!receiptSession) return;
    void primeReceiptPrintFrameRef.current(receiptSession).catch(() => undefined);
  }, [receiptSession, lang, sellerName, shift?.status, quickMode, receiptLogoPath, receiptBranchLabel, receiptStoreName, receiptStoreAddress, receiptStorePhone]);

  useEffect(() => {
    return () => {
      if (receiptPrintFrameRef.current && receiptPrintFrameRef.current.isConnected) {
        receiptPrintFrameRef.current.remove();
      }
      receiptPrintFrameRef.current = null;
      receiptPrintFrameHtmlRef.current = "";
      receiptPrintFrameLoadTokenRef.current = 0;
    };
  }, []);

  useEffect(() => {
    const runtime = globalThis as {
      __posVerification?: {
        source: string;
        clearTrace: () => void;
        readTrace: () => Array<Record<string, unknown>>;
        getReceiptPrintHtml?: () => string | null;
        snapshot: () => Record<string, unknown>;
      };
    };
    Object.assign(runtime, {
      __posVerification: {
        source: "PosSalesModule",
        clearTrace: clearPosTraceEvents,
        readTrace: readPosTraceEvents,
        getReceiptPrintHtml: () => (receiptSession ? buildReceiptPrintHtmlRef.current(receiptSession) : null),
        snapshot: () => ({
          quick_mode: quickMode,
          order_type: orderType,
          held_bills_total: heldBills.length,
          held_bills_delivery: heldBillPool.length,
          delivery_action_busy_ids: Object.keys(deliveryActionBusyById),
          delivery_action_lock_size: deliveryActionLockRef.current.size,
          delivery_action_queue_size: deliveryActionQueueByBillRef.current.size,
          checkout_request_lock: checkoutRequestLockRef.current,
          table_move_busy: tableMoveBusy,
          receipt_modal_open: Boolean(receiptSession),
          receipt_saving: receiptSaving,
          active_order_id: activeOrder?.id ?? null,
          selected_table_id: selectedTable?.id ?? null,
          cart_items: cart.length
        })
      }
    });
    return () => {
      if (runtime.__posVerification?.source === "PosSalesModule") {
        delete runtime.__posVerification;
      }
    };
  }, [
    activeOrder?.id,
    cart.length,
    heldBills.length,
    heldBillPool.length,
    orderType,
    quickMode,
    receiptSaving,
    receiptSession,
    selectedTable?.id,
    tableMoveBusy,
    deliveryActionBusyById
  ]);

  useEffect(() => {
    if (quickMode !== "delivery" && orderType !== "delivery_manual") return;

    const hasPendingDeliverySubmit = pendingQueue.some((entry) => entry.payload.order_type === "delivery_manual");
    if (
      deliveryFlowState === "cancelled" &&
      !activeOrder &&
      !hasPendingDeliverySubmit &&
      !reviewOrder &&
      !cashReviewOrder &&
      !transferReviewOrder &&
      !cashSubmitting &&
      !transferSubmitting &&
      !receiptSaved &&
      !receiptSession &&
      !deliveryDraftTouched &&
      cart.length === 0
    ) {
      return;
    }
    if (hasPendingDeliverySubmit) {
      setDeliveryFlowState("pending_dispatch");
      return;
    }

    if (reviewOrder || cashReviewOrder || transferReviewOrder || cashSubmitting || transferSubmitting) {
      setDeliveryFlowState("confirm_payment");
      return;
    }

    if (receiptSaved || (receiptSession && !activeOrder)) {
      setDeliveryFlowState("completed");
      return;
    }

    if (activeOrder?.status === "cancelled") {
      setDeliveryFlowState("cancelled");
      return;
    }

    if (activeOrder?.status === "queued") {
      setDeliveryFlowState("edit");
      return;
    }

    setDeliveryFlowState("create");
  }, [
    activeOrder,
    cashReviewOrder,
    cashSubmitting,
    orderType,
    pendingQueue,
    quickMode,
    cart.length,
    deliveryDraftTouched,
    deliveryFlowState,
    receiptSaved,
    receiptSession,
    reviewOrder,
    transferReviewOrder,
    transferSubmitting
  ]);

  const deliveryApps = useMemo<DeliveryApp[]>(
    () => [
      {
        id: "lineman",
        nameTh: "ไลน์แมน",
        nameEn: "LINE MAN",
        orderPrefix: "LM",
        logoOfficial: "/brand/delivery/official/lineman.png",
        logoFallback: "/brand/delivery/lineman.svg"
      },
      {
        id: "grabfood",
        nameTh: "แกร็บฟู้ด",
        nameEn: "GrabFood",
        orderPrefix: "GF",
        logoOfficial: "/brand/delivery/official/grabfood.png",
        logoFallback: "/brand/delivery/grabfood.svg"
      },
      {
        id: "shopeefood",
        nameTh: "ช้อปปี้ฟู้ด",
        nameEn: "ShopeeFood",
        orderPrefix: "SF",
        logoOfficial: "/brand/delivery/official/shopeefood.png",
        logoFallback: "/brand/delivery/shopeefood.svg"
      }
    ],
    []
  );
  const deliveryPopupApp = deliveryPopupAppId ? deliveryApps.find((app) => app.id === deliveryPopupAppId) ?? null : null;

  function openDeliveryOrderPopup(app: DeliveryApp) {
    const isSameApp = selectedDeliveryApp === app.id;
    setDeliveryPopupAppId(app.id);
    setDeliveryPopupCodeDigits(isSameApp ? extractDeliveryCodeDigits(app.id, deliveryExternalCode) : "");
    setDeliveryPopupNotes(isSameApp ? deliveryNotes : "");
  }

  function confirmDeliveryOrderPopup() {
    if (!deliveryPopupAppId) {
      pushSubmitMessage(text.deliverySelectAppRequired);
      return;
    }
    const digits = deliveryPopupCodeDigits.replace(/\D/g, "");
    if (!digits) {
      pushSubmitMessage(text.deliveryExternalDigitsRequired);
      return;
    }
    const code = buildDeliveryExternalCode(deliveryPopupAppId, digits);
    setSelectedDeliveryApp(deliveryPopupAppId);
    setDeliveryExternalCode(code);
    setDeliveryNotes(deliveryPopupNotes.trim());
    setDeliveryCustomerName("");
    setDeliveryDraftBillNo(buildDeliveryDraftBillNo(deliveryPopupAppId, code));
    setDeliveryCatalogOpen(true);
    setDeliveryPopupAppId(null);
    setDeliveryPopupCodeDigits("");
    setDeliveryPopupNotes("");
    pushSubmitMessage(text.deliveryDraftOpened);
  }

  function appendDeliveryStatusHistory(
    entry: HeldBill,
    status: DeliveryPendingStatus,
    note?: string | null
  ): DeliveryPendingStatusHistoryEntry[] {
    const previousHistory = normalizeHeldBillStatusHistory(entry);
    return [
      ...previousHistory,
      {
        status,
        at: new Date().toISOString(),
        note: note?.trim() ? note.trim() : null
      }
    ];
  }

  function updateDeliveryHeldBillStatus(heldBillId: string, status: DeliveryPendingStatus, note?: string | null) {
    setHeldBills((current) =>
      current.map((entry) => {
        if (entry.id !== heldBillId || entry.order_type !== "delivery_manual") {
          return entry;
        }
        return {
          ...entry,
          queue_status: status,
          status_history: appendDeliveryStatusHistory(entry, status, note)
        };
      })
    );
  }

  function getDeliveryPendingStatusLabel(status: DeliveryPendingStatus | undefined): string {
    if (status === "editing") return text.deliveryPendingStatusEditing;
    if (status === "sending") return text.deliveryPendingStatusSending;
    if (status === "sent") return text.deliveryPendingStatusSent;
    if (status === "cancelled") return text.deliveryPendingStatusCancelled;
    return text.deliveryPendingStatusPending;
  }

  function waitFor(ms: number) {
    return new Promise<void>((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  async function runDeliveryActionWithRetry(
    action: "send" | "cancel",
    heldBill: HeldBill,
    handler: (entry: HeldBill) => Promise<void> | void
  ) {
    let attempt = 0;
    while (attempt <= DELIVERY_ACTION_RETRY_LIMIT) {
      try {
        await handler(heldBill);
        return;
      } catch (error) {
        const isFinalAttempt = attempt >= DELIVERY_ACTION_RETRY_LIMIT;
        if (isFinalAttempt) {
          throw error;
        }
        const retryDelayMs = DELIVERY_ACTION_BACKOFF_MS * Math.pow(2, attempt) + randomJitterMs(120);
        const retryTrace = beginPosActionTrace("delivery.pending.retry_wait", {
          bill_id: heldBill.id,
          action,
          attempt: attempt + 1,
          delay_ms: retryDelayMs
        });
        await waitFor(retryDelayMs);
        endPosActionTrace(retryTrace, "retry", {
          bill_id: heldBill.id,
          action,
          attempt: attempt + 1
        });
        attempt += 1;
      }
    }
  }

  function queueDeliveryPendingAction(
    heldBill: HeldBill,
    action: "send" | "cancel",
    handler: (entry: HeldBill) => Promise<void> | void
  ) {
    if (heldBill.order_type !== "delivery_manual") return;
    const debounceKey = `${action}:${heldBill.id}`;
    const nowAt = nowMs();
    const lastAt = deliveryActionLastAtRef.current.get(debounceKey) ?? 0;
    if (nowAt - lastAt < DELIVERY_ACTION_DEBOUNCE_MS) {
      return;
    }
    deliveryActionLastAtRef.current.set(debounceKey, nowAt);
    if (deliveryActionPendingKeyRef.current.has(debounceKey)) {
      return;
    }
    deliveryActionPendingKeyRef.current.add(debounceKey);

    const queueMap = deliveryActionQueueByBillRef.current;
    const currentQueue = queueMap.get(heldBill.id) ?? Promise.resolve();
    const nextQueue = currentQueue
      .catch(() => undefined)
      .then(async () => {
        const trace = beginPosActionTrace(`delivery.pending.${action}`, {
          bill_id: heldBill.id,
          queue_status: heldBill.queue_status ?? "pending"
        });
        deliveryActionLockRef.current.add(heldBill.id);
        setDeliveryActionBusyById((current) => ({
          ...current,
          [heldBill.id]: action
        }));
        try {
          await runDeliveryActionWithRetry(action, heldBill, handler);
          endPosActionTrace(trace, "ok", {
            bill_id: heldBill.id,
            action
          });
        } catch (actionError) {
          const message = actionError instanceof Error ? actionError.message : String(actionError ?? "");
          if (message === DELIVERY_ACTION_BUSY_ERROR) {
            pushSubmitMessage(text.submitting);
          } else if (message) {
            pushSubmitMessage(message);
          }
          endPosActionTrace(trace, "error", {
            bill_id: heldBill.id,
            action,
            error: message || "unknown"
          });
        } finally {
          deliveryActionLockRef.current.delete(heldBill.id);
          deliveryActionPendingKeyRef.current.delete(debounceKey);
          setDeliveryActionBusyById((current) => {
            if (!(heldBill.id in current)) {
              return current;
            }
            const next = { ...current };
            delete next[heldBill.id];
            return next;
          });
        }
      });
    queueMap.set(heldBill.id, nextQueue);
    nextQueue.finally(() => {
      if (queueMap.get(heldBill.id) === nextQueue) {
        queueMap.delete(heldBill.id);
      }
    });
  }

  function cancelPendingDeliveryBillNow(heldBill: HeldBill) {
    if (heldBill.order_type !== "delivery_manual") return;
    setHeldBills((current) => current.filter((entry) => entry.id !== heldBill.id));
    if (deliveryEditingHeldBillId === heldBill.id) {
      setDeliveryEditingHeldBillId(null);
      resetDeliveryDraft();
      setCart([]);
      setActiveOrder(null);
      setReviewOrder(null);
      setCashReviewOrder(null);
      setTransferReviewOrder(null);
      setDeliveryCatalogOpen(false);
    }
    pushSubmitMessage(`${text.deliveryPendingBillCancelled}: ${heldBill.label}`);
  }

  function stageCurrentDeliveryOrder() {
    const pricedCart = normalizeDeliveryCartItemsForApp(cart, selectedDeliveryApp);
    const stageBlockingReason = getDeliveryStageBlockingReason({
      orderType,
      selectedDeliveryApp,
      deliveryExternalCode,
      pricedCartSize: pricedCart.length
    });
    if (stageBlockingReason === "delivery_pending_bill_need_order") {
      pushSubmitMessage(text.deliveryPendingBillNeedOrder);
      return;
    }
    if (stageBlockingReason === "add_items_first") {
      pushSubmitMessage(text.addItemsFirst);
      return;
    }
    if (!selectedDeliveryApp) {
      pushSubmitMessage(text.deliveryPendingBillNeedOrder);
      return;
    }
    const heldAt = new Date().toISOString();
    const nextLabel = deliveryDraftBillNo || buildDeliveryDraftBillNo(selectedDeliveryApp, deliveryExternalCode);
    const nextHeldBill = buildNewStagedDeliveryHeldBill({
      heldAt,
      label: nextLabel,
      selectedDeliveryApp,
      deliveryExternalCode,
      deliveryNotes,
      pricedCart,
      summaryDiscount
    });
    const editingHeldBillId = deliveryEditingHeldBillId;
    setHeldBills((current) =>
      applyStagedDeliveryToHeldBills({
        current,
        editingHeldBillId,
        nextHeldBill,
        heldAt,
        selectedDeliveryApp,
        deliveryExternalCode,
        deliveryNotes,
        pricedCart,
        summaryDiscount,
        appendStatusHistory: (bill, status, note) => appendDeliveryStatusHistory(bill as HeldBill, status, note)
      }) as HeldBill[]
    );
    setDeliveryEditingHeldBillId(null);
    setCart([]);
    setActiveOrder(null);
    setReviewOrder(null);
    setCashReviewOrder(null);
    setTransferReviewOrder(null);
    resetDeliveryDraft();
    setDeliveryCatalogOpen(false);
    pushSubmitMessage(`${text.deliveryPendingBillSaved}: ${nextLabel}`);
  }

  async function sendPendingDeliveryBillNow(heldBill: HeldBill) {
    await sendPendingDeliveryBillNowWithEffects({
      heldBill, isBusy, checkoutRequestLockRef, shiftId: shift?.id ?? null, isOnline,
      text: { openShiftRequired: text.openShiftRequired, deliveryPendingBillNeedOrder: text.deliveryPendingBillNeedOrder, deliveryPendingStatusCancelled: text.deliveryPendingStatusCancelled, deliveryPendingStatusSent: text.deliveryPendingStatusSent, addItemsFirst: text.addItemsFirst, offlineStaged: text.offlineStaged, submitFailed: text.submitFailed, retrySafe: text.retrySafe },
      deliveryActionBusyError: DELIVERY_ACTION_BUSY_ERROR,
      normalizeDeliveryCartItemsForApp: (cart, appId) => normalizeDeliveryCartItemsForApp(cart, appId ?? null),
      newIdempotencyKey, mapDeliveryChannel, buildDeliveryDraftBillNo, appendDeliveryStatusHistory,
      submitOrder: async (payload) => submitOrder(payload),
      submitTransferPayment: async (pendingPaymentEntry, applyUiResult) => submitTransferPayment(pendingPaymentEntry, applyUiResult),
      enqueuePendingSubmit, enqueuePendingPayment, markPendingPaymentFailed, markConnectivityFromError, pushSubmitMessage,
      setSubmitting, setTransferSubmitting, setDeliveryEditingHeldBillId, setSelectedDeliveryApp, setDeliveryExternalCode,
      setDeliveryNotes, setDeliveryDraftBillNo, setQuickMode, setOrderType, setDeliveryCatalogOpen, setCart, setCartDrawerOpen, setHeldBills, setDeliveryFlowState,
      updateDeliveryHeldBillStatus
    });
  }

  function cancelPendingDeliveryBill(heldBill: HeldBill) { queueDeliveryPendingAction(heldBill, "cancel", (entry) => { cancelPendingDeliveryBillNow(entry); }); }

  function sendPendingDeliveryBill(heldBill: HeldBill) { queueDeliveryPendingAction(heldBill, "send", async (entry) => { await sendPendingDeliveryBillNow(entry); }); }

  function showOutOfStockNotice(productName: string) {
    pushSubmitMessage(`${text.productOutOfStock}: ${productName}`);
    setOutOfStockNotice({ productName });
  }

  function addCartLine(product: ProductRow, input?: { quantity?: number; notes?: string | null; extraPrice?: number }) {
    const stockUnits = product.stock_on_hand_units;
    const quantity = Math.max(1, Math.trunc(Number(input?.quantity ?? 1)));
    const notes = String(input?.notes ?? "").trim();
    const hasCustomOptions = notes.length > 0 || Number(input?.extraPrice ?? 0) > 0;
    const cartLineId = hasCustomOptions ? `${product.id}:${notes}:${Number(input?.extraPrice ?? 0).toFixed(2)}` : product.id;
    const cartQty = cartRef.current
      .filter((row) => row.product_id === product.id)
      .reduce((sum, row) => sum + row.quantity, 0);
    if (!allowNegativeStock && stockUnits !== null && stockUnits !== undefined && cartQty + quantity > Number(stockUnits)) {
      showOutOfStockNotice(product.name);
      return;
    }
    const unitPrice = Number((getProductPriceForCurrentMode(product) + Math.max(0, Number(input?.extraPrice ?? 0))).toFixed(2));
    setCart((current) => {
      const index = current.findIndex((row) => (row.cart_line_id ?? row.product_id) === cartLineId);
      if (index >= 0) {
        const next = [...current];
        const entry = next[index];
        next[index] = { ...entry, quantity: entry.quantity + quantity, price: unitPrice, notes: notes || null };
        return next;
      }
      return [...current, { cart_line_id: cartLineId, product_id: product.id, name: product.name, quantity, price: unitPrice, notes: notes || null }];
    });
  }

  function addToCart(product: ProductRow) {
    if (product.has_recipe_deduction) {
      setModifierDraft({ product, quantity: 1, notes: "", extraPrice: 0, linkedIngredientQuantity: 1 });
      return;
    }
    addCartLine(product);
  }

  function removeFromCart(cartLineId: string) {
    setCart((current) => current.filter((row) => (row.cart_line_id ?? row.product_id) !== cartLineId));
  }

  function adjustQty(cartLineId: string, delta: number) {
    if (delta > 0) {
      const currentLine = cartRef.current.find((row) => (row.cart_line_id ?? row.product_id) === cartLineId);
      const product = productById.get(currentLine?.product_id ?? cartLineId);
      const stockUnits = product?.stock_on_hand_units;
      const currentQty = cartRef.current
        .filter((row) => row.product_id === product?.id)
        .reduce((sum, row) => sum + row.quantity, 0);
      if (!allowNegativeStock && stockUnits !== null && stockUnits !== undefined && currentQty + delta > Number(stockUnits)) {
        showOutOfStockNotice(product?.name ?? cartLineId);
        return;
      }
    }
    setCart((current) =>
      current
        .map((row) =>
          (row.cart_line_id ?? row.product_id) === cartLineId ? { ...row, quantity: Math.max(0, row.quantity + delta) } : row
        )
        .filter((row) => row.quantity > 0)
    );
  }

  function setCartLineQuantity(cartLineId: string, nextQuantityInput: number): boolean {
    const nextQuantity = Math.max(1, Math.trunc(Number(nextQuantityInput || 1)));
    const currentLine = cartRef.current.find((row) => (row.cart_line_id ?? row.product_id) === cartLineId);
    if (!currentLine) return false;
    const product = productById.get(currentLine.product_id);
    const stockUnits = product?.stock_on_hand_units;
    const otherQuantity = cartRef.current
      .filter((row) => row.product_id === currentLine.product_id && (row.cart_line_id ?? row.product_id) !== cartLineId)
      .reduce((sum, row) => sum + row.quantity, 0);
    if (!allowNegativeStock && stockUnits !== null && stockUnits !== undefined && otherQuantity + nextQuantity > Number(stockUnits)) {
      showOutOfStockNotice(product?.name ?? currentLine.name);
      return false;
    }
    setCart((current) =>
      current.map((row) =>
        (row.cart_line_id ?? row.product_id) === cartLineId ? { ...row, quantity: nextQuantity } : row
      )
    );
    return true;
  }

  function startCartQtyEdit(cartLineId: string, quantity: number) {
    setEditingCartQtyLineId(cartLineId);
    setEditingCartQtyInput(String(Math.max(1, Math.trunc(Number(quantity || 1)))));
  }

  function cancelCartQtyEdit() {
    setEditingCartQtyLineId(null);
    setEditingCartQtyInput("");
  }

  function commitCartQtyEdit(cartLineId: string) {
    const parsed = Math.max(1, Math.trunc(Number(editingCartQtyInput || 1)));
    if (setCartLineQuantity(cartLineId, parsed)) {
      cancelCartQtyEdit();
    }
  }

  function handleCartQtyInputChange(event: ChangeEvent<HTMLInputElement>) {
    const digitsOnly = event.target.value.replace(/\D/g, "");
    if (!digitsOnly) {
      setEditingCartQtyInput("");
      return;
    }
    const normalized = String(Math.max(1, Math.trunc(Number(digitsOnly))));
    setEditingCartQtyInput(normalized);
  }

  function clearCart() {
    if (orderType === "delivery_manual" && !activeOrder) {
      resetDeliveryDraft();
    }
    setCart([]);
    setSelectedMember(null);
  }

  function confirmModifierDraft() {
    if (!modifierDraft) return;
    const canAddPrice = quickMode !== "delivery";
    if (modifierDraft.editingCartLineId) {
      const notes = modifierDraft.notes.trim();
      const extraPrice = canAddPrice ? Math.max(0, modifierDraft.extraPrice) : 0;
      const unitPrice = Number((getProductPriceForCurrentMode(modifierDraft.product) + extraPrice).toFixed(2));
      const nextLineId = notes.length > 0 || extraPrice > 0 ? `${modifierDraft.product.id}:${notes}:${extraPrice.toFixed(2)}` : modifierDraft.product.id;
      setCart((current) =>
        current.map((row) =>
          (row.cart_line_id ?? row.product_id) === modifierDraft.editingCartLineId
            ? {
                ...row,
                cart_line_id: nextLineId,
                quantity: modifierDraft.quantity,
                price: unitPrice,
                notes: notes || null
              }
            : row
        )
      );
    } else {
      addCartLine(modifierDraft.product, {
        quantity: modifierDraft.quantity,
        notes: modifierDraft.notes,
        extraPrice: canAddPrice ? modifierDraft.extraPrice : 0
      });
    }
    setModifierDraft(null);
  }

  function openCartLineEditor(item: CartItem) {
    const product = productById.get(item.product_id);
    if (!product) return;
    const basePrice = getProductPriceForCurrentMode(product);
    const extraPrice = quickMode === "delivery" ? 0 : Math.max(0, Number((Number(item.price ?? 0) - basePrice).toFixed(2)));
    setModifierDraft({
      product,
      quantity: item.quantity,
      notes: item.notes ?? "",
      extraPrice,
      linkedIngredientQuantity: readIngredientNoteQuantity(item.notes ?? ""),
      editingCartLineId: item.cart_line_id ?? item.product_id
    });
  }

  function toggleModifierIngredient(name: string) {
    const value = name.trim();
    if (!value) return;
    setModifierDraft((current) => {
      if (!current) return current;
      return { ...current, notes: toggleIngredientInNotes(current.notes, value, current.linkedIngredientQuantity) };
    });
  }

  function adjustLinkedIngredientQuantity(delta: number) {
    setModifierDraft((current) => {
      if (!current) return current;
      if (!hasSelectedIngredientInNotes(current.notes, modifierIngredients)) return current;
      const linkedIngredientQuantity = Math.max(1, current.linkedIngredientQuantity + delta);
      return {
        ...current,
        linkedIngredientQuantity,
        notes: updateSelectedIngredientNoteQuantity(current.notes, modifierIngredients, linkedIngredientQuantity)
      };
    });
  }

  async function searchMembers(nextQuery = memberSearch) {
    const queryText = nextQuery.trim();
    setMemberSearchLoading(true);
    setMemberSearchError("");
    try {
      const response = await fetch(`/api/pos/members?q=${encodeURIComponent(queryText)}`, { cache: "no-store" });
      const body = (await response.json().catch(() => null)) as { data?: { members?: PosMemberChoice[] } | null; error?: { message?: string } | null } | null;
      if (!response.ok || body?.error) {
        throw new Error(body?.error?.message ?? "Failed to load members.");
      }
      setMemberSearchResults(body?.data?.members ?? []);
    } catch (error) {
      setMemberSearchError(error instanceof Error ? error.message : "Failed to load members.");
    } finally {
      setMemberSearchLoading(false);
    }
  }

  function openMemberPicker() {
    setMemberPickerOpen(true);
    setMemberSearch("");
    setMemberSearchError("");
    setMemberSearchResults([]);
    setMemberPointsInput(String(selectedMember?.points ?? 0));
    setMemberStampsInput(String(selectedMember?.stamps ?? 0));
    void searchMembers("");
  }

  function chooseMember(member: PosMemberChoice) {
    setSelectedMember(member);
    setMemberPointsInput(String(member.points ?? 0));
    setMemberStampsInput(String(member.stamps ?? 0));
  }

  function saveMemberSelection() {
    if (!selectedMember) return;
    const nextMember = {
      ...selectedMember,
      points: Math.max(0, Math.floor(Number(memberPointsInput || 0))),
      stamps: Math.max(0, Math.floor(Number(memberStampsInput || 0)))
    };
    setSelectedMember(nextMember);
    setMemberPointsInput(String(nextMember.points));
    setMemberStampsInput(String(nextMember.stamps));
    setMemberPickerOpen(false);
  }

  function openBuffetPickerForTable(table: DiningTableItem) {
    setBuffetPicker((current) => ({
      open: true,
      table,
      prompted_table_id: table.id ?? current.prompted_table_id
    }));
  }

  function closeBuffetPicker() {
    setBuffetPicker((current) => ({
      ...current,
      open: false
    }));
  }

  function confirmBuffetPickerItem(item: CartItem) {
    const targetTable = buffetPicker.table ?? selectedTable;
    const nextCart = appendConfirmedBuffetItem(cartRef.current, item);
    setCart(nextCart);
    if (targetTable?.id) {
      rememberDineInDraft(targetTable.id, nextCart);
    }
    setBuffetPicker((current) => ({
      ...current,
      open: false,
      prompted_table_id: targetTable?.id ?? current.prompted_table_id
    }));
    pushSubmitMessage(
      lang === "th"
        ? `เพิ่มชุดบุฟเฟ่ลงตะกร้า: ${item.name}`
        : `Buffet item added: ${item.name}`
    );
  }

  function moveMenuProduct(productId: string, direction: -1 | 1) {
    setProductOrderByBranch((current) => {
      const currentIds = visibleProducts.map((product) => product.id);
      const existing = current[menuOrderKey] ?? [];
      const merged = [...existing.filter((id) => currentIds.includes(id)), ...currentIds.filter((id) => !existing.includes(id))];
      const index = merged.indexOf(productId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= merged.length) return current;
      const next = [...merged];
      const [item] = next.splice(index, 1);
      next.splice(nextIndex, 0, item);
      return { ...current, [menuOrderKey]: next };
    });
  }

  function resetMenuOrder() {
    setProductOrderByBranch((current) => {
      const next = { ...current };
      delete next[menuOrderKey];
      return next;
    });
  }

  function openDiscountPopup() {
    const safeSubtotal = Math.max(0, subtotal);
    if (safeSubtotal <= 0) {
      setDiscountPercentInput("");
      setDiscountAmountInput("");
      setDiscountEditMode("percent");
      setDiscountModalOpen(true);
      return;
    }
    const percentValue = summaryDiscount > 0 ? Number(((summaryDiscount / safeSubtotal) * 100).toFixed(2)) : 0;
    setDiscountPercentInput(percentValue > 0 ? String(Number(percentValue.toFixed(2))) : "");
    setDiscountAmountInput(summaryDiscount > 0 ? String(Number(summaryDiscount.toFixed(2))) : "");
    setDiscountModalOpen(true);
  }

  function closeDiscountPopup() {
    setDiscountModalOpen(false);
  }

  function clearDiscount() {
    setDiscountPercentInput("");
    setDiscountAmountInput("");
    setDiscountEditMode("percent");
    setDiscountModalOpen(false);
  }

  function applyDiscountPopup() {
    const safeSubtotal = Math.max(0, subtotal);
    if (safeSubtotal <= 0) {
      clearDiscount();
      return;
    }
    let nextDiscountAmount = 0;
    if (discountEditMode === "amount") {
      const parsedAmount = Number(discountAmountInput);
      if (Number.isFinite(parsedAmount) && parsedAmount > 0) {
        nextDiscountAmount = Number(Math.min(safeSubtotal, Math.max(0, parsedAmount)).toFixed(2));
      }
    } else {
      const parsedPercent = Number(discountPercentInput);
      if (Number.isFinite(parsedPercent) && parsedPercent > 0) {
        const normalizedPercent = Math.min(100, Math.max(0, parsedPercent));
        nextDiscountAmount = Number((safeSubtotal * (normalizedPercent / 100)).toFixed(2));
      }
    }
    const nextPercent = nextDiscountAmount > 0 ? Number(((nextDiscountAmount / safeSubtotal) * 100).toFixed(2)) : 0;
    setDiscountAmountInput(nextDiscountAmount > 0 ? String(Number(nextDiscountAmount.toFixed(2))) : "");
    setDiscountPercentInput(nextPercent > 0 ? String(Number(nextPercent.toFixed(2))) : "");
    setDiscountModalOpen(false);
  }

  function handleDiscountPercentInputChange(value: string) {
    const sanitized = sanitizePercentInput(value);
    setDiscountEditMode("percent");
    setDiscountPercentInput(sanitized);

    const safeSubtotal = Math.max(0, subtotal);
    if (!sanitized || safeSubtotal <= 0) {
      setDiscountAmountInput("");
      return;
    }
    const parsedPercent = Number(sanitized);
    if (!Number.isFinite(parsedPercent) || parsedPercent <= 0) {
      setDiscountAmountInput("");
      return;
    }
    const normalizedPercent = Math.min(100, Math.max(0, parsedPercent));
    const computedAmount = Number((safeSubtotal * (normalizedPercent / 100)).toFixed(2));
    setDiscountAmountInput(computedAmount > 0 ? String(Number(computedAmount.toFixed(2))) : "");
  }

  function handleDiscountAmountInputChange(value: string) {
    const sanitized = sanitizeCashInput(value);
    setDiscountEditMode("amount");
    setDiscountAmountInput(sanitized);

    const safeSubtotal = Math.max(0, subtotal);
    if (!sanitized || safeSubtotal <= 0) {
      setDiscountPercentInput("");
      return;
    }
    const parsedAmount = Number(sanitized);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setDiscountPercentInput("");
      return;
    }
    const normalizedAmount = Math.min(safeSubtotal, Math.max(0, parsedAmount));
    const computedPercent = Number(((normalizedAmount / safeSubtotal) * 100).toFixed(2));
    setDiscountPercentInput(computedPercent > 0 ? String(Number(computedPercent.toFixed(2))) : "");
  }

  function holdBill() {
    if (cart.length === 0 && !activeOrder) {
      pushSubmitMessage(text.heldBillsNeedItems);
      return;
    }

    const heldAt = new Date().toISOString();
    const billNumber = activeOrder?.order_no ?? `HOLD-${heldAt.slice(11, 19).replaceAll(":", "")}`;
    const nextHeldBill: HeldBill = {
      id: crypto.randomUUID(),
      held_at: heldAt,
      label: billNumber,
      source_order_id: activeOrder?.id ?? null,
      source_order_status: activeOrder?.status ?? null,
      order_type: orderType,
      table_id: selectedTable?.id ?? null,
      table_code: selectedTable?.table_code ?? null,
      delivery_app_id: orderType === "delivery_manual" ? selectedDeliveryApp : null,
      delivery_external_code: orderType === "delivery_manual" ? deliveryExternalCode.trim() || null : null,
      delivery_customer_name: orderType === "delivery_manual" ? deliveryCustomerName.trim() || null : null,
      delivery_notes: orderType === "delivery_manual" ? deliveryNotes.trim() || null : null,
      items: cart.map((item) => ({ ...item })),
      subtotal,
      discount_amount: summaryDiscount
    };

    setHeldBills((current) => [nextHeldBill, ...current].slice(0, 50));
    if (orderType === "dine_in" && selectedTable?.id) {
      rememberDineInDraft(selectedTable.id, []);
      tableBillPrefetchCacheRef.current.delete(selectedTable.id);
      tableBillPrefetchCacheUpdatedAtRef.current.delete(selectedTable.id);
    }
    if (orderType === "delivery_manual") {
      resetDeliveryDraft();
    }
    setCart([]);
    setActiveOrder(null);
    setDineInSessionBillNo(null);
    setTableTransferVerifications([]);
    setBillPaymentMethod(null);
    setTableBrowserOpen(orderType === "dine_in");
    if (orderType === "dine_in") {
      setSelectedTable(null);
    }
    pushSubmitMessage(`${text.heldBillsSaved}: ${nextHeldBill.label}`);
  }

  function restoreHeldBill(heldBill: HeldBill) {
    if (isBusy) return;
    const restoredItems = heldBill.items.map((item) => ({ ...item }));
    const restoredSubtotal = Number(heldBill.subtotal ?? restoredItems.reduce((sum, item) => sum + item.quantity * item.price, 0));
    const restoredDiscount = Number.isFinite(heldBill.discount_amount)
      ? Number(Math.min(Math.max(0, Number(heldBill.discount_amount)), Math.max(0, restoredSubtotal)).toFixed(2))
      : 0;
    const restoredPercent = restoredSubtotal > 0 ? Number(((restoredDiscount / restoredSubtotal) * 100).toFixed(2)) : 0;
    setCart(restoredItems);
    setDiscountEditMode("amount");
    setDiscountAmountInput(restoredDiscount > 0 ? String(Number(restoredDiscount.toFixed(2))) : "");
    setDiscountPercentInput(restoredPercent > 0 ? String(Number(restoredPercent.toFixed(2))) : "");
    setOrderType(heldBill.order_type);
    setQuickMode(heldBill.order_type === "dine_in" ? "dine_in" : heldBill.order_type === "delivery_manual" ? "delivery" : "home");
    if (heldBill.order_type === "dine_in") {
      const matchedTable = heldBill.table_id ? (posTables.find((table) => table.id === heldBill.table_id) ?? null) : null;
      if (heldBill.table_id) {
        rememberDineInDraft(heldBill.table_id, restoredItems);
      }
      setSelectedTable(matchedTable);
      setTableBrowserOpen(!matchedTable);
      setDineInSessionBillNo(heldBill.label || null);
    } else {
      setSelectedTable(null);
      setTableBrowserOpen(false);
      setDineInSessionBillNo(null);
      if (heldBill.order_type === "delivery_manual") {
        setSelectedDeliveryApp(heldBill.delivery_app_id ?? null);
        setDeliveryExternalCode(heldBill.delivery_external_code ?? "");
        setDeliveryCustomerName(heldBill.delivery_customer_name ?? "");
        setDeliveryNotes(heldBill.delivery_notes ?? "");
        setDeliveryDraftBillNo(heldBill.label || null);
        setDeliveryCatalogOpen(true);
        if (isDeliveryPendingPanelMode) {
          setDeliveryEditingHeldBillId(heldBill.id);
          updateDeliveryHeldBillStatus(heldBill.id, "editing");
        }
      } else {
        resetDeliveryDraft();
      }
    }
    setTableTransferVerifications([]);
    setBillPaymentMethod(null);
    if (heldBill.source_order_id && heldBill.source_order_status === "queued") {
      setActiveOrder({
        id: heldBill.source_order_id,
        order_no: heldBill.label,
        status: "queued",
        table_id: heldBill.table_id ?? null
      });
    } else {
      setActiveOrder(null);
    }
    const shouldKeepDeliveryPendingRecord = isDeliveryPendingPanelMode && heldBill.order_type === "delivery_manual";
    if (!shouldKeepDeliveryPendingRecord) {
      setHeldBills((current) => current.filter((entry) => entry.id !== heldBill.id));
    }
    setHeldBillsModalOpen(false);
    pushSubmitMessage(`${text.heldBillsRestore}: ${heldBill.label}`);
  }

  function removeHeldBill(heldBillId: string) {
    setHeldBills((current) => current.filter((entry) => entry.id !== heldBillId));
  }

  function restoreLatestHeldBill() {
    const latestBill = isDeliveryPendingPanelMode
      ? heldBillPool.find((entry) => (entry.queue_status ?? "pending") !== "cancelled" && (entry.queue_status ?? "pending") !== "sent")
      : heldBillPool[0];
    if (!latestBill) {
      pushSubmitMessage(isDeliveryPendingPanelMode ? text.deliveryPendingBillNoMatch : text.heldBillsEmpty);
      return;
    }
    restoreHeldBill(latestBill);
  }

  function openHeldBillsPanel() {
    if (isBusy) return;
    setHeldBillSearch("");
    setHeldBillsModalOpen(true);
  }

  function applyMoveTableCardDepthCue(event: ReactPointerEvent<HTMLButtonElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const xRatio = (event.clientX - rect.left) / rect.width;
    const yRatio = (event.clientY - rect.top) / rect.height;
    const xDelta = (xRatio - 0.5) * 2;
    const yDelta = (yRatio - 0.5) * 2;
    const distance = Math.min(1, Math.hypot(xDelta, yDelta));
    const tiltX = (-yDelta * 7).toFixed(2);
    const tiltY = (xDelta * 9).toFixed(2);
    event.currentTarget.style.setProperty("--move-tilt-x", `${tiltX}deg`);
    event.currentTarget.style.setProperty("--move-tilt-y", `${tiltY}deg`);
    event.currentTarget.style.setProperty("--move-glow-x", `${(xRatio * 100).toFixed(2)}%`);
    event.currentTarget.style.setProperty("--move-glow-y", `${(yRatio * 100).toFixed(2)}%`);
    event.currentTarget.style.setProperty("--move-glow-opacity", `${Math.max(0.16, 0.5 - distance * 0.22).toFixed(2)}`);
  }

  function resetMoveTableCardDepthCue(event: ReactPointerEvent<HTMLButtonElement>) {
    event.currentTarget.style.removeProperty("--move-tilt-x");
    event.currentTarget.style.removeProperty("--move-tilt-y");
    event.currentTarget.style.removeProperty("--move-glow-x");
    event.currentTarget.style.removeProperty("--move-glow-y");
    event.currentTarget.style.removeProperty("--move-glow-opacity");
  }

  function openDineInTableBrowser() {
    invalidateTableUiContext();
    const currentSelectedTable = selectedTableRef.current;
    if (currentSelectedTable?.id && orderType === "dine_in") {
      rememberDineInDraft(currentSelectedTable.id, cartRef.current);
    } else if (orderType === "takeaway") {
      persistTakeawayCartDraft(cartRef.current);
    }
    setTableBrowserOpen(true);
    setSelectedTable(null);
    setDineInSessionBillNo(null);
    setActiveOrder(null);
    setLastCommittedCartSignature(null);
    setCart([]);
    setTableTransferVerifications([]);
    setBillPaymentMethod(null);
  }

  function returnToDineInTableBrowserKeepingBill() {
    if (isBusy || tableSwitching) return;
    const currentSelectedTable = selectedTableRef.current;
    const nextTableMode: QuickMode = quickMode === "buffet_table" ? "buffet_table" : "dine_in";
    if (currentSelectedTable?.id && orderType === "dine_in") {
      rememberDineInDraft(currentSelectedTable.id, cartRef.current);
    }
    setQuickMode(nextTableMode);
    setOrderType("dine_in");
    setTableBrowserOpen(true);
    setSelectedTable(null);
    setDineInSessionBillNo(null);
    setActiveOrder(null);
    setLastCommittedCartSignature(null);
    setCart([]);
    setTableTransferVerifications([]);
    setBillPaymentMethod(null);
    setTableMoveError(null);
    void fetchPosTables({ timeoutMs: 10000, retries: 0 }).catch(() => undefined);
  }

  function applyQuickMode(mode: QuickMode) {
    setModeSelectorOpen(false);
    if (mode === "home") {
      invalidateTableUiContext();
      if (selectedTable?.id && orderType === "dine_in") {
        rememberDineInDraft(selectedTable.id, cart);
      }
      if (orderType === "delivery_manual") {
        resetDeliveryDraft();
      }
      setQuickMode("home");
      setOrderType("takeaway");
      setTableBrowserOpen(false);
      setDineInSessionBillNo(null);
      setSelectedTable(null);
      setActiveOrder(null);
      setLastCommittedCartSignature(null);
      setCart(readTakeawayCartDraft());
      setTableTransferVerifications([]);
      setBillPaymentMethod(null);
      pushSubmitMessage(text.goHome);
      return;
    }

    if (mode === "dine_in" || mode === "buffet_table") {
      if (orderType === "delivery_manual") {
        resetDeliveryDraft();
      }
      setQuickMode(mode);
      setOrderType(orderTypeForQuickMode(mode));
      openDineInTableBrowser();
      pushSubmitMessage(mode === "buffet_table" ? (lang === "th" ? "โต๊ะบุฟเฟ่" : "Buffet table") : text.dineIn);
      if (posTables.length === 0 || tableLoadError) {
        void fetchPosTables().catch((tableError) => {
          markConnectivityFromError(tableError);
          const message = tableError instanceof Error ? tableError.message : "Failed to load table layout.";
          pushSubmitMessage(localizeApiMessage(message));
        });
      }
      return;
    }

    if (selectedTable?.id && orderType === "dine_in") {
      rememberDineInDraft(selectedTable.id, cart);
    } else if (orderType === "takeaway") {
      persistTakeawayCartDraft(cart);
    }
    invalidateTableUiContext();
    setQuickMode("delivery");
    setOrderType("delivery_manual");
    setDeliveryCatalogOpen(false);
    setDeliveryDraftBillNo(null);
    setTableBrowserOpen(false);
    setDineInSessionBillNo(null);
    setSelectedTable(null);
    setActiveOrder(null);
    setCart([]);
    setTableTransferVerifications([]);
    setBillPaymentMethod(null);
    pushSubmitMessage(text.delivery);
  }

  function isQuickModeLocked(mode: QuickMode) {
    const feature =
      mode === "dine_in"
        ? POS_MODE_FEATURES.dine_in
        : mode === "buffet_table"
          ? POS_MODE_FEATURES.buffet_table
          : mode === "delivery"
            ? POS_MODE_FEATURES.delivery
            : null;
    return Boolean(enabledFeatures !== null && feature && enabledFeatures[feature] === false);
  }

  function selectQuickMode(mode: QuickMode) {
    if (mode === "delivery") {
      setModeSelectorOpen(false);
      setDeliveryMaintenanceOpen(true);
      return;
    }
    if (mode === quickMode) {
      setModeSelectorOpen(false);
      return;
    }
    if (isQuickModeLocked(mode)) {
      setModeSelectorOpen(false);
      setPackageLockOpen(true);
      return;
    }
    applyQuickMode(mode);
  }

  function requestCancelBill() {
    if (orderType === "dine_in") {
      if (activeOrder?.status === "queued") {
        setCancelBillTargetOrder(activeOrder);
        setCancelBillApprovalOpen(true);
        return;
      }
      if (activeOrder && activeOrder.status !== "queued") {
        pushSubmitMessage(text.cancelBillNotAllowed);
        return;
      }
      const hasCartItems = cartRef.current.length > 0;
      if (!hasCartItems) {
        pushSubmitMessage(text.addItemsFirst);
        return;
      }
      if (selectedTable?.id) {
        rememberDineInDraft(selectedTable.id, []);
      }
      setCart([]);
      pushSubmitMessage(text.cancelBillCartCleared);
      return;
    }

    if (orderType === "delivery_manual") {
      if (activeOrder?.status === "queued") {
        setCancelBillTargetOrder(activeOrder);
        setCancelBillApprovalOpen(true);
        return;
      }
      if (activeOrder && activeOrder.status !== "queued") {
        pushSubmitMessage(text.cancelBillNotAllowed);
        return;
      }
      if (!deliveryDraftTouched && cartRef.current.length === 0) {
        pushSubmitMessage(text.addItemsFirst);
        return;
      }
      setCart([]);
      resetDeliveryDraft();
      setDeliveryFlowState("create");
      pushSubmitMessage(text.deliveryDraftCleared);
      return;
    }

    if (!activeOrder) {
      const hasCartItems = cartRef.current.length > 0;
      if (!hasCartItems) {
        pushSubmitMessage(text.cancelBillNeedOrder);
        return;
      }
      setCart([]);
      pushSubmitMessage(text.cancelBillCartCleared);
      return;
    }
    if (activeOrder.status !== "queued") {
      pushSubmitMessage(text.cancelBillNotAllowed);
      return;
    }
    setCancelBillTargetOrder(activeOrder);
    setCancelBillApprovalOpen(true);
  }

  async function selectTableFromBrowser(table: DiningTableItem) {
    if (isBusy) return;
    if (!tableBrowserOpen && orderType === "dine_in" && selectedTable?.id === table.id) {
      return;
    }
    if (selectedTable?.id && selectedTable.id !== table.id && orderType === "dine_in") {
      rememberDineInDraft(selectedTable.id, cart);
    }

    if (table.status === "disabled" || table.status === "reserved") {
      pushSubmitMessage(text.tableNotReady);
      return;
    }

    if (table.active_session_id || table.status === "occupied" || table.status === "ordering" || table.status === "pending_payment") {
      const latestQrEventId = table.qr_activity?.latest_event_id ?? null;
      const shouldForceQrRefresh = Boolean(latestQrEventId && seenTableQrActivity[table.id] !== latestQrEventId);
      markTableQrActivitySeen(table);
      const nextTableMode: QuickMode = quickMode === "buffet_table" ? "buffet_table" : "dine_in";
      setQuickMode(nextTableMode);
      setOrderType("dine_in");
      setTableBrowserOpen(false);
      setSelectedTable(table);
      const cached = tableBillPrefetchCacheRef.current.get(table.id);
      const canApplyCachedBill = Boolean(cached && !shouldForceQrRefresh);
      if (canApplyCachedBill && cached) {
        applyTableBillPayload(table, cached);
      } else {
        setActiveOrder(null);
        setLastCommittedCartSignature(null);
        setDineInSessionBillNo(null);
        setTableTransferVerifications([]);
        setBillPaymentMethod(null);
        setCart(dineInDraftByTableIdRef.current[table.id] ?? []);
      }
      pushSubmitMessage(`${text.tableSelected}: ${table.table_code}`);
      if (nextTableMode === "buffet_table") {
        openBuffetPickerForTable(table);
      }
      void loadTableBillContext(table).catch((loadError) => {
        markConnectivityFromError(loadError);
        const message = loadError instanceof Error ? loadError.message : "Failed to load table bill details.";
        pushSubmitMessage(localizeApiMessage(message));
      });
      return;
    }

    await openBillForTable(table);
    if (quickMode === "buffet_table") {
      openBuffetPickerForTable(table);
    }
  }

  async function cancelActiveOrder(targetOrder: ActiveOrder, approvalId?: string) {
    if (isBusy) return;
    if (!approvalId) {
      pushSubmitMessage(text.cancelBillPinRequired);
      return;
    }
    const shouldReturnToTableBrowser = orderType === "dine_in" || isTableSalesMode(quickMode) || Boolean(targetOrder.table_id);
    const returnTableMode: QuickMode = quickMode === "buffet_table" ? "buffet_table" : "dine_in";
    setCancelBillSubmitting(true);
    pushSubmitMessage(text.cancelBillProcessing);
    try {
      const payload: { reason: string; cancellation_approval_id: string } = {
        reason: "Cancelled from POS sales screen",
        cancellation_approval_id: approvalId
      };
      const { response, body } = await fetchJsonWithTimeout<ApiErrorBody>(
        `/api/pos/orders/${targetOrder.id}/cancel`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        },
        20000,
        1
      );
      if (!response.ok || body.error) {
        throw new Error(body.error?.message ?? "Failed to cancel bill.");
      }
      clearClosedBillUiState({ clearReceipt: true, tableId: targetOrder.table_id ?? selectedTable?.id ?? null });
      setDineInSessionBillNo(null);
      setSelectedTable(null);
      if (targetOrder.table_id) {
        setPosTables((current) =>
          current.map((table) =>
            table.id === targetOrder.table_id
              ? { ...table, status: "available", active_session_id: null, active_order_id: null }
              : table
          )
        );
      }
      if (orderType === "delivery_manual" || quickMode === "delivery") {
        setDeliveryFlowState("cancelled");
      }
      if (shouldReturnToTableBrowser) {
        invalidateTableUiContext();
        setQuickMode(returnTableMode);
        setOrderType("dine_in");
        setTableBrowserOpen(true);
      }
      pushSubmitMessage(text.cancelBillSuccess);
      if (shouldReturnToTableBrowser) {
        window.setTimeout(() => {
          void fetchPosTablesRef.current({ timeoutMs: 10000, retries: 0 }).catch(() => undefined);
        }, 350);
      }
    } catch (cancelError) {
      markConnectivityFromError(cancelError);
      const message = cancelError instanceof Error ? cancelError.message : "Unknown error";
      pushSubmitMessage(localizeApiMessage(message));
    } finally {
      setCancelBillSubmitting(false);
    }
  }

  async function submitOrder(payload: PendingSubmit, options?: { applyUiResult?: boolean }): Promise<ActiveOrder | null> {
    const applyUiResult = options?.applyUiResult ?? true;
    return submitOrderWithEffects({
      payload, applyUiResult, fetchJsonWithTimeout,
      text: { orderUpdated: text.orderUpdated, orderCreated: text.orderCreated },
      setIsOnline, dequeuePendingSubmit, setActiveOrder, setCart, setCartDrawerOpen,
      refreshTables: () => { void fetchPosTables().catch(() => undefined); },
      pushSubmitMessage
    });
  }

  async function handleCheckout() {
    if (isBusy || checkoutRequestLockRef.current) return;
    checkoutRequestLockRef.current = true;
    const blockingReason = getCheckoutBlockingReason({
      shiftId: shift?.id,
      cartSize: cart.length,
      orderType,
      selectedTable: selectedTable ? { id: selectedTable.id, active_session_id: selectedTable.active_session_id } : null,
      selectedDeliveryApp,
      deliveryExternalCode
    });
    if (blockingReason) {
      if (blockingReason === "open_shift_required") {
        pushSubmitMessage(text.openShiftRequired);
      } else if (blockingReason === "add_items_first") {
        pushSubmitMessage(text.addItemsFirst);
      } else if (blockingReason === "open_bill_required") {
        pushSubmitMessage(text.openBillRequired);
        openDineInTableBrowser();
      } else if (blockingReason === "delivery_app_required") {
        pushSubmitMessage(text.deliverySelectAppRequired);
      } else if (blockingReason === "delivery_external_required") {
        pushSubmitMessage(text.deliveryExternalCodeRequired);
      }
      checkoutRequestLockRef.current = false;
      return;
    }
    if (orderType === "delivery_manual") {
      setSubmitting(true);
      pushSubmitMessage(text.deliveryQueueProcessing);
      try {
        await waitFor(180);
        stageCurrentDeliveryOrder();
      } finally {
        setSubmitting(false);
        checkoutRequestLockRef.current = false;
      }
      return;
    }
    if (!shift || shift.status !== "open") {
      pushSubmitMessage(text.openShiftRequired);
      checkoutRequestLockRef.current = false;
      return;
    }
    setSubmitting(true);
    pushSubmitMessage(text.submitting);
    const latestTaxSettings = await refreshTaxSettings();
    const effectiveTaxBreakdown = latestTaxSettings
      ? calculateClientTaxBreakdown(taxBaseTotal, latestTaxSettings)
      : taxBreakdown;
    const effectiveTotal = effectiveTaxBreakdown.grand_total;
    const cartSnapshot = cart.map((item) => ({ ...item }));
    const cartSnapshotSignature = buildCartSignature(cartSnapshot);
    const currentQueuedOrder = activeOrder?.status === "queued" ? activeOrder : null;
    const canSkipDineInSubmit = shouldSkipDineInSubmit({
      orderType,
      currentQueuedOrder,
      selectedTable: selectedTable ? { id: selectedTable.id, active_session_id: selectedTable.active_session_id } : null,
      lastCommittedCartSignature,
      cartSnapshotSignature,
      total: effectiveTotal
    });

    if (canSkipDineInSubmit && currentQueuedOrder) {
      setReviewOrder(
        buildReviewOrder({
          order: currentQueuedOrder,
          fallbackOrderType: orderType,
          fallbackTableId: selectedTable?.id ?? null,
          fallbackTotal: effectiveTotal,
          items: cartSnapshot,
          discountAmount: summaryDiscount,
          taxTotal: currentQueuedOrder.tax_total ?? effectiveTaxBreakdown.tax_total,
          taxLines: currentQueuedOrder.tax_lines?.length ? currentQueuedOrder.tax_lines : effectiveTaxBreakdown.lines
        })
      );
      setTakeawayCreatingPreview(null);
      setCashReviewOrder(null);
      setTransferReviewOrder(null);
      setCashReceivedInput("");
      setCashError(null);
      setReceiptSession(null);
      setReceiptSaving(false);
      setReceiptSaved(false);
      setReceiptError(null);
      setSubmitting(false);
      checkoutRequestLockRef.current = false;
      return;
    }

    const payload: PendingSubmit = buildCheckoutSubmitPayload({
      idempotencyKey: newIdempotencyKey(),
      activeOrder: activeOrder?.status === "queued" ? activeOrder : null,
      shiftId: shift!.id,
      orderType,
      selectedTableId: selectedTable?.id,
      subtotal,
      summaryDiscount,
      cart,
      member: selectedMember
        ? {
            name: selectedMember.name,
            phone: selectedMember.phone,
            code: selectedMember.member_token ?? selectedMember.id,
            points: selectedMember.points,
            stamps: selectedMember.stamps
          }
        : null
    });
    payload.payload.tax_total = effectiveTaxBreakdown.tax_total;
    payload.payload.grand_total = effectiveTotal;
    payload.payload.tax_lines = effectiveTaxBreakdown.lines;

    if (orderType === "takeaway") {
      setTakeawayCreatingPreview({
        items: cartSnapshot,
        total_amount: effectiveTotal
      });
    }

    if (!isOnline) {
      setTakeawayCreatingPreview(null);
      enqueuePendingSubmit(payload);
      setCart([]);
      setCartDrawerOpen(false);
      pushSubmitMessage(text.offlineStaged);
      setSubmitting(false);
      checkoutRequestLockRef.current = false;
      return;
    }

    try {
      const createdOrder = await submitOrder(payload);
      if (orderType === "takeaway" || orderType === "dine_in") {
        if (!createdOrder) {
          throw new Error("Order created but bill information is missing.");
        }
        const createdOrderWithMember = selectedMember
          ? {
              ...createdOrder,
              member_name: createdOrder.member_name ?? selectedMember.name,
              member_phone: createdOrder.member_phone ?? selectedMember.phone,
              member_code: createdOrder.member_code ?? selectedMember.member_token ?? selectedMember.id,
              member_points: createdOrder.member_points ?? selectedMember.points,
              member_stamps: createdOrder.member_stamps ?? selectedMember.stamps
            }
          : createdOrder;
        if (orderType === "dine_in" && selectedTable?.id) {
          rememberDineInDraft(selectedTable.id, cartSnapshot);
          setLastCommittedCartSignature(cartSnapshotSignature);
        }
        setTakeawayCreatingPreview(null);
        setReviewOrder(
          buildReviewOrder({
            order: createdOrderWithMember,
            fallbackOrderType: orderType,
            fallbackTableId: selectedTable?.id ?? null,
            fallbackTotal: effectiveTotal,
            items: cartSnapshot,
            discountAmount: summaryDiscount,
            taxTotal: createdOrder.tax_total ?? effectiveTaxBreakdown.tax_total,
            taxLines: createdOrder.tax_lines?.length ? createdOrder.tax_lines : effectiveTaxBreakdown.lines
          })
        );
        setCashReviewOrder(null);
        setTransferReviewOrder(null);
        setCashReceivedInput("");
        setCashError(null);
        setReceiptSession(null);
        setReceiptSaving(false);
        setReceiptSaved(false);
        setReceiptError(null);
      }
    } catch (submitError) {
      setTakeawayCreatingPreview(null);
      const rawMessage = submitError instanceof Error ? submitError.message : "Unknown error";
      const message = localizeApiMessage(rawMessage);
      const errorCode = extractApiErrorCode(rawMessage);

      if (isConflictErrorCode(errorCode)) {
        if (errorCode === "table_not_available") {
          setActiveOrder(null);
          setSelectedTable(null);
          setLastCommittedCartSignature(null);
          setTableBrowserOpen(true);
          void fetchPosTablesRef.current({ timeoutMs: 10000, retries: 0 }).catch(() => undefined);
          pushSubmitMessage(`${text.tableNotReady}: ${message}`);
          return;
        }
        if (errorCode === "shift_not_open") {
          setReloadToken((current) => current + 1);
          pushSubmitMessage(text.openShiftRequired);
          return;
        }
        if (errorCode === "order_not_updatable" || errorCode === "order_not_found") {
          setActiveOrder(null);
          setLastCommittedCartSignature(null);
          pushSubmitMessage(message);
          return;
        }
      }

      markConnectivityFromError(submitError);
      if (isConnectivityIssueMessage(rawMessage)) {
        enqueuePendingSubmit(payload, rawMessage);
        setCart([]);
        setCartDrawerOpen(false);
        pushSubmitMessage(`${text.submitFailed}: ${message}. ${text.retrySafe}`);
      } else {
        pushSubmitMessage(`${text.submitFailed}: ${message}`);
      }
    } finally {
      setSubmitting(false);
      checkoutRequestLockRef.current = false;
    }
  }

  async function retryPendingSubmit() {
    await runPendingSubmitRetry({
      hasPending: Boolean(pending),
      isBusy,
      isOnline,
      stillOfflineMessage: text.stillOffline,
      retryFailedMessage: text.retryFailed,
      submitOrder: async () => {
        if (!pending) return;
        await submitOrder(pending, { applyUiResult: false });
      },
      markPendingFailed: (errorMessage) => {
        if (!pending) return;
        markPendingSubmitFailed(pending.idempotencyKey, errorMessage);
      },
      dequeuePending: () => {
        if (!pending) return;
        dequeuePendingSubmit(pending.idempotencyKey);
      },
      onConflictTableNotAvailable: () => {
        void fetchPosTablesRef.current({ timeoutMs: 10000, retries: 0 }).catch(() => undefined);
        setTableBrowserOpen(true);
        setSelectedTable(null);
        setActiveOrder(null);
      },
      onConflictShiftNotOpen: () => {
        setReloadToken((current) => current + 1);
      },
      onSetSubmitting: setSubmitting,
      onSetOnline: setIsOnline,
      onMarkConnectivityFromError: markConnectivityFromError,
      onPushMessage: pushSubmitMessage
    });
  }

  async function retryPendingPaymentSubmit() {
    await runPendingPaymentRetry({
      hasPendingPayment: Boolean(pendingPayment),
      isBusy,
      isOnline,
      stillOfflineMessage: text.stillOffline,
      retryFailedMessage: text.retryFailed,
      submitPayment: async () => {
        if (!pendingPayment) return;
        await submitTransferPayment(pendingPayment, false);
      },
      markPendingPaymentFailed: (errorMessage) => {
        if (!pendingPayment) return;
        markPendingPaymentFailed(pendingPayment.idempotencyKey, errorMessage);
      },
      onSetTransferSubmitting: setTransferSubmitting,
      onSetOnline: setIsOnline,
      onMarkConnectivityFromError: markConnectivityFromError,
      onPushMessage: pushSubmitMessage
    });
  }

  function handleEmergencyRetry() {
    if (!isOnline) {
      pushSubmitMessage(text.stillOffline);
      return;
    }
    if (pendingPayment) {
      void retryPendingPaymentSubmit();
      return;
    }
    if (pending) {
      void retryPendingSubmit();
      return;
    }
    setReloadToken((current) => current + 1);
  }

  async function openBillForTable(table: DiningTableItem) {
    if (isBusy || tableSwitching) return;
    const previousSelectedTable = selectedTableRef.current;
    const previousTableBrowserOpen = tableBrowserOpen;
    const openingTableMode: QuickMode = quickMode === "buffet_table" ? "buffet_table" : "dine_in";
    setTableSwitching(true);
    pushSubmitMessage(null);
    setQuickMode(openingTableMode);
    setOrderType("dine_in");
    setSelectedTable(table);
    setTableBrowserOpen(false);
    setDineInSessionBillNo(null);
    setActiveOrder(null);
    setLastCommittedCartSignature(null);
    setTableTransferVerifications([]);
    setBillPaymentMethod(null);
    setCart([]);
    const requestStartedAt = nowMs();
    try {
      const { response, body } = await fetchJsonWithTimeout<ApiErrorBody & {
        data?: {
          id: string;
          table_id: string;
          table_code: string;
          table_name: string | null;
          status: string;
          opened_at: string;
          shift_id: string;
        };
      }>(
        `/api/pos/tables/${table.id}/open-bill`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({})
        },
        12000,
        0
      );
      const clientDurationMs = nowMs() - requestStartedAt;
      const serverDurationMs = parseServerDurationMs(response, "x-pos-open-bill-ms");
      reportEndpointPerf("/api/pos/tables/[tableId]/open-bill", clientDurationMs, serverDurationMs, "dine_in_open_bill");
      if (!response.ok || body.error) {
        throw new Error(body.error?.message ?? "Failed to open bill for table.");
      }
      const openedSession = body.data;
      const nextTable: DiningTableItem = {
        ...table,
        active_session_id: openedSession?.id ?? table.active_session_id ?? null
      };
      setPosTables((current) =>
        current.map((tableRow) =>
          tableRow.id === nextTable.id ? { ...tableRow, active_session_id: nextTable.active_session_id, status: "occupied" } : tableRow
        )
      );
      setSelectedTable(nextTable);
      setDineInSessionBillNo(
        openedSession
          ? buildDineInSessionBillNo(nextTable.table_code, openedSession.opened_at, openedSession.id)
          : null
      );
      const liveCartAfterOpen = selectedTableRef.current?.id === nextTable.id ? cartRef.current.map((item) => ({ ...item })) : [];
      setCart(liveCartAfterOpen);
      setActiveOrder(null);
      setLastCommittedCartSignature(null);
      setTableTransferVerifications([]);
      setBillPaymentMethod(null);
      rememberDineInDraft(nextTable.id, liveCartAfterOpen);
      setQuickMode(openingTableMode);
      setOrderType("dine_in");
      setTableBrowserOpen(false);
      pushSubmitMessage(`${text.tableOpenSuccess}: ${table.table_code}`);
    } catch (openError) {
      markConnectivityFromError(openError);
      setSelectedTable(previousSelectedTable);
      setTableBrowserOpen(previousTableBrowserOpen);
      const message = openError instanceof Error ? openError.message : "Unknown error";
      pushSubmitMessage(localizeApiMessage(message));
    } finally {
      setTableSwitching(false);
      checkoutRequestLockRef.current = false;
    }
  }

  async function submitMoveTable() {
    if (!selectedTable?.id) {
      setTableMoveError(text.tableMoveNeedBill);
      return;
    }
    if (!tableMoveTargetId) {
      setTableMoveError(text.tableMoveNoTarget);
      return;
    }

    const sourceTable = selectedTable;
    const targetTableId = tableMoveTargetId;
    const targetTableFromState = posTables.find((table) => table.id === targetTableId) ?? null;
    const sourceTableCode = sourceTable.table_code;
    const targetTableCode = targetTableFromState?.table_code ?? "-";
    const cartSnapshot = cartRef.current.map((item) => ({ ...item }));
    const nextTargetStatus =
      sourceTable.status === "pending_payment" ? "pending_payment" : sourceTable.status === "ordering" ? "ordering" : "occupied";
    const moveTrace = beginPosActionTrace("table.move", {
      source_table_id: sourceTable.id,
      target_table_id: targetTableId,
      cart_items: cartSnapshot.length
    });
    const nextMoveQuickMode: QuickMode = quickMode === "buffet_table" ? "buffet_table" : "dine_in";

    setTableMoveBusy(true);
    setTableMoveError(null);
    pushSubmitMessage(text.tableMoveSubmitting);
    try {
      const { response, body } = await fetchJsonWithTimeout<ApiErrorBody>(
        `/api/pos/tables/${sourceTable.id}/move-bill`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            target_table_id: targetTableId,
            reason: tableMoveReason.trim() || undefined
          })
        },
        35000,
        1
      );

      if (!response.ok || body.error) {
        throw new Error(body.error?.message ?? "Failed to move table.");
      }

      setPosTables((current) =>
        current.map((table) => {
          if (table.id === sourceTable.id) {
            return {
              ...table,
              status: "available",
              active_session_id: null,
              active_order_id: null
            };
          }
          if (table.id === targetTableId) {
            return {
              ...table,
              status: nextTargetStatus,
              active_session_id: sourceTable.active_session_id ?? table.active_session_id ?? null,
              active_order_id: sourceTable.active_order_id ?? table.active_order_id ?? null
            };
          }
          return table;
        })
      );

      if (sourceTable.id && cartSnapshot.length > 0) {
        rememberDineInDraft(sourceTable.id, []);
        rememberDineInDraft(targetTableId, cartSnapshot);
      }

      const nextSelectedTable: DiningTableItem =
        targetTableFromState
          ? {
              ...targetTableFromState,
              status: nextTargetStatus,
              active_session_id: sourceTable.active_session_id ?? targetTableFromState.active_session_id ?? null,
              active_order_id: sourceTable.active_order_id
            }
          : {
              ...sourceTable,
              id: targetTableId,
              table_code: targetTableCode,
              status: nextTargetStatus
            };
      setSelectedTable(nextSelectedTable);
      setActiveOrder((current) => (current ? { ...current, table_id: targetTableId } : current));
      setCart(cartSnapshot);
      setLastCommittedCartSignature(cartSnapshot.length > 0 ? buildCartSignature(cartSnapshot) : null);

      setTableMoveModalOpen(false);
      setTableMoveTargetId("");
      setTableMoveReason("");
      setQuickMode(nextMoveQuickMode);
      setOrderType("dine_in");
      setTableBrowserOpen(false);
      pushSubmitMessage(`${text.tableMoveSuccess}: ${sourceTableCode}  ${targetTableCode}`);
      endPosActionTrace(moveTrace, "ok", {
        source_table_id: sourceTable.id,
        target_table_id: targetTableId
      });

      void loadTableBillContext(nextSelectedTable).catch(() => undefined);
      window.setTimeout(() => {
        void fetchPosTablesRef.current({ timeoutMs: 10000, retries: 0 }).catch(() => undefined);
      }, 350);
    } catch (moveError) {
      markConnectivityFromError(moveError);
      const rawMessage = moveError instanceof Error ? moveError.message : "Failed to move table.";
      const message = localizeApiMessage(rawMessage);
      setTableMoveError(message);
      pushSubmitMessage(message);
      endPosActionTrace(moveTrace, "error", {
        source_table_id: sourceTable.id,
        target_table_id: targetTableId,
        error: message
      });
    } finally {
      setTableMoveBusy(false);
    }
  }

  function closeCheckoutReviewPopup() {
    const order = reviewOrder;
    setReviewOrder(null);
    if (order) void setTablePaymentLock(order, false);
  }

  function openCashPaymentPopup(order: CheckoutReviewOrder) {
    void setTablePaymentLock(order, true);
    setTakeawayCreatingPreview(null);
    setReviewOrder(null);
    setTransferReviewOrder(null);
    setTransferReference("");
    setTransferError(null);
    setCashReviewOrder(order);
    setCashReceivedInput(order.total_amount.toFixed(2));
    setCashReplaceOnNextKey(true);
    setCashError(null);
    setReceiptError(null);
  }

  function openTransferPaymentPopup(order: CheckoutReviewOrder) {
    void setTablePaymentLock(order, true);
    setTakeawayCreatingPreview(null);
    setReviewOrder(null);
    setCashReviewOrder(null);
    setCashError(null);
    setTransferReviewOrder(order);
    setTransferPaymentMode("manual");
    setInetPaymentIntent(null);
    setInetQrStatus("idle");
    setTransferReference("");
    setTransferError(null);
    setTransferSlipFile(null);
    if (transferSlipPreviewUrl) {
      URL.revokeObjectURL(transferSlipPreviewUrl);
    }
    setTransferSlipPreviewUrl(null);
    setTransferSlipParsed(null);
    setTransferSlipChecks(null);
    setTransferSlipIssues([]);
    setTransferSlipVerified(false);
    setTransferSlipVerifiedAgainst(null);
    setTransferSlipVerificationId(null);
    setTransferOverrideApprovalId(null);
    setTransferOverrideModalOpen(false);
    setTransferSlipChecking(false);
    if (transferSlipInputRef.current) {
      transferSlipInputRef.current.value = "";
    }
    setReceiptError(null);
  }

  function closeTransferPaymentPopup() {
    if (transferSubmitting || transferSlipChecking) return;
    const order = transferReviewOrder;
    setTransferReviewOrder(null);
    if (order) void setTablePaymentLock(order, false);
    setTransferPaymentMode("manual");
    setInetPaymentIntent(null);
    setInetQrStatus("idle");
    setTransferReference("");
    setTransferError(null);
    setTransferSlipFile(null);
    if (transferSlipPreviewUrl) {
      URL.revokeObjectURL(transferSlipPreviewUrl);
    }
    setTransferSlipPreviewUrl(null);
    setTransferSlipParsed(null);
    setTransferSlipChecks(null);
    setTransferSlipIssues([]);
    setTransferSlipVerified(false);
    setTransferSlipVerifiedAgainst(null);
    setTransferSlipVerificationId(null);
    setTransferOverrideApprovalId(null);
    setTransferOverrideModalOpen(false);
    setTransferSlipChecking(false);
    if (transferSlipInputRef.current) {
      transferSlipInputRef.current.value = "";
    }
  }

  function selectTransferPaymentMode(mode: TransferPaymentMode) {
    if (transferSubmitting || transferSlipChecking) return;
    if (mode === "inet_nops" && !inetQrEnabled) {
      setTransferError(text.transferInetDisabled);
      return;
    }
    setTransferPaymentMode(mode);
    setTransferError(null);
    if (mode === "manual") {
      setInetQrStatus(inetPaymentIntent?.status === "paid" ? "paid" : inetPaymentIntent ? "pending" : "idle");
      return;
    }
    if (!inetPaymentIntent && inetQrStatus !== "creating" && inetQrStatus !== "pending" && inetQrStatus !== "paid") {
      window.setTimeout(() => {
        void createInetQrPayment();
      }, 0);
    }
  }

  async function createInetQrPayment() {
    if (!transferReviewOrder || transferSubmitting || transferSlipChecking || receiptSaving) return;
    if (!inetQrEnabled) {
      setTransferError(text.transferInetDisabled);
      return;
    }
    setTransferPaymentMode("inet_nops");
    setInetQrStatus("creating");
    setTransferSubmitting(true);
    setTransferError(null);
    try {
      const { response, body } = await fetchJsonWithTimeout<
        ApiErrorBody & {
          data?: {
            payment_intent_id: string;
            provider_order_id: string;
            qr_code: string;
            amount: number;
            status: "pending";
          };
        }
      >(
        "/api/pos/payments/inet/qr",
        {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ order_id: transferReviewOrder.order_id })
        },
        25000,
        0
      );
      if (!response.ok || body.error || !body.data) {
        throw new Error(body.error?.message ?? "Failed to create INET QR.");
      }
      setInetPaymentIntent({
        payment_intent_id: body.data.payment_intent_id,
        provider_order_id: body.data.provider_order_id,
        qr_code: body.data.qr_code,
        amount: Number(body.data.amount),
        status: body.data.status
      });
      setInetQrStatus("pending");
    } catch (inetError) {
      const message = localizeApiMessage(inetError instanceof Error ? inetError.message : "Unknown error");
      markConnectivityFromError(inetError);
      setInetQrStatus("failed");
      setTransferError(message);
      pushSubmitMessage(message);
    } finally {
      setTransferSubmitting(false);
    }
  }

  function handleTransferSlipFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setTransferSlipFile(file);
    setTransferSlipParsed(null);
    setTransferSlipChecks(null);
    setTransferSlipIssues([]);
    setTransferSlipVerified(false);
    setTransferSlipVerifiedAgainst(null);
    setTransferSlipVerificationId(null);
    setTransferOverrideApprovalId(null);
    setTransferOverrideModalOpen(false);
    setTransferReference("");
    setTransferError(null);
    if (transferSlipPreviewUrl) {
      URL.revokeObjectURL(transferSlipPreviewUrl);
      setTransferSlipPreviewUrl(null);
    }
    if (!file) {
      return;
    }
    const previewUrl = URL.createObjectURL(file);
    setTransferSlipPreviewUrl(previewUrl);
  }

  async function verifyTransferSlip() {
    if (!transferReviewOrder) return;
    if (!transferSlipFile) {
      setTransferError(text.transferSlipNeedUpload);
      return;
    }

    setTransferSlipChecking(true);
    setTransferError(null);
    setTransferSlipIssues([]);
    setTransferSlipVerified(false);
    setTransferSlipVerifiedAgainst(null);
    setTransferSlipVerificationId(null);
    setTransferOverrideApprovalId(null);
    setTransferOverrideModalOpen(false);
    setTransferSlipParsed(null);
    setTransferSlipChecks(null);

    try {
      const formData = new FormData();
      formData.append("slip_image", transferSlipFile);
      formData.append("order_id", transferReviewOrder.order_id);
      formData.append("expected_amount", String(transferPromptPayAmount));
      formData.append("expected_payee_name", expectedPayeeName);
      formData.append("expected_promptpay_phone", activePromptPayPhone);

      const { response, body } = await fetchJsonWithTimeout<SlipVerifyResponseBody>(
        "/api/pos/payments/slip-verify",
        {
          method: "POST",
          body: formData
        },
        30000
      );

      if (!response.ok || body.error || !body.data) {
        throw new Error(body.error?.message ?? "Failed to verify transfer slip.");
      }

      setTransferSlipParsed(body.data.parsed);
      setTransferSlipChecks(body.data.checks);
      setTransferSlipIssues(body.data.checks.issues ?? []);
      setTransferSlipVerified(body.data.checks.passed);
      setTransferSlipVerifiedAgainst(body.data.checks.passed ? currentTransferSlipSignature : null);
      setTransferSlipVerificationId(body.data.verification_id);
      setTransferOverrideApprovalId(null);
      setTransferReference(body.data.parsed.reference_no ?? body.data.parsed.transaction_id ?? transferReference);
      if (!body.data.checks.passed) {
        setTransferError(body.data.checks.issues?.[0] ?? text.transferSlipVerifyFailed);
      }
      if (orderType === "dine_in" && selectedTable) {
        void loadTableBillContext(selectedTable).catch(() => undefined);
      }
    } catch (verifyError) {
      markConnectivityFromError(verifyError);
      setTransferError(verifyError instanceof Error ? verifyError.message : "Unknown error");
      setTransferSlipParsed(null);
      setTransferSlipChecks(null);
      setTransferSlipVerified(false);
      setTransferSlipVerifiedAgainst(null);
      setTransferSlipVerificationId(null);
      setTransferOverrideApprovalId(null);
    } finally {
      setTransferSlipChecking(false);
    }
  }

  async function submitTransferPayment(pendingPaymentEntry: PendingPaymentQueueItem, applyUiResult: boolean) {
    return submitTransferPaymentWithEffects({
      pendingPaymentEntry, applyUiResult, fetchJsonWithTimeout,
      text: { receiptSaved: text.receiptSaved, transferQueued: text.transferQueued },
      transferSlipPreviewUrl, fallbackReceiptItems: transferReviewOrder?.items ?? [], storeProfile,
      setIsOnline, dequeuePendingPayment, setActiveOrder, setCart, setTakeawayCreatingPreview, setReviewOrder, setCashReviewOrder,
      setTransferReviewOrder, setTransferReference, setCashReceivedInput, setCashReplaceOnNextKey, setCashError, setTransferError, setTransferSlipFile,
      revokeTransferSlipPreviewUrl: (url) => URL.revokeObjectURL(url),
      setTransferSlipPreviewUrl, setTransferSlipParsed, setTransferSlipChecks, setTransferSlipIssues, setTransferSlipVerified,
      setTransferSlipVerifiedAgainst, setTransferSlipVerificationId, setTransferOverrideApprovalId, setReceiptSession, setReceiptSaving,
      setReceiptSaved, setBillPaymentMethod, setReceiptError,
      pushSubmitMessage
    });
  }

  useEffect(() => {
    submitOrderRef.current = submitOrder;
    submitTransferPaymentRef.current = submitTransferPayment;
  });

  function applyQuickCashAmount(amount: number) {
    if (cashSubmitting) return;
    setCashReceivedInput(amount.toFixed(2));
    setCashReplaceOnNextKey(true);
    setCashError(null);
  }

  function appendCashKeypadValue(key: string) {
    if (cashSubmitting) return;
    if (cashReplaceOnNextKey) {
      const replacement = key === "." ? "0." : key;
      setCashReceivedInput(sanitizeCashInput(replacement));
      setCashReplaceOnNextKey(false);
      setCashError(null);
      return;
    }

    if (key === "." && cashReceivedInput.includes(".")) return;

    const base = cashReceivedInput;
    const decimalPart = base.includes(".") ? base.split(".")[1] ?? "" : "";
    const hasLockedTwoDecimals = decimalPart.length >= 2;
    if (hasLockedTwoDecimals && key !== ".") {
      const replacement = key === "00" ? "0" : key;
      setCashReceivedInput(sanitizeCashInput(replacement));
      setCashReplaceOnNextKey(false);
      setCashError(null);
      return;
    }

    let nextValue = "";
    if (!base) {
      nextValue = key === "." ? "0." : key;
    } else if (base === "0" && key !== "." && !base.includes(".")) {
      nextValue = key;
    } else {
      nextValue = `${base}${key}`;
    }

    setCashReceivedInput(sanitizeCashInput(nextValue));
    setCashReplaceOnNextKey(false);
    setCashError(null);
  }

  function backspaceCashInput() {
    if (cashSubmitting) return;
    if (cashReplaceOnNextKey) {
      setCashReceivedInput("");
      setCashReplaceOnNextKey(false);
      setCashError(null);
      return;
    }
    const trimmed = cashReceivedInput.slice(0, -1);
    setCashReceivedInput(trimmed ? sanitizeCashInput(trimmed) : "");
    setCashReplaceOnNextKey(false);
    setCashError(null);
  }

  function clearCashInput() {
    if (cashSubmitting) return;
    setCashReceivedInput("");
    setCashReplaceOnNextKey(false);
    setCashError(null);
  }

  function requestCancelBillFromCash(order: CheckoutReviewOrder) {
    if (isBusy) return;
    const targetOrder: ActiveOrder =
      activeOrder && activeOrder.id === order.order_id
        ? activeOrder
        : {
            id: order.order_id,
            order_no: order.order_no,
            status: "queued",
            order_type: order.order_type,
            channel: order.channel ?? null,
            external_order_code: order.external_order_code ?? null,
            total_amount: order.total_amount,
            table_id: order.table_id ?? null,
            created_at: order.created_at
          };

    if (targetOrder.status !== "queued") {
      pushSubmitMessage(text.cancelBillNotAllowed);
      return;
    }

    setCashReviewOrder(null);
    setTransferReviewOrder(null);
    setTransferReference("");
    setTransferError(null);
    setTransferSlipFile(null);
    if (transferSlipPreviewUrl) {
      URL.revokeObjectURL(transferSlipPreviewUrl);
    }
    setTransferSlipPreviewUrl(null);
    setTransferSlipParsed(null);
    setTransferSlipChecks(null);
    setTransferSlipIssues([]);
    setTransferSlipVerified(false);
    setTransferSlipVerifiedAgainst(null);
    setTransferSlipVerificationId(null);
    setTransferOverrideApprovalId(null);
    setTransferOverrideModalOpen(false);
    setCashError(null);
    setCancelBillTargetOrder(targetOrder);
    setCancelBillApprovalOpen(true);
  }

  function requestCancelBillFromReview(order: CheckoutReviewOrder) {
    if (isBusy) return;
    const targetOrder: ActiveOrder =
      activeOrder && activeOrder.id === order.order_id
        ? activeOrder
        : {
            id: order.order_id,
            order_no: order.order_no,
            status: "queued",
            order_type: order.order_type,
            channel: order.channel ?? null,
            external_order_code: order.external_order_code ?? null,
            total_amount: order.total_amount,
            table_id: order.table_id ?? null,
            created_at: order.created_at
          };

    if (targetOrder.status !== "queued") {
      pushSubmitMessage(text.cancelBillNotAllowed);
      return;
    }

    setReviewOrder(null);
    setCashReviewOrder(null);
    setTransferReviewOrder(null);
    setTransferReference("");
    setTransferError(null);
    setTransferSlipFile(null);
    if (transferSlipPreviewUrl) {
      URL.revokeObjectURL(transferSlipPreviewUrl);
    }
    setTransferSlipPreviewUrl(null);
    setTransferSlipParsed(null);
    setTransferSlipChecks(null);
    setTransferSlipIssues([]);
    setTransferSlipVerified(false);
    setTransferSlipVerifiedAgainst(null);
    setTransferSlipVerificationId(null);
    setTransferOverrideApprovalId(null);
    setTransferOverrideModalOpen(false);
    setCashError(null);
    setCancelBillTargetOrder(targetOrder);
    setCancelBillApprovalOpen(true);
  }

  function closeCashPaymentPopup() {
    if (cashSubmitting) return;
    const order = cashReviewOrder;
    setCashReviewOrder(null);
    if (order) void setTablePaymentLock(order, false);
    setCashError(null);
  }

  function closeReceiptPopup() {
    const shouldReturnToTableBrowser =
      receiptSession?.payment_method === "bank_transfer" && (orderType === "dine_in" || quickMode === "dine_in");
    receiptModalClosedRef.current = true;
    setReceiptSession(null);
    setReceiptSaved(false);
    setReceiptAutoPrinted(false);
    setReceiptError(null);
    setReceiptSaving(false);
    if (!activeOrder && cartRef.current.length === 0) {
      setBillPaymentMethod(null);
    }
    if (shouldReturnToTableBrowser) {
      returnToDineInTableBrowserAfterPayment();
    }
  }


  async function openCashDrawerAfterCashPayment(orderNo: string) {
    if (typeof window === "undefined") return;

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

    const runtime = (window as Window & { CpIPOSWindowsRuntime?: LocalBridgeRuntimePayload }).CpIPOSWindowsRuntime ?? null;
    const token = String(window.sessionStorage.getItem("cpi_local_bridge_token_v1") ?? runtime?.bridge_token ?? "").trim();
    const tokenHeader = String(
      window.sessionStorage.getItem("cpi_local_bridge_token_header_v1") ?? runtime?.bridge_token_header ?? "X-CpIPOS-Bridge-Token"
    ).trim();
    const printUrl = String(
      window.localStorage.getItem("cpi_local_bridge_print_url_v1") ?? runtime?.bridge_print_url ?? "http://127.0.0.1:3210/print"
    ).trim();
    const healthUrl = String(
      window.localStorage.getItem("cpi_local_bridge_health_url_v1") ?? runtime?.bridge_health_url ?? "http://127.0.0.1:3210/health"
    ).trim();

    if (!token || !tokenHeader || !printUrl || !healthUrl) {
      pushSubmitMessage(
        lang === "th"
          ? `รับเงินสดสำเร็จ แต่ยังไม่พบรหัสเชื่อมต่อ Windows Runtime สำหรับเปิดลิ้นชัก: ${orderNo}`
          : `Cash payment saved, but Windows Runtime bridge token was not available for drawer open: ${orderNo}`
      );
      return;
    }

    const buildDrawerUrl = (urlText: string) => {
      try {
        const url = new URL(urlText);
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
        return urlText.replace(/\/print(?:\/test)?\/?$/u, "/cash-drawer/open");
      }
    };

    let printerName = String(runtime?.windows_printer ?? "").trim();

    if (!printerName) {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 2500);
      try {
        const healthResponse = await fetch(healthUrl, { cache: "no-store", signal: controller.signal });
        const healthBody = (await healthResponse.json().catch(() => null)) as LocalBridgeHealthBody | null;
        printerName = String(healthBody?.data?.resolved_printer ?? healthBody?.data?.system_default_printer ?? "").trim();
      } catch {
        printerName = "";
      } finally {
        window.clearTimeout(timeoutId);
      }
    }

    const body: Record<string, unknown> = {
      drawer_connection_mode: "printer-kick",
      drawer_kick_pin: 0,
      drawer_pulse_on_ms: 80,
      drawer_pulse_off_ms: 250,
      metadata: {
        source: "pos_sales_module",
        trigger: "cash_payment_success",
        order_no: orderNo,
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
      const response = await fetch(buildDrawerUrl(printUrl), {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          [tokenHeader]: token
        },
        body: JSON.stringify(body)
      });

      const result = (await response.json().catch(() => null)) as LocalBridgeCommandBody | null;

      if (response.ok && result?.ok !== false && !result?.error) {
        pushSubmitMessage(
          lang === "th"
            ? `รับเงินสดสำเร็จ และเปิดลิ้นชักแล้ว: ${orderNo}`
            : `Cash payment saved and drawer opened: ${orderNo}`
        );
        return;
      }

      pushSubmitMessage(
        lang === "th"
          ? `รับเงินสดสำเร็จ แต่เปิดลิ้นชักไม่สำเร็จ กรุณากดปุ่มเปิดลิ้นชักเอง: ${orderNo}`
          : `Cash payment saved, but drawer open failed. Please open the drawer manually: ${orderNo}`
      );
    } catch {
      pushSubmitMessage(
        lang === "th"
          ? `รับเงินสดสำเร็จ แต่เชื่อมต่อ Windows Runtime เพื่อเปิดลิ้นชักไม่ได้: ${orderNo}`
          : `Cash payment saved, but Windows Runtime drawer bridge was unavailable: ${orderNo}`
      );
    }
  }
  async function confirmCashPayment() {
    if (!cashReviewOrder || cashSubmitting || receiptSaving) {
      return;
    }
    if (!isOnline) {
      setCashError(text.stillOffline);
      return;
    }

    const received = Number(sanitizeCashInput(cashReceivedInput));
    const hasReceivedAmount = Number.isFinite(received) && received > 0;
    const hasEnoughAmount = hasReceivedAmount && received + 0.009 >= cashReviewOrder.total_amount;
    if (!hasReceivedAmount || !hasEnoughAmount) {
      setCashError(text.cashInsufficient);
      setCashNoticeMessage(text.cashInsufficient);
      return;
    }
    const nextReceiptSession: ReceiptSession = {
      ...cashReviewOrder,
      payment_method: "cash",
      cash_received: received,
      change_amount: Math.max(0, received - cashReviewOrder.total_amount),
      store_profile: storeProfile
    };

    receiptModalClosedRef.current = false;
    setCashSubmitting(true);
    setCashReviewOrder(null);
    setReceiptSession(nextReceiptSession);
    setReceiptSaving(true);
    setReceiptSaved(false);
    setReceiptError(null);

    try {
      const { response, body } = await fetchJsonWithTimeout<PosPaymentResponseBody>(
        "/api/pos/payments",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-idempotency-key": `pos-payment-${crypto.randomUUID()}`
          },
          body: JSON.stringify({
            order_id: cashReviewOrder.order_id,
            payment_lines: [{ method: "cash", amount: cashReviewOrder.total_amount }],
            cash_received: received,
            change_amount: Math.max(0, received - cashReviewOrder.total_amount)
          })
        },
        20000
      );

      if (!response.ok || body.error) {
        throw new Error(body.error?.message ?? "Failed to complete payment.");
      }

      setReceiptSaved(true);
      setReceiptAutoPrinted(Number(body.data?.print_jobs_queued ?? 0) > 0);
      setBillPaymentMethod("cash");
      clearClosedBillUiState({ clearReceipt: false, tableId: cashReviewOrder.table_id ?? null, resetDelivery: true });
      pushSubmitMessage(`${text.receiptSaved}: ${cashReviewOrder.order_no}`);
      runPostPaymentSideEffects(nextReceiptSession);
      if (orderType === "dine_in" || Boolean(cashReviewOrder.table_id)) {
        setQuickMode(quickMode === "buffet_table" ? "buffet_table" : "dine_in");
        setOrderType("dine_in");
      }
    } catch (paymentError) {
      const message = paymentError instanceof Error ? paymentError.message : "Unknown error";
      markConnectivityFromError(paymentError);
      setReceiptSession(null);
      setReceiptSaved(false);
      setReceiptError(message);
      setCashError(message);
      if (!receiptModalClosedRef.current) {
        setCashReviewOrder(cashReviewOrder);
        setCashReceivedInput(received.toFixed(2));
        setCashReplaceOnNextKey(true);
      }
    } finally {
      setCashSubmitting(false);
      setReceiptSaving(false);
    }
  }

  async function confirmTransferPayment() {
    if (!transferReviewOrder || transferSubmitting || transferSlipChecking || receiptSaving) return;
    if (!promptPayQrUrl) {
      setTransferError(text.transferPaymentSettingsRequiredBody);
      return;
    }
    const pendingPaymentEntry: PendingPaymentQueueItem = {
      idempotencyKey: `pos-transfer-${crypto.randomUUID()}`,
      payload: {
        order_id: transferReviewOrder.order_id,
        order_no: transferReviewOrder.order_no,
        order_type: orderType,
        total_amount: transferReviewOrder.total_amount,
        discount_amount: transferReviewOrder.discount_amount ?? 0,
        tax_total: transferReviewOrder.tax_total ?? 0,
        tax_lines: transferReviewOrder.tax_lines ?? [],
        method: "bank_transfer",
        reference_no: null,
        transfer_verification_id: null,
        transfer_override_approval_id: null,
        skip_transfer_verification: true,
        receipt_items: transferReviewOrder.items.map((item) => ({ ...item }))
      },
      queued_at: new Date().toISOString(),
      retry_count: 0,
      last_error: null
    };

    if (!isOnline) {
      enqueuePendingPayment(pendingPaymentEntry);
      setActiveOrder((current) => (current?.id === pendingPaymentEntry.payload.order_id ? null : current));
      setCart([]);
      setTakeawayCreatingPreview(null);
      setReviewOrder(null);
      setCashReviewOrder(null);
      setTransferReviewOrder(null);
      setTransferReference("");
      setTransferError(null);
      setTransferSlipFile(null);
      if (transferSlipPreviewUrl) {
        URL.revokeObjectURL(transferSlipPreviewUrl);
      }
      setTransferSlipPreviewUrl(null);
      setTransferSlipParsed(null);
      setTransferSlipChecks(null);
      setTransferSlipIssues([]);
      setTransferSlipVerified(false);
      setTransferSlipVerifiedAgainst(null);
      setTransferSlipVerificationId(null);
      setTransferOverrideApprovalId(null);
      setTransferOverrideModalOpen(false);
      pushSubmitMessage(text.transferQueued);
      return;
    }

    const paidTransferOrder = transferReviewOrder;
    setTransferSubmitting(true);
    setTransferError(null);
    try {
      enqueuePendingPayment(pendingPaymentEntry);
      await submitTransferPayment(pendingPaymentEntry, true);
      runPostPaymentSideEffects({
        ...paidTransferOrder,
        payment_method: "bank_transfer",
        cash_received: paidTransferOrder.total_amount,
        change_amount: 0,
        store_profile: storeProfile
      });
      clearClosedBillUiState({ clearReceipt: false, tableId: paidTransferOrder.table_id ?? null, resetDelivery: true });
      if (orderType === "dine_in" || Boolean(paidTransferOrder.table_id)) {
        setQuickMode(quickMode === "buffet_table" ? "buffet_table" : "dine_in");
        setOrderType("dine_in");
      }
    } catch (transferPayError) {
      const rawMessage = transferPayError instanceof Error ? transferPayError.message : "Unknown error";
      const message = localizeApiMessage(rawMessage);
      markPendingPaymentFailed(pendingPaymentEntry.idempotencyKey, rawMessage);
      markConnectivityFromError(transferPayError);
      setTransferError(message);
      pushSubmitMessage(message);
    } finally {
      setTransferSubmitting(false);
    }
  }

  async function submitStockAdjustment(formData: FormData) {
    if (isBusy) return;
    setStockAdjusting(true);
    setStockAdjustError(null);
    try {
      const { response, body } = await fetchJsonWithTimeout<{ data?: { id?: string } } & ApiErrorBody>(
        "/api/backoffice/stock/adjust",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-idempotency-key": `pos-stock-${crypto.randomUUID()}` },
          body: JSON.stringify({
            ingredient_id: String(formData.get("ingredient_id") ?? ""),
            quantity_delta: Number(formData.get("quantity_delta") ?? 0),
            reason: String(formData.get("reason") ?? ""),
            approval_id: stockApprovalId
          })
        },
        20000
      );
      if (!response.ok || body.error) {
        throw new Error(body.error?.message ?? "Stock adjustment failed.");
      }
      setStockModalOpen(false);
      setStockApprovalId(null);
      setStockTargetId("");
      pushSubmitMessage(`${text.stockAdjusted}: ${body.data?.id ?? "-"}`);
    } catch (adjustError) {
      markConnectivityFromError(adjustError);
      setStockAdjustError(adjustError instanceof Error ? adjustError.message : "Unknown error");
    } finally {
      setStockAdjusting(false);
    }
  }

  function openIngredientAdjustDialog(order: CheckoutReviewOrder, item: CartItem) {
    const lineKey = `${order.order_id}:${item.product_id}`;
    if (reviewItemDeductingKey === lineKey) return;
    if (!item.product_id || !canDeductIngredientForItem(item.product_id)) return;
    setIngredientAdjustOptions([]);
    setIngredientAdjustSelectedIds([]);
    setIngredientAdjustLoading(true);
    setIngredientAdjustError(null);
    setIngredientAdjustDialog({
      order,
      item,
      mode: "deduct"
    });
    void loadIngredientAdjustOptions(order, item);
  }

  function closeIngredientAdjustDialog() {
    if (ingredientAdjustBusy) return;
    setIngredientAdjustDialog(null);
    setIngredientAdjustOptions([]);
    setIngredientAdjustSelectedIds([]);
    setIngredientAdjustLoading(false);
    setIngredientAdjustError(null);
  }

  async function loadIngredientAdjustOptions(order: CheckoutReviewOrder, item: CartItem) {
    try {
      const query = new URLSearchParams({
        product_id: item.product_id,
        quantity: String(item.quantity)
      });
      const { response, body } = await fetchJsonWithTimeout<
        { data?: { ingredients?: ReviewItemIngredientOption[] } } & ApiErrorBody
      >(`/api/pos/orders/${encodeURIComponent(order.order_id)}/item-ingredient-deduct?${query.toString()}`, { cache: "no-store" }, 45000, 1);
      if (!response.ok || body.error) {
        throw new Error(body.error?.message ?? "Failed to load item ingredients.");
      }
      const options = Array.isArray(body.data?.ingredients) ? body.data!.ingredients! : [];
      setIngredientAdjustOptions(options);
      setIngredientAdjustSelectedIds([]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setIngredientAdjustError(message);
      setIngredientAdjustOptions([]);
      setIngredientAdjustSelectedIds([]);
    } finally {
      setIngredientAdjustLoading(false);
    }
  }

  async function applyIngredientForReviewItem(
    order: CheckoutReviewOrder,
    item: CartItem,
    mode: "deduct" | "restore",
    ingredientIds: string[]
  ) {
    const lineKey = `${order.order_id}:${item.product_id}`;
    if (reviewItemDeductingKey === lineKey) return;
    if (!item.product_id || !canDeductIngredientForItem(item.product_id)) return;
    if (ingredientIds.length === 0) {
      setIngredientAdjustError(text.reviewItemIngredientSelectRequired);
      return;
    }

    setReviewItemDeductingKey(lineKey);
    setReviewItemDeductingMode(mode);
    setStockAdjustError(null);
    setIngredientAdjustError(null);
    try {
      const { response, body } = await fetchJsonWithTimeout<{ data?: { deductions?: Array<{ ingredient_id: string; required_grams: number }> } } & ApiErrorBody>(
        `/api/pos/orders/${encodeURIComponent(order.order_id)}/item-ingredient-deduct`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-idempotency-key": `pos-item-ingredient-deduct-${order.order_id}-${item.product_id}-${crypto.randomUUID()}`
          },
          body: JSON.stringify({
            product_id: item.product_id,
            quantity: item.quantity,
            mode,
            ingredient_ids: ingredientIds
          })
        },
        45000,
        1
      );
      if (!response.ok || body.error) {
        throw new Error(body.error?.message ?? "Failed to apply item ingredient deduction.");
      }
      pushSubmitMessage(
        `${mode === "restore" ? text.reviewItemIngredientRestoreSuccess : text.reviewItemIngredientDeductSuccess}: ${item.name}`
      );
      setIngredientAdjustDialog((current) => {
        if (!current) return current;
        if (current.order.order_id !== order.order_id) return current;
        if (current.item.product_id !== item.product_id) return current;
        return null;
      });
      setIngredientAdjustOptions([]);
      setIngredientAdjustSelectedIds([]);
      setIngredientAdjustError(null);
    } catch (error) {
      markConnectivityFromError(error);
      const rawMessage = error instanceof Error ? error.message : "Unknown error";
      const message = formatIngredientAdjustApiError({
        message: rawMessage,
        mode,
        options: ingredientAdjustOptions,
        text
      });
      setStockAdjustError(message);
      setIngredientAdjustError(message);
      pushSubmitMessage(message);
    } finally {
      setReviewItemDeductingKey((current) => (current === lineKey ? null : current));
      setReviewItemDeductingMode(null);
    }
  }

  async function confirmIngredientAdjustDialog(mode: "deduct" | "restore") {
    if (!ingredientAdjustDialog) return;
    setIngredientAdjustDialog((current) => (current ? { ...current, mode } : current));
    const selectedSet = new Set(ingredientAdjustSelectedIds);
    if (selectedSet.size === 0) {
      setIngredientAdjustError(text.reviewItemIngredientSelectRequired);
      return;
    }
    const targetIngredientIds = ingredientAdjustOptions
      .filter((entry) => selectedSet.has(String(entry.ingredient_id)))
      .filter((entry) => (mode === "restore" ? Number(entry.restorable_grams ?? 0) > 0 : true))
      .map((entry) => String(entry.ingredient_id));
    if (mode === "restore" && targetIngredientIds.length === 0) {
      setIngredientAdjustError(text.reviewItemIngredientRestoreExceeds);
      return;
    }
    await applyIngredientForReviewItem(ingredientAdjustDialog.order, ingredientAdjustDialog.item, mode, targetIngredientIds);
  }

  function renderCartList() {
    if (cart.length === 0) {
      return (
        <div className="posui-cart-empty" aria-label={lang === "th" ? "ตะกร้าว่าง" : "Empty cart"}>
          <Image
            className="posui-cart-empty__logo"
            src="/brand/cpipos-logo.png"
            alt={lang === "th" ? "โลโก้ CpIPOS" : "CpIPOS logo"}
            width={640}
            height={240}
            priority
          />
        </div>
      );
    }

    return (
      <div className={`posui-cart-items ${cart.length > 5 ? "posui-cart-items--capped" : ""}`}>
        {cart.map((item) => {
          const cartLineId = item.cart_line_id ?? item.product_id;
          const isEditingQuantity = editingCartQtyLineId === cartLineId;
          return (
          <article key={cartLineId} className="posui-cart-item">
            <div className="posui-cart-thumb" aria-hidden>
              {item.name.slice(0, 1).toUpperCase()}
            </div>
            <div className="posui-cart-item__info">
              <p>{item.name}</p>
              {item.notes ? <small>{item.notes}</small> : null}
              <small>{formatMoney(item.price)}</small>
              <div className="posui-qty-row">
                <button type="button" onClick={() => adjustQty(cartLineId, -1)} aria-label={`Decrease ${item.name}`}>
                  -
                </button>
                {isEditingQuantity ? (
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    step={1}
                    value={editingCartQtyInput}
                    aria-label={`${lang === "th" ? "จำนวน" : "Quantity"}: ${item.name}`}
                    onChange={handleCartQtyInputChange}
                    onBlur={() => commitCartQtyEdit(cartLineId)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        commitCartQtyEdit(cartLineId);
                      }
                      if (event.key === "Escape") {
                        event.preventDefault();
                        cancelCartQtyEdit();
                      }
                    }}
                  />
                ) : (
                  <span>{item.quantity}</span>
                )}
                <button type="button" onClick={() => adjustQty(cartLineId, 1)} aria-label={`Increase ${item.name}`}>
                  +
                </button>
                <button
                  type="button"
                  className={`posui-qty-edit ${isEditingQuantity ? "is-saving" : ""}`}
                  aria-label={`${isEditingQuantity ? (lang === "th" ? "บันทึกจำนวน" : "Save quantity") : (lang === "th" ? "แก้ไขจำนวน" : "Edit quantity")}: ${item.name}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    if (isEditingQuantity) {
                      commitCartQtyEdit(cartLineId);
                    } else {
                      startCartQtyEdit(cartLineId, item.quantity);
                    }
                  }}
                >
                  <svg className="posui-edit-icon" viewBox="0 0 24 24" aria-hidden="true">
                    {isEditingQuantity ? (
                      <path d="M9.2 16.2 4.9 12l-1.4 1.4 5.7 5.7L21 7.3 19.6 6 9.2 16.2Z" fill="currentColor" />
                    ) : (
                      <path d="M4 17.5V20h2.5L17.8 8.7l-2.5-2.5L4 17.5Zm15.7-11.6c.4-.4.4-1 0-1.4l-1.2-1.2c-.4-.4-1-.4-1.4 0l-1 1 2.5 2.5 1.1-.9Z" fill="currentColor" />
                    )}
                  </svg>
                </button>
              </div>
            </div>
            <div className="posui-cart-item__sum">
              <strong>{formatMoney(item.quantity * item.price)}</strong>
              {productById.get(item.product_id)?.has_recipe_deduction ? (
                <button type="button" className="posui-cart-action posui-cart-action--edit" aria-label={`${lang === "th" ? "แก้ไข" : "Edit"}: ${item.name}`} onClick={() => openCartLineEditor(item)}>
                  <svg className="posui-edit-icon" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M4 17.5V20h2.5L17.8 8.7l-2.5-2.5L4 17.5Zm15.7-11.6c.4-.4.4-1 0-1.4l-1.2-1.2c-.4-.4-1-.4-1.4 0l-1 1 2.5 2.5 1.1-.9Z" fill="currentColor" />
                  </svg>
                </button>
              ) : null}
              <button type="button" className="posui-cart-action posui-cart-action--delete" aria-label={`${text.remove}: ${item.name}`} onClick={() => removeFromCart(cartLineId)}>
                <svg className="posui-delete-icon" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M9 3h6l1 2h4v2H4V5h4l1-2Zm1 7h2v8h-2v-8Zm4 0h2v8h-2v-8ZM8 10h2v8H8v-8Z"
                    fill="currentColor"
                  />
                </svg>
              </button>
            </div>
          </article>
          );
        })}
      </div>
    );
  }

  function getStatusValue() {
    if (quickMode === "delivery") {
      return getDeliveryFlowLabel(deliveryFlowState);
    }
    const modeLabel = getQuickModeLabel();
    return modeLabel;
  }

  function getDeliveryFlowLabel(state: DeliveryFlowState) {
    if (state === "edit") return text.deliveryStateEdit;
    if (state === "confirm_payment") return text.deliveryStateConfirmPayment;
    if (state === "cancelled") return text.deliveryStateCancelled;
    if (state === "pending_dispatch") return text.deliveryStatePendingDispatch;
    if (state === "completed") return text.deliveryStateCompleted;
    return text.deliveryStateCreate;
  }

  function getQuickModeLabel() {
    if (quickMode === "buffet_table") return lang === "th" ? "โต๊ะบุฟเฟ่" : "Buffet table";
    if (quickMode === "dine_in") return text.dineIn;
    if (quickMode === "delivery") return text.delivery;
    return text.goHome;
  }

  function renderDineInPaymentIdentity(orderTableId?: string | null) {
    if (orderType !== "dine_in" || !selectedTable) {
      return null;
    }
    const currentTableDisplay = selectedTable.table_name?.trim() || selectedTable.table_code || "-";
    const orderTable = orderTableId
      ? (posTables.find((table) => table.id === orderTableId) ?? (selectedTable.id === orderTableId ? selectedTable : null))
      : null;
    const orderTableDisplay = orderTable?.table_name?.trim() || orderTable?.table_code || "-";
    const hasTableMismatch = Boolean(orderTableId && selectedTable.id !== orderTableId);
    return (
      <div className={`posui-payment-bill-identity ${hasTableMismatch ? "is-mismatch" : ""}`} role="status" aria-live="polite">
        <p className="posui-payment-bill-identity__title">{text.dineIn}</p>
        <div className="posui-payment-bill-identity__grid">
          <p>
            <span>{text.tableLabel}</span>
            <strong>{currentTableDisplay}</strong>
          </p>
        </div>
        {hasTableMismatch ? (
          <div className="posui-payment-bill-identity__warn">
            <strong>{text.paymentTableMismatchBanner}</strong>
            <p>
              <span>{text.paymentTableMismatchCurrent}</span>
              <strong>{currentTableDisplay}</strong>
            </p>
            <p>
              <span>{text.paymentTableMismatchOrder}</span>
              <strong>{orderTableDisplay}</strong>
            </p>
          </div>
        ) : null}
      </div>
    );
  }

  function getTransferVerificationStatusLabel(status: TableBillTransferVerificationPayload["verification_status"]) {
    if (status === "passed") return text.transferVerificationStatusPassed;
    if (status === "failed") return text.transferVerificationStatusFailed;
    if (status === "override_passed") return text.transferVerificationStatusOverridePassed;
    return text.transferVerificationStatusError;
  }

  function renderExternalOrderCode(order: CheckoutReviewOrder | null | undefined) {
    const externalCode = order?.external_order_code?.trim();
    if (!externalCode) return null;
    return (
      <p className="posui-payment-modal__delivery-code" aria-live="polite">
        <span>{text.externalCode}</span>
        <strong>{externalCode}</strong>
      </p>
    );
  }

  function resolveReceiptDiscountAmount(session: ReceiptSession): number {
    const explicitDiscount = Number(session.discount_amount ?? 0);
    if (Number.isFinite(explicitDiscount) && explicitDiscount > 0) {
      return Number(Math.max(0, explicitDiscount).toFixed(2));
    }
    const cartSubtotal = session.items.reduce((sum, item) => sum + item.quantity * item.price, 0);
    const fallbackDiscount = Math.max(0, cartSubtotal - Number(session.total_amount ?? 0));
    return Number(fallbackDiscount.toFixed(2));
  }

  function buildReceiptPrintHtml(session: ReceiptSession) {
    const pageHeightMm = Math.min(700, Math.max(120, 78 + session.items.length * 10));
    const printableWidthMm = 48;
    const logoUrl = getAbsoluteAssetUrl(receiptLogoPath);
    const receiptDiscountAmount = resolveReceiptDiscountAmount(session);
    const receiptTaxLines = resolveTaxLinesForReceipt(session, text.tax);
    const itemRows = session.items
      .map((item) => {
        const qty = formatQuantity(item.quantity);
        const lineTotal = formatMoneyPlain(item.quantity * item.price);
        const unitPrice = formatMoneyPlain(item.price);
        const details = parseReceiptItemDetails(item.notes);
        const detailRows = [
          ...details.choices.map((choice) => `<div class="choice">+ ${escapeHtml(choice)}</div>`),
          details.note ? `<div class="note">${escapeHtml(text.notes)}: ${escapeHtml(details.note)}</div>` : ""
        ].join("");
        return `
          <tr>
            <td class="col-name">
              <div class="name">${escapeHtml(item.name)}</div>
              <div class="unit">x ${escapeHtml(unitPrice)}</div>
              ${detailRows}
            </td>
            <td class="col-qty">${escapeHtml(qty)}</td>
            <td class="col-total">${escapeHtml(lineTotal)}</td>
          </tr>
        `;
      })
      .join("");
    const externalOrderCodeMeta = session.external_order_code?.trim()
      ? `<div class="meta-line"><span>${escapeHtml(text.externalCode)}</span><span>${escapeHtml(session.external_order_code)}</span></div>`
      : "";
    const receiptMemberLabel = getReceiptMemberLabel(session);
    const receiptMemberMeta = receiptMemberLabel
      ? `<div class="meta-line"><span>${escapeHtml(text.member)}</span><span>${escapeHtml(receiptMemberLabel)}</span></div>`
      : "";
    const storeAddressLine = receiptStoreAddress ? `<div class="muted">${escapeHtml(receiptStoreAddress)}</div>` : "";
    const storePhoneLine = receiptStorePhone ? `<div class="muted">${escapeHtml(receiptStorePhone)}</div>` : "";
    const paymentMethodLine = `<div class="summary-line is-heading"><span>${escapeHtml(text.paymentMethod)}</span><strong>${escapeHtml(getReceiptPaymentMethodLabel(session))}</strong></div>`;
    const discountLine = `<div class="summary-line is-muted"><span>${escapeHtml(text.discount)}</span><strong>฿${escapeHtml(formatMoneyPlain(receiptDiscountAmount))}</strong></div>`;
    const taxSummaryLines = receiptTaxLines
      .map(
        (line) =>
          `<div class="summary-line is-muted"><span>${escapeHtml(line.label)}</span><strong>${escapeHtml(formatSignedMoneyPlain(line.amount))}</strong></div>`
      )
      .join("");
    const cashSummaryLines =
      session.payment_method === "cash"
        ? `
    <div class="summary-line is-aux"><span>${escapeHtml(text.cashReceivedLabel)}</span><strong>฿${escapeHtml(formatMoneyPlain(session.cash_received))}</strong></div>
    <div class="summary-line is-aux"><span>${escapeHtml(text.cashChange)}</span><strong>฿${escapeHtml(formatMoneyPlain(session.change_amount))}</strong></div>`
        : "";

    return `<!doctype html>
<html lang="${lang}">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(receiptStoreName)} - ${escapeHtml(session.order_no)}</title>
  <style>
    @page { size: 58mm ${pageHeightMm}mm; margin: 0; }
    html, body { margin: 0; padding: 0; width: 58mm !important; min-height: ${pageHeightMm}mm; background: #fff; color: #000; font-family: "Noto Sans Thai", "Tahoma", "Segoe UI", sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    * { box-sizing: border-box; }
    .receipt58 { width: ${printableWidthMm}mm; margin: 0 auto; padding: 1.2mm 0 1.8mm; min-height: ${Math.max(90, pageHeightMm - 4)}mm; font-size: 11px; line-height: 1.28; }
    .center { text-align: center; }
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
    .summary-line.is-heading {
      padding-bottom: 0.8mm;
      margin-bottom: 0.7mm;
      border-bottom: 1px dashed #111;
      font-size: 9.6px;
    }
    .summary-line.is-muted { font-size: 9.6px; }
    .summary-line.is-aux { font-size: 9.7px; }
    .summary-line.grand {
      margin: 1.1mm 0 0.9mm;
      padding: 0.7mm 0;
      border-top: 1px solid #111;
      border-bottom: 1px solid #111;
      font-size: 13px;
      letter-spacing: 0.01em;
    }
    .summary-line.grand span,
    .summary-line.grand strong { font-weight: 900; }
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
    <div class="head-title">${escapeHtml(receiptStoreName)}</div>
    ${storeAddressLine}
    ${storePhoneLine}
    <div class="muted">${escapeHtml(receiptBranchLabel)}</div>
    <div class="hr"></div>
    <div class="meta-line"><span>${escapeHtml(text.sellerName)}</span><span>${escapeHtml(sellerName)}</span></div>
    <div class="meta-line"><span>${escapeHtml(text.shiftName)}</span><span>${escapeHtml(shift?.status ?? "-")}</span></div>
    <div class="meta-line"><span>${escapeHtml(text.modeLabel)}</span><span>${escapeHtml(getQuickModeLabel())}</span></div>
    <div class="meta-line"><span>${escapeHtml(text.billNo)}</span><span>${escapeHtml(session.order_no)}</span></div>
    ${externalOrderCodeMeta}
    ${receiptMemberMeta}
    <div class="meta-line"><span>${escapeHtml(text.date)}</span><span>${escapeHtml(formatReceiptDateTime(session.created_at, lang))}</span></div>
    <div class="hr"></div>
    <table>
      <tbody>
        ${itemRows}
      </tbody>
    </table>
    <div class="hr"></div>
    ${paymentMethodLine}
    ${discountLine}
    ${taxSummaryLines}
    <div class="summary-line grand"><span>${escapeHtml(text.paymentTotalDue)}</span><strong>฿${escapeHtml(formatMoneyPlain(session.total_amount))}</strong></div>
    ${cashSummaryLines}
    <div class="hr"></div>
    <div class="foot">CpIPOS</div>
  </main>
</body>
</html>`;
  }

  function getOrCreateReceiptPrintFrame(): HTMLIFrameElement {
    const existing = receiptPrintFrameRef.current;
    if (existing && existing.isConnected) {
      return existing;
    }

    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.position = "fixed";
    frame.style.right = "0";
    frame.style.bottom = "0";
    frame.style.width = "0";
    frame.style.height = "0";
    frame.style.border = "0";
    frame.style.opacity = "0";
    frame.style.pointerEvents = "none";
    document.body.appendChild(frame);
    receiptPrintFrameRef.current = frame;
    return frame;
  }

  async function primeReceiptPrintFrame(session: ReceiptSession, prebuiltHtml?: string): Promise<HTMLIFrameElement> {
    const html = prebuiltHtml ?? buildReceiptPrintHtml(session);
    const frame = getOrCreateReceiptPrintFrame();
    if (receiptPrintFrameHtmlRef.current === html && frame.dataset.receiptReady === "1") {
      return frame;
    }

    receiptPrintFrameHtmlRef.current = html;
    frame.dataset.receiptReady = "0";
    const loadToken = ++receiptPrintFrameLoadTokenRef.current;

    await new Promise<void>((resolve, reject) => {
      const doc = frame.contentDocument ?? frame.contentWindow?.document;
      if (!doc) {
        reject(new Error("missing_print_frame_document"));
        return;
      }

      const onLoad = () => resolve();
      frame.addEventListener("load", onLoad, { once: true });
      doc.open();
      doc.write(html);
      doc.close();
    });

    const doc = frame.contentDocument;
    if (!doc) {
      throw new Error("missing_print_frame_document_after_write");
    }
    const images = Array.from(doc.images);
    if (images.length > 0) {
      await new Promise<void>((resolve) => {
        let pending = images.length;
        let finished = false;
        const completeOne = () => {
          if (finished) return;
          pending -= 1;
          if (pending <= 0) {
            finished = true;
            resolve();
          }
        };
        images.forEach((img) => {
          if (img.complete) {
            completeOne();
            return;
          }
          img.addEventListener("load", completeOne, { once: true });
          img.addEventListener("error", completeOne, { once: true });
        });
        window.setTimeout(() => {
          if (finished) return;
          finished = true;
          resolve();
        }, 900);
      });
    }

    if (loadToken === receiptPrintFrameLoadTokenRef.current) {
      frame.dataset.receiptReady = "1";
    }
    return frame;
  }

  useEffect(() => {
    buildReceiptPrintHtmlRef.current = buildReceiptPrintHtml;
    primeReceiptPrintFrameRef.current = primeReceiptPrintFrame;
  });

  async function handleReceiptPrint() {
    if (!receiptSession || receiptSaving) return;
    const printTrace = beginPosActionTrace("receipt.print", {
      order_no: receiptSession.order_no
    });
    const receiptHtml = buildReceiptPrintHtml(receiptSession);
    let bluetoothFallbackReason: string | null = null;

    if (typeof window !== "undefined") {
      type RuntimePayload = {
        bridge_token?: string | null;
        bridge_token_header?: string | null;
        bridge_print_url?: string | null;
        windows_printer?: string | null;
      };

      type BridgePrintResponse = {
        ok?: boolean;
        error?: { message?: string } | unknown;
        data?: { printed?: boolean; printer_name?: string; job_id?: string; html_printed?: boolean } | null;
      };

      const runtime = (window as Window & { CpIPOSWindowsRuntime?: RuntimePayload }).CpIPOSWindowsRuntime ?? null;
      const token = String(window.sessionStorage.getItem("cpi_local_bridge_token_v1") ?? runtime?.bridge_token ?? "").trim();
      const tokenHeader = String(
        window.sessionStorage.getItem("cpi_local_bridge_token_header_v1") ?? runtime?.bridge_token_header ?? "X-CpIPOS-Bridge-Token"
      ).trim();
      const printUrl = String(
        window.localStorage.getItem("cpi_local_bridge_print_url_v1") ?? runtime?.bridge_print_url ?? "http://127.0.0.1:3210/print"
      ).trim();
      const printerName = String(runtime?.windows_printer ?? "").trim();

      if (token && tokenHeader && printUrl) {
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), 12000);

        try {
          const payload: Record<string, unknown> = {
            receipt_html: receiptHtml,
            order_no: receiptSession.order_no,
            metadata: {
              source: "pos_sales_module",
              trigger: "manual_receipt_print",
              order_no: receiptSession.order_no,
              payment_method: receiptSession.payment_method
            }
          };

          if (printerName) {
            payload.printer_name = printerName;
          }

          const response = await fetch(printUrl, {
            method: "POST",
            cache: "no-store",
            headers: {
              "Content-Type": "application/json",
              [tokenHeader]: token
            },
            body: JSON.stringify(payload),
            signal: controller.signal
          });

          const result = (await response.json().catch(() => null)) as BridgePrintResponse | null;
          if (response.ok && result?.ok !== false && !result?.error) {
            setReceiptAutoPrinted(true);
            pushSubmitMessage(
              lang === "th"
                ? `ส่งพิมพ์ใบเสร็จผ่าน Windows Runtime แล้ว: ${receiptSession.order_no}`
                : `Receipt sent to Windows Runtime: ${receiptSession.order_no}`
            );
            endPosActionTrace(printTrace, "ok", {
              order_no: receiptSession.order_no,
              transport: "local_bridge_windows_runtime",
              html_printed: Boolean(result?.data?.html_printed)
            });
            return;
          }

          bluetoothFallbackReason =
            lang === "th"
              ? `พิมพ์ผ่าน Windows Runtime ไม่สำเร็จ กำลังใช้โหมดสำรอง: ${receiptSession.order_no}`
              : `Windows Runtime print failed. Falling back: ${receiptSession.order_no}`;
        } catch (error) {
          bluetoothFallbackReason =
            error instanceof Error && error.message
              ? `${lang === "th" ? "เชื่อมต่อ Windows Runtime ไม่สำเร็จ" : "Windows Runtime print failed"}: ${error.message}`
              : lang === "th"
                ? "เชื่อมต่อ Windows Runtime ไม่สำเร็จ กำลังใช้โหมดสำรอง"
                : "Windows Runtime print failed. Falling back.";
        } finally {
          window.clearTimeout(timeoutId);
        }
      }
    }

    try {
      const { response, body } = await fetchJsonWithTimeout<BluetoothReceiptPrintResponseBody>(
        "/api/pos/receipts/bluetooth",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            order_id: receiptSession.order_id,
            order_no: receiptSession.order_no,
            receipt_html: receiptHtml
          })
        },
        7000,
        0
      );

      const code = body.error?.code ?? "";
      if (response.ok && !body.error) {
        const envelope = body.data;
        const jobs = Array.isArray(envelope?.data?.jobs) ? envelope!.data!.jobs! : [];
        const printedCount = jobs.filter((job) => job.status === "printed").length;
        const failedCount = jobs.filter((job) => job.status === "failed").length;
        if (envelope?.ok === true && printedCount > 0 && failedCount === 0) {
          pushSubmitMessage(lang === "th" ? `ส่งพิมพ์ Bluetooth สำเร็จ ${printedCount} เครื่อง` : `Bluetooth print sent (${printedCount} printer(s)).`);
          endPosActionTrace(printTrace, "ok", {
            order_no: receiptSession.order_no,
            transport: "bluetooth_bridge",
            printer_count: printedCount
          });
          return;
        }
        if (envelope?.data?.fallback_to_browser_print === true) {
          bluetoothFallbackReason = envelope.message ?? (lang === "th" ? "กำลังพิมพ์ผ่านโหมดสำรอง" : "Using fallback print mode.");
        }
        if (failedCount > 0) {
          bluetoothFallbackReason = lang === "th" ? "พิมพ์ Bluetooth ไม่สำเร็จบางเครื่อง กำลังเปิดหน้าพิมพ์สำรอง" : "Bluetooth print failed on some printers. Falling back to browser print.";
        } else if (printedCount === 0) {
          bluetoothFallbackReason = lang === "th" ? "ยังไม่พบผลพิมพ์ Bluetooth กำลังเปิดหน้าพิมพ์สำรอง" : "No Bluetooth print result yet. Falling back to browser print.";
        }
      } else if (code !== "bluetooth_printer_not_configured") {
        bluetoothFallbackReason =
          body.error?.message ??
          (lang === "th" ? "พิมพ์ Bluetooth ไม่สำเร็จ กำลังเปิดหน้าพิมพ์สำรอง" : "Bluetooth print failed. Falling back to browser print.");
      }
    } catch (error) {
      bluetoothFallbackReason =
        error instanceof Error && error.message
          ? `${lang === "th" ? "พิมพ์ Bluetooth ไม่สำเร็จ" : "Bluetooth print failed"}: ${error.message}`
          : lang === "th"
            ? "พิมพ์ Bluetooth ไม่สำเร็จ กำลังเปิดหน้าพิมพ์สำรอง"
            : "Bluetooth print failed. Falling back to browser print.";
    }

    if (bluetoothFallbackReason) {
      pushSubmitMessage(bluetoothFallbackReason);
    }

    try {
      const frame = await primeReceiptPrintFrame(receiptSession, receiptHtml);
      const frameWindow = frame.contentWindow;
      if (!frameWindow) {
        throw new Error("missing_print_frame_window");
      }
      frameWindow.focus();
      frameWindow.print();
      endPosActionTrace(printTrace, "ok", {
        order_no: receiptSession.order_no,
        transport: "iframe_print"
      });
    } catch (error) {
      pushSubmitMessage(lang === "th" ? "ไม่สามารถเปิดหน้าพิมพ์ได้" : "Unable to open print dialog.");
      endPosActionTrace(printTrace, "error", {
        order_no: receiptSession.order_no,
        transport: "iframe_print",
        error: error instanceof Error ? error.message : "unknown_print_error"
      });
    }
  }

  async function autoPrintReceiptToWindowsRuntime(session: ReceiptSession, trigger: string) {
    if (typeof window === "undefined") return;

    type RuntimePayload = {
      bridge_token?: string | null;
      bridge_token_header?: string | null;
      bridge_print_url?: string | null;
      windows_printer?: string | null;
    };

    type BridgePrintResponse = {
      ok?: boolean;
      error?: { message?: string } | unknown;
      data?: { printed?: boolean; printer_name?: string; job_id?: string } | null;
    };

    const runtime = (window as Window & { CpIPOSWindowsRuntime?: RuntimePayload }).CpIPOSWindowsRuntime ?? null;
    const token = String(window.sessionStorage.getItem("cpi_local_bridge_token_v1") ?? runtime?.bridge_token ?? "").trim();
    const tokenHeader = String(
      window.sessionStorage.getItem("cpi_local_bridge_token_header_v1") ?? runtime?.bridge_token_header ?? "X-CpIPOS-Bridge-Token"
    ).trim();
    const printUrl = String(
      window.localStorage.getItem("cpi_local_bridge_print_url_v1") ?? runtime?.bridge_print_url ?? "http://127.0.0.1:3210/print"
    ).trim();
    const printerName = String(runtime?.windows_printer ?? "").trim();

    if (!token || !tokenHeader || !printUrl) {
      setReceiptAutoPrinted(false);
      return;
    }

    const receiptHtml = buildReceiptPrintHtml(session);
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 9000);

    try {
      const payload: Record<string, unknown> = {
        receipt_html: receiptHtml,
        order_no: session.order_no,
        metadata: {
          source: "pos_sales_module",
          trigger,
          order_no: session.order_no,
          payment_method: session.payment_method
        }
      };

      if (printerName) {
        payload.printer_name = printerName;
      }

      const response = await fetch(printUrl, {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          [tokenHeader]: token
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      const result = (await response.json().catch(() => null)) as BridgePrintResponse | null;
      if (response.ok && result?.ok !== false && !result?.error) {
        setReceiptAutoPrinted(true);
        pushSubmitMessage(
          lang === "th"
            ? `บันทึกชำระสำเร็จ และส่งพิมพ์ใบเสร็จแล้ว: ${session.order_no}`
            : `Payment saved and receipt print sent: ${session.order_no}`
        );
        return;
      }

      setReceiptAutoPrinted(false);
      pushSubmitMessage(
        lang === "th"
          ? `บันทึกชำระสำเร็จ แต่พิมพ์ใบเสร็จอัตโนมัติไม่สำเร็จ กรุณากดพิมพ์เอง: ${session.order_no}`
          : `Payment saved, but automatic receipt print failed. Please print manually: ${session.order_no}`
      );
    } catch {
      setReceiptAutoPrinted(false);
      pushSubmitMessage(
        lang === "th"
          ? `บันทึกชำระสำเร็จ แต่เชื่อมต่อเครื่องพิมพ์อัตโนมัติไม่ได้ กรุณากดพิมพ์เอง: ${session.order_no}`
          : `Payment saved, but automatic printer bridge was unavailable. Please print manually: ${session.order_no}`
      );
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  function runPostPaymentSideEffects(session: ReceiptSession) {
    if (session.payment_method === "cash") {
      void openCashDrawerAfterCashPayment(session.order_no);
    }

    window.setTimeout(() => {
      void autoPrintReceiptToWindowsRuntime(
        session,
        session.payment_method === "cash" ? "cash_payment_success" : "transfer_payment_success"
      );
    }, session.payment_method === "cash" ? 120 : 0);
  }
  const handleTableBrowserRetryLoad = useCallback(() => {
    void fetchPosTablesRef.current().catch((tableError) => {
      const message = tableError instanceof Error ? tableError.message : "Failed to load table layout.";
      if (isConnectivityIssueMessage(message)) {
        setIsOnline(false);
      }
      pushSubmitMessageRef.current(message);
    });
  }, []);

  function renderTableBrowser() {
    return (
      <PosTableBrowser
        lang={lang}
        text={text}
        tableLoadError={tableLoadError}
        tableLoading={tableLoading}
        visibleTables={visibleTables}
        visibleFloorObjects={visibleFloorObjects}
        tableViewMode={tableViewMode}
        setTableViewMode={updateTableViewMode}
        tableZones={tableZones}
        tableZoneFilter={tableZoneFilter}
        setTableZoneFilter={setTableZoneFilter}
        selectedTableId={selectedTable?.id ?? null}
        isBusy={isBusy}
        tableSwitching={tableSwitching}
        tableZoom={tableZoom}
        setTableZoom={setTableZoom}
        tablePan={tablePan}
        setTablePan={setTablePan}
        hideControls={showInlineTopbarTableControls}
        onRetryLoad={handleTableBrowserRetryLoad}
        onTablePrefetch={prefetchTableBillOnIntent}
        onSelectTable={(table) => {
          void selectTableFromBrowser(table);
        }}
      />
    );
  }

  function renderDeliveryApps() {
    return (
      <section className="posui-delivery-apps" aria-label={text.deliveryAppTitle}>
        <header className="posui-delivery-apps__header">
          <h3>{text.deliveryAppTitle}</h3>
          <p>{text.deliveryAppHint}</p>
        </header>
        <div className="posui-delivery-apps__grid" role="list">
          {deliveryApps.map((app) => {
            const isActive = selectedDeliveryApp === app.id;
            return (
              <button
                key={app.id}
                type="button"
                role="listitem"
                className={`posui-delivery-app-card app-${app.id} ${isActive ? "is-active" : ""}`}
                onClick={() => openDeliveryOrderPopup(app)}
              >
                <div className="posui-delivery-app-card__logo-wrap">
                  <Image
                    src={deliveryLogoFallback[app.id] ? app.logoFallback : app.logoOfficial}
                    alt={lang === "th" ? app.nameTh : app.nameEn}
                    className="posui-delivery-app-card__logo"
                    width={160}
                    height={72}
                    loading="lazy"
                    unoptimized
                    onError={() =>
                      setDeliveryLogoFallback((current) => ({
                        ...current,
                        [app.id]: true
                      }))
                    }
                  />
                </div>
                <strong>{lang === "th" ? app.nameTh : app.nameEn}</strong>
                <small>{app.orderPrefix}</small>
              </button>
            );
          })}
        </div>
        <section className="posui-delivery-meta">
          <header className="posui-delivery-meta__header">
            <h4>{text.deliveryMetaTitle}</h4>
            <p>{text.deliveryMetaHint}</p>
          </header>
          <footer className="posui-delivery-meta__footer">
            <p>
              {text.deliveryStateLabel}: <strong>{getDeliveryFlowLabel(deliveryFlowState)}</strong>
            </p>
            {selectedDeliveryApp && deliveryExternalCode.trim() ? (
              <p className="posui-delivery-meta__active-code">
                {text.externalCode}: <strong>{deliveryExternalCode}</strong>
              </p>
            ) : null}
          </footer>
        </section>
      </section>
    );
  }

  function renderCartContent() {
    return (
      <>
        {renderCartList()}
        <PosPaymentPanel
          subtotal={summaryDiscount}
          total={total}
          taxAmount={taxBreakdown.tax_total}
          taxLines={taxBreakdown.lines}
          onCheckout={handleCheckout}
          onRetry={showEmergencyRetry ? handleEmergencyRetry : undefined}
          onCancelBill={canCancelActiveOrder ? requestCancelBill : undefined}
          onHoldBill={holdBill}
          onMember={
            orderType === "delivery_manual"
              ? undefined
              : () => setMemberMaintenanceOpen(true)
          }
          onTableQrOrder={() => setTableQrModalOpen(true)}
          onPromotion={openDiscountPopup}
          onOpenCashDrawer={cashDrawerConfigured ? openCashDrawerManually : undefined}
          showHoldBill={quickMode === "home"}
          showTableQrOrder={
            orderType === "dine_in" &&
            !tableBrowserOpen &&
            Boolean(selectedTable?.id && selectedTable.active_session_id)
          }
          tableQrOrderLabel={text.tableQrOrder}
          checkoutLabel={orderType === "dine_in" ? text.dineInCheckout : orderType === "delivery_manual" ? text.deliveryQueueCheckout : text.checkout}
          checkoutDisabled={
            isBusy ||
            !shift?.id ||
            cart.length === 0 ||
            (orderType === "dine_in" && (!selectedTable || !selectedTable.active_session_id)) ||
            (orderType === "delivery_manual" && (!selectedDeliveryApp || !deliveryExternalCode.trim()))
          }
          submitting={isBusy}
          submittingLabel={text.submitting}
          retryDisabled={isBusy}
          pendingLabel={text.pendingSaved}
          message={submitMessage}
          pending={pendingSyncCount > 0}
          billNo={showSummaryBillNo ? activeBillNo : "-"}
          showBillNo={showSummaryBillNo}
          showPaymentMethod={showSummaryPaymentMethod}
          showModeStatus
          showStatus={showSummaryStatus}
          showDiscount={showSummaryDiscount}
          showTax={showSummaryTax}
          actionsDisabled={isBusy}
          openCashDrawerLabel={text.openCashDrawer}
          openingCashDrawerLabel={text.openingCashDrawer}
          openingCashDrawer={cashDrawerOpening}
          openCashDrawerDisabled={isBusy || cashDrawerCoolingDown}
          cancelBillDisabled={!canCancelFromSidebar}
          cancelLabel={undefined}
          transferVerificationLabel={text.transferVerificationSummaryLabel}
          transferVerificationBadge={
            latestSidebarTransferVerification
              ? {
                  label: getTransferVerificationStatusLabel(latestSidebarTransferVerification.verification_status),
                  tone: getTransferVerificationStatusTone(latestSidebarTransferVerification.verification_status)
                }
              : null
          }
          paymentMethodValue={getBillPaymentMethodLabel(sidebarPaymentMethod)}
          modeStatusValue={getQuickModeLabel()}
          memberSummary={
            selectedMember
              ? {
                  name: selectedMember.name,
                  code: selectedMember.member_token ?? selectedMember.id,
                  phone: selectedMember.phone,
                  points: selectedMember.points,
                  stamps: selectedMember.stamps
                }
              : null
          }
          text={{
            subtotal: text.subtotal,
            total: text.total,
            tax: text.tax,
            checkout: text.checkout,
            retry: text.retry,
            managerOverride: text.managerOverride,
            cancelBill: text.cancelBill,
            holdBill: text.holdBill,
            member: text.member,
            promotion: text.promotion,
            billNo: text.billNo,
            status: text.status,
            mode: text.modeLabel,
            paymentMethod: text.paymentMethod,
            statusValue: getStatusValue()
          }}
        />
      </>
    );
  }

  const modifierHasSelectedIngredient = modifierDraft ? hasSelectedIngredientInNotes(modifierDraft.notes, modifierIngredients) : false;
  const showInlineTopbarCategories = salesTopbarCollapsed && !showTableBrowser && !showDeliverySetup;
  const showInlineTopbarTableControls = salesTopbarCollapsed && showTableBrowser;

  function renderSalesCategoryNav() {
    if (showTableBrowser || showDeliverySetup) return null;
    return (
      <PosCategoryNav
        items={categories.map((category) => ({ id: category, label: category }))}
        activeId={activeCategory}
        onSelect={setActiveCategory}
        trailingActionLabel={text.manageMenu}
        onTrailingAction={() => setMenuManagerOpen(true)}
      />
    );
  }

  function renderTableBrowserControls() {
    if (!showTableBrowser) return null;
    return (
      <div className="posui-table-browser__controls-row posui-table-browser__controls-row--topbar">
        <div className="posui-table-browser__view-switch" role="tablist" aria-label={text.tableSelectTitle}>
          <button
            type="button"
            role="tab"
            className={`posui-chip posui-chip--dine-view ${lang === "th" ? "is-th" : ""} ${tableViewMode === "list" ? "is-active" : ""}`}
            onClick={() => updateTableViewMode("list")}
          >
            <span>{text.tableListMode}</span>
          </button>
          <button
            type="button"
            role="tab"
            className={`posui-chip posui-chip--dine-view ${lang === "th" ? "is-th" : ""} ${tableViewMode === "floor" ? "is-active" : ""}`}
            onClick={() => updateTableViewMode("floor")}
          >
            <span>{text.tableFloorMode}</span>
          </button>
        </div>
        <div className="posui-table-browser__zones-inline">
          <TableZoneTabs zones={tableZones} activeZoneId={tableZoneFilter} onChange={setTableZoneFilter} lang={lang} />
        </div>
      </div>
    );
  }

  return (
    <section className="posui-page" aria-busy={loading}>
      {error && !hasRenderableData && !needsLogin ? (
        <div className="surface" style={{ borderColor: "#d66", marginBottom: 12 }}>
          <h3 style={{ marginTop: 0 }}>Error</h3>
          <p>{error.includes("Request timeout") ? text.requestTimeout : error}</p>
          <button type="button" className="posui-btn" onClick={() => setReloadToken((current) => current + 1)} disabled={loading}>
            {text.retryLoad}
          </button>
        </div>
      ) : null}
      {needsLogin ? (
        <div className="surface" style={{ borderColor: "#93c5fd", marginBottom: 12 }}>
          <h3 style={{ marginTop: 0 }}>ต้องเข้าสู่ระบบก่อนใช้งาน POS</h3>
          <p style={{ marginTop: 8 }}>ยังไม่พบ POS session จากระบบล็อกอิน กรุณาเข้าสู่ระบบที่ ID App แล้วกลับมาหน้านี้</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <a href={idAppLoginUrl} className="posui-btn posui-btn--primary">
              ไปหน้า Login
            </a>
            <button type="button" className="posui-btn" onClick={() => setReloadToken((current) => current + 1)} disabled={loading}>
              ตรวจสอบอีกครั้ง
            </button>
          </div>
        </div>
      ) : null}

      <PosShell
        topBar={
          <div className={`posui-sales-topbar ${salesTopbarCollapsed ? "is-collapsed" : ""} ${showInlineTopbarCategories ? "has-inline-categories" : ""} ${showInlineTopbarTableControls ? "has-inline-table-controls" : ""}`}>
            <div className="posui-mode-header-row">
              <button
                type="button"
                className="posui-topbar-collapse-toggle"
                onClick={() => setSalesTopbarCollapsed((current) => !current)}
                aria-expanded={!salesTopbarCollapsed}
                aria-label={
                  salesTopbarCollapsed
                    ? lang === "th"
                      ? "ขยายแถบข้อมูลด้านบน"
                      : "Expand top information bar"
                    : lang === "th"
                      ? "หุบแถบข้อมูลด้านบน"
                      : "Collapse top information bar"
                }
                title={
                  salesTopbarCollapsed
                    ? lang === "th"
                      ? "ขยายแถบบน"
                      : "Expand top bar"
                    : lang === "th"
                      ? "หุบแถบบน"
                      : "Collapse top bar"
                }
              >
                <span className="posui-topbar-collapse-toggle__chevron" aria-hidden="true" />
              </button>
              <div className="posui-filter-group">
                <div className="posui-top-actions-card">
                  <button
                    type="button"
                    className="posui-mode-switch-button"
                    disabled={hasBlockingPaymentOverlay}
                    onClick={() => setModeSelectorOpen(true)}
                    aria-haspopup="dialog"
                    aria-label={`${text.switchMode}: ${getQuickModeLabel()}`}
                  >
                    <span className="posui-mode-switch-button__icon" aria-hidden="true">
                      <QuickModeIcon mode={quickMode === "buffet_table" ? "dine_in" : quickMode} />
                    </span>
                    <span className="posui-mode-switch-button__action">{text.switchMode}</span>
                  </button>
                  <div className="posui-mode-stack-meta">
                    {quickMode === "delivery" ? (
                      <button
                        type="button"
                        className="posui-held-bill-btn"
                        onClick={openHeldBillsPanel}
                        title={text.deliveryPendingBillsOpen}
                      >
                        {`${text.deliveryPendingBillsTitle}: ${heldBillPool.length}`}
                      </button>
                    ) : !isTableSalesMode(quickMode) ? (
                      <button
                        type="button"
                        className="posui-held-bill-btn"
                        onClick={openHeldBillsPanel}
                        title={text.heldBillsOpen}
                      >
                        {`${text.heldBills}: ${heldBillPool.length}`}
                      </button>
                    ) : null}
                    {isTableSalesMode(quickMode) ? (
                      <span className="posui-sales-status-item">
                        {text.tableLabel}: {selectedTable ? selectedTable.table_code : "-"}
                      </span>
                    ) : null}
                    {isTableSalesMode(quickMode) && selectedTable?.active_session_id ? (
                      <button
                        type="button"
                        className="posui-held-bill-btn"
                        onClick={() => {
                          setTableMoveTargetId("");
                          setTableMoveReason("");
                          setTableMoveError(null);
                          setTableMoveModalOpen(true);
                        }}
                        title={text.tableMove}
                        disabled={isBusy || tableMoveBusy}
                      >
                        {text.tableMove}
                      </button>
                    ) : null}
                    {isTableSalesMode(quickMode) && selectedTable && !tableBrowserOpen ? (
                      <button
                        type="button"
                        className="posui-held-bill-btn"
                        onClick={returnToDineInTableBrowserKeepingBill}
                        title={text.selectTable}
                        disabled={isBusy || tableSwitching}
                      >
                        {text.selectTable}
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
              <div className="posui-filter-group posui-sales-meta-group">
                <section className="posui-sales-meta-card" aria-label={text.salesInfoTitle}>
                  <div className="posui-sales-meta-columns">
                    <dl className="posui-sales-meta-list posui-sales-meta-list--left">
                      <div className="posui-sales-meta-row">
                        <dt>{text.sellerName}</dt>
                        <dd>{sellerName}</dd>
                      </div>
                      <div className="posui-sales-meta-row">
                        <dt>{text.shiftName}</dt>
                        <dd>{shift?.status ?? text.noShift}</dd>
                      </div>
                      <div className="posui-sales-meta-row">
                        <dt>{text.branchName}</dt>
                        <dd>{branchName}</dd>
                      </div>
                    </dl>
                    <dl className="posui-sales-meta-list posui-sales-meta-list--right">
                      <PosRealtimeClock lang={lang} dateLabel={text.date} timeLabel={text.time} />
                      <div className="posui-sales-meta-row">
                        <dt>{text.cashierDeviceCode}</dt>
                        <dd>{devicePolicy?.code || devicePolicy?.name || "-"}</dd>
                      </div>
                    </dl>
                  </div>
                </section>
              </div>
              {showInlineTopbarCategories ? <div className="posui-topbar-category-slot">{renderSalesCategoryNav()}</div> : null}
              {showInlineTopbarTableControls ? <div className="posui-topbar-table-slot">{renderTableBrowserControls()}</div> : null}
            </div>
          </div>
        }
        categoryNav={salesTopbarCollapsed ? null : renderSalesCategoryNav()}
        productGrid={
          showTableBrowser ? renderTableBrowser() : showDeliverySetup ? renderDeliveryApps() : (
            <PosProductCatalog
              products={visibleProducts}
              isDeliveryMode={orderType === "delivery_manual"}
              storefrontPriceLabel={text.storefrontPriceLabel}
              stockRemainingLabel={text.productStockRemaining}
              outOfStockLabel={text.productOutOfStock}
              getProductPrice={getProductPriceForCurrentMode}
              onAddProduct={addToCart}
            />
          )
        }
        cartPanel={
          <PosCartPanel title={text.cart} itemCount={cart.length} onClear={clearCart} clearLabel={text.clear} itemsLabel={text.items}>
            {renderCartContent()}
          </PosCartPanel>
        }
        cartSummaryBar={
          <button type="button" className="posui-cart-summary-button" onClick={() => setCartDrawerOpen(true)}>
            <span>
              {text.cartSummary} {cart.length} {text.items}
            </span>
            <strong>{formatMoney(total)}</strong>
          </button>
        }
        cartDrawer={
          <PosCartDrawer open={cartDrawerOpen} title={text.cartDrawerTitle} closeLabel={text.close} onClose={() => setCartDrawerOpen(false)}>
            <PosCartPanel title={text.cart} itemCount={cart.length} onClear={clearCart} clearLabel={text.clear} itemsLabel={text.items}>
              {renderCartContent()}
            </PosCartPanel>
          </PosCartDrawer>
        }
      />

      <PosMemberMaintenanceModal open={memberMaintenanceOpen} lang={lang} onClose={() => setMemberMaintenanceOpen(false)} />

      {memberPickerOpen ? (
        <div className="posui-payment-modal-backdrop" role="dialog" aria-modal="true" aria-label={text.member} onClick={() => setMemberPickerOpen(false)}>
          <section className="posui-payment-modal posui-payment-modal--review" onClick={(event) => event.stopPropagation()}>
            <header className="posui-payment-modal__header">
              <h3>{lang === "th" ? "เลือกสมาชิก" : "Select Member"}</h3>
              <button type="button" className="posui-btn" onClick={() => setMemberPickerOpen(false)}>
                {text.close}
              </button>
            </header>
            <div className="grid gap-3">
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                <input
                  value={memberSearch}
                  onChange={(event) => setMemberSearch(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void searchMembers(memberSearch);
                  }}
                  placeholder={lang === "th" ? "ค้นหาชื่อ เบอร์โทร หรือรหัสสมาชิก" : "Search name, phone, or member code"}
                  className="posui-payment-modal__input"
                />
                <button type="button" className="posui-btn posui-btn--primary" onClick={() => void searchMembers(memberSearch)} disabled={memberSearchLoading}>
                  {memberSearchLoading ? "..." : lang === "th" ? "ค้นหา" : "Search"}
                </button>
                <button type="button" className="posui-btn" onClick={() => setMemberSearch("")}>
                  {lang === "th" ? "สแกน QR" : "Scan QR"}
                </button>
              </div>
              {memberSearchError ? <p className="posui-payment-modal__error">{memberSearchError}</p> : null}
              <div className="grid max-h-56 gap-2 overflow-y-auto">
                {memberSearchResults.length === 0 && !memberSearchLoading ? <p className="posui-payment-modal__hint">{lang === "th" ? "ยังไม่พบสมาชิก" : "No members found."}</p> : null}
                {memberSearchResults.map((member) => {
                  const active = selectedMember?.id === member.id;
                  return (
                    <button
                      key={member.id}
                      type="button"
                      onClick={() => chooseMember(member)}
                      className={`grid grid-cols-[minmax(0,1fr)_auto] gap-2 rounded-lg border p-3 text-left ${active ? "border-blue-300 bg-blue-50" : "border-slate-200 bg-white hover:bg-slate-50"}`}
                    >
                      <span className="min-w-0">
                        <strong className="block truncate text-sm text-slate-950">{member.name}</strong>
                        <small className="block truncate text-xs font-bold text-slate-500">
                          {(member.member_token ?? member.id).slice(0, 16)} / {member.phone}
                        </small>
                      </span>
                      <span className="text-right text-xs font-black text-slate-700">
                        {member.points} {lang === "th" ? "คะแนน" : "pts"} / {member.stamps} {lang === "th" ? "แต้ม" : "stamps"}
                      </span>
                    </button>
                  );
                })}
              </div>
              {selectedMember ? (
                <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="m-0 text-sm font-black text-slate-950">
                    {selectedMember.name} / {(selectedMember.member_token ?? selectedMember.id).slice(0, 16)}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="posui-payment-modal__input-label">
                      {lang === "th" ? "คะแนน" : "Points"}
                      <input value={memberPointsInput} onChange={(event) => setMemberPointsInput(event.target.value)} inputMode="numeric" className="posui-payment-modal__input" />
                    </label>
                    <label className="posui-payment-modal__input-label">
                      {lang === "th" ? "แต้ม" : "Stamps"}
                      <input value={memberStampsInput} onChange={(event) => setMemberStampsInput(event.target.value)} inputMode="numeric" className="posui-payment-modal__input" />
                    </label>
                  </div>
                </div>
              ) : null}
            </div>
            <div className="posui-payment-modal__actions">
              <button type="button" className="posui-btn" onClick={() => setSelectedMember(null)}>
                {lang === "th" ? "ล้างสมาชิก" : "Clear member"}
              </button>
              <button type="button" className="posui-btn posui-btn--primary" onClick={saveMemberSelection} disabled={!selectedMember}>
                {lang === "th" ? "บันทึกสมาชิกในบิล" : "Save member to bill"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {menuManagerOpen ? (
        <div className="posui-payment-modal-backdrop" role="dialog" aria-modal="true" aria-label={text.manageMenu} onClick={() => setMenuManagerOpen(false)}>
          <section className="posui-menu-manager" onClick={(event) => event.stopPropagation()}>
            <header className="posui-menu-manager__header">
              <div>
                <h3>{text.manageMenu}</h3>
                <p>{lang === "th" ? "จัดลำดับสินค้าบนหน้าขายเท่านั้น ไม่กระทบสต๊อกหรือสูตรวัตถุดิบ" : "Sort POS menu display only. Stock and recipes are unchanged."}</p>
              </div>
              <button type="button" className="posui-btn" onClick={() => setMenuManagerOpen(false)}>
                {text.close}
              </button>
            </header>
            <div className="posui-menu-manager__tools">
              <strong>{activeCategory || (lang === "th" ? "ทุกหมวดหมู่" : "All categories")}</strong>
              <button type="button" className="posui-btn" onClick={resetMenuOrder}>
                {lang === "th" ? "รีเซ็ตลำดับ" : "Reset order"}
              </button>
            </div>
            <div className="posui-menu-manager__list">
              {visibleProducts.map((product, index) => (
                <article key={`menu-sort-${product.id}`} className="posui-menu-manager__item">
                  <span className="posui-menu-manager__rank">{index + 1}</span>
                  <div>
                    <strong>{product.name}</strong>
                    <small>{product.sku}</small>
                  </div>
                  <div className="posui-menu-manager__actions">
                    <button type="button" className="posui-icon-btn" disabled={index === 0} onClick={() => moveMenuProduct(product.id, -1)} aria-label={lang === "th" ? "เลื่อนขึ้น" : "Move up"}>
                      ↑
                    </button>
                    <button type="button" className="posui-icon-btn" disabled={index === visibleProducts.length - 1} onClick={() => moveMenuProduct(product.id, 1)} aria-label={lang === "th" ? "เลื่อนลง" : "Move down"}>
                      ↓
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>
      ) : null}

      {modeSelectorOpen ? (
        <div
          className="posui-mode-selector-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pos-mode-selector-title"
          onClick={() => setModeSelectorOpen(false)}
        >
          <section className="posui-mode-selector" onClick={(event) => event.stopPropagation()}>
            <header className="posui-mode-selector__header">
              <div>
                <p>{text.switchMode}</p>
                <h2 id="pos-mode-selector-title">{text.selectMode}</h2>
                <span>{text.selectModeHint}</span>
              </div>
              <button
                type="button"
                className="posui-mode-selector__close"
                onClick={() => setModeSelectorOpen(false)}
                aria-label={text.close}
                title={text.close}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M18 6 6 18M6 6l12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </header>
            <div className="posui-mode-selector__grid">
              <button
                type="button"
                className={`posui-mode-option ${quickMode === "home" ? "is-active" : ""}`}
                onClick={() => selectQuickMode("home")}
              >
                <span className="posui-mode-option__icon" aria-hidden="true">
                  <QuickModeIcon mode="home" />
                </span>
                <span className="posui-mode-option__copy">
                  <strong>{text.goHome}</strong>
                  <small>{lang === "th" ? "รับกลับ ไม่ใช้โต๊ะ" : "Takeaway order"}</small>
                </span>
                <span className="posui-mode-option__check" aria-hidden="true">✓</span>
              </button>
              <button
                type="button"
                className={`posui-mode-option ${quickMode === "dine_in" ? "is-active" : ""} ${isQuickModeLocked("dine_in") ? "is-locked" : ""}`}
                onClick={() => selectQuickMode("dine_in")}
                aria-disabled={isQuickModeLocked("dine_in")}
                title={isQuickModeLocked("dine_in") ? (lang === "th" ? "แพ็กเกจปัจจุบันยังไม่เปิดใช้งานฟีเจอร์นี้" : "This feature is not enabled in your package") : undefined}
              >
                <span className="posui-mode-option__icon" aria-hidden="true">
                  <QuickModeIcon mode="dine_in" />
                </span>
                <span className="posui-mode-option__copy">
                  <strong>{text.dineIn}</strong>
                  <small>{lang === "th" ? "เลือกโต๊ะและเปิดบิล" : "Select table and open bill"}</small>
                </span>
                <span className="posui-mode-option__check" aria-hidden="true">✓</span>
              </button>
              <PosBuffetTableModeButton
                label={lang === "th" ? "โต๊ะบุฟเฟ่" : "Buffet table"}
                hint={lang === "th" ? "เปิดโต๊ะแล้วเลือกชุดราคาบุฟเฟ่" : "Open table and select buffet price"}
                active={quickMode === "buffet_table"}
                locked={isQuickModeLocked("buffet_table")}
                lockTitle={isQuickModeLocked("buffet_table") ? (lang === "th" ? "แพ็กเกจปัจจุบันยังไม่เปิดใช้งานฟีเจอร์นี้" : "This feature is not enabled in your package") : undefined}
                icon={<QuickModeIcon mode="dine_in" />}
                onClick={() => selectQuickMode("buffet_table")}
              />
              <button
                type="button"
                className={`posui-mode-option ${quickMode === "delivery" ? "is-active" : ""} ${isQuickModeLocked("delivery") ? "is-locked" : ""}`}
                onClick={() => selectQuickMode("delivery")}
                aria-disabled={isQuickModeLocked("delivery")}
                title={isQuickModeLocked("delivery") ? (lang === "th" ? "แพ็กเกจปัจจุบันยังไม่เปิดใช้งานฟีเจอร์นี้" : "This feature is not enabled in your package") : undefined}
              >
                <span className="posui-mode-option__icon" aria-hidden="true">
                  <QuickModeIcon mode="delivery" />
                </span>
                <span className="posui-mode-option__copy">
                  <strong>{text.delivery}</strong>
                  <small>{lang === "th" ? "รับออเดอร์จากแอป" : "Delivery app order"}</small>
                </span>
                <span className="posui-mode-option__check" aria-hidden="true">✓</span>
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {devicePolicy && deviceSalesBlocked ? (
        <PosDeviceBlockedOverlay
          devicePolicy={devicePolicy}
          lang={lang}
          text={text}
          onRetry={() => setReloadToken((current) => current + 1)}
        />
      ) : null}

      {discountModalOpen ? (
        <div className="posui-payment-modal-backdrop" role="dialog" aria-modal="true" aria-label={text.discountPopupTitle}>
          <section className="posui-payment-modal posui-payment-modal--cash posui-discount-popup" onClick={(event) => event.stopPropagation()}>
            <header className="posui-payment-modal__header">
              <h3>{text.discountPopupTitle}</h3>
              <button type="button" className="posui-btn" onClick={closeDiscountPopup}>
                {text.close}
              </button>
            </header>
            <p className="posui-payment-modal__hint">{text.discountPopupHint}</p>
            <div className="posui-discount-popup__fields">
              <label className="posui-payment-modal__input-label" htmlFor="pos-discount-percent">
                {text.discountPercentLabel}
              </label>
              <input
                id="pos-discount-percent"
                className="posui-payment-modal__input"
                type="text"
                inputMode="decimal"
                value={discountPercentInput}
                onChange={(event) => handleDiscountPercentInputChange(event.target.value)}
                placeholder="0"
              />
              <label className="posui-payment-modal__input-label" htmlFor="pos-discount-amount">
                {text.discountAmountLabel}
              </label>
              <input
                id="pos-discount-amount"
                className="posui-payment-modal__input"
                type="text"
                inputMode="decimal"
                value={discountAmountInput}
                onChange={(event) => handleDiscountAmountInputChange(event.target.value)}
                placeholder="0.00"
              />
              <p className="posui-discount-popup__preview">
                <span>{text.total}</span>
                <strong>{formatMoney(total)}</strong>
              </p>
            </div>
            <div className="posui-payment-modal__actions posui-discount-popup__actions">
              <button type="button" className="posui-btn" onClick={clearDiscount}>
                {text.discountClear}
              </button>
              <button type="button" className="posui-btn posui-btn--primary" onClick={applyDiscountPopup}>
                {text.discountApply}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {deliveryPopupApp ? (
        <div className="posui-payment-modal-backdrop" role="dialog" aria-modal="true" aria-label={text.deliveryMetaTitle}>
          <section className="posui-payment-modal posui-payment-modal--review posui-delivery-order-popup" onClick={(event) => event.stopPropagation()}>
            <header className="posui-payment-modal__header">
              <h3>{text.deliveryMetaTitle}</h3>
              <button
                type="button"
                className="posui-btn"
                onClick={() => {
                  setDeliveryPopupAppId(null);
                  setDeliveryPopupCodeDigits("");
                  setDeliveryPopupNotes("");
                }}
              >
                {text.close}
              </button>
            </header>
            <p className="posui-payment-modal__hint">{text.deliveryMetaHint}</p>
            <div className="posui-delivery-order-popup__content">
              <label className="posui-delivery-meta__field">
                <span>{text.externalCode}</span>
                <div className="posui-delivery-order-popup__code-wrap">
                  <span className="posui-delivery-order-popup__prefix">{deliveryPopupApp.orderPrefix}-</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    autoComplete="off"
                    value={deliveryPopupCodeDigits}
                    onChange={(event) => setDeliveryPopupCodeDigits(event.target.value.replace(/\D/g, ""))}
                    placeholder={text.deliveryOrderCodeDigitsLabel}
                  />
                </div>
              </label>
              <label className="posui-delivery-meta__field posui-delivery-meta__field--full">
                <span>{text.notes}</span>
                <textarea
                  value={deliveryPopupNotes}
                  onChange={(event) => setDeliveryPopupNotes(event.target.value)}
                  placeholder={text.notesPlaceholder}
                  rows={3}
                />
              </label>
            </div>
            <div className="posui-payment-modal__actions">
              <button type="button" className="posui-btn posui-btn--primary" onClick={confirmDeliveryOrderPopup}>
                {text.deliveryOpenOrder}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {stockAdjustError ? <ErrorState message={stockAdjustError} /> : null}

      {outOfStockNotice ? (
        <div className="posui-payment-modal-backdrop" role="alertdialog" aria-modal="true" aria-label={text.productOutOfStock}>
          <section className="posui-payment-modal posui-payment-modal--stock-alert" onClick={(event) => event.stopPropagation()}>
            <div className="posui-stock-alert__mark" aria-hidden="true">!</div>
            <div className="posui-stock-alert__content">
              <h3>{text.productOutOfStock}</h3>
              <p>{text.productOutOfStockBody}</p>
              <strong>{outOfStockNotice.productName}</strong>
            </div>
            <div className="posui-payment-modal__actions posui-stock-alert__actions">
              <button type="button" className="posui-btn posui-btn--primary" onClick={() => setOutOfStockNotice(null)} autoFocus>
                {text.productOutOfStockOk}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {tableMoveModalOpen ? (
        <div className="posui-payment-modal-backdrop" role="dialog" aria-modal="true" aria-label={text.tableMoveTitle}>
          <section className="posui-payment-modal posui-payment-modal--review posui-payment-modal--table-move" onClick={(event) => event.stopPropagation()}>
            <header className="posui-payment-modal__header">
              <h3>{text.tableMoveTitle}</h3>
              <button
                type="button"
                className="posui-btn"
                disabled={tableMoveBusy}
                onClick={() => {
                  setTableMoveModalOpen(false);
                  setTableMoveError(null);
                }}
              >
                {text.close}
              </button>
            </header>
            <p className="posui-payment-modal__hint">{text.tableMoveHint}</p>
            <div className="posui-payment-receipt-card">
              <label className="posui-payment-modal__input-label">{text.tableMoveTargetLabel}</label>
              <div className="posui-table-move-grid" role="list" aria-label={text.tableMoveTargetLabel}>
                {moveTableCandidates.map((table) => {
                  const isSelected = tableMoveTargetId === table.id;
                  const zoneName = tableZoneNameMap.get(table.zone_id ?? "") ?? "-";
                  return (
                    <button
                      key={table.id}
                      type="button"
                      aria-pressed={isSelected}
                      className={`posui-table-move-card ${isSelected ? "is-selected" : ""}`}
                      disabled={tableMoveBusy}
                      onPointerEnter={() => prefetchTableBillOnIntent(table)}
                      onPointerMove={applyMoveTableCardDepthCue}
                      onPointerLeave={resetMoveTableCardDepthCue}
                      onClick={() => {
                        setTableMoveTargetId(table.id);
                        setTableMoveError(null);
                      }}
                    >
                      <span className="posui-table-move-card__glass" aria-hidden="true" />
                      <strong>{table.table_code}</strong>
                      <small>{table.table_name?.trim() || "-"}</small>
                      <em>{zoneName}</em>
                    </button>
                  );
                })}
              </div>
              {moveTableCandidates.length === 0 ? <p className="posui-payment-modal__hint">{text.tableMoveNoAvailable}</p> : null}

              <label className="posui-payment-modal__input-label" htmlFor="table-move-reason">
                {text.tableMoveReasonLabel}
              </label>
              <input
                id="table-move-reason"
                className="posui-payment-modal__input"
                value={tableMoveReason}
                disabled={tableMoveBusy}
                onChange={(event) => setTableMoveReason(event.target.value)}
              />
              {tableMoveError ? <p className="posui-payment-modal__error">{tableMoveError}</p> : null}
            </div>
            <div className="posui-payment-modal__actions">
              <button
                type="button"
                className="posui-btn posui-btn--primary"
                disabled={tableMoveBusy || !tableMoveTargetId}
                onClick={() => {
                  if (!tableMoveTargetId) {
                    setTableMoveError(text.tableMoveNoTarget);
                    return;
                  }
                  setTableMoveError(null);
                  void submitMoveTable();
                }}
              >
                {tableMoveBusy ? text.tableMoveSubmitting : text.tableMoveConfirm}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      <PosManagerApprovalModal
        open={cancelBillApprovalOpen && Boolean(cancelBillTargetOrder?.id)}
        title={text.cancelBillApprovalTitle}
        action="cancel_bill"
        targetTable="orders"
        targetId={cancelBillTargetOrder?.id ?? "00000000-0000-0000-0000-000000000000"}
        lang={lang}
        labels={{
          pinLabel: text.pinModalLabel,
          pinKeypadHint: text.pinModalHint,
          pinLengthError: text.pinModalPinLengthError,
          pinRejected: text.pinModalPinRejected,
          checkingAccess: text.pinModalCheckingAccess,
          clear: text.pinModalClear,
          remove: text.pinModalRemove,
          closeAriaLabel: text.pinModalCloseAria
        }}
        onClose={() => {
          setCancelBillApprovalOpen(false);
          setCancelBillTargetOrder(null);
        }}
        onApproved={(approvalId) => {
          const targetOrder = cancelBillTargetOrder;
          setCancelBillApprovalOpen(false);
          setCancelBillTargetOrder(null);
          if (!targetOrder) return;
          void cancelActiveOrder(targetOrder, approvalId);
        }}
      />

      {cashNoticeMessage ? (
        <div className="fixed inset-0 z-[220] grid place-items-center bg-slate-950/55 p-4 backdrop-blur-sm">
          <section className="w-[min(420px,92vw)] rounded-3xl border border-slate-200 bg-white p-5 shadow-2xl">
            <div className="grid gap-2">
              <h3 className="text-lg font-black text-slate-950">
                {lang === "th" ? "แจ้งเตือนการชำระเงิน" : "Payment notice"}
              </h3>
              <p className="text-sm font-semibold text-slate-600">{cashNoticeMessage}</p>
            </div>
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setCashNoticeMessage(null)}
                className="h-11 rounded-2xl bg-blue-600 px-5 text-sm font-black text-white shadow-sm hover:bg-blue-700"
              >
                {lang === "th" ? "ตกลง" : "OK"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      <PosManagerApprovalModal
        open={stockModalOpen}
        title={text.managerOverrideTitle}
        action="stock_adjustment"
        targetTable="stock_movements"
        targetId={stockTargetId || "stock-adjustment"}
        lang={lang}
        labels={{
          pinLabel: text.pinModalLabel,
          pinKeypadHint: text.pinModalHint,
          pinLengthError: text.pinModalPinLengthError,
          pinRejected: text.pinModalPinRejected,
          checkingAccess: text.pinModalCheckingAccess,
          clear: text.pinModalClear,
          remove: text.pinModalRemove,
          closeAriaLabel: text.pinModalCloseAria
        }}
        onClose={() => {
          setStockModalOpen(false);
          setStockTargetId("");
          setStockApprovalId(null);
        }}
        onApproved={(approvalId) => {
          setStockApprovalId(approvalId);
          const ingredientId = prompt("ingredient_id");
          const qty = prompt("quantity_delta");
          const reason = prompt("reason");
          if (!ingredientId || !qty || !reason) return;
          const formData = new FormData();
          formData.set("ingredient_id", ingredientId);
          formData.set("quantity_delta", qty);
          formData.set("reason", reason);
          void submitStockAdjustment(formData);
        }}
      />
      <PosManagerApprovalModal
        open={transferOverrideModalOpen && Boolean(transferReviewOrder)}
        title={text.transferOverrideTitle}
        action="transfer_payment_override"
        targetTable="orders"
        targetId={transferReviewOrder?.order_id ?? "00000000-0000-0000-0000-000000000000"}
        lang={lang}
        labels={{
          pinLabel: text.pinModalLabel,
          pinKeypadHint: text.pinModalHint,
          pinLengthError: text.pinModalPinLengthError,
          pinRejected: text.pinModalPinRejected,
          checkingAccess: text.pinModalCheckingAccess,
          clear: text.pinModalClear,
          remove: text.pinModalRemove,
          closeAriaLabel: text.pinModalCloseAria
        }}
        onClose={() => setTransferOverrideModalOpen(false)}
        onApproved={(approvalId) => {
          setTransferOverrideApprovalId(approvalId);
          setTransferOverrideModalOpen(false);
          setTransferError(null);
        }}
      />
      <PosPaymentModals
          text={text}
          lang={lang}
          shiftStatus={shift?.status}
          sellerName={sellerName}
          quickMode={quickMode === "buffet_table" ? "dine_in" : quickMode}
          receiptLogoPath={receiptLogoPath}
          receiptStoreName={receiptStoreName}
          receiptStoreAddress={receiptStoreAddress}
          receiptStorePhone={receiptStorePhone}
          receiptBranchLabel={receiptBranchLabel}
          takeawayCreatingPreview={takeawayCreatingPreview}
          reviewOrder={reviewOrder}
          cashReviewOrder={cashReviewOrder}
          transferReviewOrder={transferReviewOrder}
          receiptSession={receiptSession}
          receiptSaving={receiptSaving}
          cashSubmitting={cashSubmitting}
          transferSubmitting={transferSubmitting}
          transferSlipChecking={transferSlipChecking}
          transferSlipFile={transferSlipFile}
          transferSlipPreviewUrl={transferSlipPreviewUrl}
          transferSlipParsed={transferSlipParsed}
          transferSlipChecks={transferSlipChecks}
          transferSlipIssues={transferSlipIssues}
          transferSlipVerified={transferSlipVerified}
          transferSlipReverifyRequired={transferSlipReverifyRequired}
          transferNeedsOverride={transferNeedsOverride}
          transferCanSubmit={transferCanSubmit}
          transferError={transferError}
          transferReference={transferReference}
          transferPaymentMode={visibleTransferPaymentMode}
          inetQrEnabled={inetQrEnabled}
          inetQrUrl={inetQrUrl}
          inetQrStatus={inetQrStatus}
          inetProviderOrderId={inetPaymentIntent?.provider_order_id ?? null}
          promptPayQrUrl={promptPayQrUrl}
          promptPayPhoneDisplay={promptPayPhoneDisplay}
          promptPayQrMode={activePaymentQrMode}
          paymentAccountLabel={
            paymentAccount
              ? [paymentAccount.bank_name, paymentAccount.account_name, paymentAccount.account_number].filter(Boolean).join(" / ")
              : ""
          }
          expectedPayeeName={expectedPayeeName}
          transferVerificationHistory={transferVerificationHistory}
          cashReceivedInput={cashReceivedInput}
          cashReceivedDisplay={cashReceivedDisplay}
          cashDiff={cashDiff}
          cashQuickAmounts={cashQuickAmounts}
          cashKeypadKeys={cashKeypadKeys}
          cashError={cashError}
          cashConfirmNeedsAttention={cashConfirmNeedsAttention}
          transferSlipInputRef={transferSlipInputRef}
          formatMoney={formatMoney}
          formatQuantity={formatQuantity}
          formatReceiptDateTime={formatReceiptDateTime}
          renderExternalOrderCode={renderExternalOrderCode}
          renderDineInPaymentIdentity={renderDineInPaymentIdentity}
          getQuickModeLabel={getQuickModeLabel}
          getReceiptPaymentMethodLabel={getReceiptPaymentMethodLabel}
          getTransferVerificationStatusTone={getTransferVerificationStatusTone}
          getTransferVerificationStatusLabel={getTransferVerificationStatusLabel}
          canDeductIngredientForItem={canDeductIngredientForItem}
          ingredientDeductingKey={reviewItemDeductingKey}
          ingredientDeductingMode={reviewItemDeductingMode}
        normalizeTransferVerificationIssues={normalizeTransferVerificationIssues}
        onCloseReview={closeCheckoutReviewPopup}
        onCancelFromReview={requestCancelBillFromReview}
        onCancelFromCash={requestCancelBillFromCash}
        onCancelFromTransfer={requestCancelBillFromReview}
        onDeductIngredientForItem={openIngredientAdjustDialog}
        onOpenCash={openCashPaymentPopup}
          onOpenTransfer={openTransferPaymentPopup}
          onCloseCash={closeCashPaymentPopup}
          onConfirmCash={confirmCashPayment}
          onApplyQuickCashAmount={applyQuickCashAmount}
          onAppendCashKeypadValue={appendCashKeypadValue}
          onClearCashInput={clearCashInput}
          onBackspaceCashInput={backspaceCashInput}
          onCloseTransfer={closeTransferPaymentPopup}
          onSelectTransferPaymentMode={selectTransferPaymentMode}
          onCreateInetQrPayment={createInetQrPayment}
          onTransferSlipFileChange={handleTransferSlipFileChange}
          onVerifyTransferSlip={verifyTransferSlip}
          onRequestTransferOverride={() => setTransferOverrideModalOpen(true)}
          onTransferReferenceChange={setTransferReference}
          onConfirmTransfer={confirmTransferPayment}
          onPrintReceipt={handleReceiptPrint}
          onCloseReceipt={closeReceiptPopup}
          receiptAutoPrinted={receiptAutoPrinted}
      />

      {ingredientAdjustDialog ? (
        <div
          className="posui-payment-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={text.reviewItemIngredientModalTitle}
          onClick={closeIngredientAdjustDialog}
        >
          <section
            className="posui-payment-modal posui-payment-modal--ingredient-adjust"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="posui-payment-modal__header">
              <h3>{text.reviewItemIngredientModalTitle}</h3>
              <button type="button" className="posui-btn" onClick={closeIngredientAdjustDialog} disabled={ingredientAdjustBusy}>
                {text.close}
              </button>
            </header>
            <p className="posui-payment-modal__hint">{text.reviewItemIngredientModalHint}</p>
            <div className="posui-ingredient-adjust__item-card">
              <strong>{ingredientAdjustDialog.item.name}</strong>
              <span>
                {text.reviewQtyPriceLabel}: {formatQuantity(ingredientAdjustDialog.item.quantity)} x {formatMoney(ingredientAdjustDialog.item.price)}
              </span>
            </div>
            <div className="posui-ingredient-adjust__mode-group">
              <p>{text.reviewItemIngredientSelectHint}</p>
              {ingredientAdjustLoading ? <small>{text.reviewItemIngredientLoading}</small> : null}
              {ingredientAdjustError ? <small className="posui-ingredient-adjust__error">{ingredientAdjustError}</small> : null}
              {!ingredientAdjustLoading && !ingredientAdjustError ? (
                ingredientAdjustOptions.length > 0 ? (
                  <div className="posui-ingredient-adjust__options">
                    {ingredientAdjustOptions.map((option) => {
                      const optionId = String(option.ingredient_id);
                      const checked = ingredientAdjustSelectedSet.has(optionId);
                      return (
                        <label key={optionId} className="posui-ingredient-adjust__option-row">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setIngredientAdjustSelectedIds((current) =>
                                checked ? current.filter((entry) => entry !== optionId) : [...current, optionId]
                              )
                            }
                            disabled={ingredientAdjustBusy}
                          />
                          <div>
                            <strong>{option.ingredient_name || optionId}</strong>
                            <span>
                              {text.reviewItemIngredientRequiredGrams}: {option.required_grams} g
                            </span>
                            <span>
                              {text.reviewItemIngredientAvailableGrams}: {Number(option.available_grams ?? 0)} g
                            </span>
                            <span>
                              {text.reviewItemIngredientRestorableGrams}: {Number(option.restorable_grams ?? 0)} g
                            </span>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                ) : (
                  <small>{text.reviewItemIngredientNone}</small>
                )
              ) : null}
            </div>
            <div className="posui-ingredient-adjust__actions">
              <button type="button" className="posui-btn posui-btn--ghost" onClick={closeIngredientAdjustDialog} disabled={ingredientAdjustBusy}>
                {text.close}
              </button>
              <button
                type="button"
                className="posui-btn posui-btn--primary"
                onClick={() => void confirmIngredientAdjustDialog("deduct")}
                disabled={ingredientAdjustBusy || ingredientAdjustLoading || !ingredientAdjustCanDeduct}
              >
                {ingredientAdjustBusy && reviewItemDeductingMode === "deduct"
                  ? text.reviewItemIngredientDeducting
                  : text.reviewItemIngredientDeductSelected}
              </button>
              <button
                type="button"
                className="posui-btn posui-btn--ghost"
                onClick={() => void confirmIngredientAdjustDialog("restore")}
                disabled={ingredientAdjustBusy || ingredientAdjustLoading || !ingredientAdjustCanRestore}
              >
                {ingredientAdjustBusy && reviewItemDeductingMode === "restore"
                  ? text.reviewItemIngredientRestoring
                  : text.reviewItemIngredientRestoreSelected}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {receiptSession ? (
        <section className="posui-print-receipt-root" aria-hidden="true">
          <article className="posui-print-receipt58">
            <header className="posui-print-receipt58__head">
              <Image
                src={receiptLogoPath}
                alt="Receipt logo"
                className="posui-print-receipt58__logo"
                width={196}
                height={78}
                unoptimized
                onError={(event) => {
                  event.currentTarget.src = receiptFallbackLogoPath;
                }}
              />
              <h1>{receiptStoreName}</h1>
              {receiptStoreAddress ? <p>{receiptStoreAddress}</p> : null}
              {receiptStorePhone ? <p>{receiptStorePhone}</p> : null}
              <p>{receiptBranchLabel}</p>
            </header>
            <div className="posui-print-receipt58__divider" />
            <dl className="posui-print-receipt58__meta">
              <div>
                <dt>{text.sellerName}</dt>
                <dd>{sellerName}</dd>
              </div>
              <div>
                <dt>{text.shiftName}</dt>
                <dd>{shift?.status ?? "-"}</dd>
              </div>
              <div>
                <dt>{text.modeLabel}</dt>
                <dd>{getQuickModeLabel()}</dd>
              </div>
              <div>
                <dt>{text.billNo}</dt>
                <dd>{receiptSession.order_no}</dd>
              </div>
              {receiptSession.external_order_code ? (
                <div>
                  <dt>{text.externalCode}</dt>
                  <dd>{receiptSession.external_order_code}</dd>
                </div>
              ) : null}
              {getReceiptMemberLabel(receiptSession) ? (
                <div>
                  <dt>{text.member}</dt>
                  <dd>{getReceiptMemberLabel(receiptSession)}</dd>
                </div>
              ) : null}
              <div>
                <dt>{text.date}</dt>
                <dd>{formatReceiptDateTime(receiptSession.created_at, lang)}</dd>
              </div>
            </dl>
            <div className="posui-print-receipt58__divider" />
            <table className="posui-print-receipt58__table">
              <tbody>
                {receiptSession.items.map((item) => {
                  const details = parseReceiptItemDetails(item.notes);
                  return (
                    <tr key={`print-${receiptSession.order_id}-${item.product_id}-${item.notes ?? ""}`}>
                      <td>
                        <div className="name">{item.name}</div>
                        <div className="unit">x {formatMoney(item.price)}</div>
                        {details.choices.map((choice) => (
                          <div key={`print-choice-${item.product_id}-${choice}`} className="choice">+ {choice}</div>
                        ))}
                        {details.note ? <div className="note">{text.notes}: {details.note}</div> : null}
                      </td>
                      <td>{formatQuantity(item.quantity)}</td>
                      <td>{formatMoney(item.quantity * item.price)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="posui-print-receipt58__divider" />
            <div className="posui-print-receipt58__summary">
              <p className="is-heading">
                <span>{text.paymentMethod}</span>
                <strong>{getReceiptPaymentMethodLabel(receiptSession)}</strong>
              </p>
              <p className="is-muted">
                <span>{text.discount}</span>
                <strong>{formatMoney(receiptDiscountAmount)}</strong>
              </p>
              {receiptTaxLines.map((line) => (
                <p key={`receipt-tax-${line.id}`} className="is-muted">
                  <span>{line.label}</span>
                  <strong>
                    {line.amount < 0 ? "-" : "+"}
                    {formatMoney(Math.abs(line.amount))}
                  </strong>
                </p>
              ))}
              <p className="is-due">
                <span>{text.paymentTotalDue}</span>
                <strong>{formatMoney(receiptSession.total_amount)}</strong>
              </p>
              {receiptSession.payment_method === "cash" ? (
                <>
                  <p className="is-aux">
                    <span>{text.cashReceivedLabel}</span>
                    <strong>{formatMoney(receiptSession.cash_received)}</strong>
                  </p>
                  <p className="is-aux">
                    <span>{text.cashChange}</span>
                    <strong>{formatMoney(receiptSession.change_amount)}</strong>
                  </p>
                </>
              ) : null}
            </div>
            <div className="posui-print-receipt58__divider" />
            <p className="posui-print-receipt58__footer">CpIPOS</p>
          </article>
        </section>
      ) : null}

      <PosBuffetPricePickerModal
        open={buffetPicker.open}
        lang={lang}
        tableCode={buffetPicker.table?.table_code ?? selectedTable?.table_code ?? null}
        isBusy={isBusy}
        onClose={closeBuffetPicker}
        onConfirm={(item) => confirmBuffetPickerItem(item)}
      />

      <TableQrOrderModal
        open={tableQrModalOpen}
        tableId={selectedTable?.id ?? null}
        tableCode={selectedTable?.table_code ?? null}
        onClose={() => setTableQrModalOpen(false)}
        onBusyChange={setTableQrBusy}
      />

      {tableQrAlert ? (
        <div className="posui-table-alert-popup" role="alert" aria-live="assertive" aria-label={tableQrAlert.type === "call_staff" ? text.tableQrCallStaff : text.tableQrRequestCheckout}>
          <section className="posui-table-alert">
            <div className="posui-table-alert__icon" aria-hidden="true">
              !
            </div>
            <div className="posui-table-alert__content">
              <strong>{tableQrAlert.type === "call_staff" ? text.tableQrCallStaff : text.tableQrRequestCheckout}</strong>
              <p>{tableQrAlert.tableCode}</p>
              {tableQrAlert.note ? <span>{tableQrAlert.note}</span> : null}
            </div>
            <button type="button" onClick={() => setTableQrAlert(null)} aria-label={text.clear}>
              x
            </button>
          </section>
        </div>
      ) : null}

      <PosHeldBillsModal
        open={heldBillsModalOpen}
        text={text}
        lang={lang}
        isDeliveryPendingPanelMode={isDeliveryPendingPanelMode}
        heldBillSearch={heldBillSearch}
        heldBillPool={heldBillPool}
        filteredHeldBills={filteredHeldBills}
        deliveryApps={deliveryApps}
        deliveryLogoFallback={deliveryLogoFallback}
        deliveryActionBusyById={deliveryActionBusyById}
        isBusy={isBusy}
        formatMoney={formatMoney}
        formatHeldAt={formatHeldAt}
        getDeliveryPendingStatusLabel={getDeliveryPendingStatusLabel}
        normalizeHeldBillStatusHistory={normalizeHeldBillStatusHistory}
        onClose={() => setHeldBillsModalOpen(false)}
        onHeldBillSearchChange={setHeldBillSearch}
        onRestoreLatestHeldBill={restoreLatestHeldBill}
        onRestoreHeldBill={restoreHeldBill}
        onRemoveHeldBill={removeHeldBill}
        onSendPendingDeliveryBill={(heldBill) => {
          sendPendingDeliveryBill(heldBill);
        }}
        onCancelPendingDeliveryBill={cancelPendingDeliveryBill}
        onDeliveryLogoError={(appId) =>
          setDeliveryLogoFallback((current) => ({
            ...current,
            [appId]: true
          }))
        }
      />
      {loading && !hasRenderableData ? (
        <div className="table-loading-overlay" role="status" aria-live="polite" aria-label={text.loading}>
          <div className="table-loading-dialog">
            <span className="table-loading-spinner" aria-hidden="true" />
            <p>{text.loading}</p>
          </div>
        </div>
      ) : null}
      {processingOverlayLabel ? (
        <div className="table-loading-overlay" role="status" aria-live="polite" aria-label={processingOverlayLabel}>
          <div className="table-loading-dialog">
            <span className="table-loading-spinner" aria-hidden="true" />
            <p>{processingOverlayLabel}</p>
          </div>
        </div>
      ) : null}
      {stockAdjusting ? <LoadingState label={text.applyingStock} /> : null}
      {modifierDraft ? (
        <div className="posui-payment-modal-backdrop" role="dialog" aria-modal="true" aria-label={lang === "th" ? "เลือกตัวเลือกสินค้า" : "Select product options"}>
          <section className="posui-payment-modal posui-payment-modal--review" onClick={(event) => event.stopPropagation()}>
            <header className="posui-payment-modal__header">
              <h3>{modifierDraft.product.name}</h3>
              <button type="button" className="posui-btn" onClick={() => setModifierDraft(null)}>
                {text.close}
              </button>
            </header>
            <p className="posui-payment-modal__hint">
              {lang === "th"
                ? quickMode === "delivery"
                  ? "สินค้าเมนูนี้ผูกวัตถุดิบอยู่ โหมดเดลิเวอรี่บันทึกตัวเลือกได้แต่ไม่เพิ่มราคา"
                  : "สินค้าเมนูนี้ผูกวัตถุดิบอยู่ เลือก/ระบุวัตถุดิบก่อนเพิ่มลงตะกร้า"
                : quickMode === "delivery"
                  ? "This recipe product can save options in delivery mode, but extra price is disabled."
                  : "This recipe product supports options before adding to cart."}
            </p>
            <div className="posui-payment-receipt-card">
              <div className="posui-payment-modal__input-label">
                <span>{lang === "th" ? "วัตถุดิบที่ผูกไว้" : "Linked Ingredients"}</span>
                {modifierIngredientsLoading ? <small>{lang === "th" ? "กำลังโหลดวัตถุดิบ..." : "Loading ingredients..."}</small> : null}
                {modifierIngredientsError ? <small className="text-red-600">{modifierIngredientsError}</small> : null}
                <div className="mt-2 flex flex-wrap gap-2">
                  {modifierIngredients.length === 0 && !modifierIngredientsLoading ? (
                    <small>{lang === "th" ? "ยังไม่มีรายการวัตถุดิบให้เลือก" : "No linked ingredients available."}</small>
                  ) : null}
                  {modifierIngredients.map((ingredient) => {
                    const selected = isIngredientSelectedInNotes(modifierDraft.notes, ingredient.name);
                    return (
                      <button
                        key={ingredient.ingredient_id}
                        type="button"
                        onClick={() => toggleModifierIngredient(ingredient.name)}
                        aria-pressed={selected}
                        className={`group inline-flex min-h-[44px] items-center gap-2 rounded-xl border px-3 py-2 text-left text-xs font-bold shadow-sm transition ${
                          selected
                            ? "border-orange-500 bg-orange-50 text-orange-800 ring-1 ring-orange-200"
                            : "border-slate-200 bg-white text-slate-700 hover:border-orange-200 hover:bg-orange-50/60"
                        }`}
                      >
                        <span
                          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] ${
                            selected ? "border-orange-500 bg-orange-500 text-white" : "border-slate-300 bg-slate-50 text-slate-400"
                          }`}
                          aria-hidden="true"
                        >
                          {selected ? "✓" : "+"}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-slate-900">{ingredient.name}</span>
                          <span className={`mt-0.5 block text-[11px] font-semibold ${selected ? "text-orange-700" : "text-slate-500"}`}>
                            {formatIngredientAmount(Number(ingredient.quantity_per_item), lang)} {formatIngredientUnit(ingredient.base_unit, lang)}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <label className="posui-payment-modal__input-label">
                {lang === "th" ? "ตัวเลือกเพิ่มเติม" : "Additional Options"}
                <textarea
                  value={modifierDraft.notes}
                  onChange={(event) => setModifierDraft((current) => (current ? { ...current, notes: event.target.value } : current))}
                  rows={2}
                  placeholder={lang === "th" ? "เช่น เพิ่มลูกชิ้น, ไม่ใส่นม..." : "e.g. extra meatballs, no milk..."}
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <span className="text-xs font-bold text-slate-600">{lang === "th" ? "จำนวนวัตถุดิบที่เลือก" : "Linked Ingredient Qty"}</span>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <button type="button" className="posui-btn" disabled={!modifierHasSelectedIngredient} onClick={() => adjustLinkedIngredientQuantity(-1)}>
                      -
                    </button>
                    <strong className="text-xl text-slate-900">{modifierDraft.linkedIngredientQuantity}</strong>
                    <button type="button" className="posui-btn" disabled={!modifierHasSelectedIngredient} onClick={() => adjustLinkedIngredientQuantity(1)}>
                      +
                    </button>
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <span className="text-xs font-bold text-slate-600">{lang === "th" ? "ราคาเพิ่มวัตถุดิบ" : "Extra Ingredient Price"}</span>
                  <div className="mt-2 flex items-center gap-2">
                    <button type="button" className="posui-btn" disabled={quickMode === "delivery"} onClick={() => setModifierDraft((current) => (current ? { ...current, extraPrice: Math.max(0, Number((current.extraPrice - 5).toFixed(2))) } : current))}>
                      -5
                    </button>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      disabled={quickMode === "delivery"}
                      value={modifierDraft.extraPrice}
                      onChange={(event) => setModifierDraft((current) => (current ? { ...current, extraPrice: Math.max(0, Number(event.target.value || 0)) } : current))}
                      className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-center text-sm font-bold text-slate-900"
                    />
                    <button type="button" className="posui-btn" disabled={quickMode === "delivery"} onClick={() => setModifierDraft((current) => (current ? { ...current, extraPrice: Number((current.extraPrice + 5).toFixed(2)) } : current))}>
                      +5
                    </button>
                  </div>
                </div>
              </div>
              <div className="mt-3 rounded-xl border border-orange-100 bg-orange-50 px-3 py-2 text-sm font-bold text-orange-700">
                {lang === "th" ? "ราคาต่อหน่วยหลังรวมตัวเลือก" : "Unit price with options"}:{" "}
                {formatMoney(getProductPriceForCurrentMode(modifierDraft.product) + (quickMode === "delivery" ? 0 : Math.max(0, modifierDraft.extraPrice)))}
              </div>
            </div>
            <div className="posui-payment-modal__actions">
              <button type="button" className="posui-btn" onClick={() => setModifierDraft(null)}>
                {lang === "th" ? "ยกเลิก" : "Cancel"}
              </button>
              <button type="button" className="posui-btn posui-btn--primary" onClick={confirmModifierDraft}>
                {modifierDraft.editingCartLineId ? (lang === "th" ? "บันทึกการแก้ไข" : "Save Changes") : lang === "th" ? "เพิ่มลงตะกร้า" : "Add to Cart"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
      <PackageLockDialog lang={lang} open={packageLockOpen} onClose={() => setPackageLockOpen(false)} />
      <PosMemberMaintenanceModal
        open={deliveryMaintenanceOpen}
        lang={lang}
        title={text.deliveryMaintenanceTitle}
        message={text.deliveryMaintenanceMessage}
        onClose={() => setDeliveryMaintenanceOpen(false)}
      />
    </section>
  );
}














