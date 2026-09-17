"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import type { Language } from "@/lib/i18n";
import styles from "./desktop-license-management-console.module.css";

type ApiEnvelope<T> = { data: T | null; error: { code?: string; message?: string } | null };
type ExpiryMode = "perpetual" | "30" | "365" | "custom";
type MdmCommand = "force_sync" | "refresh_license" | "recheck_printer" | "check_update" | "collect_health";

type DeviceRow = {
  id: string;
  device_code: string;
  device_name?: string | null;
  machine_id?: string | null;
  status: string;
  is_authorized: boolean;
  app_version?: string | null;
  last_seen_at?: string | null;
  last_license_check_at?: string | null;
  last_sales_sync_at?: string | null;
  printer_status?: string | null;
  printer_name?: string | null;
  cpu_percent?: number | null;
  memory_percent?: number | null;
  disk_free_bytes?: number | null;
  database_bytes?: number | null;
  integrity_status?: string | null;
  tamper_detected?: boolean;
  online?: boolean;
};

type RegistryRow = {
  id: string;
  license_id: string;
  customer_name: string;
  plan: string;
  max_devices: 1 | 2;
  starts_at: string;
  expires_at: string | null;
  status: string;
  features: string[];
  revision: number;
  created_at: string;
  updated_at: string;
  devices: DeviceRow[];
  today: { bill_count: number; cancelled_count: number; gross_sales: number; cancelled_value: number };
  month: { bill_count: number; cancelled_count: number; gross_sales: number; cancelled_value: number };
  recent_receipts: Array<{ id: string; license_device_id: string; receipt_no: string; sold_at: string; total_amount: number; payment_method: string; status: string; cashier_name?: string | null }>;
};

type RegistryResponse = { rows: RegistryRow[]; checked_at: string };
type SignerStatus = { configured: boolean; key_matches_desktop?: boolean; public_key_fingerprint?: string | null; expected_public_key_fingerprint?: string | null };
type LicensePayload = { licenseId: string; customer: string; plan: string; notBefore: string; expiresAt: string | null; maxDevices: 1 | 2; devices: string[]; features: string[] };
type IssueResult = { token: string; payload: LicensePayload; generated_at?: string };

type FormState = {
  customer: string;
  plan: string;
  deviceCount: 1 | 2;
  device1: string;
  device2: string;
  notBefore: string;
  expiryMode: ExpiryMode;
  customExpiry: string;
  features: string[];
};

const DEVICE_PATTERN = /^CP-[A-F0-9]{5}-[A-F0-9]{5}-[A-F0-9]{5}-[A-F0-9]{5}$/;
const FEATURES = [
  ["offline-pos", "ขายหน้าร้านออฟไลน์", "Offline POS"],
  ["inventory", "สินค้าและสต็อก", "Inventory"],
  ["reports", "รายงาน", "Reports"],
  ["receipt-printing", "พิมพ์ใบเสร็จ", "Receipt printing"],
  ["employee-pin", "พนักงานและ PIN", "Employees & PIN"]
] as const;
const SALES_MODES = [
  ["sales-grocery", "โหมดร้านชำ", "Grocery / retail"],
  ["sales-takeaway", "โหมดกลับบ้าน", "Takeaway"],
  ["sales-dine-in", "โหมดนั่งโต๊ะ", "Dine-in / table"]
] as const;

const emptyForm = (): FormState => ({
  customer: "",
  plan: "Offline Standard",
  deviceCount: 1,
  device1: "",
  device2: "",
  notBefore: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date()),
  expiryMode: "perpetual",
  customExpiry: "",
  features: [...FEATURES.map(([id]) => id), "sales-grocery"]
});

function normalizeDevice(value: string) { return value.trim().toUpperCase().replace(/\s+/g, ""); }
function dateInput(value?: string | null) { if (!value) return ""; const d = new Date(value); return Number.isNaN(d.getTime()) ? "" : new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(d); }
function startIso(value: string) { return value ? `${value}T00:00:00+07:00` : null; }
function endIso(value: string) { return value ? `${value}T23:59:59+07:00` : null; }
function money(value: unknown) { return new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB", maximumFractionDigits: 2 }).format(Number(value ?? 0)); }
function bytes(value?: number | null) { const v = Number(value ?? 0); if (!v) return "—"; if (v < 1024 * 1024) return `${(v / 1024).toFixed(0)} KB`; if (v < 1024 ** 3) return `${(v / 1024 ** 2).toFixed(1)} MB`; return `${(v / 1024 ** 3).toFixed(2)} GB`; }
function when(value?: string | null, language: Language = "th") { if (!value) return "—"; const d = new Date(value); return Number.isNaN(d.getTime()) ? "—" : new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-US", { dateStyle: "short", timeStyle: "short" }).format(d); }
function modeText(features: string[], th: boolean) {
  const names = SALES_MODES.filter(([id]) => features.includes(id)).map(([, thai, en]) => th ? thai : en);
  return names.length ? names.join(" · ") : (th ? "ร้านชำ" : "Grocery");
}

export function DesktopLicenseManagementConsole({ language }: { language: Language }) {
  const th = language === "th";
  const [rows, setRows] = useState<RegistryRow[]>([]);
  const [signer, setSigner] = useState<SignerStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<RegistryRow | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [result, setResult] = useState<IssueResult | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const [statusRes, registryRes] = await Promise.all([
        fetch("/api/it-admin/license-issuer", { cache: "no-store" }),
        fetch("/api/it-admin/license-registry", { cache: "no-store" })
      ]);
      const statusBody = await statusRes.json() as ApiEnvelope<SignerStatus>;
      const registryBody = await registryRes.json() as ApiEnvelope<RegistryResponse>;
      if (statusBody.data) setSigner(statusBody.data);
      if (!registryRes.ok || !registryBody.data) throw new Error(registryBody.error?.message || "LOAD_LICENSES_FAILED");
      setRows(registryBody.data.rows || []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "LOAD_LICENSES_FAILED");
    } finally { if (!quiet) setLoading(false); }
  }, []);

  useEffect(() => {
    void load(false);
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(true); }, 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const deviceValues = useMemo(() => [normalizeDevice(form.device1), ...(form.deviceCount === 2 ? [normalizeDevice(form.device2)] : [])], [form.device1, form.device2, form.deviceCount]);
  const validation = useMemo(() => {
    if (!form.customer.trim()) return th ? "กรอกชื่อลูกค้า / ร้านค้า" : "Customer is required";
    if (deviceValues.some(v => !DEVICE_PATTERN.test(v))) return th ? "Device Code ไม่ถูกต้อง" : "Invalid Device Code";
    if (new Set(deviceValues).size !== deviceValues.length) return th ? "Device Code ห้ามซ้ำ" : "Device Codes must be unique";
    if (form.expiryMode === "custom" && !form.customExpiry) return th ? "กรอกวันหมดอายุ" : "Expiry date is required";
    if (!SALES_MODES.some(([id]) => form.features.includes(id))) return th ? "เลือกโหมดขายอย่างน้อย 1 โหมด" : "Select at least one sales mode";
    return "";
  }, [form, deviceValues, th]);

  const openCreate = () => { setEditing(null); setForm(emptyForm()); setResult(null); setMessage(""); setFormOpen(true); };
  const openEdit = (row: RegistryRow) => {
    const devices = row.devices.filter(d => d.is_authorized);
    const features = Array.isArray(row.features) ? [...row.features] : ["offline-pos"];
    if (!SALES_MODES.some(([id]) => features.includes(id))) features.push("sales-grocery");
    setEditing(row);
    setForm({
      customer: row.customer_name,
      plan: row.plan,
      deviceCount: (Math.min(2, Math.max(1, devices.length)) as 1 | 2),
      device1: devices[0]?.device_code || "",
      device2: devices[1]?.device_code || "",
      notBefore: dateInput(row.starts_at),
      expiryMode: row.expires_at ? "custom" : "perpetual",
      customExpiry: dateInput(row.expires_at),
      features
    });
    setResult(null); setMessage(""); setFormOpen(true);
  };

  const submit = async () => {
    if (validation) { setMessage(validation); return; }
    if (!signer?.configured) { setMessage(th ? "ยังไม่ได้ตั้งค่า Private Key ฝั่ง Server จึงยังสร้าง License จริงไม่ได้" : "Server signing key is not configured"); return; }
    setBusy(true); setMessage(""); setResult(null);
    try {
      const input = {
        customer: form.customer.trim(),
        plan: form.plan,
        devices: deviceValues,
        notBefore: startIso(form.notBefore),
        validDays: form.expiryMode === "30" ? 30 : form.expiryMode === "365" ? 365 : null,
        expiresAt: form.expiryMode === "custom" ? endIso(form.customExpiry) : null,
        features: form.features
      };
      const endpoint = editing ? "/api/it-admin/license-registry" : "/api/it-admin/license-issuer";
      const response = await fetch(endpoint, {
        method: editing ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(editing ? { contractId: editing.id, input } : input)
      });
      const payload = await response.json() as ApiEnvelope<IssueResult>;
      if (!response.ok || !payload.data) throw new Error(payload.error?.message || "LICENSE_SAVE_FAILED");
      setResult(payload.data);
      await load(true);
    } catch (error) { setMessage(error instanceof Error ? error.message : "LICENSE_SAVE_FAILED"); }
    finally { setBusy(false); }
  };

  const remove = async (row: RegistryRow) => {
    if (!window.confirm(th ? `ยกเลิก License ${row.license_id} ของ ${row.customer_name}?\nประวัติยอดขายและ Audit จะยังถูกเก็บไว้` : `Revoke ${row.license_id}? Historical data will be retained.`)) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/it-admin/license-registry", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ contractId: row.id, reason: "Revoked from IT license console" }) });
      const payload = await response.json() as ApiEnvelope<{ deleted: boolean }>;
      if (!response.ok || !payload.data) throw new Error(payload.error?.message || "LICENSE_DELETE_FAILED");
      await load(true);
    } catch (error) { setMessage(error instanceof Error ? error.message : "LICENSE_DELETE_FAILED"); }
    finally { setBusy(false); }
  };

  const sendCommand = async (row: RegistryRow, device: DeviceRow, commandType: MdmCommand) => {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/it-admin/license-mdm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contractId: row.id, deviceId: device.id, commandType })
      });
      const payload = await response.json() as ApiEnvelope<{ command: { id: string } }>;
      if (!response.ok || !payload.data) throw new Error(payload.error?.message || "MDM_COMMAND_FAILED");
      setMessage(th ? `ส่งคำสั่ง ${commandType} ไปยัง ${device.device_name || device.device_code} แล้ว ระบบจะรับเมื่อเครื่องออนไลน์` : `Queued ${commandType} for ${device.device_name || device.device_code}`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "MDM_COMMAND_FAILED"); }
    finally { setBusy(false); }
  };

  const toggleFeature = (id: string) => {
    if (id === "offline-pos") return;
    setForm(current => ({ ...current, features: current.features.includes(id) ? current.features.filter(v => v !== id) : [...current.features, id] }));
  };

  return <div className={styles.stack}>
    <section className={styles.security}>
      <div className={`${styles.securityStatus} ${signer?.configured && signer?.key_matches_desktop !== false ? styles.ready : styles.notReady}`}><span className={styles.dot}/><strong>{signer?.configured ? (signer.key_matches_desktop === false ? (th ? "Private Key ไม่ตรงกับ Desktop v0.3.0" : "Signing key mismatch") : (th ? "Private Key พร้อมใช้งาน" : "Private key ready")) : (th ? "ยังไม่ได้ตั้งค่า Private Key" : "Private key not configured")}</strong></div>
      <small>{th ? "เปิดฟอร์มเตรียมข้อมูลได้ แต่การสร้าง License จริงต้องมี Private Key ที่ Server" : "You can prepare the form now; issuing a real license still requires the server signing key."}</small>
    </section>

    <div className={styles.toolbar}>
      <div className={styles.toolbarText}><strong>{th ? "รายการ License POS Desktop" : "POS Desktop licenses"}</strong><span>{th ? "License กำหนดเครื่อง โหมดขาย อายุใช้งาน และ MDM เมื่อเครื่องออนไลน์" : "Licenses control devices, sales modes, term and online MDM."}</span></div>
      <div className={styles.actions}><button className={styles.secondary} onClick={() => void load(false)} disabled={busy}>{th ? "รีเฟรช" : "Refresh"}</button><button className={styles.primary} onClick={openCreate} disabled={busy}>{th ? "+ ออก License ใหม่" : "+ New license"}</button></div>
    </div>

    {message && !formOpen ? <div className={styles.error}>{message}</div> : null}

    <section className={styles.panel}>
      {loading ? <div className={styles.empty}>{th ? "กำลังโหลดรายการ License..." : "Loading licenses..."}</div> : rows.length === 0 ? <div className={styles.empty}>{th ? "ยังไม่มี License ที่บันทึกใน CpiPOS-001" : "No saved desktop licenses"}</div> : <div className={styles.tableWrap}><table className={styles.table}>
        <thead><tr><th>{th ? "ลูกค้า / License" : "Customer / License"}</th><th>{th ? "สถานะ / อายุ" : "Status / term"}</th><th>{th ? "เครื่อง / โหมดขาย" : "Devices / modes"}</th><th>{th ? "ยอดวันนี้" : "Today"}</th><th>{th ? "ยอดเดือนนี้" : "This month"}</th><th>{th ? "จัดการ" : "Actions"}</th></tr></thead>
        <tbody>{rows.map(row => {
          const online = row.devices.filter(d => d.online).length;
          const expired = Boolean(row.expires_at && Date.now() > Date.parse(row.expires_at));
          return <Fragment key={row.id}>
            <tr>
              <td><div className={styles.mainCell}><strong>{row.customer_name}</strong><code>{row.license_id}</code><span className={styles.muted}>{row.plan} · Rev {row.revision}</span></div></td>
              <td><div className={styles.mainCell}><span className={`${styles.badge} ${row.status === "active" && !expired ? styles.badgeActive : styles.badgeBad}`}>{expired ? (th ? "หมดอายุ" : "Expired") : row.status}</span><span className={styles.muted}>{when(row.starts_at, language)} → {row.expires_at ? when(row.expires_at, language) : (th ? "ไม่หมดอายุ" : "Lifetime")}</span></div></td>
              <td><strong>{online}/{row.devices.filter(d => d.is_authorized).length} {th ? "ออนไลน์" : "online"}</strong><div className={styles.muted}>{modeText(row.features || [], th)}</div></td>
              <td><div className={styles.mainCell}><strong className={styles.money}>{money(row.today.gross_sales)}</strong><span className={styles.muted}>{row.today.bill_count} {th ? "บิล" : "bills"}</span></div></td>
              <td><div className={styles.mainCell}><strong className={styles.money}>{money(row.month.gross_sales)}</strong><span className={styles.muted}>{row.month.bill_count} {th ? "บิล" : "bills"}</span></div></td>
              <td><div className={styles.actions}><button className={styles.secondary} onClick={() => openEdit(row)} disabled={busy}>{th ? "แก้ไข" : "Edit"}</button><button className={styles.danger} onClick={() => void remove(row)} disabled={busy}>{th ? "ลบ / ยกเลิก" : "Revoke"}</button></div></td>
            </tr>
            <tr className={styles.deviceRow}><td colSpan={6}><div className={styles.deviceGrid}>{row.devices.map(device => <article className={styles.deviceCard} key={device.id}>
              <div className={styles.deviceHead}><div><strong>{device.device_name || device.device_code}</strong><div className={styles.muted}>{device.device_code} · {device.app_version ? `v${device.app_version}` : "v—"}</div></div><span className={device.tamper_detected ? styles.tamper : device.online ? styles.online : styles.offline}>{device.tamper_detected ? "TAMPER" : device.online ? "ONLINE" : "OFFLINE"}</span></div>
              <div className={styles.metrics}><div className={styles.metric}><span>Last seen</span><strong>{when(device.last_seen_at, language)}</strong></div><div className={styles.metric}><span>Printer</span><strong>{device.printer_status || "—"}{device.printer_name ? ` · ${device.printer_name}` : ""}</strong></div><div className={styles.metric}><span>CPU</span><strong>{device.cpu_percent == null ? "—" : `${Number(device.cpu_percent).toFixed(0)}%`}</strong></div><div className={styles.metric}><span>RAM</span><strong>{device.memory_percent == null ? "—" : `${Number(device.memory_percent).toFixed(0)}%`}</strong></div><div className={styles.metric}><span>POS DB</span><strong>{bytes(device.database_bytes)}</strong></div><div className={styles.metric}><span>Disk free</span><strong>{bytes(device.disk_free_bytes)}</strong></div><div className={styles.metric}><span>Integrity</span><strong>{device.integrity_status || "unknown"}</strong></div><div className={styles.metric}><span>Sales sync</span><strong>{when(device.last_sales_sync_at, language)}</strong></div></div>
              <div className={styles.actions}>
                <button className={styles.secondary} disabled={busy} onClick={() => void sendCommand(row, device, "force_sync")}>{th ? "ซิงก์" : "Sync"}</button>
                <button className={styles.secondary} disabled={busy} onClick={() => void sendCommand(row, device, "refresh_license")}>{th ? "ตรวจ License" : "License"}</button>
                <button className={styles.secondary} disabled={busy} onClick={() => void sendCommand(row, device, "recheck_printer")}>{th ? "ตรวจ Printer" : "Printer"}</button>
                <button className={styles.secondary} disabled={busy} onClick={() => void sendCommand(row, device, "check_update")}>{th ? "ตรวจอัปเดต" : "Update"}</button>
              </div>
              <div className={styles.receiptList}>{row.recent_receipts.filter(r => r.license_device_id === device.id).slice(0,3).map(receipt => <div className={styles.receipt} key={receipt.id}><span>{receipt.receipt_no} · {when(receipt.sold_at, language)}</span><strong>{money(receipt.total_amount)}</strong></div>)}</div>
            </article>)}</div></td></tr>
          </Fragment>;
        })}</tbody>
      </table></div>}
    </section>

    {formOpen ? <div className={styles.overlay} onMouseDown={() => !busy && setFormOpen(false)}><section className={styles.modal} onMouseDown={event => event.stopPropagation()}>
      <header className={styles.modalHeader}><div><h3>{editing ? (th ? "แก้ไขและออก License Revision ใหม่" : "Edit and reissue license") : (th ? "ออก License POS Desktop" : "Issue POS Desktop license")}</h3><p>{editing ? editing.license_id : (th ? "กรอก Device Code และกำหนดสิทธิ์การขายให้เครื่องลูกค้า" : "Enter the Desktop Device Code and licensed sales modes")}</p></div><button className={styles.iconButton} onClick={() => setFormOpen(false)} disabled={busy}>×</button></header>
      <div className={styles.form}>
        {!signer?.configured ? <div className={styles.error}>{th ? "Private Key ยังไม่พร้อม: กรอกข้อมูลได้ แต่ยังสร้าง License จริงไม่ได้" : "Signing key is not ready. You can prepare the form but cannot issue yet."}</div> : null}
        <div className={styles.grid}>
          <label className={styles.wide}>{th ? "ชื่อลูกค้า / ร้านค้า" : "Customer / store"}<input value={form.customer} onChange={e => setForm(v => ({...v,customer:e.target.value}))}/></label>
          <label>{th ? "แพ็กเกจ" : "Plan"}<select value={form.plan} onChange={e => setForm(v => ({...v,plan:e.target.value}))}><option>Offline Standard</option><option>Offline Pro</option><option>Offline 2 Devices</option><option>Offline Lifetime</option></select></label>
          <label>{th ? "จำนวนเครื่อง" : "Devices"}<select value={form.deviceCount} onChange={e => setForm(v => ({...v,deviceCount:Number(e.target.value) as 1|2}))}><option value="1">1</option><option value="2">2</option></select></label>
          <label className={styles.wide}>Device Code #1<input value={form.device1} onChange={e => setForm(v => ({...v,device1:e.target.value.toUpperCase()}))} placeholder="CP-AAAAA-BBBBB-CCCCC-DDDDD"/></label>
          {form.deviceCount === 2 ? <label className={styles.wide}>Device Code #2<input value={form.device2} onChange={e => setForm(v => ({...v,device2:e.target.value.toUpperCase()}))} placeholder="CP-11111-22222-33333-44444"/></label> : null}
          <label>{th ? "วันที่เริ่มใช้งาน" : "Starts"}<input type="date" value={form.notBefore} onChange={e => setForm(v => ({...v,notBefore:e.target.value}))}/></label>
          <label>{th ? "อายุ License" : "License term"}<select value={form.expiryMode} onChange={e => setForm(v => ({...v,expiryMode:e.target.value as ExpiryMode}))}><option value="perpetual">{th ? "ไม่หมดอายุ" : "Lifetime"}</option><option value="30">30 {th ? "วัน" : "days"}</option><option value="365">365 {th ? "วัน" : "days"}</option><option value="custom">{th ? "กำหนดวันหมดอายุ" : "Custom expiry"}</option></select></label>
          {form.expiryMode === "custom" ? <label>{th ? "วันหมดอายุ" : "Expires"}<input type="date" value={form.customExpiry} onChange={e => setForm(v => ({...v,customExpiry:e.target.value}))}/></label> : null}
        </div>
        <fieldset className={styles.features}><legend>{th ? "โหมดขายที่ License อนุญาต" : "Licensed sales modes"}</legend>{SALES_MODES.map(([id,thai,en]) => <label key={id}><input type="checkbox" checked={form.features.includes(id)} onChange={() => toggleFeature(id)}/>{th ? thai : en}</label>)}</fieldset>
        <fieldset className={styles.features}><legend>{th ? "สิทธิ์ระบบ" : "System features"}</legend>{FEATURES.map(([id,thai,en]) => <label key={id}><input type="checkbox" checked={form.features.includes(id)} disabled={id === "offline-pos"} onChange={() => toggleFeature(id)}/>{th ? thai : en}</label>)}</fieldset>
        {message ? <div className={styles.error}>{message}</div> : null}
        {result ? <div className={styles.success}><strong>{th ? "สร้าง License สำเร็จ" : "License issued"} · {result.payload.licenseId}</strong><label className={styles.tokenBox}>{th ? "License Key สำหรับนำไปใส่โปรแกรม" : "License key"}<textarea readOnly value={result.token}/></label><div className={styles.actions}><button className={styles.secondary} onClick={() => void navigator.clipboard.writeText(result.token)}>{th ? "คัดลอกรหัส" : "Copy"}</button></div></div> : null}
        <div className={styles.formActions}><button className={styles.secondary} onClick={() => setFormOpen(false)} disabled={busy}>{th ? "ปิด" : "Close"}</button><button className={styles.primary} onClick={() => void submit()} disabled={busy || Boolean(validation) || !signer?.configured}>{busy ? (th ? "กำลังบันทึก..." : "Saving...") : editing ? (th ? "บันทึกและออก Revision ใหม่" : "Save & reissue") : (th ? "สร้าง License" : "Issue license")}</button></div>
      </div>
    </section></div> : null}
  </div>;
}
