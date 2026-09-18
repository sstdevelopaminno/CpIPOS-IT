"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./device-pairing-console.module.css";

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

type OwnershipType = "company_owned" | "company_financed" | "customer_owned" | "byod";

const OWNERSHIP_OPTIONS: Array<{ value: OwnershipType; label: string }> = [
  { value: "company_owned", label: "Company owned · เครื่องบริษัท" },
  { value: "company_financed", label: "Company financed · เครื่องผ่อน/ให้เช่า" },
  { value: "customer_owned", label: "Customer owned · เครื่องลูกค้า" },
  { value: "byod", label: "BYOD · อุปกรณ์ส่วนตัว" }
];

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (!response.ok || !payload || payload.error) {
    throw new Error(payload?.error?.message ?? `Request failed (${response.status}).`);
  }
  return payload.data;
}

function connectionBadge(status: string | undefined) {
  if (status === "active") return `${styles.badge} ${styles.badgeConnected}`;
  if (status === "pending") return `${styles.badge} ${styles.badgePending}`;
  return `${styles.badge} ${styles.badgeOff}`;
}

function connectionLabel(status: string | undefined) {
  if (status === "active") return "MDM connected";
  if (status === "pending") return "Waiting approval";
  if (status === "revoked") return "Disconnected";
  return "Not enrolled";
}

export function DevicePairingConsole({ tenantId }: { tenantId: string }) {
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [enrollments, setEnrollments] = useState<EnrollmentRow[]>([]);
  const [branchId, setBranchId] = useState("");
  const [token, setToken] = useState<TokenResult | null>(null);
  const [ownershipByEnrollment, setOwnershipByEnrollment] = useState<Record<string, OwnershipType | "">>({});
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

  const activeCount = enrollments.filter((item) => item.enrollment_status === "active").length;
  const pendingCount = enrollments.filter((item) => item.enrollment_status === "pending").length;
  const onlineCount = devices.filter((item) => item.status.toLowerCase() === "online" || item.status.toLowerCase() === "active").length;

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
    const ownershipType = ownershipByEnrollment[id] ?? "";
    if (action === "approve" && !ownershipType) {
      setError("Select device ownership before connecting MDM.");
      return;
    }

    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch(`/api/it-admin/v1/device-enrollments/${id}/${action}`, {
        method: "POST",
        ...(action === "approve" ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ownership_type: ownershipType })
        } : {})
      });
      await parseResponse(response);
      setSuccess(
        action === "approve"
          ? `MDM enrollment approved as ${ownershipType}. Full MDM becomes available only when Device Owner and required native capabilities are reported.`
          : "MDM enrollment disconnected."
      );
      setOwnershipByEnrollment((current) => ({ ...current, [id]: "" }));
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : `Failed to ${action} device enrollment.`);
    } finally {
      setBusy(false);
    }
  }

  function EnrollmentActions({ enrollment }: { enrollment: EnrollmentRow }) {
    if (enrollment.enrollment_status === "pending") {
      return (
        <div className={styles.actionRow}>
          <select
            aria-label={`Ownership for ${enrollment.device_code}`}
            value={ownershipByEnrollment[enrollment.id] ?? ""}
            onChange={(event) => setOwnershipByEnrollment((current) => ({
              ...current,
              [enrollment.id]: event.target.value as OwnershipType | ""
            }))}
            disabled={busy}
          >
            <option value="">Select ownership</option>
            {OWNERSHIP_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <button
            type="button"
            className={`${styles.button} ${styles.buttonPrimary}`}
            disabled={busy || !(ownershipByEnrollment[enrollment.id] ?? "")}
            onClick={() => void changeEnrollment(enrollment.id, "approve")}
          >
            เชื่อมต่อ MDM
          </button>
        </div>
      );
    }

    if (enrollment.enrollment_status === "active") {
      return (
        <button
          type="button"
          className={`${styles.button} ${styles.buttonDanger}`}
          disabled={busy}
          onClick={() => void changeEnrollment(enrollment.id, "revoke")}
        >
          ปิดการเชื่อมต่อ MDM
        </button>
      );
    }

    return <span className={connectionBadge(enrollment.enrollment_status)}>{connectionLabel(enrollment.enrollment_status)}</span>;
  }

  return (
    <section className={styles.console}>
      <header className={styles.hero}>
        <h2>Device enrollment & pairing</h2>
        <p>
          เมนูนี้ใช้เชื่อมต่อและปิดการเชื่อมต่อ MDM ที่ระดับ enrollment โดยตรง การเปิด Full MDM จริงยังตรวจ ownership, Android Device Owner และ native capability ของเครื่องตามเงื่อนไขเดิม
        </p>
      </header>

      {success ? <p className={`${styles.notice} ${styles.success}`}>{success}</p> : null}
      {error ? <p className={`${styles.notice} ${styles.error}`}>{error}</p> : null}

      <div className={styles.summaryGrid}>
        <div className={styles.summaryCard}><span>Registered devices</span><strong>{devices.length}</strong></div>
        <div className={styles.summaryCard}><span>Online / active</span><strong>{onlineCount}</strong></div>
        <div className={styles.summaryCard}><span>MDM connected</span><strong>{activeCount}</strong></div>
        <div className={styles.summaryCard}><span>Waiting approval</span><strong>{pendingCount}</strong></div>
      </div>

      <div className={styles.toolbar}>
        <label className={styles.field}>
          <span>Branch</span>
          <select value={branchId} onChange={(event) => setBranchId(event.target.value)} disabled={busy || loading}>
            <option value="">Select branch</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id} disabled={!branch.is_active}>
                {branch.code} · {branch.name}{branch.is_active ? "" : " (inactive)"}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className={`${styles.button} ${styles.buttonPrimary}`} disabled={busy || loading || !branchId} onClick={() => void generateToken()}>
          Generate POS pairing token
        </button>
        <button type="button" className={styles.button} disabled={busy || loading} onClick={() => void load()}>
          Refresh
        </button>
      </div>

      {token ? (
        <div className={styles.token}>
          <strong>One-time pairing token</strong>
          <div className={styles.tokenCode}>{token.activation_token}</div>
          <p>Expires: {formatDateTime(token.expires_at)}</p>
          <p>Waiting for the POS/Android agent to consume this token and create a pending enrollment. Token creation itself is not yet a successful MDM connection.</p>
        </div>
      ) : null}

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div><h3>Registered devices</h3><p>ดูสถานะเครื่องและสถานะการเชื่อมต่อ MDM ล่าสุด</p></div>
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Device</th>
                <th>Runtime status</th>
                <th>Pairing / MDM</th>
                <th>Last seen</th>
                <th>MDM action</th>
                <th>Health</th>
              </tr>
            </thead>
            <tbody>
              {devices.length === 0 ? (
                <tr><td colSpan={6} className={styles.empty}>{loading ? "Loading..." : "No registered devices."}</td></tr>
              ) : (
                devices.map((device) => {
                  const enrollment = enrollmentByDeviceCode.get(device.device_code);
                  return (
                    <tr key={device.id}>
                      <td><span className={styles.deviceName}>{device.device_name}</span><span className={styles.muted}>{device.device_code} · {device.device_type}</span></td>
                      <td><span className={connectionBadge(device.status === "active" || device.status === "online" ? "active" : undefined)}>{device.status}</span></td>
                      <td>
                        <span className={connectionBadge(enrollment?.enrollment_status)}>{connectionLabel(enrollment?.enrollment_status)}</span>
                        <span className={styles.muted}>{enrollment ? `${enrollment.trust_level} · ${enrollment.device_type}` : "Legacy · not enrolled"}</span>
                      </td>
                      <td>{formatDateTime(device.last_seen_at)}</td>
                      <td>{enrollment ? <EnrollmentActions enrollment={enrollment}/> : <span className={styles.muted}>Generate token / wait for request</span>}</td>
                      <td><a className={styles.healthLink} href={`/it-admin/tenants/${tenantId}/devices/${device.id}`}>Open health</a></td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <p className={styles.connectionNote}>“เชื่อมต่อ MDM” ใช้ endpoint approve เดิม และ “ปิดการเชื่อมต่อ MDM” ใช้ endpoint revoke เดิม จึงยังคง audit และ security contract เดิมทั้งหมด</p>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div><h3>Enrollment requests</h3><p>คำขอใหม่และประวัติการเชื่อมต่อ/ยกเลิก MDM</p></div>
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Device code</th>
                <th>Type</th>
                <th>Status</th>
                <th>Trust</th>
                <th>Updated</th>
                <th>Ownership / Action</th>
              </tr>
            </thead>
            <tbody>
              {enrollments.length === 0 ? (
                <tr><td colSpan={6} className={styles.empty}>No enrollment requests yet.</td></tr>
              ) : (
                enrollments.map((enrollment) => (
                  <tr key={enrollment.id}>
                    <td className={styles.deviceName}>{enrollment.device_code}</td>
                    <td>{enrollment.device_type}</td>
                    <td><span className={connectionBadge(enrollment.enrollment_status)}>{connectionLabel(enrollment.enrollment_status)}</span></td>
                    <td>{enrollment.trust_level}</td>
                    <td>{formatDateTime(enrollment.updated_at)}</td>
                    <td><EnrollmentActions enrollment={enrollment}/></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
