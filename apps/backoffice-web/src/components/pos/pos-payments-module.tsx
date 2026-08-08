"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { PaymentMethod } from "@pos/shared-types";
import { EmptyState, ErrorState, LoadingState } from "@/components/backoffice/list-state";
import { fetchWithTimeout } from "@/lib/client-fetch";

type OrderRow = {
  id: string;
  order_no: string;
  order_type: string;
  customer_name: string | null;
  total_amount: number;
  status: string;
  created_at: string;
};

type PaymentLine = {
  method: PaymentMethod;
  amount: number;
  reference_no?: string;
};

export function PosPaymentsModule() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [line1Method, setLine1Method] = useState<PaymentMethod>("cash");
  const [line1AmountInput, setLine1AmountInput] = useState("");
  const [line1Ref, setLine1Ref] = useState("");
  const [line2Enabled, setLine2Enabled] = useState(false);
  const [line2Method, setLine2Method] = useState<PaymentMethod>("bank_transfer");
  const [line2Amount, setLine2Amount] = useState("");
  const [line2Ref, setLine2Ref] = useState("");
  const [printKitchen, setPrintKitchen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const selectedOrder = useMemo(() => orders.find((order) => order.id === selectedOrderId) ?? null, [orders, selectedOrderId]);
  const line1Amount = useMemo(() => {
    if (line1AmountInput) return line1AmountInput;
    if (!selectedOrder) return "";
    return Number(selectedOrder.total_amount).toFixed(2);
  }, [line1AmountInput, selectedOrder]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchWithTimeout("/api/pos/payments?status=queued", { cache: "no-store" }, 10000);
      const body = await response.json();
      if (!response.ok || body.error) {
        throw new Error(body.error?.message ?? "Failed to load queued orders.");
      }
      const items = (body.data.items ?? []) as OrderRow[];
      setOrders(items);
      setSelectedOrderId((current) => (current || items[0]?.id || ""));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function submitPayment() {
    if (!selectedOrder) {
      setMessage("Select order first.");
      return;
    }

    const lines: PaymentLine[] = [
      { method: line1Method, amount: Number(line1Amount || 0), reference_no: line1Ref || undefined }
    ];
    if (line2Enabled) {
      lines.push({ method: line2Method, amount: Number(line2Amount || 0), reference_no: line2Ref || undefined });
    }

    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetchWithTimeout("/api/pos/payments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-idempotency-key": `pos-pay-${crypto.randomUUID()}`
        },
        body: JSON.stringify({
          order_id: selectedOrder.id,
          payment_lines: lines,
          print_kitchen_ticket: printKitchen
        })
      }, 20000);
      const body = await response.json();
      if (!response.ok || body.error) {
        throw new Error(body.error?.message ?? "Payment failed.");
      }
      setMessage(
        `Payment success. Group=${body.data.payment_group_id || "-"}, print jobs=${body.data.print_jobs_queued}`
      );
      await load();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unknown error");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <LoadingState label="Loading queued POS orders..." />;
  if (error && !orders.length) return <ErrorState message={error} />;

  return (
    <section className="surface">
      <h2>POS Payments</h2>
      <p style={{ color: "var(--muted)" }}>
        Cash/transfer flow with split-payment-ready structure, retry-safe submit, and print trigger.
      </p>

      {message ? <p style={{ color: "#067647" }}>{message}</p> : null}
      {error ? <p style={{ color: "#b42318" }}>{error}</p> : null}

      {orders.length === 0 ? <EmptyState label="No queued orders for payment." /> : null}

      {orders.length > 0 ? (
        <div className="grid cols-2" style={{ gap: 12 }}>
          <div>
            <h3>Queued Orders</h3>
            <div style={{ display: "grid", gap: 8 }}>
              {orders.map((order) => (
                <button
                  key={order.id}
                  type="button"
                  onClick={() => {
                    setSelectedOrderId(order.id);
                    setLine1AmountInput("");
                    setLine2Amount("");
                    setLine1Ref("");
                    setLine2Ref("");
                  }}
                  style={{
                    minHeight: 44,
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    background: selectedOrderId === order.id ? "#e6f0ff" : "#fff",
                    textAlign: "left",
                    padding: "8px 10px"
                  }}
                >
                  {order.order_no} | {order.order_type} | {Number(order.total_amount).toFixed(2)}
                </button>
              ))}
            </div>
          </div>

          <div>
            <h3>Payment Entry</h3>
            <p>Order total: {selectedOrder ? Number(selectedOrder.total_amount).toFixed(2) : "-"}</p>
            <div className="grid cols-2">
              <select value={line1Method} onChange={(e) => setLine1Method(e.target.value as PaymentMethod)} style={{ minHeight: 42 }}>
                <option value="cash">cash</option>
                <option value="bank_transfer">bank_transfer</option>
              </select>
              <input
                type="number"
                step="0.01"
                value={line1Amount}
                onChange={(e) => setLine1AmountInput(e.target.value)}
                style={{ minHeight: 42, padding: "8px 10px" }}
              />
            </div>
            <input
              placeholder="reference no (optional)"
              value={line1Ref}
              onChange={(e) => setLine1Ref(e.target.value)}
              style={{ minHeight: 42, padding: "8px 10px", width: "100%", marginTop: 8 }}
            />

            <label style={{ display: "inline-flex", alignItems: "center", gap: 8, marginTop: 8 }}>
              <input
                type="checkbox"
                checked={line2Enabled}
                onChange={(e) => setLine2Enabled(e.target.checked)}
              />
              Enable split payment line
            </label>

            {line2Enabled ? (
              <>
                <div className="grid cols-2" style={{ marginTop: 8 }}>
                  <select value={line2Method} onChange={(e) => setLine2Method(e.target.value as PaymentMethod)} style={{ minHeight: 42 }}>
                    <option value="cash">cash</option>
                    <option value="bank_transfer">bank_transfer</option>
                  </select>
                  <input
                    type="number"
                    step="0.01"
                    value={line2Amount}
                    onChange={(e) => setLine2Amount(e.target.value)}
                    style={{ minHeight: 42, padding: "8px 10px" }}
                  />
                </div>
                <input
                  placeholder="reference no (optional)"
                  value={line2Ref}
                  onChange={(e) => setLine2Ref(e.target.value)}
                  style={{ minHeight: 42, padding: "8px 10px", width: "100%", marginTop: 8 }}
                />
              </>
            ) : null}

            <label style={{ display: "inline-flex", alignItems: "center", gap: 8, marginTop: 8 }}>
              <input
                type="checkbox"
                checked={printKitchen}
                onChange={(e) => setPrintKitchen(e.target.checked)}
              />
              Trigger kitchen print
            </label>

            <button type="button" onClick={submitPayment} disabled={busy || !selectedOrder} style={{ minHeight: 42, marginTop: 8 }}>
              {busy ? "Processing..." : "Complete payment"}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
