"use client";

import { useState } from "react";
import { EmptyState, ErrorState, LoadingState } from "@/components/backoffice/list-state";
import { PaginationControls } from "@/components/backoffice/pagination-controls";
import { usePaginatedApi } from "@/components/backoffice/use-paginated-api";

type AuditRow = {
  id: string;
  module: string;
  action: string;
  role: string;
  entity_type: string;
  entity_id: string | null;
  target_table: string;
  target_id: string | null;
  created_at: string;
  metadata?: Record<string, unknown>;
};

export function AuditModule() {
  const [page, setPage] = useState(1);
  const [moduleFilter, setModuleFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [search, setSearch] = useState("");

  const { loading, error, items, pagination } = usePaginatedApi<AuditRow>("/api/backoffice/audit-logs", {
    page,
    page_size: 20,
    module: moduleFilter || undefined,
    action: actionFilter || undefined,
    search: search || undefined
  });

  return (
    <section className="surface">
      <h2>User Behavior Audit</h2>
      <p style={{ color: "var(--muted)" }}>Manager/Owner-scoped audit stream with filter and search controls.</p>

      <div className="grid cols-4" style={{ marginBottom: 12 }}>
        <input
          value={search}
          placeholder="Search module/action/entity"
          onChange={(event) => {
            setPage(1);
            setSearch(event.target.value);
          }}
          style={{ minHeight: 42, padding: "8px 10px" }}
        />
        <input
          value={moduleFilter}
          placeholder="module (e.g. stock, shift)"
          onChange={(event) => {
            setPage(1);
            setModuleFilter(event.target.value);
          }}
          style={{ minHeight: 42, padding: "8px 10px" }}
        />
        <input
          value={actionFilter}
          placeholder="action"
          onChange={(event) => {
            setPage(1);
            setActionFilter(event.target.value);
          }}
          style={{ minHeight: 42, padding: "8px 10px" }}
        />
      </div>

      {loading ? <LoadingState label="Loading audit logs..." /> : null}
      {!loading && error ? <ErrorState message={error} /> : null}
      {!loading && !error && items.length === 0 ? <EmptyState label="No audit logs found for current filters." /> : null}

      {!loading && !error && items.length > 0 ? (
        <>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: 8 }}>Time</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: 8 }}>Module</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: 8 }}>Action</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: 8 }}>Role</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: 8 }}>Entity</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: 8 }}>Target</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: 8 }}>Metadata</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr key={row.id}>
                    <td style={{ borderBottom: "1px solid var(--border)", padding: 8 }}>{new Date(row.created_at).toLocaleString()}</td>
                    <td style={{ borderBottom: "1px solid var(--border)", padding: 8 }}>{row.module}</td>
                    <td style={{ borderBottom: "1px solid var(--border)", padding: 8 }}>{row.action}</td>
                    <td style={{ borderBottom: "1px solid var(--border)", padding: 8 }}>{row.role}</td>
                    <td style={{ borderBottom: "1px solid var(--border)", padding: 8 }}>
                      {row.entity_type}
                      {row.entity_id ? `:${row.entity_id}` : ""}
                    </td>
                    <td style={{ borderBottom: "1px solid var(--border)", padding: 8 }}>
                      {row.target_table}
                      {row.target_id ? `:${row.target_id}` : ""}
                    </td>
                    <td style={{ borderBottom: "1px solid var(--border)", padding: 8, maxWidth: 360, whiteSpace: "pre-wrap" }}>
                      {row.metadata ? JSON.stringify(row.metadata).slice(0, 220) : "-"}
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
