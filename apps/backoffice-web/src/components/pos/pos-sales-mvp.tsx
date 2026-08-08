"use client";

import { useEffect, useMemo, useState } from "react";

type Lang = "th" | "en";

type SessionSummary = {
  tenant: { id: string; code: string | null; name: string | null };
  branch: { id: string; code: string | null; name: string | null };
  user: { id: string; full_name: string };
  role: string;
  device: { id: string | null; code: string | null };
  shift: { id: string; status: string; opened_at: string; closed_at: string | null } | null;
  has_active_shift: boolean;
};

type ProductRow = {
  id: string;
  name: string;
  sku: string | null;
  category: string | null;
  price: number;
  is_active: boolean;
};

type CartItem = {
  product_id: string;
  name: string;
  unit_price: number;
  quantity: number;
};

type ShiftOrderRow = {
  id: string;
  order_no: string;
  status: string;
  subtotal: number;
  discount_amount: number;
  tax_total: number;
  grand_total: number;
  paid_total: number;
  created_at: string;
  payments: Array<{ method: string; amount: number; status: string; created_at: string }>;
};

type ReceiptPreview = {
  order_no: string;
  items: Array<{ id: string; name: string; quantity: number; unit_price: number; line_total: number }>;
  payments: Array<{ id: string; method: string; amount: number; status: string; created_at: string }>;
  total: number;
  paid_total: number;
  change_total: number;
};

type AttendanceStatus = "scheduled" | "checked_in" | "late" | "absent" | "on_leave" | "checked_out" | "manual_adjusted";
type AttendanceFilter = "all" | "checked_in" | "late" | "on_leave" | "absent";

type AttendanceStaffRow = {
  user_id: string;
  full_name: string;
  role: string | null;
  attendance_status: AttendanceStatus;
  checked_in_at: string | null;
  checked_out_at: string | null;
  late_minutes: number;
  note: string | null;
};

type AttendanceSnapshot = {
  date: string;
  summary: {
    checkedIn: number;
    late: number;
    absent: number;
    onLeave: number;
    total: number;
  };
  can_view_all_branch: boolean;
  can_manage: boolean;
  staff: AttendanceStaffRow[];
};

function formatMoney(value: number): string {
  return new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

function round2(value: number): number {
  return Number(value.toFixed(2));
}

function parseApiError(body: unknown): string {
  if (typeof body !== "object" || body === null) return "Unknown server error.";
  const errorObj = (body as { error?: { message?: string } }).error;
  return String(errorObj?.message ?? "Unknown server error.");
}

export function PosSalesMvp({ lang }: { lang: Lang }) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<SessionSummary | null>(null);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [orders, setOrders] = useState<ShiftOrderRow[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [discountTotal, setDiscountTotal] = useState("0");
  const [pendingOrder, setPendingOrder] = useState<{ id: string; order_no: string; grand_total: number } | null>(null);
  const [payMethod, setPayMethod] = useState<"cash" | "bank_transfer">("cash");
  const [payAmountInput, setPayAmountInput] = useState("");
  const [payReference, setPayReference] = useState("");
  const [receiptPreview, setReceiptPreview] = useState<ReceiptPreview | null>(null);
  const [attendance, setAttendance] = useState<AttendanceSnapshot | null>(null);
  const [attendanceOpen, setAttendanceOpen] = useState(false);
  const [attendanceFilter, setAttendanceFilter] = useState<AttendanceFilter>("all");
  const [attendanceBusy, setAttendanceBusy] = useState(false);

  const subtotal = useMemo(() => round2(cart.reduce((sum, item) => sum + item.unit_price * item.quantity, 0)), [cart]);
  const discount = useMemo(() => {
    const parsed = Number(discountTotal);
    if (!Number.isFinite(parsed) || parsed < 0) return 0;
    return Math.min(round2(parsed), subtotal);
  }, [discountTotal, subtotal]);
  const taxTotal = 0;
  const grandTotal = round2(subtotal - discount + taxTotal);

  const filteredAttendanceStaff = useMemo(() => {
    const rows = attendance?.staff ?? [];
    if (attendanceFilter === "all") return rows;
    if (attendanceFilter === "checked_in") {
      return rows.filter((row) => row.attendance_status === "checked_in" || row.attendance_status === "checked_out");
    }
    if (attendanceFilter === "late") return rows.filter((row) => row.attendance_status === "late");
    if (attendanceFilter === "on_leave") return rows.filter((row) => row.attendance_status === "on_leave");
    return rows.filter((row) => row.attendance_status === "absent");
  }, [attendance?.staff, attendanceFilter]);

  async function loadSession() {
    const response = await fetch("/api/pos/session/current", { cache: "no-store" });
    const body = (await response.json().catch(() => null)) as
      | { data?: SessionSummary | null; error?: { message?: string } | null }
      | null;
    if (!response.ok || !body?.data) {
      throw new Error(parseApiError(body));
    }
    return body.data;
  }

  async function loadProducts() {
    const response = await fetch("/api/pos/products", { cache: "no-store" });
    const body = (await response.json().catch(() => null)) as
      | { data?: { products?: ProductRow[] } | null; error?: { message?: string } | null }
      | null;
    if (!response.ok || !body?.data) {
      throw new Error(parseApiError(body));
    }
    return body.data.products ?? [];
  }

  async function loadHistory() {
    const response = await fetch("/api/pos/orders/current-shift", { cache: "no-store" });
    const body = (await response.json().catch(() => null)) as
      | { data?: { orders?: ShiftOrderRow[] } | null; error?: { message?: string } | null }
      | null;
    if (!response.ok || !body?.data) {
      throw new Error(parseApiError(body));
    }
    return body.data.orders ?? [];
  }

  async function loadAttendance() {
    const response = await fetch("/api/pos/attendance/status", { cache: "no-store" });
    const body = (await response.json().catch(() => null)) as
      | { data?: AttendanceSnapshot | null; error?: { message?: string } | null }
      | null;
    if (!response.ok || !body?.data) {
      throw new Error(parseApiError(body));
    }
    return body.data;
  }

  useEffect(() => {
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const [sessionData, productRows, orderRows, attendanceData] = await Promise.all([
          loadSession(),
          loadProducts(),
          loadHistory(),
          loadAttendance()
        ]);
        setSession(sessionData);
        setProducts(productRows);
        setOrders(orderRows);
        setAttendance(attendanceData);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Load failed.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const snapshot = await loadAttendance();
          setAttendance(snapshot);
        } catch {
          // keep last known snapshot
        }
      })();
    }, 20000);
    return () => window.clearInterval(timer);
  }, []);

  function addProduct(product: ProductRow) {
    setCart((current) => {
      const index = current.findIndex((item) => item.product_id === product.id);
      if (index === -1) {
        return [...current, { product_id: product.id, name: product.name, unit_price: Number(product.price), quantity: 1 }];
      }
      const next = [...current];
      next[index] = { ...next[index], quantity: next[index].quantity + 1 };
      return next;
    });
  }

  function updateQuantity(productId: string, delta: number) {
    setCart((current) =>
      current
        .map((item) => (item.product_id === productId ? { ...item, quantity: Math.max(0, item.quantity + delta) } : item))
        .filter((item) => item.quantity > 0)
    );
  }

  async function createOrder() {
    if (cart.length === 0) {
      setError("Please add at least one product.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/pos/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: cart.map((item) => ({ product_id: item.product_id, quantity: item.quantity })),
          discount_total: discount
        })
      });
      const body = (await response.json().catch(() => null)) as
        | {
            data?: {
              order?: { id: string; order_no: string; grand_total?: number | null; subtotal?: number; discount_amount?: number; tax_total?: number };
            } | null;
            error?: { message?: string } | null;
          }
        | null;
      if (!response.ok || !body?.data?.order) {
        throw new Error(parseApiError(body));
      }

      const order = body.data.order;
      const fallbackGrand = round2((Number(order.subtotal ?? subtotal) - Number(order.discount_amount ?? discount)) + Number(order.tax_total ?? taxTotal));
      const resolvedGrand = Number(order.grand_total ?? fallbackGrand);
      setPendingOrder({ id: order.id, order_no: order.order_no, grand_total: resolvedGrand });
      setPayAmountInput(String(resolvedGrand));
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Order create failed.");
    } finally {
      setBusy(false);
    }
  }

  async function payOrder() {
    if (!pendingOrder) return;
    setBusy(true);
    setError(null);
    try {
      const amount = Number(payAmountInput);
      const response = await fetch(`/api/pos/orders/${pendingOrder.id}/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method: payMethod,
          amount,
          reference_no: payReference.trim() || null
        })
      });
      const body = (await response.json().catch(() => null)) as
        | { data?: { receipt_preview?: ReceiptPreview } | null; error?: { message?: string } | null }
        | null;
      if (!response.ok || !body?.data?.receipt_preview) {
        throw new Error(parseApiError(body));
      }

      setReceiptPreview(body.data.receipt_preview);
      setPendingOrder(null);
      setPayAmountInput("");
      setPayReference("");
      setCart([]);
      setDiscountTotal("0");
      const [historyRows, attendanceSnapshot] = await Promise.all([loadHistory(), loadAttendance()]);
      setOrders(historyRows);
      setAttendance(attendanceSnapshot);
    } catch (payError) {
      setError(payError instanceof Error ? payError.message : "Payment failed.");
    } finally {
      setBusy(false);
    }
  }

  async function checkInSelf() {
    setAttendanceBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/pos/attendance/check-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "pos_sales_mvp_manual" })
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(parseApiError(body));
      }
      setAttendance(await loadAttendance());
    } catch (checkInError) {
      setError(checkInError instanceof Error ? checkInError.message : "Check-in failed.");
    } finally {
      setAttendanceBusy(false);
    }
  }

  async function checkOutSelf() {
    setAttendanceBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/pos/attendance/check-out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "pos_sales_mvp_manual" })
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(parseApiError(body));
      }
      setAttendance(await loadAttendance());
    } catch (checkOutError) {
      setError(checkOutError instanceof Error ? checkOutError.message : "Check-out failed.");
    } finally {
      setAttendanceBusy(false);
    }
  }

  async function applyManualAttendanceStatus(targetUserId: string, status: "checked_in" | "late" | "absent" | "on_leave") {
    if (!attendance?.can_manage) return;
    const note = window.prompt(`Optional note for ${status}`, "") ?? "";
    setAttendanceBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/pos/attendance/manual-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: targetUserId,
          status,
          note: note.trim() || null
        })
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(parseApiError(body));
      }
      setAttendance(await loadAttendance());
    } catch (manualError) {
      setError(manualError instanceof Error ? manualError.message : "Manual status update failed.");
    } finally {
      setAttendanceBusy(false);
    }
  }

  if (loading) {
    return <p>Loading POS Sales MVP...</p>;
  }

  return (
    <section style={{ display: "grid", gap: 14, height: "100%", overflow: "auto", paddingRight: 4 }}>
      <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 12, background: "#fff" }}>
        <h2 style={{ margin: "0 0 6px" }}>POS Sales MVP</h2>
        <p style={{ margin: 0, color: "#475569" }}>
          {session?.branch.name ?? session?.branch.code ?? session?.branch.id} | device {session?.device.code ?? "-"} |{" "}
          {session?.user.full_name ?? session?.user.id} ({session?.role}) | shift {session?.shift?.status ?? "-"}
        </p>
        <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <small style={{ color: "#0f172a", fontWeight: 700 }}>
            Staff: checked in {attendance?.summary.checkedIn ?? 0} | late {attendance?.summary.late ?? 0} | leave{" "}
            {attendance?.summary.onLeave ?? 0} | absent {attendance?.summary.absent ?? 0}
          </small>
          <button type="button" onClick={() => setAttendanceOpen(true)} style={{ minHeight: 30 }}>
            View details
          </button>
          <button type="button" onClick={() => void checkInSelf()} disabled={attendanceBusy} style={{ minHeight: 30 }}>
            Check in
          </button>
          <button type="button" onClick={() => void checkOutSelf()} disabled={attendanceBusy} style={{ minHeight: 30 }}>
            Check out
          </button>
        </div>
      </div>

      {error ? <p style={{ margin: 0, color: "#b91c1c", fontWeight: 700 }}>{error}</p> : null}

      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1.25fr 1fr", alignItems: "start" }}>
        <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 12, background: "#fff" }}>
          <h3 style={{ marginTop: 0 }}>Products</h3>
          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
            {products.map((product) => (
              <button
                key={product.id}
                type="button"
                onClick={() => addProduct(product)}
                style={{ textAlign: "left", border: "1px solid #cbd5e1", borderRadius: 10, padding: 10, background: "#f8fafc", cursor: "pointer" }}
              >
                <strong style={{ display: "block" }}>{product.name}</strong>
                <small style={{ display: "block", color: "#64748b" }}>{product.category ?? "-"}</small>
                <small style={{ display: "block", color: "#0f172a", marginTop: 4 }}>฿{formatMoney(Number(product.price ?? 0))}</small>
              </button>
            ))}
            {products.length === 0 ? <p style={{ margin: 0, color: "#64748b" }}>No active products.</p> : null}
          </div>
        </div>

        <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 12, background: "#fff" }}>
          <h3 style={{ marginTop: 0 }}>Cart</h3>
          {cart.length === 0 ? <p style={{ color: "#64748b" }}>No items selected.</p> : null}
          <div style={{ display: "grid", gap: 8 }}>
            {cart.map((item) => (
              <div key={item.product_id} style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 8, background: "#f8fafc" }}>
                <strong>{item.name}</strong>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
                  <span>฿{formatMoney(item.unit_price)}</span>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <button type="button" onClick={() => updateQuantity(item.product_id, -1)} disabled={busy}>
                      -
                    </button>
                    <span>{item.quantity}</span>
                    <button type="button" onClick={() => updateQuantity(item.product_id, 1)} disabled={busy}>
                      +
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <label style={{ display: "grid", gap: 4, marginTop: 10 }}>
            Discount
            <input value={discountTotal} onChange={(event) => setDiscountTotal(event.target.value)} type="number" step="0.01" min={0} />
          </label>
          <p style={{ margin: "10px 0 0" }}>Subtotal: ฿{formatMoney(subtotal)}</p>
          <p style={{ margin: "2px 0 0" }}>Discount: ฿{formatMoney(discount)}</p>
          <p style={{ margin: "2px 0 0" }}>Tax: ฿{formatMoney(taxTotal)}</p>
          <p style={{ margin: "2px 0 0", fontWeight: 800 }}>Grand Total: ฿{formatMoney(grandTotal)}</p>

          <button type="button" disabled={busy || cart.length === 0} onClick={() => void createOrder()} style={{ marginTop: 10, minHeight: 40 }}>
            {busy ? "Processing..." : "Checkout"}
          </button>
        </div>
      </div>

      {pendingOrder ? (
        <div style={{ border: "1px solid #0ea5e9", borderRadius: 12, padding: 12, background: "#f0f9ff" }}>
          <h3 style={{ marginTop: 0 }}>Payment</h3>
          <p style={{ margin: "0 0 8px" }}>
            Order {pendingOrder.order_no} | Due ฿{formatMoney(pendingOrder.grand_total)}
          </p>
          <label style={{ display: "grid", gap: 4, maxWidth: 240 }}>
            Method
            <select value={payMethod} onChange={(event) => setPayMethod(event.target.value as "cash" | "bank_transfer")} disabled={busy}>
              <option value="cash">cash</option>
              <option value="bank_transfer">bank_transfer</option>
            </select>
          </label>
          <label style={{ display: "grid", gap: 4, maxWidth: 240, marginTop: 8 }}>
            Amount
            <input value={payAmountInput} onChange={(event) => setPayAmountInput(event.target.value)} type="number" step="0.01" min={0} />
          </label>
          {payMethod === "bank_transfer" ? (
            <label style={{ display: "grid", gap: 4, maxWidth: 280, marginTop: 8 }}>
              Transfer reference (placeholder)
              <input value={payReference} onChange={(event) => setPayReference(event.target.value)} />
            </label>
          ) : null}
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button type="button" disabled={busy} onClick={() => void payOrder()}>
              {busy ? "Processing..." : "Pay order"}
            </button>
            <button type="button" disabled={busy} onClick={() => setPendingOrder(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {receiptPreview ? (
        <div style={{ border: "1px solid #bbf7d0", borderRadius: 12, padding: 12, background: "#f0fdf4" }}>
          <h3 style={{ marginTop: 0 }}>Receipt Preview</h3>
          <p style={{ margin: "0 0 8px" }}>Order {receiptPreview.order_no}</p>
          <div style={{ display: "grid", gap: 4 }}>
            {receiptPreview.items.map((item) => (
              <div key={item.id} style={{ display: "flex", justifyContent: "space-between" }}>
                <span>
                  {item.name} x {item.quantity}
                </span>
                <strong>฿{formatMoney(item.line_total)}</strong>
              </div>
            ))}
          </div>
          <p style={{ margin: "8px 0 0" }}>Total: ฿{formatMoney(receiptPreview.total)}</p>
          <p style={{ margin: "2px 0 0" }}>Paid: ฿{formatMoney(receiptPreview.paid_total)}</p>
        </div>
      ) : null}

      <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 12, background: "#fff" }}>
        <h3 style={{ marginTop: 0 }}>Current Shift Orders</h3>
        <div style={{ display: "grid", gap: 8 }}>
          {orders.map((order) => (
            <div key={order.id} style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 8, background: "#f8fafc" }}>
              <strong>{order.order_no}</strong>
              <p style={{ margin: "4px 0 0", color: "#475569" }}>
                {order.status} | ฿{formatMoney(order.grand_total)} | paid ฿{formatMoney(order.paid_total)} | {new Date(order.created_at).toLocaleString()}
              </p>
            </div>
          ))}
          {orders.length === 0 ? <p style={{ margin: 0, color: "#64748b" }}>No orders in current shift.</p> : null}
        </div>
      </div>

      <small style={{ color: "#64748b" }}>Lang: {lang}</small>

      {attendanceOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,23,42,0.45)",
            display: "grid",
            placeItems: "center",
            zIndex: 70,
            padding: 14
          }}
          onClick={() => setAttendanceOpen(false)}
        >
          <section
            style={{
              width: "min(980px, 96vw)",
              maxHeight: "86vh",
              overflow: "auto",
              borderRadius: 14,
              border: "1px solid #cbd5e1",
              background: "#fff",
              padding: 14
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
              <h3 style={{ margin: 0 }}>Staff Attendance ({attendance?.date ?? "-"})</h3>
              <button type="button" onClick={() => setAttendanceOpen(false)}>
                Close
              </button>
            </div>

            <div style={{ marginTop: 10, display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
              <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 8 }}>Checked in: {attendance?.summary.checkedIn ?? 0}</div>
              <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 8 }}>Late: {attendance?.summary.late ?? 0}</div>
              <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 8 }}>On leave: {attendance?.summary.onLeave ?? 0}</div>
              <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 8 }}>Absent: {attendance?.summary.absent ?? 0}</div>
            </div>

            <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
              {(["all", "checked_in", "late", "on_leave", "absent"] as AttendanceFilter[]).map((filter) => (
                <button
                  key={filter}
                  type="button"
                  onClick={() => setAttendanceFilter(filter)}
                  style={{
                    minHeight: 32,
                    borderRadius: 8,
                    border: attendanceFilter === filter ? "2px solid #1d4ed8" : "1px solid #cbd5e1",
                    background: attendanceFilter === filter ? "#eff6ff" : "#fff"
                  }}
                >
                  {filter}
                </button>
              ))}
            </div>

            <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
              {filteredAttendanceStaff.map((row) => (
                <article key={row.user_id} style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 10, background: "#f8fafc" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                    <div>
                      <strong>{row.full_name}</strong>{" "}
                      <small style={{ color: "#64748b" }}>
                        ({row.role ?? "staff"}) - {row.attendance_status}
                      </small>
                      <p style={{ margin: "4px 0 0", color: "#475569" }}>
                        In: {row.checked_in_at ? new Date(row.checked_in_at).toLocaleTimeString() : "-"} | Out:{" "}
                        {row.checked_out_at ? new Date(row.checked_out_at).toLocaleTimeString() : "-"} | Late {row.late_minutes} min
                      </p>
                      {row.note ? <p style={{ margin: "4px 0 0", color: "#475569" }}>Note: {row.note}</p> : null}
                    </div>
                    {attendance?.can_manage ? (
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "flex-start" }}>
                        <button type="button" disabled={attendanceBusy} onClick={() => void applyManualAttendanceStatus(row.user_id, "checked_in")}>
                          Mark in
                        </button>
                        <button type="button" disabled={attendanceBusy} onClick={() => void applyManualAttendanceStatus(row.user_id, "late")}>
                          Mark late
                        </button>
                        <button type="button" disabled={attendanceBusy} onClick={() => void applyManualAttendanceStatus(row.user_id, "on_leave")}>
                          Mark leave
                        </button>
                        <button type="button" disabled={attendanceBusy} onClick={() => void applyManualAttendanceStatus(row.user_id, "absent")}>
                          Mark absent
                        </button>
                      </div>
                    ) : null}
                  </div>
                </article>
              ))}
              {filteredAttendanceStaff.length === 0 ? <p style={{ color: "#64748b" }}>No staff in this filter.</p> : null}
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
