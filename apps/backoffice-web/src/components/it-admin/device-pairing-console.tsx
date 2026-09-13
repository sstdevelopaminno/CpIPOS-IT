"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type ApiEnvelope<T> = {
  data: T;
  error: { code?: string; message?: string } | null;
};

type BranchRow = {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
};

type DeviceRow = {
  id: string;
  branch_id: string;
  device_code: string;
  device_name: string;
  device_type: string;
  status: string;
  last_seen_at: string | null;
};

type EnrollmentRow = {
  id: string;
  branch_id: string | null;
  device_code: string;
  device_type: string;
  enrollment_status: string;
  trust_level: string;
  approved_at: string | null;
  revoked_at: string | null;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
};

type TokenResult = {
  activation_token: string;
  token_id: string;
  status: string;
  expires_at: string;
};

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as ApiEnvelope<T>;
  if (!response.ok || payload.error) {
    throw new Error(payload.error?.message ?? "Request failed.");
  }
  return payload.data;
}

const cellStyle = { padding: "8px 10px", borderBottom: "1px solid #e2e8f0", fontSize: 13 };
const headerStyle = { ...cellStyle, color: "#475569", textAlign: "left" as const };

export function DevicePairingConsole({ tenantId }: { tenantId: string }) {
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [enrollments, setEnrollments] = useState<EnrollmentRow[]>([]);
  const [branchId, setBranchId] = useState("");
  const [token, setToken] = useState<TokenResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [branchData, deviceData, enrollmentData] = await Promise.all([
        fetch(`/api/it-admin/v1/tenants/${tenantId}/branches`, { cache: "no-store" }).then((response) =>
          parseResponse<{ branches: BranchRow[] }>(response)
        ),
        fetch(`/api/it-admin/v1/tenants/${tenantId}/devices`, { cache: "no-store" }).then((response) =>
          parseResponse<{ devices: DeviceRow[] }>(response)
        ),
        fetch(`/api/it-admin/v1/device-enrollments?tenant_id=${encodeURIComponent(tenantId)}`, { cache: "no-store" }).then((response) =>
          parseResponse<{ enrollments: EnrollmentRow[] }>(response)
        )
      ]);
      setBranches(branchData.branches);
      setDevices(deviceData.devices);
      setEnrollments(enrollmentData.enrollments);
      setBranchId((current) => current || branchData.branches.find((branch) => branch.is_active)?.id || "");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load device pairing state.");
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  const enrollmentByDeviceCode = useMemo(() => {
    const map = new Map<string, EnrollmentRow>();
    for (const enrollment of enrollments) {
      const existing = map.get(enrollment.device_code);
      if (!existing || new Date(enrollment.updated_at).valueOf() > new Date(existing.updated_at).valueOf()) {
        map.set(enrollment.device_code, enrollment);
      }
    }
    return map;
  }, [enrollments]);

  async function generateToken() {
    if (!branchId) {
      setError("Select a branch before generating a pairing token.");
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    setToken(null);
    try {
      const response = await fetch("/api/it-admin/v1/activation-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenant_id: tenantId,
          branch_id: branchId,
          token_type: "pos_terminal",
          purpose: "device_activation",
          expires_in_minutes: 10,
          metadata: { source: "cpipos_it_pairing_console" }
        })
      });
      const result = await parseResponse<TokenResult>(response);
      setToken(result);
      setSuccess("Pairing token generated. It is shown only in this response and expires shortly.");
    } catch (tokenError) {
      setError(tokenError instanceof Error ? tokenError.message : "Failed to generate pairing token.");
    } finally {
      setBusy(false);
    }
  }

  async function changeEnrollment(id: string, action: "approve" | "revoke") {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch(`/api/it-admin/v1/device-enrollments/${id}/${action}`, { method: "POST" });
      await parseResponse(response);
      setSuccess(action === "approve" ? "Device enrollment approved." : "Device enrollment revoked.");
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : `Failed to ${action} device enrollment.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="surface" style={{ display: "grid", gap: 16 }}>
      <div>
        <h2 style={{ margin: 0 }}>Device enrollment & pairing</h2>
        <p style={{ margin: "6px 0 0", color: "#475569" }}>
          New devices use short-lived activation tokens. Existing production devices without an enrollment record remain explicitly marked as legacy; monitoring compatibility does not make them trusted or paired.
        </p>
      </div>

      {success ? <p style={{ margin: 0, color: "#047857" }}>{success}</p> : null}
      {error ? <p style={{ margin: 0, color: "#b91c1c" }}>{error}</p> : null}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "end" }}>
        <label style={{ display: "grid", gap: 4, minWidth: 260 }}>
          <span style={{ fontSize: 13, color: "#475569" }}>Branch</span>
          <select value={branchId} onChange={(event) => setBranchId(event.target.value)} disabled={busy || loading}>
            <option value="">Select branch</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id} disabled={!branch.is_active}>
                {branch.code} · {branch.name}{branch.is_active ? "" : " (inactive)"}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="pos-monitor-btn" disabled={busy || loading || !branchId} onClick={() => void generateToken()}>
          Generate POS pairing token
        </button>
        <button type="button" className="pos-monitor-btn" disabled={busy || loading} onClick={() => void load()}>
          Refresh
        </button>
      </div>

      {token ? (
        <div style={{ border: "1px solid #f59e0b", borderRadius: 8, padding: 12, background: "#fffbeb" }}>
          <strong>One-time pairing token</strong>
          <div style={{ marginTop: 8, overflowWrap: "anywhere", fontFamily: "monospace", fontSize: 14 }}>{token.activation_token}</div>
          <div style={{ marginTop: 6, fontSize: 13, color: "#92400e" }}>Expires: {formatDateTime(token.expires_at)}</div>
          <div style={{ marginTop: 6, fontSize: 13, color: "#92400e" }}>
            Waiting for the POS/Android agent to consume this token and create a pending enrollment. Do not treat token creation itself as successful pairing.
          </div>
        </div>
      ) : null}

      <div>
        <h3 style={{ margin: "0 0 8px" }}>Registered devices</h3>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={headerStyle}>Device</th>
                <th style={headerStyle}>Runtime status</th>
                <th style={headerStyle}>Pairing</th>
                <th style={headerStyle}>Last seen</th>
                <th style={headerStyle}>MDM</th>
              </tr>
            </thead>
            <tbody>
              {devices.length === 0 ? (
                <tr><td style={cellStyle} colSpan={5}>{loading ? "Loading..." : "No registered devices."}</td></tr>
              ) : (
                devices.map((device) => {
                  const enrollment = enrollmentByDeviceCode.get(device.device_code);
                  const pairing = enrollment ? `${enrollment.enrollment_status} / ${enrollment.trust_level}` : "Legacy · not enrolled";
                  return (
                    <tr key={device.id}>
                      <td style={cellStyle}>{device.device_name} ({device.device_code})</td>
                      <td style={cellStyle}>{device.status}</td>
                      <td style={cellStyle}>{pairing}</td>
                      <td style={cellStyle}>{formatDateTime(device.last_seen_at)}</td>
                      <td style={cellStyle}><a href={`/it-admin/tenants/${tenantId}/devices/${device.id}`}>Open health</a></td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h3 style={{ margin: "0 0 8px" }}>Enrollment requests</h3>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={headerStyle}>Device code</th>
                <th style={headerStyle}>Type</th>
                <th style={headerStyle}>Status</th>
                <th style={headerStyle}>Trust</th>
                <th style={headerStyle}>Updated</th>
                <th style={headerStyle}>Action</th>
              </tr>
            </thead>
            <tbody>
              {enrollments.length === 0 ? (
                <tr><td style={cellStyle} colSpan={6}>No enrollment requests yet.</td></tr>
              ) : (
                enrollments.map((enrollment) => (
                  <tr key={enrollment.id}>
                    <td style={cellStyle}>{enrollment.device_code}</td>
                    <td style={cellStyle}>{enrollment.device_type}</td>
                    <td style={cellStyle}>{enrollment.enrollment_status}</td>
                    <td style={cellStyle}>{enrollment.trust_level}</td>
                    <td style={cellStyle}>{formatDateTime(enrollment.updated_at)}</td>
                    <td style={cellStyle}>
                      {enrollment.enrollment_status === "pending" ? (
                        <button type="button" className="pos-monitor-btn" disabled={busy} onClick={() => void changeEnrollment(enrollment.id, "approve")}>Approve</button>
                      ) : enrollment.enrollment_status === "active" ? (
                        <button type="button" className="pos-monitor-btn" disabled={busy} onClick={() => void changeEnrollment(enrollment.id, "revoke")}>Revoke</button>
                      ) : "-"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
