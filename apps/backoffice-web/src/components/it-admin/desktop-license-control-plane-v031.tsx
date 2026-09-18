"use client";

import { useEffect, useMemo, useState } from "react";
import type { Language } from "@/lib/i18n";
import styles from "./desktop-license-control-plane-v031.module.css";

type ApiEnvelope<T> = { data: T | null; error: { code?: string; message?: string } | null };
type Feature = "offline-pos" | "inventory" | "reports" | "receipt-printing" | "employee-pin" | "sales-grocery" | "sales-takeaway" | "sales-dine-in";
type ExpiryMode = "perpetual" | "30" | "365" | "custom";
type DeviceRow = { id: string; device_code: string; device_name?: string | null; machine_id?: string | null; status: string; is_authorized: boolean; app_version?: string | null; last_seen_at?: string | null; last_license_check_at?: string | null; printer_status?: string | null; cpu_percent?: number | null; memory_percent?: number | null; disk_free_bytes?: number | null; database_bytes?: number | null; online?: boolean };
type RegistryRow = { id: string; license_id: string; customer_name: string; plan: string; max_devices: 1 | 2; starts_at: string; expires_at: string | null; status: string; features: string[]; revision: number; created_at: string; updated_at: string; devices: DeviceRow[]; today?: { bill_count: number; gross_sales: number; cancelled_count: number; cancelled_value: number }; month?: { bill_count: number; gross_sales: number; cancelled_count: number; cancelled_value: number }; recent_receipts?: Array<{ id: string; receipt_no: string; sold_at: string; total_amount: number; payment_method: string; status: string; cashier_name?: string | null }> };
type SignerStatus = { configured: boolean; key_matches_desktop?: boolean; public_key_fingerprint?: string | null; expected_public_key_fingerprint?: string | null; expected_public_key_spki_base64?: string | null; signer_source?: string; desktop_version?: string };
type IssueResult = { token: string; payload: { licenseId: string; customer: string; plan: string; devices: string[]; maxDevices: 1 | 2; features: string[]; notBefore: string; expiresAt: string | null } };
type LicenseForm = { customer: string; plan: string; deviceCount: 1 | 2; device1: string; device2: string; notBefore: string; expiryMode: ExpiryMode; customExpiry: string; features: Feature[] };

const DEVICE_PATTERN = /^CP-[A-F0-9]{5}-[A-F0-9]{5}-[A-F0-9]{5}-[A-F0-9]{5}$/;
const FEATURE_OPTIONS: Array<{ id: Feature; th: string; en: string; group: "system" | "sales" }> = [
  { id: "offline-pos", th: "ขายหน้าร้านออฟไลน์", en: "Offline POS", group: "system" },
  { id: "inventory", th: "สินค้าและสต็อก", en: "Inventory", group: "system" },
  { id: "reports", th: "รายงาน", en: "Reports", group: "system" },
  { id: "receipt-printing", th: "พิมพ์ใบเสร็จ", en: "Receipt printing", group: "system" },
  { id: "employee-pin", th: "พนักงานและ PIN", en: "Employees & PIN", group: "system" },
  { id: "sales-grocery", th: "โหมดร้านชำ", en: "Grocery mode", group: "sales" },
  { id: "sales-takeaway", th: "โหมดกลับบ้าน", en: "Takeaway mode", group: "sales" },
  { id: "sales-dine-in", th: "โหมดนั่งโต๊ะ", en: "Dine-in / table mode", group: "sales" }
];

function todayInput() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
}

function emptyForm(): LicenseForm {
  return {
    customer: "",
    plan: "Offline Standard",
    deviceCount: 1,
    device1: "",
    device2: "",
    notBefore: todayInput(),
    expiryMode: "perpetual",
    customExpiry: "",
    features: ["offline-pos", "inventory", "reports", "receipt-printing", "employee-pin", "sales-grocery"]
  };
}

function normalizeDevice(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

function startIso(value: string) {
  return value ? `${value}T00:00:00+07:00` : null;
}

function endIso(value: string) {
  return value ? `${value}T23:59:59+07:00` : null;
}

function formatWhen(value?: string | null, language: Language = "th") {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-US", { dateStyle: "short", timeStyle: "short" }).format(date);
}

function money(value: unknown) {
  return new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB", maximumFractionDigits: 2 }).format(Number(value ?? 0));
}

function bytes(value?: number | null) {
  const n = Number(value ?? 0);
  if (!n) return "—";
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

function salesModeText(features: string[], th: boolean) {
  return FEATURE_OPTIONS.filter((item) => item.group === "sales" && features.includes(item.id)).map((item) => th ? item.th : item.en).join(" · ") || (th ? "ยังไม่กำหนดโหมดขาย" : "No sales mode");
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || "Unknown error");
}

export function DesktopLicenseControlPlaneV031({ language }: { language: Language }) {
  const th = language === "th";
  const [rows, setRows] = useState<RegistryRow[]>([]);
  const [signer, setSigner] = useState<SignerStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [form, setForm] = useState<LicenseForm>(emptyForm());
  const [previewOpen, setPreviewOpen] = useState(false);
  const [issued, setIssued] = useState<IssueResult | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [privateKeyInput, setPrivateKeyInput] = useState("");
  const [keyResult, setKeyResult] = useState<any>(null);

  const selected = useMemo(() => rows.find((row) => row.id === selectedId) || rows[0] || null, [rows, selectedId]);
  const devices = useMemo(() => [normalizeDevice(form.device1), ...(form.deviceCount === 2 ? [normalizeDevice(form.device2)] : [])], [form]);
  const validation = useMemo(() => {
    if (!form.customer.trim()) return th ? "กรอกชื่อลูกค้า / ร้านค้า" : "Customer name is required";
    if (devices.some((device) => !DEVICE_PATTERN.test(device))) return th ? "Device Code ไม่ถูกต้อง" : "Invalid Device Code";
    if (new Set(devices).size !== devices.length) return th ? "Device Code ห้ามซ้ำ" : "Device codes must be unique";
    if (!form.features.some((feature) => feature.startsWith("sales-"))) return th ? "เลือกโหมดขายอย่างน้อย 1 โหมด" : "Select at least one sales mode";
    if (form.expiryMode === "custom" && !form.customExpiry) return th ? "กรอกวันหมดอายุ" : "Expiry date is required";
    return "";
  }, [devices, form, th]);

  const load = async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const [signerRes, registryRes, keyRes] = await Promise.all([
        fetch("/api/it-admin/license-issuer", { cache: "no-store" }),
        fetch("/api/it-admin/license-registry", { cache: "no-store" }),
        fetch("/api/it-admin/license-key-management", { cache: "no-store" })
      ]);
      const signerBody = await signerRes.json() as ApiEnvelope<SignerStatus>;
      const keyBody = await keyRes.json() as ApiEnvelope<SignerStatus>;
      const registryBody = await registryRes.json() as ApiEnvelope<{ rows: RegistryRow[] }>;
      setSigner(keyBody.data || signerBody.data || null);
      if (!registryRes.ok || !registryBody.data) throw new Error(registryBody.error?.message || "LOAD_LICENSE_REGISTRY_FAILED");
      setRows(registryBody.data.rows || []);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      if (!quiet) setLoading(false);
    }
  };

  useEffect(() => {
    void load(false);
    const timer = window.setInterval(() => void load(true), 30000);
    return () => window.clearInterval(timer);
  }, []);

  const setFeature = (feature: Feature, checked: boolean) => {
    setForm((current) => {
      const next = checked ? [...new Set([...current.features, feature])] : current.features.filter((item) => item !== feature);
      if (!next.includes("offline-pos")) next.unshift("offline-pos");
      return { ...current, features: next };
    });
  };

  const issue = async () => {
    if (validation) { setMessage(validation); return; }
    if (!signer?.configured) { setMessage(th ? "ยังไม่ได้ตั้งค่า Private Key ที่ตรงกับ CpIPOS Desktop 0.3.1" : "Signing key is not ready."); return; }
    setBusy(true); setMessage(""); setIssued(null);
    try {
      const response = await fetch("/api/it-admin/license-issuer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          customer: form.customer.trim(),
          plan: form.plan.trim(),
          devices,
          notBefore: startIso(form.notBefore),
          validDays: form.expiryMode === "30" ? 30 : form.expiryMode === "365" ? 365 : null,
          expiresAt: form.expiryMode === "custom" ? endIso(form.customExpiry) : null,
          features: form.features
        })
      });
      const body = await response.json() as ApiEnvelope<IssueResult>;
      if (!response.ok || !body.data) throw new Error(body.error?.message || "LICENSE_ISSUE_FAILED");
      setIssued(body.data); setPreviewOpen(false); await load(true);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const keyAction = async (action: "generate" | "validate" | "save_vault") => {
    setBusy(true); setMessage(""); setKeyResult(null);
    try {
      const response = await fetch("/api/it-admin/license-key-management", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, privateKeyPem: privateKeyInput })
      });
      const body = await response.json() as ApiEnvelope<any>;
      if (!response.ok || !body.data) throw new Error(body.error?.message || "LICENSE_KEY_ACTION_FAILED");
      setKeyResult(body.data);
      if (body.data.private_key_pem) setPrivateKeyInput(body.data.private_key_pem);
      await load(true);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const copy = async (value: string) => {
    await navigator.clipboard.writeText(value);
    setMessage(th ? "คัดลอกแล้ว" : "Copied");
  };

  const deviceAction = async (action: string, deviceId?: string, contractId?: string) => {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/it-admin/license-devices", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, deviceId, contractId, reason: action })
      });
      const body = await response.json() as ApiEnvelope<any>;
      if (!response.ok || !body.data) throw new Error(body.error?.message || "DEVICE_ACTION_FAILED");
      await load(true);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const deleteLicense = async (row: RegistryRow) => {
    if (!window.confirm(th ? `ยกเลิก License ${row.license_id}?` : `Revoke ${row.license_id}?`)) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/it-admin/license-registry", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ contractId: row.id, reason: "Revoked from Control Plane v0.3.1" }) });
      const body = await response.json() as ApiEnvelope<any>;
      if (!response.ok || !body.data) throw new Error(body.error?.message || "LICENSE_DELETE_FAILED");
      await load(true);
    } catch (error) { setMessage(errorMessage(error)); } finally { setBusy(false); }
  };

  const installerInfo = {
    version: "0.3.1",
    file: "CpIPOS.Desktop_0.3.1_x64-setup.exe",
    sha256: "1c70f88db5bbf31520d61da6fa39cf41efbf89d05ac84f9420b8bf50875aaf4c",
    size: "3.08 MB"
  };

  return <div className={styles.page}>
    <header className={styles.hero}>
      <div><span>DESKTOP LICENSE CONTROL PLANE</span><h1>{th ? "จัดการ License โปรแกรม POS Desktop" : "POS Desktop License Control"}</h1><p>{th ? "Key Management, Preview, History, Devices, Trial, Audit และ MDM สำหรับ CpIPOS Desktop 0.3.1" : "Key management, preview, history, devices, trial, audit and MDM for CpIPOS Desktop 0.3.1."}</p></div>
      <button onClick={() => void load(false)} disabled={loading || busy}>{th ? "รีเฟรช" : "Refresh"}</button>
    </header>
    {message ? <div className={styles.alert}>{message}</div> : null}

    <section className={styles.statusGrid}>
      <div className={styles.statusCard}><b>{th ? "Private Key" : "Private key"}</b><strong className={signer?.configured ? styles.ok : styles.bad}>{signer?.configured ? (th ? "พร้อมออก License" : "Ready") : (th ? "ยังไม่พร้อม" : "Not ready")}</strong><small>{signer?.public_key_fingerprint || signer?.expected_public_key_fingerprint || "—"}</small></div>
      <div className={styles.statusCard}><b>{th ? "เวอร์ชันล่าสุด" : "Latest desktop"}</b><strong>{installerInfo.version}</strong><small>{installerInfo.file}</small></div>
      <div className={styles.statusCard}><b>{th ? "License ทั้งหมด" : "Licenses"}</b><strong>{rows.length}</strong><small>{rows.filter((row) => row.status === "active").length} active</small></div>
      <div className={styles.statusCard}><b>{th ? "เครื่องออนไลน์" : "Online devices"}</b><strong>{rows.flatMap((row) => row.devices || []).filter((device) => device.online).length}</strong><small>MDM heartbeat</small></div>
    </section>

    <section className={styles.grid2}>
      <article className={styles.card}>
        <h2>1. {th ? "Key Management" : "Key Management"}</h2>
        <p>{th ? "ตรวจสอบ Private Key ที่ใช้ Sign ลายเส้น ต้องตรงกับ Public Key ที่ฝังอยู่ใน CpIPOS Desktop 0.3.1" : "Validate the signing key against the public key embedded in CpIPOS Desktop 0.3.1."}</p>
        <textarea className={styles.textarea} value={privateKeyInput} onChange={(event) => setPrivateKeyInput(event.target.value)} placeholder="-----BEGIN PRIVATE KEY-----" />
        <div className={styles.actions}><button onClick={() => void keyAction("validate")} disabled={busy || !privateKeyInput.trim()}>{th ? "ตรวจสอบ Key" : "Validate"}</button><button onClick={() => void keyAction("save_vault")} disabled={busy || !privateKeyInput.trim()}>{th ? "บันทึกเข้า Vault" : "Save to Vault"}</button><button onClick={() => void keyAction("generate")} disabled={busy}>{th ? "สร้าง Key Pair ใหม่" : "Generate key pair"}</button></div>
        {keyResult ? <pre className={styles.pre}>{JSON.stringify(keyResult, null, 2)}</pre> : null}
      </article>

      <article className={styles.card}>
        <h2>2. {th ? "Preview ก่อนสร้าง License" : "License Preview"}</h2>
        <div className={styles.formGrid}><label>{th ? "ชื่อลูกค้า / ร้านค้า" : "Customer"}<input value={form.customer} onChange={(e) => setForm({ ...form, customer: e.target.value })} /></label><label>{th ? "แพ็กเกจ" : "Plan"}<input value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })} /></label><label>{th ? "จำนวนเครื่อง" : "Devices"}<select value={form.deviceCount} onChange={(e) => setForm({ ...form, deviceCount: Number(e.target.value) as 1 | 2 })}><option value={1}>1</option><option value={2}>2</option></select></label><label>{th ? "เริ่มใช้งาน" : "Start"}<input type="date" value={form.notBefore} onChange={(e) => setForm({ ...form, notBefore: e.target.value })} /></label><label>Device Code #1<input value={form.device1} onChange={(e) => setForm({ ...form, device1: e.target.value.toUpperCase() })} /></label>{form.deviceCount === 2 ? <label>Device Code #2<input value={form.device2} onChange={(e) => setForm({ ...form, device2: e.target.value.toUpperCase() })} /></label> : null}<label>{th ? "อายุ License" : "Term"}<select value={form.expiryMode} onChange={(e) => setForm({ ...form, expiryMode: e.target.value as ExpiryMode })}><option value="perpetual">{th ? "ไม่หมดอายุ" : "Perpetual"}</option><option value="30">30 วัน</option><option value="365">365 วัน</option><option value="custom">{th ? "กำหนดเอง" : "Custom"}</option></select></label>{form.expiryMode === "custom" ? <label>{th ? "หมดอายุ" : "Expires"}<input type="date" value={form.customExpiry} onChange={(e) => setForm({ ...form, customExpiry: e.target.value })} /></label> : null}</div>
        <fieldset className={styles.checks}><legend>{th ? "สิทธิ์และโหมดขาย" : "Features and sales modes"}</legend>{FEATURE_OPTIONS.map((item) => <label key={item.id}><input type="checkbox" checked={form.features.includes(item.id)} disabled={item.id === "offline-pos"} onChange={(e) => setFeature(item.id, e.target.checked)} />{th ? item.th : item.en}</label>)}</fieldset>
        <button className={styles.primary} onClick={() => validation ? setMessage(validation) : setPreviewOpen(true)} disabled={busy}>{th ? "ตรวจสอบ Preview ก่อนสร้าง" : "Preview before issue"}</button>
      </article>
    </section>

    <section className={styles.card}>
      <h2>3. {th ? "License History" : "License History"}</h2>
      <div className={styles.tableWrap}><table><thead><tr><th>License</th><th>{th ? "ลูกค้า" : "Customer"}</th><th>{th ? "โหมด" : "Modes"}</th><th>{th ? "สถานะ" : "Status"}</th><th>{th ? "ยอดวันนี้" : "Today"}</th><th>{th ? "จัดการ" : "Actions"}</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id} onClick={() => setSelectedId(row.id)} className={selected?.id === row.id ? styles.selected : ""}><td><b>{row.license_id}</b><small>rev {row.revision}</small></td><td>{row.customer_name}<small>{row.plan}</small></td><td>{salesModeText(row.features || [], th)}</td><td>{row.status}</td><td>{money(row.today?.gross_sales || 0)}<small>{row.today?.bill_count || 0} bills</small></td><td><button onClick={(e) => { e.stopPropagation(); void copy(row.license_id); }}>{th ? "คัดลอก" : "Copy"}</button><button onClick={(e) => { e.stopPropagation(); void deleteLicense(row); }}>{th ? "ยกเลิก" : "Revoke"}</button></td></tr>)}</tbody></table></div>
    </section>

    <section className={styles.grid2}>
      <article className={styles.card}>
        <h2>4. {th ? "Device Management" : "Device Management"}</h2>
        {selected ? <><h3>{selected.customer_name}</h3>{selected.devices.map((device) => <div className={styles.device} key={device.id}><div><b>{device.device_code}</b><span>{device.device_name || "—"} · {device.online ? "ONLINE" : "OFFLINE"}</span><small>CPU {device.cpu_percent ?? "—"}% · RAM {device.memory_percent ?? "—"}% · DB {bytes(device.database_bytes)}</small></div><div><button onClick={() => void deviceAction("reset_device", device.id)}>{th ? "Reset เครื่อง" : "Reset"}</button><button onClick={() => void deviceAction(device.is_authorized ? "block_device" : "unblock_device", device.id)}>{device.is_authorized ? (th ? "บล็อก" : "Block") : (th ? "ปลดบล็อก" : "Unblock")}</button></div></div>)}<button onClick={() => void deviceAction("reset_contract_devices", undefined, selected.id)}>{th ? "Reset ทุกเครื่องใน License นี้" : "Reset all devices"}</button></> : <p>{th ? "เลือกรายการ License ก่อน" : "Select a license."}</p>}
      </article>
      <article className={styles.card}>
        <h2>5. Trial Management</h2><p>{th ? "CpIPOS Desktop 0.3.1 ทดลองใช้งาน 7 วันจากวันที่ติดตั้ง โปรแกรมจะล็อกเมื่อครบกำหนด และแสดง QR LINE/ช่องใส่ลายเส้นให้ลูกค้าซื้อและเปิดใช้งาน" : "CpIPOS Desktop 0.3.1 uses an installation-anchored 7-day trial."}</p><div className={styles.installer}><b>{installerInfo.file}</b><span>SHA256: {installerInfo.sha256}</span><span>{installerInfo.size}</span></div><p>{th ? "การเปลี่ยน Trial เป็น License: ให้ลูกค้าส่ง Device Code จากหน้า Lock/Activate จากนั้นออก License จากฟอร์มด้านบน" : "To convert a trial, ask the customer for the Device Code from the lock/activation popup and issue a license above."}</p>
      </article>
    </section>

    <section className={styles.card}>
      <h2>6. Audit Log / MDM</h2><p>{th ? "ทุกการออก License, แก้ไข, Reset เครื่อง และ Revoke จะถูกส่งผ่าน API ฝั่ง IT ที่ตรวจสิทธิ์ it_admin ก่อนเสมอ ส่วน MDM จะรับ heartbeat/telemetry จาก Desktop และแสดงสถานะเครื่องใน Device Management" : "All license/device operations require it_admin APIs. Desktop MDM heartbeat is visible in Device Management."}</p><div className={styles.actions}><a className={styles.linkButton} href="/audit-logs">{th ? "เปิด Audit Logs" : "Open Audit Logs"}</a><a className={styles.linkButton} href="/it-admin/monitoring">Monitoring</a></div>{selected?.recent_receipts?.length ? <div className={styles.tableWrap}><table><thead><tr><th>{th ? "บิลล่าสุด" : "Recent receipts"}</th><th>{th ? "ยอด" : "Total"}</th><th>{th ? "เวลา" : "Time"}</th></tr></thead><tbody>{selected.recent_receipts.slice(0, 8).map((receipt) => <tr key={receipt.id}><td>{receipt.receipt_no}<small>{receipt.status} · {receipt.payment_method}</small></td><td>{money(receipt.total_amount)}</td><td>{formatWhen(receipt.sold_at, language)}</td></tr>)}</tbody></table></div> : null}</section>

    {previewOpen ? <div className={styles.modalBackdrop}><div className={styles.modal}><button className={styles.close} onClick={() => setPreviewOpen(false)}>×</button><h2>{th ? "ตรวจสอบก่อนสร้าง License" : "Review license"}</h2><dl className={styles.review}><dt>{th ? "ลูกค้า" : "Customer"}</dt><dd>{form.customer}</dd><dt>Plan</dt><dd>{form.plan}</dd><dt>Devices</dt><dd>{devices.join(" / ")}</dd><dt>{th ? "โหมดขาย" : "Modes"}</dt><dd>{salesModeText(form.features, th)}</dd><dt>{th ? "เริ่ม" : "Start"}</dt><dd>{form.notBefore}</dd><dt>{th ? "หมดอายุ" : "Expires"}</dt><dd>{form.expiryMode === "perpetual" ? (th ? "ไม่หมดอายุ" : "Perpetual") : form.expiryMode === "custom" ? form.customExpiry : `${form.expiryMode} days`}</dd></dl><div className={styles.actions}><button onClick={() => setPreviewOpen(false)}>{th ? "กลับ" : "Back"}</button><button className={styles.primary} disabled={busy} onClick={() => void issue()}>{busy ? (th ? "กำลังสร้าง..." : "Issuing...") : (th ? "ยืนยันสร้าง License" : "Issue license")}</button></div></div></div> : null}

    {issued ? <div className={styles.modalBackdrop}><div className={styles.modal}><button className={styles.close} onClick={() => setIssued(null)}>×</button><h2>{th ? "สร้าง License สำเร็จ" : "License issued"}</h2><p><b>{issued.payload.licenseId}</b></p><textarea className={styles.token} readOnly value={issued.token} /><div className={styles.actions}><button onClick={() => void copy(issued.token)}>{th ? "คัดลอก License Key" : "Copy license key"}</button><button onClick={() => setIssued(null)}>{th ? "ปิด" : "Close"}</button></div></div></div> : null}
  </div>;
}
