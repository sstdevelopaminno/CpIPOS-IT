"use client";

import { FormEvent, useEffect, useState } from "react";
import { ErrorState, LoadingState } from "@/components/backoffice/list-state";
import { ManagerOverrideModal } from "@/components/pos/manager-override-modal";
import { fetchWithTimeout } from "@/lib/client-fetch";

type ShiftResponse = {
  current_shift: {
    id: string;
    status: string;
    opening_cash: number;
    expected_cash: number | null;
    actual_cash: number | null;
    opened_at: string;
    closed_at: string | null;
  } | null;
  queued_orders: number;
};

export function PosShiftModule() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ShiftResponse | null>(null);
  const [openCash, setOpenCash] = useState("0");
  const [closeShiftId, setCloseShiftId] = useState("");
  const [expectedCash, setExpectedCash] = useState("");
  const [actualCash, setActualCash] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [overrideModal, setOverrideModal] = useState(false);
  const [overrideApprovalId, setOverrideApprovalId] = useState<string | null>(null);
  const [closeNeedOverridePayload, setCloseNeedOverridePayload] = useState<{
    shift_id: string;
    expected_cash: number;
    actual_cash: number;
  } | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchWithTimeout("/api/pos/shift", { cache: "no-store" }, 10000);
      const body = await response.json();
      if (!response.ok || body.error) {
        throw new Error(body.error?.message ?? "Shift load failed.");
      }
      setData(body.data as ShiftResponse);
      if (body.data.current_shift?.id) {
        setCloseShiftId(body.data.current_shift.id);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function openShift(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetchWithTimeout("/api/pos/shift", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "open", opening_cash: Number(openCash) })
      }, 15000);
      const body = await response.json();
      if (!response.ok || body.error) {
        throw new Error(body.error?.message ?? "Open shift failed.");
      }
      setMessage("Shift opened.");
      await load();
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : "Unknown error");
    } finally {
      setBusy(false);
    }
  }

  async function closeShiftWith(payload: {
    shift_id: string;
    expected_cash: number;
    actual_cash: number;
    manager_override_approval_id?: string;
  }) {
    const response = await fetchWithTimeout("/api/pos/shift", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "close", ...payload })
    }, 15000);
    const body = await response.json();
    if (!response.ok || body.error) {
      const code = body?.error?.code;
      const message = body?.error?.message ?? "Close shift failed.";
      const errorObj = new Error(message);
      (errorObj as Error & { code?: string }).code = code;
      throw errorObj;
    }
  }

  async function closeShift(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    setError(null);

    const payload = {
      shift_id: closeShiftId,
      expected_cash: Number(expectedCash || 0),
      actual_cash: Number(actualCash || 0),
      manager_override_approval_id: overrideApprovalId ?? undefined
    };

    try {
      await closeShiftWith(payload);
      setMessage("Shift closed.");
      setOverrideApprovalId(null);
      await load();
    } catch (closeError) {
      const maybeCode = (closeError as Error & { code?: string }).code;
      if (maybeCode === "shift_close_blocked" || closeError instanceof Error) {
        setCloseNeedOverridePayload({
          shift_id: payload.shift_id,
          expected_cash: payload.expected_cash,
          actual_cash: payload.actual_cash
        });
        setOverrideModal(true);
      }
      setError(closeError instanceof Error ? closeError.message : "Unknown error");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <LoadingState label="Loading shift..." />;
  if (error && !data) return <ErrorState message={error} />;

  return (
    <section className="surface">
      <h2>POS Shift</h2>
      <p style={{ color: "var(--muted)" }}>Open/close shift with manager override modal for mismatch/unpaid dine-in.</p>
      {message ? <p style={{ color: "#067647" }}>{message}</p> : null}
      {error ? <p style={{ color: "#b42318" }}>{error}</p> : null}

      <div style={{ marginBottom: 16 }}>
        <h3>Current Shift</h3>
        <p>Shift: {data?.current_shift?.id ?? "None"}</p>
        <p>Status: {data?.current_shift?.status ?? "-"}</p>
        <p>Queued orders: {data?.queued_orders ?? 0}</p>
      </div>

      <form onSubmit={openShift} style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        <input
          type="number"
          step="0.01"
          min={0}
          value={openCash}
          onChange={(e) => setOpenCash(e.target.value)}
          placeholder="opening_cash"
          style={{ minHeight: 42, padding: "8px 10px" }}
        />
        <button type="submit" disabled={busy} style={{ minHeight: 42 }}>
          Open shift
        </button>
      </form>

      <form onSubmit={closeShift} className="grid cols-4">
        <input
          value={closeShiftId}
          onChange={(e) => setCloseShiftId(e.target.value)}
          placeholder="shift_id"
          style={{ minHeight: 42, padding: "8px 10px" }}
          required
        />
        <input
          value={expectedCash}
          onChange={(e) => setExpectedCash(e.target.value)}
          placeholder="expected_cash"
          type="number"
          step="0.01"
          style={{ minHeight: 42, padding: "8px 10px" }}
          required
        />
        <input
          value={actualCash}
          onChange={(e) => setActualCash(e.target.value)}
          placeholder="actual_cash"
          type="number"
          step="0.01"
          style={{ minHeight: 42, padding: "8px 10px" }}
          required
        />
        <button type="submit" disabled={busy} style={{ minHeight: 42 }}>
          Close shift
        </button>
      </form>

      <ManagerOverrideModal
        open={overrideModal}
        title="Manager Override: Shift Mismatch"
        action="shift_close_override"
        targetTable="shifts"
        targetId={closeNeedOverridePayload?.shift_id ?? ""}
        onClose={() => setOverrideModal(false)}
        onApproved={async (approvalId) => {
          setOverrideModal(false);
          setOverrideApprovalId(approvalId);
          if (!closeNeedOverridePayload) return;
          try {
            await closeShiftWith({
              ...closeNeedOverridePayload,
              manager_override_approval_id: approvalId
            });
            setMessage("Shift closed with manager override.");
            await load();
          } catch (closeError) {
            setError(closeError instanceof Error ? closeError.message : "Close failed.");
          }
        }}
      />
    </section>
  );
}
