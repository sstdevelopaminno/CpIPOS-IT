"use client";

import { useState } from "react";
import { EmptyState, ErrorState, LoadingState } from "@/components/backoffice/list-state";
import { PaginationControls } from "@/components/backoffice/pagination-controls";
import { usePaginatedApi } from "@/components/backoffice/use-paginated-api";

type OrderRow = {
  id: string;
  order_no: string;
  order_type: string;
  channel: string;
  external_order_code: string | null;
  customer_name: string | null;
  total_amount: number;
  status: string;
  created_at: string;
  transfer_verification: {
    verification_status: string;
    parsed_amount: number | null;
    parsed_payer_name: string | null;
    parsed_payee_name: string | null;
    parsed_reference_no: string | null;
    parsed_transaction_id: string | null;
    verified_at: string;
    override_approval_id: string | null;
  } | null;
};

export function OrdersModule() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [orderType, setOrderType] = useState("");
  const [channel, setChannel] = useState("");
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [mutationSuccess, setMutationSuccess] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const { loading, error, items, pagination } = usePaginatedApi<OrderRow>("/api/backoffice/orders", {
    page,
    page_size: 10,
    search: search || undefined,
    status: status || undefined,
    order_type: orderType || undefined,
    channel: channel || undefined,
    reload: reloadKey
  });

  async function handleReprint(orderId: string) {
    setBusyOrderId(orderId);
    setMutationError(null);
    setMutationSuccess(null);
    try {
      const response = await fetch(`/api/backoffice/orders/${orderId}/reprint`, {
        method: "POST"
      });
      const body = await response.json();
      if (!response.ok || body.error) {
        throw new Error(body.error?.message ?? "Reprint failed.");
      }
      setMutationSuccess(`Reprint requested for order ${orderId}`);
      setReloadKey((key) => key + 1);
    } catch (reprintError) {
      setMutationError(reprintError instanceof Error ? reprintError.message : "Unknown error");
    } finally {
      setBusyOrderId(null);
    }
  }

  return (
    <section className="surface">
      <h2>Orders & Receipts</h2>
      <p style={{ color: "var(--muted)" }}>
        Real API mode with pagination, filtering, and search. Tenant/branch scoped by authenticated claims.
      </p>

      <div className="grid cols-4" style={{ marginBottom: 12 }}>
        <input
          placeholder="Search order no / external code / customer"
          value={search}
          onChange={(event) => {
            setPage(1);
            setSearch(event.target.value);
          }}
          style={{ minHeight: 42, padding: "8px 10px" }}
        />
        <select
          value={status}
          onChange={(event) => {
            setPage(1);
            setStatus(event.target.value);
          }}
          style={{ minHeight: 42 }}
        >
          <option value="">All Status</option>
          <option value="draft">draft</option>
          <option value="queued">queued</option>
          <option value="preparing">preparing</option>
          <option value="completed">completed</option>
          <option value="cancelled">cancelled</option>
        </select>
        <select
          value={orderType}
          onChange={(event) => {
            setPage(1);
            setOrderType(event.target.value);
          }}
          style={{ minHeight: 42 }}
        >
          <option value="">All Type</option>
          <option value="dine_in">dine_in</option>
          <option value="takeaway">takeaway</option>
          <option value="delivery_manual">delivery_manual</option>
        </select>
        <select
          value={channel}
          onChange={(event) => {
            setPage(1);
            setChannel(event.target.value);
          }}
          style={{ minHeight: 42 }}
        >
          <option value="">All Channel</option>
          <option value="storefront">storefront</option>
          <option value="walk_home">walk_home</option>
          <option value="grab">grab</option>
          <option value="line_man">line_man</option>
          <option value="shopee">shopee</option>
          <option value="merchant_app">merchant_app</option>
          <option value="other">other</option>
        </select>
      </div>

      {mutationError ? <ErrorState message={mutationError} /> : null}
      {mutationSuccess ? <p style={{ color: "#067647" }}>{mutationSuccess}</p> : null}

      {loading ? <LoadingState label="Loading orders..." /> : null}
      {!loading && error ? <ErrorState message={error} /> : null}
      {!loading && !error && items.length === 0 ? <EmptyState label="No orders found for current filters." /> : null}

      {!loading && !error && items.length > 0 ? (
        <>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: 8 }}>Order No</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: 8 }}>Type</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: 8 }}>Channel</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: 8 }}>External Code</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: 8 }}>Customer</th>
                  <th style={{ textAlign: "right", borderBottom: "1px solid var(--border)", padding: 8 }}>Total</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: 8 }}>Status</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: 8 }}>Transfer Verify</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: 8 }}>Slip Ref</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: 8 }}>Created</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: 8 }}>Print</th>
                </tr>
              </thead>
              <tbody>
                {items.map((order) => (
                  <tr key={order.id}>
                    <td style={{ borderBottom: "1px solid var(--border)", padding: 8 }}>{order.order_no}</td>
                    <td style={{ borderBottom: "1px solid var(--border)", padding: 8 }}>{order.order_type}</td>
                    <td style={{ borderBottom: "1px solid var(--border)", padding: 8 }}>{order.channel}</td>
                    <td style={{ borderBottom: "1px solid var(--border)", padding: 8 }}>{order.external_order_code ?? "-"}</td>
                    <td style={{ borderBottom: "1px solid var(--border)", padding: 8 }}>{order.customer_name ?? "-"}</td>
                    <td style={{ borderBottom: "1px solid var(--border)", padding: 8, textAlign: "right" }}>
                      {Number(order.total_amount).toFixed(2)}
                    </td>
                    <td style={{ borderBottom: "1px solid var(--border)", padding: 8 }}>{order.status}</td>
                    <td style={{ borderBottom: "1px solid var(--border)", padding: 8 }}>
                      {order.transfer_verification ? (
                        <>
                          <strong>{order.transfer_verification.verification_status}</strong>
                          {order.transfer_verification.override_approval_id ? " (override)" : ""}
                        </>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td style={{ borderBottom: "1px solid var(--border)", padding: 8 }}>
                      {order.transfer_verification?.parsed_reference_no ??
                        order.transfer_verification?.parsed_transaction_id ??
                        "-"}
                    </td>
                    <td style={{ borderBottom: "1px solid var(--border)", padding: 8 }}>
                      {new Date(order.created_at).toLocaleString()}
                    </td>
                    <td style={{ borderBottom: "1px solid var(--border)", padding: 8 }}>
                      <button
                        type="button"
                        disabled={busyOrderId === order.id}
                        onClick={() => handleReprint(order.id)}
                        style={{ minHeight: 36 }}
                      >
                        {busyOrderId === order.id ? "Reprinting..." : "Reprint"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 10 }}>
            <PaginationControls page={pagination.page} totalPages={pagination.total_pages} onPageChange={setPage} />
          </div>
        </>
      ) : null}
    </section>
  );
}
