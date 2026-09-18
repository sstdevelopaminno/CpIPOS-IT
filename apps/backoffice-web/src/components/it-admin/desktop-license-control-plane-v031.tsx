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
type ModalName = "issuer" | "trial" | null;
type DetailPanel = "summary" | "devices" | "audit";

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
  const [modal, setModal] = useState<ModalName>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [issued, setIssued] = useState<IssueResult | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailPanel, setDetailPanel] = useState<DetailPanel>("summary");
  const [privateKeyInput, setPrivateKeyInput] = useState("");
  const [keyResult, setKeyResult] = useState<any>(null);

  const selected = useMemo(() => rows.find((row) => row.id === selectedId) || null, [rows, selectedId]);
  const devices = useMemo(() => [normalizeDevice(form.device1), ...(form.deviceCount === 2 ? [normalizeDevice(form.device2)] : [])], [form]);
  const activeCount = rows.filter((row) => row.status === "active").length;
  const onlineCount = rows.flatMap((row) => row.devices || []).filter((device) => device.online).length;
  const validation = useMemo(() => {
    if (!form.customer.trim()) return th ? "กรอกชื่อลูกค้า / ร้านค้า" : "Customer name is required";
    if (devices.some((device) => !DEVICE_PATTERN.test(device))) return th ? "Device Code ไม่ถูกต้อง" : "Invalid Device Code";
    if (new Set(devices).size !== devices.length) return th ? "Device Code ห้ามซ้ำ" : "Device codes must be unique";
    if (!form.features.some((feature) => feature.startsWith("sales-"))) return th ? "เลือกโหมดขายอย่างน้อย 1 โหมด" : "Select at least one sales mode";
    if (form.expiryMode === "custom" && !form.customExpiry) return th ? "กรอกวันหมดอายุ" : "Expiry date is required";
    return "";
  }, [devices, form, th]);

  const installerInfo = {
    version: "0.3.1",
    file: "CpIPOS.Desktop_0.3.1_x64-setup.exe",
    sha256: "1c70f88db5bbf31520d61da6fa39cf41efbf89d05ac84f9420b8bf50875aaf4c",
    size: "3.08 MB"
  };

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

  const openIssuer = () => {
    setForm(emptyForm());
    setPreviewOpen(false);
    setIssued(null);
    setModal("issuer");
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
      setSelectedId(null);
      await load(true);
    } catch (error) { setMessage(errorMessage(error)); } finally { setBusy(false); }
  };

  return <div className={styles.page}>
    <header className={styles.heroCompact}>
      <div>
        <span>DESKTOP LICENSE CONTROL PLANE</span>
        <h1>{th ? "ออก License POS Desktop" : "POS Desktop License"}</h1>
        <p>{th ? "หน้าแรกแสดง License History ก่อน ส่วน Key, Preview, Trial, Device และ MDM ซ่อนใน POP UP" : "License History first. Key, preview, trial, device and MDM tools open in modals."}</p>
      </div>
      <div className={styles.topActions}>
        <button className={styles.primary} onClick={openIssuer}>+ {th ? "ออก License ใหม่" : "New License"}</button>
        <button onClick={() => setModal("trial")}>{th ? "Trial Management" : "Trial"}</button>
        <button onClick={() => void load(false)} disabled={loading || busy}>{th ? "รีเฟรช" : "Refresh"}</button>
      </div>
    </header>

    {message ? <div className={styles.alert}>{message}</div> : null}

    <section className={styles.card}>
      <div className={styles.historyHeader}>
        <div>
          <h2>{th ? "License History" : "License History"}</h2>
          <p>{th ? "คลิกแถว License เพื่อเปิดเมนู Device Management และ Audit Log / MDM" : "Click a license row to open device and audit/MDM tools."}</p>
        </div>
        <div className={styles.historyMeta}>
          <span>{rows.length} {th ? "รายการ" : "licenses"}</span>
          <span>{activeCount} active</span>
          <span>{onlineCount} online</span>
        </div>
      </div>
      <div className={styles.tableWrap}>
        <table>
          <thead><tr><th>License</th><th>{th ? "ลูกค้า" : "Customer"}</th><th>{th ? "โหมด" : "Modes"}</th><th>{th ? "สถานะ" : "Status"}</th><th>{th ? "ยอดวันนี้" : "Today"}</th><th>{th ? "เครื่อง" : "Devices"}</th></tr></thead>
          <tbody>{rows.length ? rows.map((row) => <tr key={row.id} onClick={() => { setSelectedId(row.id); setDetailPanel("summary"); }} className={selected?.id === row.id ? styles.selected : ""}>
            <td><b>{row.license_id}</b><small>rev {row.revision} · {formatWhen(row.created_at, language)}</small></td>
            <td>{row.customer_name}<small>{row.plan}</small></td>
            <td>{salesModeText(row.features || [], th)}</td>
            <td><span className={row.status === "active" ? styles.badgeOk : styles.badge}>{row.status}</span></td>
            <td>{money(row.today?.gross_sales || 0)}<small>{row.today?.bill_count || 0} bills</small></td>
            <td>{row.devices?.length || 0}/{row.max_devices}<small>{row.devices?.filter((device) => device.online).length || 0} online</small></td>
          </tr>) : <tr><td colSpan={6} className={styles.empty}>{loading ? (th ? "กำลังโหลด..." : "Loading...") : (th ? "ยังไม่มี License History" : "No license history")}</td></tr>}</tbody>
        </table>
      </div>
    </section>

    {modal === "issuer" ? <div className={styles.modalBackdrop}><div className={styles.modalWide}>
      <button className={styles.close} onClick={() => setModal(null)}>×</button>
      <div className={styles.modalTitle}><span>LICENSE ISSUER</span><h2>{th ? "Key Management และ Preview ก่อนสร้าง License" : "Key Management and License Preview"}</h2><p>{th ? "ตั้งค่า Private Key และตรวจสอบข้อมูลก่อนสร้างลายเส้นจริง" : "Set the private key and review before issuing a signed license."}</p></div>
      <div className={styles.grid2}>
        <article className={styles.subCard}>
          <h3>1. Key Management</h3>
          <p>{th ? "ตรวจสอบ Private Key ที่ใช้ Sign ลายเส้น ต้องตรงกับ Public Key ที่ฝังอยู่ใน CpIPOS Desktop 0.3.1" : "Validate the signing key against CpIPOS Desktop 0.3.1."}</p>
          <div className={styles.keyState}><b className={signer?.configured ? styles.ok : styles.bad}>{signer?.configured ? (th ? "พร้อมออก License" : "Ready") : (th ? "ยังไม่พร้อม" : "Not ready")}</b><small>{signer?.public_key_fingerprint || signer?.expected_public_key_fingerprint || "—"}</small></div>
          <textarea className={styles.textarea} value={privateKeyInput} onChange={(event) => setPrivateKeyInput(event.target.value)} placeholder="-----BEGIN PRIVATE KEY-----" />
          <div className={styles.actions}><button onClick={() => void keyAction("validate")} disabled={busy || !privateKeyInput.trim()}>{th ? "ตรวจสอบ Key" : "Validate"}</button><button onClick={() => void keyAction("save_vault")} disabled={busy || !privateKeyInput.trim()}>{th ? "บันทึกเข้า Vault" : "Save to Vault"}</button><button onClick={() => void keyAction("generate")} disabled={busy}>{th ? "สร้าง Key Pair ใหม่" : "Generate key pair"}</button></div>
          {keyResult ? <pre className={styles.pre}>{JSON.stringify(keyResult, null, 2)}</pre> : null}
        </article>

        <article className={styles.subCard}>
          <h3>2. {th ? "Preview ก่อนสร้าง License" : "License Preview"}</h3>
          <div className={styles.formGrid}><label>{th ? "ชื่อลูกค้า / ร้านค้า" : "Customer"}<input value={form.customer} onChange={(e) => setForm({ ...form, customer: e.target.value })} /></label><label>{th ? "แพ็กเกจ" : "Plan"}<input value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })} /></label><label>{th ? "จำนวนเครื่อง" : "Devices"}<select value={form.deviceCount} onChange={(e) => setForm({ ...form, deviceCount: Number(e.target.value) as 1 | 2 })}><option value={1}>1</option><option value={2}>2</option></select></label><label>{th ? "เริ่มใช้งาน" : "Start"}<input type="date" value={form.notBefore} onChange={(e) => setForm({ ...form, notBefore: e.target.value })} /></label><label>Device Code #1<input value={form.device1} onChange={(e) => setForm({ ...form, device1: e.target.value.toUpperCase() })} /></label>{form.deviceCount === 2 ? <label>Device Code #2<input value={form.device2} onChange={(e) => setForm({ ...form, device2: e.target.value.toUpperCase() })} /></label> : null}<label>{th ? "อายุ License" : "Term"}<select value={form.expiryMode} onChange={(e) => setForm({ ...form, expiryMode: e.target.value as ExpiryMode })}><option value="perpetual">{th ? "ไม่หมดอายุ" : "Perpetual"}</option><option value="30">30 วัน</option><option value="365">365 วัน</option><option value="custom">{th ? "กำหนดเอง" : "Custom"}</option></select></label>{form.expiryMode === "custom" ? <label>{th ? "หมดอายุ" : "Expires"}<input type="date" value={form.customExpiry} onChange={(e) => setForm({ ...form, customExpiry: e.target.value })} /></label> : null}</div>
          <fieldset className={styles.checks}><legend>{th ? "สิทธิ์และโหมดขาย" : "Features and sales modes"}</legend>{FEATURE_OPTIONS.map((item) => <label key={item.id}><input type="checkbox" checked={form.features.includes(item.id)} disabled={item.id === "offline-pos"} onChange={(e) => setFeature(item.id, e.target.checked)} />{th ? item.th : item.en}</label>)}</fieldset>
          <button className={styles.primary} onClick={() => validation ? setMessage(validation) : setPreviewOpen(true)} disabled={busy}>{th ? "ตรวจสอบ Preview ก่อนสร้าง" : "Preview before issue"}</button>
        </article>
      </div>
    </div></div> : null}

    {modal === "trial" ? <div className={styles.modalBackdrop}><div className={styles.modal}>
      <button className={styles.close} onClick={() => setModal(null)}>×</button>
      <div className={styles.modalTitle}><span>TRIAL MANAGEMENT</span><h2>Trial Management</h2></div>
      <p>{th ? "CpIPOS Desktop 0.3.1 ทดลองใช้งาน 7 วันจากวันที่ติดตั้ง โปรแกรมจะล็อกเมื่อครบกำหนด และแสดง QR LINE/ช่องใส่ลายเส้นให้ลูกค้าซื้อและเปิดใช้งาน" : "CpIPOS Desktop 0.3.1 uses an installation-anchored 7-day trial."}</p>
      <div className={styles.installer}><b>{installerInfo.file}</b><span>SHA256: {installerInfo.sha256}</span><span>{installerInfo.size}</span></div>
      <p>{th ? "การเปลี่ยน Trial เป็น License: ให้ลูกค้าส่ง Device Code จากหน้า Lock/Activate จากนั้นออก License จากฟอร์มออก License ใหม่" : "To convert a trial, ask for the Device Code from the lock/activation popup and issue a license from New License."}</p>
    </div></div> : null}

    {selected ? <div className={styles.modalBackdrop}><div className={styles.modalWide}>
      <button className={styles.close} onClick={() => setSelectedId(null)}>×</button>
      <div className={styles.modalTitle}><span>LICENSE DETAIL</span><h2>{selected.license_id}</h2><p>{selected.customer_name} · {selected.plan}</p></div>
      <div className={styles.detailActions}><button className={detailPanel === "summary" ? styles.primary : ""} onClick={() => setDetailPanel("summary")}>{th ? "สรุป License" : "Summary"}</button><button className={detailPanel === "devices" ? styles.primary : ""} onClick={() => setDetailPanel("devices")}>Device Management</button><button className={detailPanel === "audit" ? styles.primary : ""} onClick={() => setDetailPanel("audit")}>Audit Log / MDM</button><button onClick={() => void copy(selected.license_id)}>{th ? "คัดลอก License ID" : "Copy License ID"}</button><button onClick={() => void deleteLicense(selected)}>{th ? "ยกเลิก License" : "Revoke"}</button></div>
      {detailPanel === "summary" ? <div className={styles.summaryGrid}><div><b>{th ? "ลูกค้า" : "Customer"}</b><strong>{selected.customer_name}</strong></div><div><b>{th ? "โหมดขาย" : "Sales modes"}</b><strong>{salesModeText(selected.features || [], th)}</strong></div><div><b>{th ? "สถานะ" : "Status"}</b><strong>{selected.status}</strong></div><div><b>{th ? "ยอดวันนี้" : "Today"}</b><strong>{money(selected.today?.gross_sales || 0)}</strong></div><div><b>{th ? "ยอดเดือนนี้" : "Month"}</b><strong>{money(selected.month?.gross_sales || 0)}</strong></div><div><b>{th ? "หมดอายุ" : "Expires"}</b><strong>{selected.expires_at ? formatWhen(selected.expires_at, language) : (th ? "ไม่หมดอายุ" : "Perpetual")}</strong></div></div> : null}
      {detailPanel === "devices" ? <div>{selected.devices.length ? selected.devices.map((device) => <div className={styles.device} key={device.id}><div><b>{device.device_code}</b><span>{device.device_name || "—"} · {device.online ? "ONLINE" : "OFFLINE"}</span><small>CPU {device.cpu_percent ?? "—"}% · RAM {device.memory_percent ?? "—"}% · DB {bytes(device.database_bytes)} · Printer {device.printer_status || "—"}</small><small>{th ? "เห็นล่าสุด" : "Last seen"}: {formatWhen(device.last_seen_at, language)}</small></div><div><button onClick={() => void deviceAction("reset_device", device.id)}>{th ? "Reset เครื่อง" : "Reset"}</button><button onClick={() => void deviceAction(device.is_authorized ? "block_device" : "unblock_device", device.id)}>{device.is_authorized ? (th ? "บล็อก" : "Block") : (th ? "ปลดบล็อก" : "Unblock")}</button></div></div>) : <p>{th ? "ยังไม่มีเครื่องที่ Activate" : "No activated devices."}</p>}<button onClick={() => void deviceAction("reset_contract_devices", undefined, selected.id)}>{th ? "Reset ทุกเครื่องใน License นี้" : "Reset all devices"}</button></div> : null}
      {detailPanel === "audit" ? <div><p>{th ? "MDM จะรับ heartbeat/telemetry จาก Desktop และแสดงสถานะเครื่องใน Device Management ส่วน Audit Logs แยกตาม API ฝั่ง IT" : "MDM heartbeat and telemetry appear under Device Management; API actions are logged in Audit Logs."}</p><div className={styles.actions}><a className={styles.linkButton} href="/audit-logs">{th ? "เปิด Audit Logs" : "Open Audit Logs"}</a><a className={styles.linkButton} href="/it-admin/monitoring">Monitoring</a></div>{selected.recent_receipts?.length ? <div className={styles.tableWrap}><table><thead><tr><th>{th ? "บิลล่าสุด" : "Recent receipts"}</th><th>{th ? "ยอด" : "Total"}</th><th>{th ? "เวลา" : "Time"}</th></tr></thead><tbody>{selected.recent_receipts.slice(0, 8).map((receipt) => <tr key={receipt.id}><td>{receipt.receipt_no}<small>{receipt.status} · {receipt.payment_method}</small></td><td>{money(receipt.total_amount)}</td><td>{formatWhen(receipt.sold_at, language)}</td></tr>)}</tbody></table></div> : <p>{th ? "ยังไม่มี Telemetry ยอดขายล่าสุด" : "No recent sales telemetry yet."}</p>}</div> : null}
    </div></div> : null}

    {previewOpen ? <div className={styles.modalBackdrop}><div className={styles.modal}>
      <button className={styles.close} onClick={() => setPreviewOpen(false)}>×</button><h2>{th ? "ตรวจสอบก่อนสร้าง License" : "Review license"}</h2><dl className={styles.review}><dt>{th ? "ลูกค้า" : "Customer"}</dt><dd>{form.customer}</dd><dt>Plan</dt><dd>{form.plan}</dd><dt>Devices</dt><dd>{devices.join(" / ")}</dd><dt>{th ? "โหมดขาย" : "Modes"}</dt><dd>{salesModeText(form.features, th)}</dd><dt>{th ? "เริ่ม" : "Start"}</dt><dd>{form.notBefore}</dd><dt>{th ? "หมดอายุ" : "Expires"}</dt><dd>{form.expiryMode === "perpetual" ? (th ? "ไม่หมดอายุ" : "Perpetual") : form.expiryMode === "custom" ? form.customExpiry : `${form.expiryMode} days`}</dd></dl><div className={styles.actions}><button onClick={() => setPreviewOpen(false)}>{th ? "กลับ" : "Back"}</button><button className={styles.primary} disabled={busy} onClick={() => void issue()}>{busy ? (th ? "กำลังสร้าง..." : "Issuing...") : (th ? "ยืนยันสร้าง License" : "Issue license")}</button></div>
    </div></div> : null}

    {issued ? <div className={styles.modalBackdrop}><div className={styles.modal}>
      <button className={styles.close} onClick={() => setIssued(null)}>×</button><h2>{th ? "สร้าง License สำเร็จ" : "License issued"}</h2><p><b>{issued.payload.licenseId}</b></p><textarea className={styles.token} readOnly value={issued.token} /><div className={styles.actions}><button onClick={() => void copy(issued.token)}>{th ? "คัดลอก License Key" : "Copy license key"}</button><button onClick={() => { setIssued(null); setModal(null); }}>{th ? "ปิด" : "Close"}</button></div>
    </div></div> : null}
  </div>;
}
