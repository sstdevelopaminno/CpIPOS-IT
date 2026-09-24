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
  dual_screen_enabled?: boolean;
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
  const [customerDisplayEnabled, setCustomerDisplayEnabled] = useState(false);
  const [displayAccessLoading, setDisplayAccessLoading] = useState(false);

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

  useEffect(() => {
    if (!branchId) {
      setCustomerDisplayEnabled(false);
      return;
    }
    const controller = new AbortController();
    setDisplayAccessLoading(true);
    fetch(`/api/it-admin/v1/tenants/${tenantId}/customer-display-access?branch_id=${encodeURIComponent(branchId)}`, {
      cache: "no-store", credentials: "include", signal: controller.signal
    }).then(response => parseResponse<{ enabled: boolean }>(response))
      .then(result => { if (!controller.signal.aborted) setCustomerDisplayEnabled(result.enabled); })
      .catch(loadError => {
        if (!controller.signal.aborted) {
          setCustomerDisplayEnabled(false);
          setError(loadError instanceof Error ? loadError.message : "Unable to load customer display entitlement.");
        }
      }).finally(() => { if (!controller.signal.aborted) setDisplayAccessLoading(false); });
    return () => controller.abort();
  }, [branchId, tenantId]);

  async function setBranchCustomerDisplay(enabled: boolean) {
    if (!branchId || !window.confirm(enabled
      ? "เปิดสิทธิ์จอแสดงผลลูกค้าให้สาขานี้ (IT override)?"
      : "ปิดสิทธิ์จอแสดงผลลูกค้าให้สาขานี้?")) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/it-admin/v1/tenants/${tenantId}/customer-display-access`, {
        method: "PATCH", credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ branch_id: branchId, enabled })
      });
      const updated = await parseResponse<{ enabled: boolean }>(response);
      setCustomerDisplayEnabled(updated.enabled);
      setSuccess(updated.enabled ? "เปิดสิทธิ์จอแสดงผลลูกค้าสำหรับสาขาแล้ว" : "ปิดสิทธิ์จอแสดงผลลูกค้าสำหรับสาขาแล้ว");
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Unable to update customer display feature.");
    } finally { setBusy(false); }
  }

  async function setDeviceDualScreen(device: DeviceRow, enabled: boolean) {
    if (!window.confirm(enabled
      ? `อนุญาตให้เครื่อง ${device.device_name} แสดงผลจอที่ 2 เมื่อมีจอจริงและ APK รองรับ?`
      : `ปิดจอแสดงผลลูกค้าของเครื่อง ${device.device_name}?`)) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/it-admin/v1/tenants/${tenantId}/devices`, {
        method: "PATCH", credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ device_id: device.id, action: "set_dual_screen", dual_screen_enabled: enabled })
      });
      await parseResponse(response);
      setSuccess(enabled
        ? "บันทึกคำสั่งเปิดจอที่ 2 แล้ว เครื่อง Android ที่รองรับจะรับนโยบายเมื่อ Heartbeat รอบถัดไป"
        : "บันทึกคำสั่งปิดจอที่ 2 แล้ว เครื่อง Android ที่เชื่อมต่อจะรับนโยบายเมื่อ Heartbeat รอบถัดไป");
      await load();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Unable to update device dual-screen policy.");
    } finally { setBusy(false); }
  }

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

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div>
            <h3>จอแสดงผลลูกค้า / Dual Screen</h3>
            <p>ขั้นแรกเปิดสิทธิ์สาขา แล้วกำหนดเปิด/ปิดรายเครื่องด้านล่าง การสั่งจอที่ 2 ไม่ใช่การเพิ่มสิทธิ์ Android Device Owner</p>
          </div>
          <span className={connectionBadge(customerDisplayEnabled ? "active" : "")}>
            {displayAccessLoading ? "กำลังตรวจสอบ…" : customerDisplayEnabled ? "สาขาเปิดใช้งาน" : "สาขาปิดใช้งาน"}
          </span>
        </div>
        <div className={styles.actionRow}>
          <button className={`${styles.button} ${styles.buttonPrimary}`} type="button"
            disabled={busy || !branchId || displayAccessLoading || customerDisplayEnabled}
            onClick={() => void setBranchCustomerDisplay(true)}>เปิดสิทธิ์จอแสดงผลสาขา</button>
          <button className={`${styles.button} ${styles.buttonDanger}`} type="button"
            disabled={busy || !branchId || displayAccessLoading || !customerDisplayEnabled}
            onClick={() => void setBranchCustomerDisplay(false)}>ปิดสิทธิ์จอแสดงผลสาขา</button>
        </div>
        <p className={styles.connectionNote}>เครื่องต้องเป็น APK ที่ build รองรับ Dual Screen และตรวจพบจอจริงก่อนจึงจะแสดงภาพได้ ไม่สามารถเพิ่มฮาร์ดแวร์จอจากเว็บหรือสั่งยกระดับ Device Owner ได้</p>
      </section>

      {token ? (
        <div className={styles.token}>
          <strong>One-time pairing token</strong>
          <div className={styles.tokenCode}>{token.activation_token}</div>
          <p>Expires: {formatDateTime(token.expires_at)}</p>
          <p>Waiting for the POS/Android agent to consume this token and create a pending enrollment. Do not treat token creation itself as successful pairing.</p>
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
                <th>จอที่ 2</th>
                <th>Health</th>
              </tr>
            </thead>
            <tbody>
              {devices.length === 0 ? (
                <tr><td colSpan={7} className={styles.empty}>{loading ? "Loading..." : "ยังไม่มี POS ลงทะเบียนในสาขานี้ โปรดลงทะเบียนเครื่องที่ POS ก่อนสร้าง Token เชื่อม MDM"}</td></tr>
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
                      <td>{enrollment ? <EnrollmentActions enrollment={enrollment}/> : <span className={styles.muted}>ต้องลงทะเบียนและจับคู่เครื่องก่อน</span>}</td>
                      <td>
                        <button type="button" className={styles.button}
                          disabled={busy || device.device_type !== "pos_terminal" || device.status !== "active"}
                          onClick={() => void setDeviceDualScreen(device, device.dual_screen_enabled === false)}>
                          {device.dual_screen_enabled === false ? "เปิดจอที่ 2" : "ปิดจอที่ 2"}
                        </button>
                        <span className={styles.muted}>
                          {device.dual_screen_enabled === false ? "ปิดตามนโยบาย IT" :
                            customerDisplayEnabled ? "อนุญาต เมื่อ APK/จอรองรับ" : "สาขายังไม่เปิดสิทธิ์"}
                        </span>
                      </td>
                      <td><a className={styles.healthLink} href={`/tenants/${tenantId}/devices/${device.id}/health`}>Health / Full MDM</a></td>
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
