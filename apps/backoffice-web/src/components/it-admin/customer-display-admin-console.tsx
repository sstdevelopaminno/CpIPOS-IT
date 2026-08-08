"use client";

import { useEffect, useMemo, useState } from "react";

type DeviceItem = {
  id: string;
  tenant_id: string;
  tenant_code: string | null;
  tenant_name: string | null;
  branch_id: string;
  branch_code: string | null;
  branch_name: string | null;
  channel: string;
  device_name: string | null;
  is_active: boolean;
  token_expired: boolean;
  pair_code_expires_at: string;
  pair_code_used_at: string | null;
  device_token_expires_at: string | null;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
};

type DevicesResponse = {
  data: {
    summary: { total: number; active: number; inactive: number; expired: number };
    devices: DeviceItem[];
  };
  error: null | { code: string; message: string };
};

type PolicyResponse = {
  data: {
    effective_policy: {
      maxActiveDevices: number;
      inactiveExpireHours: number;
      source: "default" | "table";
    };
    policies: Array<{
      id: string;
      tenant_id: string;
      branch_id: string;
      channel: string;
      max_active_devices: number;
      inactive_expire_hours: number;
      is_active: boolean;
      updated_at: string;
    }>;
  };
  error: null | { code: string; message: string };
};

function formatDateTime(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "short", timeStyle: "medium" }).format(date);
}

export function CustomerDisplayAdminConsole() {
  const [devices, setDevices] = useState<DeviceItem[]>([]);
  const [summary, setSummary] = useState<{ total: number; active: number; inactive: number; expired: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tenantId, setTenantId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [channel, setChannel] = useState("main");
  const [activeOnly, setActiveOnly] = useState(false);
  const [includePending, setIncludePending] = useState(false);

  const [policyBusy, setPolicyBusy] = useState(false);
  const [policyError, setPolicyError] = useState<string | null>(null);
  const [policySource, setPolicySource] = useState<"default" | "table">("default");
  const [policyMaxActive, setPolicyMaxActive] = useState(4);
  const [policyInactiveHours, setPolicyInactiveHours] = useState(72);

  const tenantOptions = useMemo(() => {
    const map = new Map<string, { label: string }>();
    for (const item of devices) {
      if (!map.has(item.tenant_id)) {
        const label = item.tenant_name ? `${item.tenant_name} (${item.tenant_code ?? item.tenant_id})` : item.tenant_id;
        map.set(item.tenant_id, { label });
      }
    }
    return Array.from(map.entries()).map(([value, meta]) => ({ value, label: meta.label }));
  }, [devices]);

  const branchOptions = useMemo(() => {
    const map = new Map<string, { label: string; tenantId: string }>();
    for (const item of devices) {
      if (tenantId && item.tenant_id !== tenantId) continue;
      if (!map.has(item.branch_id)) {
        const label = item.branch_name ? `${item.branch_name} (${item.branch_code ?? item.branch_id})` : item.branch_id;
        map.set(item.branch_id, { label, tenantId: item.tenant_id });
      }
    }
    return Array.from(map.entries()).map(([value, meta]) => ({ value, label: meta.label, tenantId: meta.tenantId }));
  }, [devices, tenantId]);

  async function loadDevices() {
    setLoading(true);
    setError(null);
    try {
      const search = new URLSearchParams();
      search.set("limit", "300");
      search.set("active_only", activeOnly ? "1" : "0");
      search.set("include_pending", includePending ? "1" : "0");
      if (tenantId) search.set("tenant_id", tenantId);
      if (branchId) search.set("branch_id", branchId);
      if (channel) search.set("channel", channel);

      const response = await fetch(`/api/it-admin/customer-display/devices?${search.toString()}`, { cache: "no-store" });
      const payload = (await response.json()) as DevicesResponse;
      if (!response.ok || payload.error) {
        throw new Error(payload.error?.message ?? "Failed to load paired devices.");
      }

      setDevices(payload.data.devices ?? []);
      setSummary(payload.data.summary ?? null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load paired devices.");
    } finally {
      setLoading(false);
    }
  }

  async function loadPolicy() {
    if (!tenantId || !branchId) return;
    setPolicyBusy(true);
    setPolicyError(null);
    try {
      const search = new URLSearchParams({
        tenant_id: tenantId,
        branch_id: branchId,
        channel: channel || "main"
      });
      const response = await fetch(`/api/it-admin/customer-display/policies?${search.toString()}`, { cache: "no-store" });
      const payload = (await response.json()) as PolicyResponse;
      if (!response.ok || payload.error) {
        throw new Error(payload.error?.message ?? "Failed to load policy.");
      }
      const effective = payload.data.effective_policy;
      setPolicySource(effective.source);
      setPolicyMaxActive(effective.maxActiveDevices);
      setPolicyInactiveHours(effective.inactiveExpireHours);
    } catch (policyLoadError) {
      setPolicyError(policyLoadError instanceof Error ? policyLoadError.message : "Failed to load policy.");
    } finally {
      setPolicyBusy(false);
    }
  }

  async function savePolicy() {
    if (!tenantId || !branchId) {
      setPolicyError("Select tenant and branch before saving policy.");
      return;
    }
    setPolicyBusy(true);
    setPolicyError(null);
    try {
      const response = await fetch("/api/it-admin/customer-display/policies", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenant_id: tenantId,
          branch_id: branchId,
          channel: channel || "main",
          max_active_devices: policyMaxActive,
          inactive_expire_hours: policyInactiveHours,
          is_active: true
        })
      });
      const payload = (await response.json()) as { error: null | { message: string } };
      if (!response.ok || payload.error) {
        throw new Error(payload.error?.message ?? "Failed to save policy.");
      }
      setPolicySource("table");
      await loadDevices();
    } catch (policySaveError) {
      setPolicyError(policySaveError instanceof Error ? policySaveError.message : "Failed to save policy.");
    } finally {
      setPolicyBusy(false);
    }
  }

  async function revokeDevice(id: string) {
    setError(null);
    try {
      const response = await fetch("/api/it-admin/customer-display/devices", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pairing_id: id, reason: "it_admin_manual_revoke" })
      });
      const payload = (await response.json()) as { error: null | { message: string } };
      if (!response.ok || payload.error) {
        throw new Error(payload.error?.message ?? "Failed to revoke device.");
      }
      await loadDevices();
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : "Failed to revoke device.");
    }
  }

  useEffect(() => {
    void loadDevices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (tenantId && branchId) {
      void loadPolicy();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, branchId, channel]);

  return (
    <section className="surface" style={{ display: "grid", gap: 12 }}>
      <h2 style={{ margin: 0 }}>Customer Display Devices</h2>
      <p style={{ margin: 0, color: "#475569" }}>
        จัดการเครื่องจอลูกค้าแบบหลายอุปกรณ์: ดูสถานะ, revoke รายเครื่อง, และตั้ง policy จำกัดจำนวนเครื่องต่อ channel
      </p>

      <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
        <label style={{ display: "grid", gap: 4 }}>
          <span>Tenant</span>
          <select value={tenantId} onChange={(event) => setTenantId(event.target.value)}>
            <option value="">All tenants</option>
            {tenantOptions.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span>Branch</span>
          <select value={branchId} onChange={(event) => setBranchId(event.target.value)}>
            <option value="">All branches</option>
            {branchOptions.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span>Channel</span>
          <input value={channel} onChange={(event) => setChannel(event.target.value || "main")} />
        </label>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <input type="checkbox" checked={activeOnly} onChange={(event) => setActiveOnly(event.target.checked)} />
          Active only
        </label>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <input type="checkbox" checked={includePending} onChange={(event) => setIncludePending(event.target.checked)} />
          Include pending code rows
        </label>
        <div style={{ display: "flex", alignItems: "end", gap: 8 }}>
          <button type="button" className="pos-monitor-btn pos-monitor-btn--primary" onClick={() => void loadDevices()} disabled={loading}>
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>
      </div>

      {summary ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, fontSize: 14 }}>
          <span>Total: {summary.total}</span>
          <span>Active: {summary.active}</span>
          <span>Inactive: {summary.inactive}</span>
          <span>Token expired: {summary.expired}</span>
        </div>
      ) : null}

      {error ? <p style={{ margin: 0, color: "#b91c1c" }}>{error}</p> : null}

      <div style={{ border: "1px solid #dbe3ef", borderRadius: 10, padding: 10, display: "grid", gap: 8 }}>
        <strong>Policy for selected scope</strong>
        <small style={{ color: "#64748b" }}>
          Source: {policySource === "table" ? "Custom policy from table" : "Default policy"}
        </small>
        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
          <label style={{ display: "grid", gap: 4 }}>
            <span>Max active devices</span>
            <input
              type="number"
              min={1}
              max={64}
              value={policyMaxActive}
              onChange={(event) => setPolicyMaxActive(Math.max(1, Math.min(64, Number(event.target.value || 1))))}
            />
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <span>Inactive auto-expire (hours)</span>
            <input
              type="number"
              min={1}
              max={2160}
              value={policyInactiveHours}
              onChange={(event) => setPolicyInactiveHours(Math.max(1, Math.min(2160, Number(event.target.value || 1))))}
            />
          </label>
          <div style={{ display: "flex", alignItems: "end", gap: 8 }}>
            <button type="button" className="pos-monitor-btn pos-monitor-btn--primary" onClick={() => void savePolicy()} disabled={policyBusy}>
              {policyBusy ? "Saving..." : "Save policy"}
            </button>
          </div>
        </div>
        {policyError ? <p style={{ margin: 0, color: "#b91c1c" }}>{policyError}</p> : null}
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", borderBottom: "1px solid #e2e8f0", padding: "6px 4px" }}>Tenant / Branch</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #e2e8f0", padding: "6px 4px" }}>Channel</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #e2e8f0", padding: "6px 4px" }}>Device</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #e2e8f0", padding: "6px 4px" }}>Last seen</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #e2e8f0", padding: "6px 4px" }}>Token expires</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #e2e8f0", padding: "6px 4px" }}>Status</th>
              <th style={{ textAlign: "right", borderBottom: "1px solid #e2e8f0", padding: "6px 4px" }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {devices.map((item) => (
              <tr key={item.id}>
                <td style={{ borderBottom: "1px solid #f1f5f9", padding: "6px 4px" }}>
                  <div>{item.tenant_name ?? item.tenant_id}</div>
                  <small style={{ color: "#64748b" }}>{item.branch_name ?? item.branch_id}</small>
                </td>
                <td style={{ borderBottom: "1px solid #f1f5f9", padding: "6px 4px" }}>{item.channel}</td>
                <td style={{ borderBottom: "1px solid #f1f5f9", padding: "6px 4px" }}>{item.device_name || "-"}</td>
                <td style={{ borderBottom: "1px solid #f1f5f9", padding: "6px 4px" }}>{formatDateTime(item.last_seen_at)}</td>
                <td style={{ borderBottom: "1px solid #f1f5f9", padding: "6px 4px" }}>{formatDateTime(item.device_token_expires_at)}</td>
                <td style={{ borderBottom: "1px solid #f1f5f9", padding: "6px 4px" }}>
                  {item.is_active ? (item.token_expired ? "active / token expired" : "active") : "revoked"}
                </td>
                <td style={{ borderBottom: "1px solid #f1f5f9", padding: "6px 4px", textAlign: "right" }}>
                  <button
                    type="button"
                    className="pos-monitor-btn"
                    disabled={!item.is_active}
                    onClick={() => {
                      void revokeDevice(item.id);
                    }}
                  >
                    Revoke
                  </button>
                </td>
              </tr>
            ))}
            {devices.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: "12px 4px", color: "#64748b", textAlign: "center" }}>
                  No devices found.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
