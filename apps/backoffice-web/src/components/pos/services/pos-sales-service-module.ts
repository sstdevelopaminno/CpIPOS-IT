import type { OrderType } from "@pos/shared-types";

type ApiErrorBody = {
  error?: {
    code?: string;
    message?: string;
  } | null;
  data?: unknown;
};

type FetchJsonWithTimeout = (
  input: RequestInfo | URL,
  init?: RequestInit,
  timeoutMs?: number,
  retries?: number
) => Promise<{ response: Response; body: ApiErrorBody }>;

type CartItem = {
  product_id: string;
  name: string;
  quantity: number;
  price: number;
};

type StoreProfile = {
  display_name?: string | null;
  name?: string | null;
  logo_url?: string | null;
  company_address?: string | null;
  contact_phone?: string | null;
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
    notes?: string;
    app_total_amount: number;
    discount_amount?: number;
    gp_amount?: number;
    tax_total?: number;
    grand_total?: number;
    tax_lines?: Array<{ id: string; label: string; rate_pct: number; mode: string; amount: number }>;
    items: Array<{ product_id: string; quantity: number; unit_price?: number }>;
  };
};

type PendingPaymentQueueItem = {
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
    tax_lines?: Array<{ id: string; label: string; rate_pct: number; mode: string; amount: number }>;
  };
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
  total_amount?: number;
  tax_total?: number | null;
  tax_lines?: Array<{ id: string; label: string; rate_pct: number; mode: string; amount: number }>;
  table_id?: string | null;
  created_at?: string;
  updated_existing?: boolean;
};

type HeldBill = {
  id: string;
  held_at: string;
  label: string;
  order_type: OrderType;
  queue_status?: "pending" | "editing" | "sending" | "sent" | "cancelled";
  delivery_app_id?: "lineman" | "grabfood" | "shopeefood" | null;
  delivery_external_code?: string | null;
  delivery_notes?: string | null;
  items: CartItem[];
  subtotal: number;
  discount_amount?: number;
  source_order_id?: string | null;
  source_order_status?: string | null;
  status_history?: Array<{ status: "pending" | "editing" | "sending" | "sent" | "cancelled"; at: string; note?: string | null }>;
};

type TextLabels = {
  orderUpdated: string;
  orderCreated: string;
  receiptSaved: string;
  transferQueued: string;
  deliveryPendingBillNeedOrder: string;
  deliveryPendingStatusCancelled: string;
  deliveryPendingStatusSent: string;
  addItemsFirst: string;
  offlineStaged: string;
  submitFailed: string;
  retrySafe: string;
  openShiftRequired: string;
};

function toErrorMessage(error: unknown, fallback = "Unknown error"): string {
  return error instanceof Error ? error.message : fallback;
}

function toSafeNumber(value: unknown, fallback = 0): number {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function isOrderType(value: string): value is OrderType {
  return value === "dine_in" || value === "takeaway" || value === "delivery_manual";
}

function normalizeApiError(response: Response, body: ApiErrorBody, fallback = "Submit failed."): Error {
  const code = String(body.error?.code ?? "").trim();
  const message = String(body.error?.message ?? "").trim() || fallback;
  const statusText = response.status ? `HTTP ${response.status}` : "";
  const parts = [code, statusText, message].filter(Boolean);
  return new Error(parts.join(": "));
}

function validatePendingSubmitPayload(payload: PendingSubmit): void {
  const data = payload.payload;
  const idempotencyKey = String(payload.idempotencyKey ?? "").trim();

  if (!idempotencyKey) {
    throw new Error("missing_idempotency_key: Cannot submit POS sale without an idempotency key.");
  }
  if (!String(data.shift_id ?? "").trim()) {
    throw new Error("missing_shift_id: Open shift is required before creating POS sale.");
  }
  if (!isOrderType(data.order_type)) {
    throw new Error("invalid_order_type: Unsupported POS order type.");
  }
  if (data.order_type === "dine_in" && !String(data.table_id ?? "").trim()) {
    throw new Error("table_required: A dine-in bill requires an opened table bill session.");
  }
  if (!Array.isArray(data.items) || data.items.length === 0) {
    throw new Error("invalid_items: Add at least one item before creating a POS bill.");
  }

  for (const item of data.items) {
    if (!String(item.product_id ?? "").trim()) {
      throw new Error("invalid_items: Every POS bill item must have product_id.");
    }
    const quantity = Number(item.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error("invalid_quantity: Every POS bill item quantity must be greater than zero.");
    }
    if (item.unit_price !== undefined) {
      const unitPrice = Number(item.unit_price);
      if (!Number.isFinite(unitPrice) || unitPrice < 0) {
        throw new Error("invalid_unit_price: Every POS bill item unit_price must be zero or greater.");
      }
    }
  }
}

function buildSanitizedOrderSubmitPayload(payload: PendingSubmit["payload"]): PendingSubmit["payload"] {
  return {
    ...payload,
    shift_id: String(payload.shift_id ?? "").trim(),
    order_type: payload.order_type,
    channel: String(payload.channel ?? "").trim() || (payload.order_type === "takeaway" ? "walk_home" : "storefront"),
    table_id: payload.order_type === "dine_in" ? String(payload.table_id ?? "").trim() : undefined,
    customer_name: payload.customer_name?.trim() || undefined,
    external_order_code: payload.external_order_code?.trim() || undefined,
    notes: payload.notes?.trim() || undefined,
    app_total_amount: toSafeNumber(payload.app_total_amount, 0),
    discount_amount: toSafeNumber(payload.discount_amount, 0),
    gp_amount: toSafeNumber(payload.gp_amount, 0),
    tax_total: payload.tax_total === undefined ? undefined : toSafeNumber(payload.tax_total, 0),
    grand_total: payload.grand_total === undefined ? undefined : toSafeNumber(payload.grand_total, 0),
    tax_lines: Array.isArray(payload.tax_lines) ? payload.tax_lines : undefined,
    items: payload.items.map((item) => ({
      product_id: String(item.product_id ?? "").trim(),
      quantity: Number(item.quantity),
      unit_price: item.unit_price === undefined ? undefined : toSafeNumber(item.unit_price, 0)
    }))
  };
}

function emitOrderCreatedEvent(order: ActiveOrder): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("pos:sales:order-created", {
      detail: {
        order_id: order.id,
        order_no: order.order_no,
        status: order.status,
        order_type: order.order_type ?? null,
        table_id: order.table_id ?? null,
        total_amount: order.total_amount ?? null
      }
    })
  );
}

export async function submitOrderWithEffects(args: {
  payload: PendingSubmit;
  applyUiResult: boolean;
  fetchJsonWithTimeout: FetchJsonWithTimeout;
  text: Pick<TextLabels, "orderUpdated" | "orderCreated">;
  setIsOnline: (value: boolean) => void;
  dequeuePendingSubmit: (idempotencyKey: string) => void;
  setActiveOrder: (next: ActiveOrder | null) => void;
  setCart: (next: CartItem[]) => void;
  setCartDrawerOpen: (next: boolean) => void;
  refreshTables: () => void;
  pushSubmitMessage: (message: string) => void;
}): Promise<ActiveOrder | null> {
  const {
    payload,
    applyUiResult,
    fetchJsonWithTimeout,
    text,
    setIsOnline,
    dequeuePendingSubmit,
    setActiveOrder,
    setCart,
    setCartDrawerOpen,
    refreshTables,
    pushSubmitMessage
  } = args;

  validatePendingSubmitPayload(payload);
  const sanitizedPayload = buildSanitizedOrderSubmitPayload(payload.payload);

  const { response, body } = await fetchJsonWithTimeout(
    "/api/pos/sales",
    {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "x-idempotency-key": payload.idempotencyKey
      },
      body: JSON.stringify(sanitizedPayload)
    },
    15000,
    0
  );

  if (!response.ok || body.error) {
    throw normalizeApiError(response, body, "Failed to create POS bill.");
  }

  const nextOrder = (body.data ?? {}) as Partial<ActiveOrder>;
  if (!nextOrder.id || !nextOrder.order_no || !nextOrder.status) {
    throw new Error("order_create_response_invalid: POS bill was submitted but the API did not return order id, order number, and status.");
  }

  const createdOrder: ActiveOrder = {
    id: String(nextOrder.id),
    order_no: String(nextOrder.order_no),
    status: String(nextOrder.status),
    order_type: isOrderType(String(nextOrder.order_type ?? "")) ? (nextOrder.order_type as OrderType) : sanitizedPayload.order_type,
    channel: typeof nextOrder.channel === "string" ? nextOrder.channel : sanitizedPayload.channel,
    external_order_code:
      typeof nextOrder.external_order_code === "string" ? nextOrder.external_order_code : sanitizedPayload.external_order_code ?? null,
    total_amount: Number.isFinite(Number(nextOrder.total_amount)) ? Number(nextOrder.total_amount) : sanitizedPayload.grand_total ?? sanitizedPayload.app_total_amount,
    tax_total: Number.isFinite(Number(nextOrder.tax_total)) ? Number(nextOrder.tax_total) : sanitizedPayload.tax_total ?? null,
    tax_lines: Array.isArray(nextOrder.tax_lines)
      ? nextOrder.tax_lines as Array<{ id: string; label: string; rate_pct: number; mode: string; amount: number }>
      : sanitizedPayload.tax_lines ?? [],
    table_id: nextOrder.table_id ?? sanitizedPayload.table_id ?? null,
    created_at: nextOrder.created_at,
    updated_existing: Boolean(nextOrder.updated_existing)
  };

  setIsOnline(true);
  dequeuePendingSubmit(payload.idempotencyKey);

  if (applyUiResult) {
    setActiveOrder(createdOrder);
    pushSubmitMessage(`${createdOrder.updated_existing ? text.orderUpdated : text.orderCreated}: ${createdOrder.order_no}`);
    if (sanitizedPayload.order_type !== "takeaway") {
      setCart([]);
    }
    setCartDrawerOpen(false);
    if (sanitizedPayload.order_type === "dine_in") {
      refreshTables();
    }
  } else {
    pushSubmitMessage(`${text.orderCreated}: ${createdOrder.order_no}`);
  }

  emitOrderCreatedEvent(createdOrder);
  return createdOrder;
}

export async function submitTransferPaymentWithEffects(args: {
  pendingPaymentEntry: PendingPaymentQueueItem;
  applyUiResult: boolean;
  fetchJsonWithTimeout: FetchJsonWithTimeout;
  text: Pick<TextLabels, "receiptSaved" | "transferQueued">;
  transferSlipPreviewUrl: string | null;
  fallbackReceiptItems: CartItem[];
  storeProfile: StoreProfile | null;
  setIsOnline: (value: boolean) => void;
  dequeuePendingPayment: (idempotencyKey: string) => void;
  setActiveOrder: (updater: (current: ActiveOrder | null) => ActiveOrder | null) => void;
  setCart: (next: CartItem[]) => void;
  setTakeawayCreatingPreview: (next: null) => void;
  setReviewOrder: (next: null) => void;
  setCashReviewOrder: (next: null) => void;
  setTransferReviewOrder: (next: null) => void;
  setTransferReference: (next: string) => void;
  setCashReceivedInput: (next: string) => void;
  setCashReplaceOnNextKey: (next: boolean) => void;
  setCashError: (next: string | null) => void;
  setTransferError: (next: string | null) => void;
  setTransferSlipFile: (next: File | null) => void;
  revokeTransferSlipPreviewUrl: (url: string) => void;
  setTransferSlipPreviewUrl: (next: string | null) => void;
  setTransferSlipParsed: (next: null) => void;
  setTransferSlipChecks: (next: null) => void;
  setTransferSlipIssues: (next: string[]) => void;
  setTransferSlipVerified: (next: boolean) => void;
  setTransferSlipVerifiedAgainst: (next: string | null) => void;
  setTransferSlipVerificationId: (next: string | null) => void;
  setTransferOverrideApprovalId: (next: string | null) => void;
  setReceiptSession: (next: {
    order_id: string;
    order_no: string;
    created_at: string;
    items: CartItem[];
    total_amount: number;
    discount_amount: number;
    tax_total?: number;
    tax_lines?: Array<{ id: string; label: string; rate_pct: number; mode: string; amount: number }>;
    payment_method: "bank_transfer";
    cash_received: number;
    change_amount: number;
    store_profile?: StoreProfile | null;
  } | null) => void;
  setReceiptSaving: (next: boolean) => void;
  setReceiptSaved: (next: boolean) => void;
  setBillPaymentMethod: (next: "bank_transfer") => void;
  setReceiptError: (next: string | null) => void;
  pushSubmitMessage: (message: string) => void;
}): Promise<void> {
  const {
    pendingPaymentEntry,
    applyUiResult,
    fetchJsonWithTimeout,
    text,
    transferSlipPreviewUrl,
    fallbackReceiptItems,
    storeProfile,
    setIsOnline,
    dequeuePendingPayment,
    setActiveOrder,
    setCart,
    setTakeawayCreatingPreview,
    setReviewOrder,
    setCashReviewOrder,
    setTransferReviewOrder,
    setTransferReference,
    setCashReceivedInput,
    setCashReplaceOnNextKey,
    setCashError,
    setTransferError,
    setTransferSlipFile,
    revokeTransferSlipPreviewUrl,
    setTransferSlipPreviewUrl,
    setTransferSlipParsed,
    setTransferSlipChecks,
    setTransferSlipIssues,
    setTransferSlipVerified,
    setTransferSlipVerifiedAgainst,
    setTransferSlipVerificationId,
    setTransferOverrideApprovalId,
    setReceiptSession,
    setReceiptSaving,
    setReceiptSaved,
    setBillPaymentMethod,
    setReceiptError,
    pushSubmitMessage
  } = args;

  const { response, body } = await fetchJsonWithTimeout(
    "/api/pos/payments",
    {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "x-idempotency-key": pendingPaymentEntry.idempotencyKey
      },
      body: JSON.stringify({
        order_id: pendingPaymentEntry.payload.order_id,
        payment_lines: [
          {
            method: "bank_transfer",
            amount: pendingPaymentEntry.payload.total_amount,
            reference_no: pendingPaymentEntry.payload.reference_no ?? null
          }
        ],
        transfer_verification_id: pendingPaymentEntry.payload.transfer_verification_id ?? null,
        transfer_override_approval_id: pendingPaymentEntry.payload.transfer_override_approval_id ?? null,
        skip_transfer_verification: pendingPaymentEntry.payload.skip_transfer_verification === true,
        cash_received: pendingPaymentEntry.payload.total_amount,
        change_amount: 0
      })
    },
    20000
  );
  if (!response.ok || body.error) {
    throw normalizeApiError(response, body, "Failed to complete transfer payment.");
  }

  setIsOnline(true);
  dequeuePendingPayment(pendingPaymentEntry.idempotencyKey);

  if (!applyUiResult) {
    pushSubmitMessage(`${text.transferQueued}: ${pendingPaymentEntry.payload.order_no}`);
    return;
  }

  setActiveOrder((current) => (current?.id === pendingPaymentEntry.payload.order_id ? null : current));
  setCart([]);
  setTakeawayCreatingPreview(null);
  setReviewOrder(null);
  setCashReviewOrder(null);
  setTransferReviewOrder(null);
  setTransferReference("");
  setCashReceivedInput("");
  setCashReplaceOnNextKey(false);
  setCashError(null);
  setTransferError(null);
  setTransferSlipFile(null);
  if (transferSlipPreviewUrl) {
    revokeTransferSlipPreviewUrl(transferSlipPreviewUrl);
  }
  setTransferSlipPreviewUrl(null);
  setTransferSlipParsed(null);
  setTransferSlipChecks(null);
  setTransferSlipIssues([]);
  setTransferSlipVerified(false);
  setTransferSlipVerifiedAgainst(null);
  setTransferSlipVerificationId(null);
  setTransferOverrideApprovalId(null);
  setReceiptSession({
    order_id: pendingPaymentEntry.payload.order_id,
    order_no: pendingPaymentEntry.payload.order_no,
    created_at: new Date().toISOString(),
    items: pendingPaymentEntry.payload.receipt_items ?? fallbackReceiptItems,
    total_amount: pendingPaymentEntry.payload.total_amount,
    discount_amount: pendingPaymentEntry.payload.discount_amount ?? 0,
    tax_total: pendingPaymentEntry.payload.tax_total ?? 0,
    tax_lines: pendingPaymentEntry.payload.tax_lines ?? [],
    payment_method: "bank_transfer",
    cash_received: pendingPaymentEntry.payload.total_amount,
    change_amount: 0,
    store_profile: storeProfile
  });
  setReceiptSaving(false);
  setReceiptSaved(true);
  setBillPaymentMethod("bank_transfer");
  setReceiptError(null);
  pushSubmitMessage(`${text.receiptSaved}: ${pendingPaymentEntry.payload.order_no}`);
}

export async function sendPendingDeliveryBillNowWithEffects(args: {
  heldBill: HeldBill;
  isBusy: boolean;
  checkoutRequestLockRef: { current: boolean };
  shiftId: string | null;
  isOnline: boolean;
  text: Pick<
    TextLabels,
    | "openShiftRequired"
    | "deliveryPendingBillNeedOrder"
    | "deliveryPendingStatusCancelled"
    | "deliveryPendingStatusSent"
    | "addItemsFirst"
    | "offlineStaged"
    | "submitFailed"
    | "retrySafe"
  >;
  deliveryActionBusyError: string;
  normalizeDeliveryCartItemsForApp: (cart: CartItem[], appId: "lineman" | "grabfood" | "shopeefood" | null | undefined) => CartItem[];
  newIdempotencyKey: () => string;
  mapDeliveryChannel: (appId: "lineman" | "grabfood" | "shopeefood") => string;
  buildDeliveryDraftBillNo: (appId: "lineman" | "grabfood" | "shopeefood", externalCode: string) => string;
  appendDeliveryStatusHistory: (
    bill: HeldBill,
    status: "pending" | "editing" | "sending" | "sent" | "cancelled",
    note?: string | null
  ) => Array<{ status: "pending" | "editing" | "sending" | "sent" | "cancelled"; at: string; note?: string | null }>;
  submitOrder: (payload: PendingSubmit) => Promise<ActiveOrder | null>;
  submitTransferPayment: (pendingPaymentEntry: PendingPaymentQueueItem, applyUiResult: boolean) => Promise<void>;
  enqueuePendingSubmit: (payload: PendingSubmit, lastError?: string) => void;
  enqueuePendingPayment: (payload: PendingPaymentQueueItem) => void;
  markPendingPaymentFailed: (idempotencyKey: string, errorMessage: string) => void;
  markConnectivityFromError: (error: unknown) => void;
  pushSubmitMessage: (message: string | null) => void;
  setSubmitting: (next: boolean) => void;
  setTransferSubmitting: (next: boolean) => void;
  setDeliveryEditingHeldBillId: (next: string | null) => void;
  setSelectedDeliveryApp: (next: "lineman" | "grabfood" | "shopeefood" | null) => void;
  setDeliveryExternalCode: (next: string) => void;
  setDeliveryNotes: (next: string) => void;
  setDeliveryDraftBillNo: (next: string | null) => void;
  setQuickMode: (next: "delivery") => void;
  setOrderType: (next: "delivery_manual") => void;
  setDeliveryCatalogOpen: (next: boolean) => void;
  setCart: (next: CartItem[]) => void;
  setCartDrawerOpen: (next: boolean) => void;
  setHeldBills: (
    updater: (current: HeldBill[]) => HeldBill[]
  ) => void;
  setDeliveryFlowState: (next: "completed") => void;
  updateDeliveryHeldBillStatus: (heldBillId: string, status: "pending" | "editing" | "sending" | "sent" | "cancelled", note?: string | null) => void;
}): Promise<void> {
  const {
    heldBill,
    isBusy,
    checkoutRequestLockRef,
    shiftId,
    isOnline,
    text,
    deliveryActionBusyError,
    normalizeDeliveryCartItemsForApp,
    newIdempotencyKey,
    mapDeliveryChannel,
    buildDeliveryDraftBillNo,
    appendDeliveryStatusHistory,
    submitOrder,
    submitTransferPayment,
    enqueuePendingSubmit,
    enqueuePendingPayment,
    markPendingPaymentFailed,
    markConnectivityFromError,
    pushSubmitMessage,
    setSubmitting,
    setTransferSubmitting,
    setDeliveryEditingHeldBillId,
    setSelectedDeliveryApp,
    setDeliveryExternalCode,
    setDeliveryNotes,
    setDeliveryDraftBillNo,
    setQuickMode,
    setOrderType,
    setDeliveryCatalogOpen,
    setCart,
    setCartDrawerOpen,
    setHeldBills,
    setDeliveryFlowState,
    updateDeliveryHeldBillStatus
  } = args;

  if (isBusy || checkoutRequestLockRef.current) {
    throw new Error(deliveryActionBusyError);
  }
  if (!shiftId) {
    pushSubmitMessage(text.openShiftRequired);
    return;
  }
  if (heldBill.order_type !== "delivery_manual" || !heldBill.delivery_app_id || !heldBill.delivery_external_code) {
    pushSubmitMessage(text.deliveryPendingBillNeedOrder);
    return;
  }
  if (heldBill.queue_status === "cancelled" || heldBill.queue_status === "sent") {
    pushSubmitMessage(heldBill.queue_status === "cancelled" ? text.deliveryPendingStatusCancelled : text.deliveryPendingStatusSent);
    return;
  }

  const cartSnapshot = normalizeDeliveryCartItemsForApp(
    heldBill.items.map((item) => ({ ...item })),
    heldBill.delivery_app_id
  );
  if (cartSnapshot.length === 0) {
    pushSubmitMessage(text.addItemsFirst);
    return;
  }

  const snapshotSubtotal = Number(cartSnapshot.reduce((sum, item) => sum + item.price * item.quantity, 0).toFixed(2));
  const snapshotDiscount = Number(
    Math.min(
      snapshotSubtotal,
      Math.max(0, Number.isFinite(heldBill.discount_amount) ? Number(heldBill.discount_amount) : 0)
    ).toFixed(2)
  );

  checkoutRequestLockRef.current = true;
  setSubmitting(true);
  updateDeliveryHeldBillStatus(heldBill.id, "sending");
  setDeliveryEditingHeldBillId(null);
  setSelectedDeliveryApp(heldBill.delivery_app_id);
  setDeliveryExternalCode(heldBill.delivery_external_code);
  setDeliveryNotes(heldBill.delivery_notes ?? "");
  setDeliveryDraftBillNo(heldBill.label || buildDeliveryDraftBillNo(heldBill.delivery_app_id, heldBill.delivery_external_code));
  setQuickMode("delivery");
  setOrderType("delivery_manual");
  setDeliveryCatalogOpen(true);
  setCart(cartSnapshot);
  pushSubmitMessage(null);

  const payload: PendingSubmit = {
    idempotencyKey: newIdempotencyKey(),
    payload: {
      order_id: undefined,
      shift_id: shiftId,
      order_type: "delivery_manual",
      channel: mapDeliveryChannel(heldBill.delivery_app_id),
      table_id: undefined,
      customer_name: undefined,
      external_order_code: heldBill.delivery_external_code,
      notes: heldBill.delivery_notes ?? undefined,
      app_total_amount: snapshotSubtotal,
      discount_amount: snapshotDiscount,
      gp_amount: 0,
      items: cartSnapshot.map((item) => ({ product_id: item.product_id, quantity: item.quantity, unit_price: item.price }))
    }
  };

  if (!isOnline) {
    enqueuePendingSubmit(payload);
    updateDeliveryHeldBillStatus(heldBill.id, "pending", "offline_staged");
    setCart([]);
    setCartDrawerOpen(false);
    pushSubmitMessage(text.offlineStaged);
    setSubmitting(false);
    checkoutRequestLockRef.current = false;
    return;
  }

  try {
    const createdOrder = await submitOrder(payload);
    if (!createdOrder) {
      throw new Error("Order created but bill information is missing.");
    }
    const settledTotal = Number(createdOrder.total_amount ?? Number(Math.max(0, snapshotSubtotal - snapshotDiscount).toFixed(2)));
    setHeldBills((current) =>
      current.map((entry) => {
        if (entry.id !== heldBill.id || entry.order_type !== "delivery_manual") {
          return entry;
        }
        return {
          ...entry,
          source_order_id: createdOrder.id,
          source_order_status: createdOrder.status,
          queue_status: "sent",
          status_history: appendDeliveryStatusHistory(entry, "sent", createdOrder.order_no)
        };
      })
    );

    const pendingPaymentEntry: PendingPaymentQueueItem = {
      idempotencyKey: `pos-transfer-${crypto.randomUUID()}`,
      payload: {
        order_id: createdOrder.id,
        order_no: createdOrder.order_no,
        order_type: "delivery_manual",
        total_amount: settledTotal,
        discount_amount: snapshotDiscount,
        method: "bank_transfer",
        reference_no: heldBill.delivery_external_code,
        skip_transfer_verification: true,
        receipt_items: cartSnapshot
      },
      queued_at: new Date().toISOString(),
      retry_count: 0,
      last_error: null
    };

    enqueuePendingPayment(pendingPaymentEntry);
    setTransferSubmitting(true);
    try {
      await submitTransferPayment(pendingPaymentEntry, true);
      setHeldBills((current) => current.filter((entry) => entry.id !== heldBill.id));
      setDeliveryFlowState("completed");
    } catch (transferPayError) {
      const paymentMessage = toErrorMessage(transferPayError, "Failed to complete transfer payment.");
      markPendingPaymentFailed(pendingPaymentEntry.idempotencyKey, paymentMessage);
      updateDeliveryHeldBillStatus(heldBill.id, "pending", paymentMessage);
      markConnectivityFromError(transferPayError);
      pushSubmitMessage(`${text.submitFailed}: ${paymentMessage}. ${text.retrySafe}`);
    } finally {
      setTransferSubmitting(false);
    }
  } catch (submitError) {
    const message = toErrorMessage(submitError, "Unknown error");
    markConnectivityFromError(submitError);
    enqueuePendingSubmit(payload, message);
    updateDeliveryHeldBillStatus(heldBill.id, "pending", message);
    setCart([]);
    setCartDrawerOpen(false);
    pushSubmitMessage(`${text.submitFailed}: ${message}. ${text.retrySafe}`);
  } finally {
    setSubmitting(false);
    checkoutRequestLockRef.current = false;
  }
}