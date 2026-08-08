"use client";

import { FormEvent, useState } from "react";
import { EmptyState, ErrorState, LoadingState } from "@/components/backoffice/list-state";
import { PaginationControls } from "@/components/backoffice/pagination-controls";
import { usePaginatedApi } from "@/components/backoffice/use-paginated-api";

type ShiftRow = {
  id: string;
  opened_by: string;
  closed_by: string | null;
  opened_at: string;
  closed_at: string | null;
  opening_cash: number;
  expected_cash: number | null;
  actual_cash: number | null;
  status: string;
};

async function safeJson(response: Response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export function ShiftsModule() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [openError, setOpenError] = useState<string | null>(null);
  const [openSuccess, setOpenSuccess] = useState<string | null>(null);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [closeSuccess, setCloseSuccess] = useState<string | null>(null);
  const [submittingOpen, setSubmittingOpen] = useState(false);
  const [submittingClose, setSubmittingClose] = useState(false);

  const { loading, error, items, pagination } = usePaginatedApi<ShiftRow>("/api/backoffice/shifts", {
    page,
    page_size: 10,
    status: status || undefined
  });

  async function handleOpenShift(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmittingOpen(true);
    setOpenError(null);
    setOpenSuccess(null);
    const form = new FormData(event.currentTarget);
    const openingCash = Number(form.get("opening_cash") ?? 0);

    try {
      const response = await fetch("/api/backoffice/shifts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ opening_cash: openingCash })
      });
      const body = await safeJson(response);
      if (!response.ok || body?.error) {
        throw new Error(body?.error?.message ?? "Open shift failed.");
      }
      setOpenSuccess(`Shift opened: ${body?.data?.id ?? "success"}`);
      setPage(1);
    } catch (submitError) {
      setOpenError(submitError instanceof Error ? submitError.message : "Unknown error");
    } finally {
      setSubmittingOpen(false);
    }
  }

  async function handleCloseShift(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmittingClose(true);
    setCloseError(null);
    setCloseSuccess(null);
    const form = new FormData(event.currentTarget);
    const payload = {
      shift_id: String(form.get("shift_id") ?? ""),
      expected_cash: Number(form.get("expected_cash") ?? 0),
      actual_cash: Number(form.get("actual_cash") ?? 0),
      manager_override_approval_id: String(form.get("manager_override_approval_id") ?? "").trim() || undefined
    };

    try {
      const response = await fetch("/api/backoffice/shifts/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const body = await safeJson(response);
      if (!response.ok || body?.error) {
        throw new Error(body?.error?.message ?? "Close shift failed.");
      }
      setCloseSuccess(`Shift closed: ${body?.data?.shift_id ?? payload.shift_id}`);
      setPage(1);
    } catch (submitError) {
      setCloseError(submitError instanceof Error ? submitError.message : "Unknown error");
    } finally {
      setSubmittingClose(false);
    }
  }

  return (
    <section className="surface">
      <h2>Shift Management</h2>
      <p style={{ color: "var(--muted)" }}>Real API integration for open/close and shift history listing.</p>

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <select
          value={status}
          onChange={(event) => {
            setPage(1);
            setStatus(event.target.value);
          }}
          style={{ minHeight: 42 }}
        >
          <option value="">All Status</option>
          <option value="open">open</option>
          <option value="closed">closed</option>
        </select>
      </div>

      {loading ? <LoadingState label="Loading shifts..." /> : null}
      {!loading && error ? <ErrorState message={error} /> : null}
      {!loading && !error && items.length === 0 ? <EmptyState label="No shifts found for current filters." /> : null}

      {!loading && !error && items.length > 0 ? (
        <>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: 8 }}>Shift ID</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: 8 }}>Opened</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: 8 }}>Closed</th>
                  <th style={{ textAlign: "right", borderBottom: "1px solid var(--border)", padding: 8 }}>Opening</th>
                  <th style={{ textAlign: "right", borderBottom: "1px solid var(--border)", padding: 8 }}>Expected</th>
                  <th style={{ textAlign: "right", borderBottom: "1px solid var(--border)", padding: 8 }}>Actual</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: 8 }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {items.map((shift) => (
                  <tr key={shift.id}>
                    <td style={{ borderBottom: "1px solid var(--border)", padding: 8 }}>{shift.id}</td>
                    <td style={{ borderBottom: "1px solid var(--border)", padding: 8 }}>{new Date(shift.opened_at).toLocaleString()}</td>
                    <td style={{ borderBottom: "1px solid var(--border)", padding: 8 }}>
                      {shift.closed_at ? new Date(shift.closed_at).toLocaleString() : "-"}
                    </td>
                    <td style={{ borderBottom: "1px solid var(--border)", padding: 8, textAlign: "right" }}>
                      {Number(shift.opening_cash).toFixed(2)}
                    </td>
                    <td style={{ borderBottom: "1px solid var(--border)", padding: 8, textAlign: "right" }}>
                      {shift.expected_cash === null ? "-" : Number(shift.expected_cash).toFixed(2)}
                    </td>
                    <td style={{ borderBottom: "1px solid var(--border)", padding: 8, textAlign: "right" }}>
                      {shift.actual_cash === null ? "-" : Number(shift.actual_cash).toFixed(2)}
                    </td>
                    <td style={{ borderBottom: "1px solid var(--border)", padding: 8 }}>{shift.status}</td>
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

      <hr style={{ margin: "18px 0", borderColor: "var(--border)" }} />

      <h3>Open Shift</h3>
      <form onSubmit={handleOpenShift} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input name="opening_cash" type="number" step="0.01" min="0" placeholder="Opening cash" style={{ minHeight: 42, padding: "8px 10px" }} required />
        <button type="submit" style={{ minHeight: 42 }} disabled={submittingOpen}>
          {submittingOpen ? "Opening..." : "Open Shift"}
        </button>
      </form>
      {openError ? <p style={{ color: "#b42318" }}>{openError}</p> : null}
      {openSuccess ? <p style={{ color: "#067647" }}>{openSuccess}</p> : null}

      <h3>Close Shift</h3>
      <form onSubmit={handleCloseShift} className="grid cols-4">
        <input name="shift_id" placeholder="shift_id" required style={{ minHeight: 42, padding: "8px 10px" }} />
        <input name="expected_cash" type="number" step="0.01" required placeholder="expected_cash" style={{ minHeight: 42, padding: "8px 10px" }} />
        <input name="actual_cash" type="number" step="0.01" required placeholder="actual_cash" style={{ minHeight: 42, padding: "8px 10px" }} />
        <input name="manager_override_approval_id" placeholder="manager_override_approval_id (optional)" style={{ minHeight: 42, padding: "8px 10px" }} />
        <button type="submit" style={{ minHeight: 42 }} disabled={submittingClose}>
          {submittingClose ? "Closing..." : "Close Shift"}
        </button>
      </form>
      {closeError ? <p style={{ color: "#b42318" }}>{closeError}</p> : null}
      {closeSuccess ? <p style={{ color: "#067647" }}>{closeSuccess}</p> : null}
    </section>
  );
}
