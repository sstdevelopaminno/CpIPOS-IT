"use client";

import { useState } from "react";
import { EmptyState, ErrorState, LoadingState } from "@/components/backoffice/list-state";
import { PaginationControls } from "@/components/backoffice/pagination-controls";
import { usePaginatedApi } from "@/components/backoffice/use-paginated-api";

type StaffRow = {
  id: string;
  user_id: string;
  role: "owner" | "manager" | "staff";
  is_default: boolean;
  users_profiles: {
    id: string;
    full_name: string;
    email: string;
    is_active: boolean;
    platform_role: string;
  } | null;
};

export function StaffModule() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [isActiveFilter, setIsActiveFilter] = useState("");
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [mutationSuccess, setMutationSuccess] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const { loading, error, items, pagination } = usePaginatedApi<StaffRow>("/api/backoffice/staff", {
    page,
    page_size: 10,
    search: search || undefined,
    role: roleFilter || undefined,
    is_active: isActiveFilter || undefined,
    reload: reloadKey
  });

  async function patchStaff(userId: string, payload: Record<string, unknown>) {
    setBusyUserId(userId);
    setMutationError(null);
    setMutationSuccess(null);
    try {
      const response = await fetch("/api/backoffice/staff", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          ...payload
        })
      });
      const body = await response.json();
      if (!response.ok || body.error) {
        throw new Error(body.error?.message ?? "Update failed.");
      }
      setMutationSuccess(`Updated ${userId}`);
      setReloadKey((key) => key + 1);
    } catch (updateError) {
      setMutationError(updateError instanceof Error ? updateError.message : "Unknown error");
    } finally {
      setBusyUserId(null);
    }
  }

  return (
    <section className="surface">
      <h2>Staff & Roles</h2>
      <p style={{ color: "var(--muted)" }}>
        Real API integration for staff listing and role/status update. Access limited to manager/owner.
      </p>

      <div className="grid cols-4" style={{ marginBottom: 12 }}>
        <input
          placeholder="Search full name or email"
          value={search}
          onChange={(event) => {
            setPage(1);
            setSearch(event.target.value);
          }}
          style={{ minHeight: 42, padding: "8px 10px" }}
        />
        <select
          value={roleFilter}
          onChange={(event) => {
            setPage(1);
            setRoleFilter(event.target.value);
          }}
          style={{ minHeight: 42 }}
        >
          <option value="">All Roles</option>
          <option value="owner">owner</option>
          <option value="manager">manager</option>
          <option value="staff">staff</option>
        </select>
        <select
          value={isActiveFilter}
          onChange={(event) => {
            setPage(1);
            setIsActiveFilter(event.target.value);
          }}
          style={{ minHeight: 42 }}
        >
          <option value="">All Status</option>
          <option value="true">active</option>
          <option value="false">inactive</option>
        </select>
      </div>

      {mutationError ? <ErrorState message={mutationError} /> : null}
      {mutationSuccess ? <p style={{ color: "#067647" }}>{mutationSuccess}</p> : null}

      {loading ? <LoadingState label="Loading staff..." /> : null}
      {!loading && error ? <ErrorState message={error} /> : null}
      {!loading && !error && items.length === 0 ? <EmptyState label="No staff members found for current filters." /> : null}

      {!loading && !error && items.length > 0 ? (
        <>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: 8 }}>Name</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: 8 }}>Email</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: 8 }}>Role</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: 8 }}>Status</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: 8 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => {
                  const profile = row.users_profiles;
                  return (
                    <tr key={row.id}>
                      <td style={{ borderBottom: "1px solid var(--border)", padding: 8 }}>{profile?.full_name ?? "-"}</td>
                      <td style={{ borderBottom: "1px solid var(--border)", padding: 8 }}>{profile?.email ?? "-"}</td>
                      <td style={{ borderBottom: "1px solid var(--border)", padding: 8 }}>{row.role}</td>
                      <td style={{ borderBottom: "1px solid var(--border)", padding: 8 }}>
                        {profile?.is_active ? "active" : "inactive"}
                      </td>
                      <td style={{ borderBottom: "1px solid var(--border)", padding: 8 }}>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <button
                            type="button"
                            disabled={busyUserId === row.user_id}
                            onClick={() => patchStaff(row.user_id, { role: "staff" })}
                            style={{ minHeight: 36 }}
                          >
                            Set staff
                          </button>
                          <button
                            type="button"
                            disabled={busyUserId === row.user_id}
                            onClick={() => patchStaff(row.user_id, { role: "manager" })}
                            style={{ minHeight: 36 }}
                          >
                            Set manager
                          </button>
                          <button
                            type="button"
                            disabled={busyUserId === row.user_id}
                            onClick={() => patchStaff(row.user_id, { is_active: !(profile?.is_active ?? true) })}
                            style={{ minHeight: 36 }}
                          >
                            {profile?.is_active ? "Deactivate" : "Activate"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
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
