export function isConnectivityIssueMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("timeout") ||
    normalized.includes("failed to fetch") ||
    normalized.includes("network") ||
    normalized.includes("load failed") ||
    normalized.includes("connection")
  );
}

export function extractApiErrorCode(message: string): string | null {
  const matched = String(message ?? "")
    .trim()
    .match(/^([a-z0-9_]+)\s*:/i);
  return matched?.[1]?.toLowerCase() ?? null;
}

export function isConflictErrorCode(code: string | null): boolean {
  if (!code) return false;
  return code === "table_not_available" || code === "shift_not_open" || code === "order_not_updatable" || code === "order_not_found";
}

const API_ERROR_I18N = {
  th: {
    unauthorized: "สิทธิ์การเข้าถึงไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่",
    shift_not_open: "ยังไม่เปิดกะขาย กรุณาเปิดกะก่อนทำรายการ",
    table_not_available: "โต๊ะนี้ยังไม่พร้อมใช้งานหรือถูกใช้งานอยู่",
    table_required: "ต้องเลือกโต๊ะก่อนทำรายการทานในร้าน",
    order_not_found: "ไม่พบบิลนี้ในสาขาปัจจุบัน",
    order_not_updatable: "บิลนี้ไม่สามารถแก้ไขได้แล้ว กรุณาสร้างบิลใหม่",
    order_not_cancelable: "สถานะบิลนี้ยังยกเลิกไม่ได้",
    cancellation_approval_required: "ต้องยืนยัน PIN ก่อนยกเลิกบิล",
    cancellation_approval_invalid: "ไม่พบการอนุมัติยกเลิกบิล",
    cancellation_approval_expired: "การอนุมัติหมดอายุ กรุณายืนยัน PIN ใหม่",
    invalid_order_type: "ประเภทออเดอร์ไม่ถูกต้อง",
    invalid_items: "ยังไม่มีรายการสินค้า กรุณาเพิ่มสินค้าอย่างน้อย 1 รายการ",
    invalid_quantity: "จำนวนสินค้าไม่ถูกต้อง",
    invalid_product_id: "รหัสสินค้าไม่ถูกต้อง",
    product_not_found: "พบสินค้าบางรายการไม่ถูกต้องหรือไม่พร้อมขาย",
    payment_lines_required: "ต้องมีรายการชำระเงินอย่างน้อย 1 รายการ",
    invalid_payment_amount: "จำนวนเงินที่ชำระไม่ถูกต้อง",
    payment_total_mismatch: "ยอดชำระไม่ตรงกับยอดบิล",
    pin_rejected: "รหัส PIN ไม่ถูกต้องหรือไม่มีสิทธิ์อนุมัติ",
    order_queue_overloaded: "คิวบิลหนาแน่นเกินกำหนด กรุณาเคลียร์คิวก่อนทำรายการใหม่",
    order_tx_timeout: "ระบบใช้เวลานานเกินไป กรุณาลองใหม่อีกครั้ง",
    rpc_not_available: "บริการธุรกรรมชั่วคราวไม่พร้อมใช้งาน กรุณาลองใหม่",
    stock_deduction_failed: "ตัดสต๊อกเพื่อปิดการขายไม่สำเร็จ กรุณาตรวจสอบสต๊อกหรือการตั้งค่าสต๊อกแล้วลองใหม่",
    pos_sales_create_failed: "สร้างออเดอร์ไม่สำเร็จ กรุณาลองใหม่",
    cancel_order_failed: "ยกเลิกบิลไม่สำเร็จ กรุณาลองใหม่"
  },
  en: {
    unauthorized: "Unauthorized access. Please sign in again.",
    shift_not_open: "Open shift is required before performing this action.",
    table_not_available: "This table is unavailable or already occupied.",
    table_required: "A table is required for dine-in orders.",
    order_not_found: "Order was not found in the current branch.",
    order_not_updatable: "This order can no longer be edited. Please create a new order.",
    order_not_cancelable: "This order status cannot be cancelled.",
    cancellation_approval_required: "PIN approval is required before cancelling bill.",
    cancellation_approval_invalid: "Cancellation approval was not found.",
    cancellation_approval_expired: "Cancellation approval has expired. Please request PIN again.",
    invalid_order_type: "Unsupported order type.",
    invalid_items: "Order has no items. Add at least one item.",
    invalid_quantity: "Invalid item quantity.",
    invalid_product_id: "Invalid product ID.",
    product_not_found: "One or more products are invalid or unavailable.",
    payment_lines_required: "At least one payment line is required.",
    invalid_payment_amount: "Invalid payment amount.",
    payment_total_mismatch: "Payment total does not match order total.",
    pin_rejected: "PIN is invalid or not authorized for this action.",
    order_queue_overloaded: "Order queue is overloaded. Please clear queued bills first.",
    order_tx_timeout: "Request timed out. Please try again.",
    rpc_not_available: "Transaction service is temporarily unavailable. Please retry.",
    stock_deduction_failed: "Unable to deduct stock while completing payment. Check stock settings and try again.",
    pos_sales_create_failed: "Unable to create order. Please try again.",
    cancel_order_failed: "Unable to cancel order. Please try again."
  }
} as const;

export function localizeApiErrorMessage(args: { message: string; lang: "th" | "en" }): string {
  const { message, lang } = args;
  const trimmed = String(message ?? "").trim();
  if (!trimmed) return "";
  const code = extractApiErrorCode(trimmed);
  if (!code) return trimmed;
  const mapped = API_ERROR_I18N[lang]?.[code as keyof (typeof API_ERROR_I18N)["th"]];
  if (!mapped) return trimmed;
  return mapped;
}
