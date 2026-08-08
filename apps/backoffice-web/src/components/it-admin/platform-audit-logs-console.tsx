"use client";

import { useCallback, useEffect, useState } from "react";
import type { CSSProperties } from "react";

type AuditItem = {
  id: string;
  tenant_id: string | null;
  branch_id: string | null;
  actor_user_id: string | null;
  action: string;
  target_table: string | null;
  created_at: string;
  metadata: Record<string, unknown> | null;
};

type AuditResponse = {
  data: {
    items: AuditItem[];
    pagination: {
      page: number;
      page_size: number;
      total: number;
      total_pages: number;
    };
  };
  error: { code: string; message: string } | null;
};

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "short", timeStyle: "short" }).format(date);
}

export function PlatformAuditLogsConsole() {
  const [tenantId, setTenantId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [actor, setActor] = useState("");
  const [action, setAction] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [items, setItems] = useState<AuditItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (tenantId) params.set("tenant_id", tenantId);
      if (branchId) params.set("branch_id", branchId);
      if (actor) params.set("actor_user_id", actor);
      if (action) params.set("action", action);
      if (dateFrom) params.set("date_from", dateFrom);
      if (dateTo) params.set("date_to", dateTo);

      const response = await fetch(`/api/it-admin/admin/audit-logs?${params.toString()}`, { cache: "no-store" });
      const payload = (await response.json()) as AuditResponse;
      if (!response.ok || payload.error) {
        throw new Error(payload.error?.message ?? "Failed to load audit logs.");
      }

      setItems(payload.data.items ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load audit logs.");
    } finally {
      setLoading(false);
    }
  }, [action, actor, branchId, dateFrom, dateTo, tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="surface" style={{ display: "grid", gap: 10 }}>
      <h2 style={{ margin: 0 }}>Audit Logs</h2>
      <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
        <input placeholder="tenant_id" value={tenantId} onChange={(event) => setTenantId(event.target.value)} />
        <input placeholder="branch_id" value={branchId} onChange={(event) => setBranchId(event.target.value)} />
        <input placeholder="actor_user_id" value={actor} onChange={(event) => setActor(event.target.value)} />
        <input placeholder="action" value={action} onChange={(event) => setAction(event.target.value)} />
        <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
        <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" className="pos-monitor-btn pos-monitor-btn--primary" onClick={() => void load()} disabled={loading}>
          {loading ? "Loading..." : "Apply Filter"}
        </button>
      </div>
      {error ? <p style={{ margin: 0, color: "#b91c1c" }}>{error}</p> : null}

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={thStyle}>Time</th>
              <th style={thStyle}>Action</th>
              <th style={thStyle}>Tenant/Branch</th>
              <th style={thStyle}>Actor</th>
              <th style={thStyle}>Target</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td style={tdStyle}>{formatDateTime(item.created_at)}</td>
                <td style={tdStyle}>{item.action}</td>
                <td style={tdStyle}>{item.tenant_id ?? "-"}<br />{item.branch_id ?? "-"}</td>
                <td style={tdStyle}>{item.actor_user_id ?? "-"}</td>
                <td style={tdStyle}>{item.target_table ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const thStyle: CSSProperties = {
  textAlign: "left",
  borderBottom: "1px solid #e2e8f0",
  padding: "8px 6px"
};

const tdStyle: CSSProperties = {
  borderBottom: "1px solid #f1f5f9",
  padding: "8px 6px",
  verticalAlign: "top"
};
