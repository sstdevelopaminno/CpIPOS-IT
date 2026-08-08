"use client";

import { useEffect, useState } from "react";
import { EmptyState, ErrorState, LoadingState } from "@/components/backoffice/list-state";
import { PaginationControls } from "@/components/backoffice/pagination-controls";
import { usePaginatedApi } from "@/components/backoffice/use-paginated-api";
import { ManagerOverrideModal } from "@/components/pos/manager-override-modal";
import { fetchWithTimeout } from "@/lib/client-fetch";

type OrderRow = {
  id: string;
  order_no: string;
  order_type: string;
  channel: string;
  customer_name: string | null;
  external_order_code: string | null;
  total_amount: number;
  status: string;
  created_at: string;
  cash_received?: number | null;
  change_amount?: number | null;
  payment_completed_at?: string | null;
  seller_name?: string | null;
  cashier_name?: string | null;
  branch_name?: string | null;
  shift_status?: string | null;
};

export function PosOrdersModule() {
  const dateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<OrderRow | null>(null);

  const { loading, error, items, pagination } = usePaginatedApi<OrderRow>("/api/pos/orders", {
    page,
    page_size: 10,
    status: status || undefined,
    search: search || undefined,
    reload: reloadKey
  });

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  async function handleCancel(order: OrderRow, approvalId: string) {
    try {
      const response = await fetchWithTimeout(`/api/pos/orders/${order.id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason: "Cancelled from POS orders module",
          cancellation_approval_id: approvalId
        })
      }, 15000);
      const body = await response.json();
      if (!response.ok || body.error) {
        throw new Error(body.error?.message ?? "Cancel failed.");
      }
      setMessage(`Order ${order.order_no} cancelled.`);
      setReloadKey((key) => key + 1);
    } catch (cancelError) {
      setErrorText(cancelError instanceof Error ? cancelError.message : "Unknown error");
    } finally {
      setCancelTarget(null);
    }
  }

  return (
    <section className="surface">
      <h2>POS Orders</h2>
      <p style={{ color: "var(--muted)" }}>Real order list with manager override cancel bill support.</p>

      <div className="grid cols-4" style={{ marginBottom: 12 }}>
        <input
          value={searchInput}
          onChange={(event) => {
            setSearchInput(event.target.value);
          }}
          placeholder="search order / customer"
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
          <option value="">all statuses</option>
          <option value="queued">queued</option>
          <option value="completed">completed</option>
          <option value="cancelled">cancelled</option>
        </select>
      </div>

      {message ? <p style={{ color: "#067647" }}>{message}</p> : null}
      {errorText ? <ErrorState message={errorText} /> : null}
      {loading ? <LoadingState label="Loading POS orders..." /> : null}
      {!loading && error ? <ErrorState message={error} /> : null}
      {!loading && !error && items.length === 0 ? <EmptyState label="No orders found." /> : null}

      {!loading && !error && items.length > 0 ? (
        <>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: 8 }}>Order</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: 8 }}>Type</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: 8 }}>Seller</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: 8 }}>Branch / Shift</th>
                  <th style={{ textAlign: "right", borderBottom: "1px solid var(--border)", padding: 8 }}>Total</th>
                  <th style={{ textAlign: "right", borderBottom: "1px solid var(--border)", padding: 8 }}>Received</th>
                  <th style={{ textAlign: "right", borderBottom: "1px solid var(--border)", padding: 8 }}>Change</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: 8 }}>Paid At</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: 8 }}>Status</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: 8 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr key={row.id}>
                    <td style={{ borderBottom: "1px solid var(--border)", padding: 8 }}>{row.order_no}</td>
                    <td style={{ borderBottom: "1px solid var(--border)", padding: 8 }}>{row.order_type}</td>
                    <td style={{ borderBottom: "1px solid var(--border)", padding: 8 }}>{row.seller_name ?? "-"}</td>
                    <td style={{ borderBottom: "1px solid var(--border)", padding: 8 }}>
                      {(row.branch_name ?? "-")} / {(row.shift_status ?? "-")}
                    </td>
                    <td style={{ borderBottom: "1px solid var(--border)", padding: 8, textAlign: "right" }}>
                      {Number(row.total_amount).toFixed(2)}
                    </td>
                    <td style={{ borderBottom: "1px solid var(--border)", padding: 8, textAlign: "right" }}>
                      {Number(row.cash_received ?? 0).toFixed(2)}
                    </td>
                    <td style={{ borderBottom: "1px solid var(--border)", padding: 8, textAlign: "right" }}>
                      {Number(row.change_amount ?? 0).toFixed(2)}
                    </td>
                    <td style={{ borderBottom: "1px solid var(--border)", padding: 8 }}>
                      {row.payment_completed_at ? dateTimeFormatter.format(new Date(row.payment_completed_at)) : "-"}
                    </td>
                    <td style={{ borderBottom: "1px solid var(--border)", padding: 8 }}>{row.status}</td>
                    <td style={{ borderBottom: "1px solid var(--border)", padding: 8 }}>
                      <button
                        type="button"
                        onClick={() => setCancelTarget(row)}
                        disabled={row.status !== "queued"}
                        style={{ minHeight: 36 }}
                      >
                        Cancel bill
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

      <ManagerOverrideModal
        open={Boolean(cancelTarget)}
        title="Manager Override: Cancel Bill"
        action="cancel_bill"
        targetTable="orders"
        targetId={cancelTarget?.id ?? ""}
        onClose={() => setCancelTarget(null)}
        onApproved={(approvalId) => {
          if (!cancelTarget) return;
          void handleCancel(cancelTarget, approvalId);
        }}
      />
    </section>
  );
}
