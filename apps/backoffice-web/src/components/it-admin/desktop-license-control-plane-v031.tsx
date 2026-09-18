"use client";

import { useEffect, useMemo, useState } from "react";
import type { Language } from "@/lib/i18n";
import styles from "./desktop-license-control-plane-v031.module.css";

type ApiEnvelope<T> = { data: T | null; error: { code?: string; message?: string } | null };
type Feature = "offline-pos" | "inventory" | "reports" | "receipt-printing" | "employee-pin" | "sales-grocery" | "sales-takeaway" | "sales-dine-in";
type ExpiryMode = "perpetual" | "30" | "365" | "custom";
type DeviceRow = {
  id: string;
  device_code: string;
  device_name?: string | null;
  machine_id?: string | null;
  status: string;
  is_authorized: boolean;
  remote_management_enabled?: boolean | null;
  app_version?: string | null;
  last_seen_at?: string | null;
  last_license_check_at?: string | null;
  last_sales_sync_at?: string | null;
  printer_status?: string | null;
  cpu_percent?: number | null;
  memory_percent?: number | null;
  disk_free_bytes?: number | null;
  database_bytes?: number | null;
  integrity_status?: string | null;
  tamper_detected?: boolean | null;
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
  today?: { bill_count: number; gross_sales: number; cancelled_count: number; cancelled_value: number };
  month?: { bill_count: number; gross_sales: number; cancelled_count: number; cancelled_value: number };
  recent_receipts?: Array<{ id: string; receipt_no: string; sold_at: string; total_amount: number; payment_method: string; status: string; cashier_name?: string | null }>;
};
type SignerStatus = { configured: boolean; key_matches_desktop?: boolean; public_key_fingerprint?: string | null; expected_public_key_fingerprint?: string | null; expected_public_key_spki_base64?: string | null; signer_source?: string; desktop_version?: string };
type IssueResult = { generated_at?: string; token: string; payload: { licenseId: string; customer: string; plan: string; devices: string[]; maxDevices: 1 | 2; features: string[]; notBefore: string; expiresAt: string | null }; publicKeyFingerprint?: string };
type LicenseTokenResult = { contract_id: string; license_id: string; customer_name: string; plan: string; revision: number; token: string; token_sha256?: string | null; created_at?: string; updated_at?: string };
type LicenseForm = { customer: string; plan: string; deviceCount: 1 | 2; device1: string; device2: string; notBefore: string; expiryMode: ExpiryMode; customExpiry: string; features: Feature[] };
type ModalName = "issuer" | "key" | "trial" | null;
type DetailPanel = "summary" | "devices" | "audit";
type MdmCommandType = "force_sync" | "refresh_license" | "recheck_printer" | "check_update" | "collect_health";

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
const MDM_COMMANDS: Array<{ type: MdmCommandType; th: string; en: string }> = [
  { type: "collect_health", th: "ตรวจสุขภาพเครื่อง", en: "Collect health" },
  { type: "force_sync", th: "ซิงก์ข้อมูลทันที", en: "Force sync" },
  { type: "refresh_license", th: "รีเฟรช License", en: "Refresh license" },
  { type: "recheck_printer", th: "ตรวจเครื่องพิมพ์", en: "Check printer" },
  { type: "check_update", th: "ตรวจอัปเดต", en: "Check update" }
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

function dateInput(value?: string | null) {
  if (!value) return todayInput();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return todayInput();
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(date);
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

function number(value: unknown) {
  return new Intl.NumberFormat("th-TH", { maximumFractionDigits: 0 }).format(Number(value ?? 0));
}

function bytes(value?: number | null) {
  const n = Number(value ?? 0);
  if (!n) return "—";
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

function pct(value?: number | null) {
  const n = Number(value ?? 0);
  return Math.min(100, Math.max(0, Number.isFinite(n) ? n : 0));
}

function salesModeText(features: string[], th: boolean) {
  return FEATURE_OPTIONS.filter((item) => item.group === "sales" && features.includes(item.id)).map((item) => th ? item.th : item.en).join(" · ") || (th ? "ยังไม่กำหนดโหมดขาย" : "No sales mode");
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || "Unknown error");
}

function downloadText(name: string, text: string, type = "text/plain;charset=utf-8") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function formFromRow(row: RegistryRow): LicenseForm {
  const devices = row.devices?.map((device) => device.device_code).filter(Boolean) || [];
  return {
    customer: row.customer_name,
    plan: row.plan,
    deviceCount: (row.max_devices === 2 ? 2 : 1),
    device1: devices[0] || "",
    device2: devices[1] || "",
    notBefore: dateInput(row.starts_at),
    expiryMode: row.expires_at ? "custom" : "perpetual",
    customExpiry: row.expires_at ? dateInput(row.expires_at) : "",
    features: (row.features || ["offline-pos", "sales-grocery"]) as Feature[]
  };
}

function deviceStatus(device: DeviceRow, th: boolean) {
  if (!device.is_authorized) return th ? "ปิดใช้งาน / บล็อก" : "Blocked";
  if (device.online) return th ? "ออนไลน์" : "Online";
  if (device.status === "never_seen") return th ? "ยังไม่เคยเชื่อมต่อ" : "Never seen";
  return th ? "ออฟไลน์" : "Offline";
}

function mdmEnabled(device: DeviceRow) {
  return device.is_authorized && device.remote_management_enabled !== false;
}

export function DesktopLicenseControlPlaneV031({ language }: { language: Language }) {
  const th = language === "th";
  const [rows, setRows] = useState<RegistryRow[]>([]);
  const [signer, setSigner] = useState<SignerStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<LicenseForm>(emptyForm());
  const [modal, setModal] = useState<ModalName>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [issued, setIssued] = useState<IssueResult | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailPanel, setDetailPanel] = useState<DetailPanel>("summary");
  const [privateKeyInput, setPrivateKeyInput] = useState("");
  const [keyResult, setKeyResult] = useState<unknown>(null);

  const selected = useMemo(() => rows.find((row) => row.id === selectedId) || null, [rows, selectedId]);
  const devices = useMemo(() => [normalizeDevice(form.device1), ...(form.deviceCount === 2 ? [normalizeDevice(form.device2)] : [])], [form]);
  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => [row.license_id, row.customer_name, row.plan, ...(row.devices || []).map((d) => d.device_code)].join(" ").toLowerCase().includes(q));
  }, [rows, search]);
  const totals = useMemo(() => {
    const allDevices = rows.flatMap((row) => row.devices || []);
    const todayGross = rows.reduce((sum, row) => sum + Number(row.today?.gross_sales || 0), 0);
    const todayBills = rows.reduce((sum, row) => sum + Number(row.today?.bill_count || 0), 0);
    return {
      licenses: rows.length,
      active: rows.filter((row) => row.status === "active").length,
      online: allDevices.filter((device) => device.online).length,
      blocked: allDevices.filter((device) => !device.is_authorized).length,
      mdm: allDevices.filter((device) => mdmEnabled(device)).length,
      totalDevices: allDevices.length,
      todayGross,
      todayBills,
      maxTodayGross: Math.max(1, ...rows.map((row) => Number(row.today?.gross_sales || 0)))
    };
  }, [rows]);

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

  const copy = async (value: string, label?: string) => {
    await navigator.clipboard.writeText(value);
    setMessage(label || (th ? "คัดลอกแล้ว" : "Copied"));
  };

  const fetchToken = async (row: RegistryRow) => {
    const response = await fetch("/api/it-admin/license-token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contractId: row.id })
    });
    const body = await response.json() as ApiEnvelope<LicenseTokenResult>;
    if (!response.ok || !body.data) throw new Error(body.error?.message || "LICENSE_TOKEN_FAILED");
    return body.data;
  };

  const copyLicenseKey = async (row: RegistryRow) => {
    setBusy(true);
    setMessage("");
    try {
      const token = await fetchToken(row);
      await copy(token.token, th ? "คัดลอก License Key จริงแล้ว นำไปใส่ใน CpIPOS Desktop ได้" : "Signed License Key copied");
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const downloadLicenseKey = async (row: RegistryRow) => {
    setBusy(true);
    setMessage("");
    try {
      const token = await fetchToken(row);
      downloadText(`${row.license_id}-LICENSE-KEY.txt`, `${token.token}\n`);
      setMessage(th ? "ดาวน์โหลด License Key แล้ว" : "License Key downloaded");
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const printLicenseKey = async (row: RegistryRow) => {
    setBusy(true);
    setMessage("");
    try {
      const token = await fetchToken(row);
      const win = window.open("", "_blank", "width=720,height=720");
      if (!win) throw new Error("POPUP_BLOCKED");
      win.document.write(`<html><head><title>${row.license_id}</title><style>body{font-family:Arial,sans-serif;padding:24px}textarea{width:100%;height:260px;font-family:monospace}code{font-weight:700}</style></head><body><h1>CpIPOS Desktop License Key</h1><p><b>License ID:</b> <code>${row.license_id}</code></p><p><b>Customer:</b> ${row.customer_name}</p><p>Copy the full License Key below into CpIPOS Desktop. Do not use License ID.</p><textarea readonly>${token.token}</textarea><script>window.print()</script></body></html>`);
      win.document.close();
      setMessage(th ? "เปิดหน้าพิมพ์ License Key แล้ว" : "License Key print window opened");
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const issue = async () => {
    if (validation) {
      setMessage(validation);
      return;
    }
    if (!signer?.configured) {
      setMessage(th ? "ยังไม่ได้ตั้งค่า Private Key ที่ตรงกับ CpIPOS Desktop 0.3.1" : "Signing key is not ready.");
      return;
    }
    setBusy(true);
    setMessage("");
    setIssued(null);
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
      setIssued(body.data);
      setPreviewOpen(false);
      await load(true);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const reissue = async (row: RegistryRow) => {
    const inputForm = formFromRow(row);
    const rowDevices = [normalizeDevice(inputForm.device1), ...(inputForm.deviceCount === 2 ? [normalizeDevice(inputForm.device2)] : [])];
    if (!window.confirm(th ? `ออก License Key ใหม่สำหรับ ${row.license_id}?` : `Reissue ${row.license_id}?`)) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/it-admin/license-registry", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contractId: row.id,
          input: {
            customer: inputForm.customer,
            plan: inputForm.plan,
            devices: rowDevices,
            notBefore: startIso(inputForm.notBefore),
            validDays: null,
            expiresAt: inputForm.expiryMode === "custom" ? endIso(inputForm.customExpiry) : null,
            features: inputForm.features
          }
        })
      });
      const body = await response.json() as ApiEnvelope<IssueResult>;
      if (!response.ok || !body.data) throw new Error(body.error?.message || "LICENSE_REISSUE_FAILED");
      setIssued(body.data);
      await copy(body.data.token, th ? "ออกและคัดลอก License Key ใหม่แล้ว" : "Reissued License Key copied");
      await load(true);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const keyAction = async (action: "generate" | "validate" | "save_vault") => {
    setBusy(true);
    setMessage("");
    setKeyResult(null);
    try {
      const response = await fetch("/api/it-admin/license-key-management", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, privateKeyPem: privateKeyInput })
      });
      const body = await response.json() as ApiEnvelope<Record<string, unknown>>;
      if (!response.ok || !body.data) throw new Error(body.error?.message || "LICENSE_KEY_ACTION_FAILED");
      setKeyResult(body.data);
      if (typeof body.data.private_key_pem === "string") setPrivateKeyInput(body.data.private_key_pem);
      await load(true);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const deviceAction = async (action: string, deviceId?: string, contractId?: string) => {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/it-admin/license-devices", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, deviceId, contractId, reason: action })
      });
      const body = await response.json() as ApiEnvelope<Record<string, unknown>>;
      if (!response.ok || !body.data) throw new Error(body.error?.message || "DEVICE_ACTION_FAILED");
      setMessage(th ? "อัปเดตสถานะเครื่องแล้ว" : "Device status updated");
      await load(true);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const sendMdmCommand = async (device: DeviceRow, commandType: MdmCommandType) => {
    if (!selected) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/it-admin/license-mdm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contractId: selected.id, deviceId: device.id, commandType, payload: { source: "license_detail_panel" } })
      });
      const body = await response.json() as ApiEnvelope<{ command: { id: string; command_type: string; status: string } }>;
      if (!response.ok || !body.data) throw new Error(body.error?.message || "MDM_COMMAND_FAILED");
      setMessage(th ? `ส่งคำสั่ง MDM แล้ว: ${commandType}` : `MDM command queued: ${commandType}`);
      await load(true);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const deleteLicense = async (row: RegistryRow) => {
    if (!window.confirm(th ? `ยกเลิก License ${row.license_id}?` : `Revoke ${row.license_id}?`)) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/it-admin/license-registry", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contractId: row.id, reason: "Revoked from Control Plane v0.3.1" })
      });
      const body = await response.json() as ApiEnvelope<Record<string, unknown>>;
      if (!response.ok || !body.data) throw new Error(body.error?.message || "LICENSE_DELETE_FAILED");
      setSelectedId(null);
      await load(true);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return <div className={styles.page}>
    <header className={styles.heroCompact}>
      <div>
        <span>DESKTOP LICENSE CONTROL PLANE</span>
        <h1>{th ? "จัดการ License โปรแกรม POS Desktop" : "POS Desktop License"}</h1>
        <p>{th ? "ออกลายเส้นจริง จัดการเครื่อง ตรวจสุขภาพ และควบคุม MDM จากหน้าเดียว" : "Issue signed keys, manage devices, inspect health, and control MDM in one page."}</p>
      </div>
      <div className={styles.actions}>
        <button onClick={() => void load(false)} disabled={busy}>{th ? "รีเฟรช" : "Refresh"}</button>
        <button onClick={() => setModal("key")}>Key Management</button>
        <button onClick={() => setModal("trial")}>Trial</button>
        <button className={styles.primary} onClick={openIssuer}>+ {th ? "ออก License ใหม่" : "New License"}</button>
      </div>
    </header>

    {message ? <div className={styles.alert}>{message}</div> : null}

    <section className={styles.kpiGrid}>
      <article className={styles.kpi}><span>{th ? "License ทั้งหมด" : "Total licenses"}</span><b>{number(totals.licenses)}</b><small>{totals.active} active</small></article>
      <article className={styles.kpi}><span>{th ? "เครื่องออนไลน์" : "Online devices"}</span><b>{number(totals.online)}/{number(totals.totalDevices)}</b><small>{totals.blocked} blocked</small></article>
      <article className={styles.kpi}><span>{th ? "MDM เชื่อมต่อ" : "MDM connected"}</span><b>{number(totals.mdm)}</b><small>{th ? "กดเปิด/ปิดได้ในแท็บ MDM" : "Toggle inside MDM tab"}</small></article>
      <article className={styles.kpi}><span>{th ? "ยอดขายวันนี้" : "Today sales"}</span><b>{money(totals.todayGross)}</b><small>{number(totals.todayBills)} bills</small></article>
    </section>

    <section className={styles.card}>
      <div className={styles.historyHeader}>
        <div>
          <h2>{th ? "License History / ตัวเลขและกราฟ" : "License History / Metrics & Chart"}</h2>
          <p>{th ? "License ID ใช้ดูประวัติเท่านั้น ต้องคัดลอก License Key แบบเต็มไปใส่ในโปรแกรม" : "License ID is history only. Copy the full signed License Key into Desktop."}</p>
        </div>
        <div className={styles.historyMeta}>
          <span>{rows.length} {th ? "รายการ" : "licenses"}</span>
          <span>{totals.online} online</span>
          <span>{totals.mdm} MDM</span>
        </div>
      </div>
      <div className={styles.chartPanel}>
        <div className={styles.chartTitle}><b>{th ? "กราฟยอดขายวันนี้ตาม License" : "Today sales by license"}</b><span>{money(totals.todayGross)}</span></div>
        <div className={styles.barChart}>{filteredRows.slice(0, 12).map((row) => {
          const value = Number(row.today?.gross_sales || 0);
          const height = Math.max(8, Math.round((value / totals.maxTodayGross) * 100));
          return <button key={row.id} type="button" className={styles.chartBar} title={`${row.license_id} ${money(value)}`} onClick={() => { setSelectedId(row.id); setDetailPanel("summary"); }}><i style={{ height: `${height}%` }} /><span>{row.customer_name.slice(0, 10) || row.license_id.slice(-6)}</span></button>;
        })}</div>
      </div>
      <div className={styles.formGrid}>
        <label>{th ? "ค้นหา License / ลูกค้า / Device" : "Search license / customer / device"}<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="CP-... / CpIPOS Store / Device Code" /></label>
      </div>
      <div className={styles.tableWrap}>
        <table>
          <thead><tr><th>License ID</th><th>{th ? "ลูกค้า" : "Customer"}</th><th>{th ? "โหมด" : "Modes"}</th><th>{th ? "สถานะ" : "Status"}</th><th>{th ? "ยอดวันนี้" : "Today"}</th><th>{th ? "เครื่อง / Key" : "Devices / Key"}</th></tr></thead>
          <tbody>{filteredRows.length ? filteredRows.map((row) => <tr key={row.id} onClick={() => { setSelectedId(row.id); setDetailPanel("summary"); }} className={selected?.id === row.id ? styles.selected : ""}>
            <td><b>{row.license_id}</b><small>rev {row.revision} · {formatWhen(row.created_at, language)}</small></td>
            <td>{row.customer_name}<small>{row.plan}</small></td>
            <td>{salesModeText(row.features || [], th)}</td>
            <td><span className={row.status === "active" ? styles.badgeOk : styles.badge}>{row.status}</span></td>
            <td>{money(row.today?.gross_sales || 0)}<small>{row.today?.bill_count || 0} bills</small></td>
            <td>{row.devices?.length || 0}/{row.max_devices}<small>{row.devices?.filter((device) => device.online).length || 0} online · {row.devices?.filter((device) => mdmEnabled(device)).length || 0} MDM</small><button type="button" onClick={(event) => { event.stopPropagation(); void copyLicenseKey(row); }}>{th ? "คัดลอก Key จริง" : "Copy key"}</button></td>
          </tr>) : <tr><td colSpan={6} className={styles.empty}>{loading ? (th ? "กำลังโหลด..." : "Loading...") : (th ? "ยังไม่มี License History" : "No license history")}</td></tr>}</tbody>
        </table>
      </div>
    </section>

    {modal === "key" ? <div className={styles.modalBackdrop}><div className={styles.modalWide}>
      <button className={styles.close} onClick={() => setModal(null)}>×</button>
      <div className={styles.modalTitle}><span>1. KEY MANAGEMENT</span><h2>Private Key / Public Key</h2><p>{th ? "Private Key ต้องตรงกับ Public Key ที่ฝังอยู่ใน CpIPOS Desktop 0.3.1" : "Private key must match the public key embedded in Desktop 0.3.1."}</p></div>
      <article className={styles.subCard}>
        <div className={styles.keyState}><b className={signer?.configured ? styles.ok : styles.bad}>{signer?.configured ? (th ? "พร้อมออก License" : "Ready") : (th ? "ยังไม่พร้อม" : "Not ready")}</b><small>{signer?.public_key_fingerprint || signer?.expected_public_key_fingerprint || "—"}</small></div>
        <textarea className={styles.textarea} value={privateKeyInput} onChange={(event) => setPrivateKeyInput(event.target.value)} placeholder="-----BEGIN PRIVATE KEY-----" />
        <div className={styles.actions}><button onClick={() => void keyAction("validate")} disabled={busy || !privateKeyInput.trim()}>{th ? "ตรวจสอบ Key" : "Validate"}</button><button onClick={() => void keyAction("save_vault")} disabled={busy || !privateKeyInput.trim()}>{th ? "บันทึกเข้า Vault" : "Save to Vault"}</button><button onClick={() => void keyAction("generate")} disabled={busy}>{th ? "สร้าง Key Pair ใหม่" : "Generate key pair"}</button></div>
        {keyResult ? <pre className={styles.pre}>{JSON.stringify(keyResult, null, 2)}</pre> : null}
      </article>
    </div></div> : null}

    {modal === "issuer" ? <div className={styles.modalBackdrop}><div className={styles.modalWide}>
      <button className={styles.close} onClick={() => setModal(null)}>×</button>
      <div className={styles.modalTitle}><span>2. LICENSE PREVIEW / ISSUE</span><h2>{th ? "ออก License POS Desktop" : "Issue Desktop License"}</h2><p>{th ? "ตรวจข้อมูลก่อนสร้าง ลายเส้นจริงคือ License Key แบบยาว ไม่ใช่ License ID" : "Review before issuing. The real key is the long signed License Key, not the License ID."}</p></div>
      <div className={styles.grid2}>
        <article className={styles.subCard}>
          <h3>{th ? "ข้อมูล License" : "License details"}</h3>
          <div className={styles.formGrid}><label>{th ? "ชื่อลูกค้า / ร้านค้า" : "Customer"}<input value={form.customer} onChange={(event) => setForm({ ...form, customer: event.target.value })} /></label><label>{th ? "แพ็กเกจ" : "Plan"}<input value={form.plan} onChange={(event) => setForm({ ...form, plan: event.target.value })} /></label><label>{th ? "จำนวนเครื่อง" : "Devices"}<select value={form.deviceCount} onChange={(event) => setForm({ ...form, deviceCount: Number(event.target.value) as 1 | 2 })}><option value={1}>1</option><option value={2}>2</option></select></label><label>{th ? "เริ่มใช้งาน" : "Start"}<input type="date" value={form.notBefore} onChange={(event) => setForm({ ...form, notBefore: event.target.value })} /></label><label>Device Code #1<input value={form.device1} onChange={(event) => setForm({ ...form, device1: event.target.value.toUpperCase() })} /></label>{form.deviceCount === 2 ? <label>Device Code #2<input value={form.device2} onChange={(event) => setForm({ ...form, device2: event.target.value.toUpperCase() })} /></label> : null}<label>{th ? "อายุ License" : "Term"}<select value={form.expiryMode} onChange={(event) => setForm({ ...form, expiryMode: event.target.value as ExpiryMode })}><option value="perpetual">{th ? "ไม่หมดอายุ" : "Perpetual"}</option><option value="30">30 วัน</option><option value="365">365 วัน</option><option value="custom">{th ? "กำหนดเอง" : "Custom"}</option></select></label>{form.expiryMode === "custom" ? <label>{th ? "หมดอายุ" : "Expires"}<input type="date" value={form.customExpiry} onChange={(event) => setForm({ ...form, customExpiry: event.target.value })} /></label> : null}</div>
          <fieldset className={styles.checks}><legend>{th ? "สิทธิ์และโหมดขาย" : "Features and sales modes"}</legend>{FEATURE_OPTIONS.map((item) => <label key={item.id}><input type="checkbox" checked={form.features.includes(item.id)} disabled={item.id === "offline-pos"} onChange={(event) => setFeature(item.id, event.target.checked)} />{th ? item.th : item.en}</label>)}</fieldset>
          <button className={styles.primary} onClick={() => validation ? setMessage(validation) : setPreviewOpen(true)} disabled={busy}>{th ? "ตรวจสอบ Preview ก่อนสร้าง" : "Preview before issue"}</button>
        </article>
        <article className={styles.subCard}>
          <h3>{th ? "License Key ที่ออกล่าสุด" : "Latest issued key"}</h3>
          {issued ? <><p><b>License ID:</b> {issued.payload.licenseId}</p><p>{issued.payload.customer} · {issued.payload.plan}</p><textarea className={styles.textarea} readOnly value={issued.token} rows={9} spellCheck={false} /><div className={styles.actions}><button className={styles.primary} onClick={() => void copy(issued.token, th ? "คัดลอก License Key จริงแล้ว" : "Signed key copied")}>{th ? "คัดลอก License Key" : "Copy License Key"}</button><button onClick={() => downloadText(`${issued.payload.licenseId}-LICENSE-KEY.txt`, `${issued.token}\n`)}>{th ? "ดาวน์โหลด .txt" : "Download .txt"}</button></div></> : <p>{th ? "เมื่อสร้างสำเร็จ จะแสดง License Key แบบเต็มตรงนี้" : "The signed key will appear here after issue."}</p>}
        </article>
      </div>
    </div></div> : null}

    {modal === "trial" ? <div className={styles.modalBackdrop}><div className={styles.modal}>
      <button className={styles.close} onClick={() => setModal(null)}>×</button>
      <div className={styles.modalTitle}><span>5. TRIAL MANAGEMENT</span><h2>Trial Management</h2></div>
      <p>{th ? "CpIPOS Desktop 0.3.1 ทดลองใช้งาน 7 วันจากวันที่ติดตั้ง โปรแกรมจะล็อกเมื่อครบกำหนด และแสดง QR LINE/ช่องใส่ลายเส้นให้ลูกค้าซื้อและเปิดใช้งาน" : "CpIPOS Desktop 0.3.1 uses an installation-anchored 7-day trial."}</p>
      <div className={styles.installer}><b>{installerInfo.file}</b><span>SHA256: {installerInfo.sha256}</span><span>{installerInfo.size}</span></div>
      <p>{th ? "การเปลี่ยน Trial เป็น License: ให้ลูกค้าส่ง Device Code จากหน้า Lock/Activate จากนั้นออก License จากฟอร์มออก License ใหม่" : "To convert a trial, ask for the Device Code from the lock/activation popup and issue a license from New License."}</p>
    </div></div> : null}

    {selected ? <div className={styles.modalBackdrop}><div className={styles.modalWide}>
      <button className={styles.close} onClick={() => setSelectedId(null)}>×</button>
      <div className={styles.modalTitle}><span>3/4/6. LICENSE DETAIL</span><h2>{selected.license_id}</h2><p>{selected.customer_name} · {selected.plan}</p></div>
      <div className={styles.detailActions}><button className={detailPanel === "summary" ? styles.primary : ""} onClick={() => setDetailPanel("summary")}>{th ? "สรุป License" : "Summary"}</button><button className={detailPanel === "devices" ? styles.primary : ""} onClick={() => setDetailPanel("devices")}>Device Management</button><button className={detailPanel === "audit" ? styles.primary : ""} onClick={() => setDetailPanel("audit")}>Audit Log / MDM</button><button onClick={() => void copyLicenseKey(selected)}>{th ? "คัดลอก License Key จริง" : "Copy signed key"}</button><button onClick={() => void downloadLicenseKey(selected)}>{th ? "ดาวน์โหลด Key" : "Download key"}</button><button onClick={() => void printLicenseKey(selected)}>{th ? "พิมพ์ Key" : "Print key"}</button><button onClick={() => { setForm(formFromRow(selected)); setModal("issuer"); setSelectedId(null); }}>{th ? "แก้ไขเป็นฟอร์มใหม่" : "Edit as new form"}</button><button onClick={() => void reissue(selected)}>{th ? "ออก Key ใหม่" : "Reissue"}</button><button onClick={() => void deleteLicense(selected)}>{th ? "ยกเลิก License" : "Revoke"}</button></div>
      {detailPanel === "summary" ? <div className={styles.summaryGrid}><div><b>{th ? "ลูกค้า" : "Customer"}</b><strong>{selected.customer_name}</strong></div><div><b>{th ? "โหมดขาย" : "Sales modes"}</b><strong>{salesModeText(selected.features || [], th)}</strong></div><div><b>{th ? "สถานะ" : "Status"}</b><strong>{selected.status}</strong></div><div><b>{th ? "ยอดวันนี้" : "Today"}</b><strong>{money(selected.today?.gross_sales || 0)}</strong><span>{number(selected.today?.bill_count || 0)} bills</span></div><div><b>{th ? "ยอดเดือนนี้" : "Month"}</b><strong>{money(selected.month?.gross_sales || 0)}</strong><span>{number(selected.month?.bill_count || 0)} bills</span></div><div><b>{th ? "หมดอายุ" : "Expires"}</b><strong>{selected.expires_at ? formatWhen(selected.expires_at, language) : (th ? "ไม่หมดอายุ" : "Perpetual")}</strong></div></div> : null}
      {detailPanel === "devices" ? <div className={styles.deviceGrid}>{selected.devices.length ? selected.devices.map((device) => <article className={styles.deviceCard} key={device.id}><div className={styles.deviceHead}><div><b>{device.device_code}</b><span>{device.device_name || device.machine_id || "—"}</span></div><span className={device.online ? styles.badgeOk : !device.is_authorized ? styles.badgeDanger : styles.badge}>{deviceStatus(device, th)}</span></div><div className={styles.healthBars}><label>CPU <b>{device.cpu_percent ?? "—"}%</b><i><em style={{ width: `${pct(device.cpu_percent)}%` }} /></i></label><label>RAM <b>{device.memory_percent ?? "—"}%</b><i><em style={{ width: `${pct(device.memory_percent)}%` }} /></i></label></div><p>{th ? "เห็นล่าสุด" : "Last seen"}: {formatWhen(device.last_seen_at, language)} · DB {bytes(device.database_bytes)} · Printer {device.printer_status || "—"}</p><div className={styles.statusBox}><strong>{th ? "สถานะเครื่อง" : "Device status"}</strong><span>{th ? "ดูสถานะได้ และกดเปิด/ปิดสิทธิ์เครื่องได้จากตรงนี้" : "Inspect status and enable/disable the device here."}</span></div><div className={styles.actions}><button onClick={() => void deviceAction("reset_device", device.id)} disabled={busy}>{th ? "Reset เครื่อง" : "Reset"}</button><button className={!device.is_authorized ? styles.primary : ""} onClick={() => void deviceAction(device.is_authorized ? "block_device" : "unblock_device", device.id)} disabled={busy}>{device.is_authorized ? (th ? "ปิด/บล็อกเครื่อง" : "Disable / block") : (th ? "เปิดใช้งานเครื่อง" : "Enable device")}</button></div></article>) : <p>{th ? "ยังไม่มีเครื่องที่ Activate" : "No activated devices."}</p>}<button onClick={() => void deviceAction("reset_contract_devices", undefined, selected.id)} disabled={busy}>{th ? "Reset ทุกเครื่องใน License นี้" : "Reset all devices"}</button></div> : null}
      {detailPanel === "audit" ? <div className={styles.mdmPanel}><p>{th ? "MDM ใช้ส่งคำสั่งให้ Desktop จากหลังบ้าน เช่น ตรวจสุขภาพ ซิงก์ข้อมูล รีเฟรช License และตรวจเครื่องพิมพ์ สามารถกดเชื่อมต่อหรือปิดการเชื่อมต่อได้ต่อเครื่อง" : "MDM queues remote commands for Desktop. You can connect or disconnect MDM per device."}</p>{selected.devices.length ? selected.devices.map((device) => <article className={styles.mdmCard} key={device.id}><div className={styles.deviceHead}><div><b>{device.device_code}</b><span>{device.device_name || "—"} · {formatWhen(device.last_seen_at, language)}</span></div><span className={mdmEnabled(device) ? styles.badgeOk : styles.badgeDanger}>{mdmEnabled(device) ? (th ? "MDM เชื่อมต่อ" : "MDM connected") : (th ? "MDM ปิดอยู่" : "MDM disconnected")}</span></div><div className={styles.actions}><button className={mdmEnabled(device) ? "" : styles.primary} onClick={() => void deviceAction("enable_mdm", device.id)} disabled={busy || !device.is_authorized || mdmEnabled(device)}>{th ? "เชื่อมต่อ MDM" : "Connect MDM"}</button><button onClick={() => void deviceAction("disable_mdm", device.id)} disabled={busy || !mdmEnabled(device)}>{th ? "ปิดการเชื่อมต่อ" : "Disconnect"}</button></div><div className={styles.commandGrid}>{MDM_COMMANDS.map((command) => <button key={command.type} onClick={() => void sendMdmCommand(device, command.type)} disabled={busy || !mdmEnabled(device)}>{th ? command.th : command.en}</button>)}</div></article>) : <p>{th ? "ยังไม่มีเครื่องสำหรับเชื่อมต่อ MDM" : "No devices for MDM."}</p>}<div className={styles.actions}><a className={styles.linkButton} href="/audit-logs">{th ? "เปิด Audit Logs" : "Open Audit Logs"}</a><a className={styles.linkButton} href="/it-admin/monitoring">Monitoring</a></div>{selected.recent_receipts?.length ? <div className={styles.tableWrap}><table><thead><tr><th>{th ? "บิลล่าสุด" : "Recent receipts"}</th><th>{th ? "ยอด" : "Total"}</th><th>{th ? "เวลา" : "Time"}</th></tr></thead><tbody>{selected.recent_receipts.slice(0, 8).map((receipt) => <tr key={receipt.id}><td>{receipt.receipt_no}<small>{receipt.status} · {receipt.payment_method}</small></td><td>{money(receipt.total_amount)}</td><td>{formatWhen(receipt.sold_at, language)}</td></tr>)}</tbody></table></div> : <p>{th ? "ยังไม่มี Telemetry ยอดขายล่าสุด" : "No recent sales telemetry yet."}</p>}</div> : null}
    </div></div> : null}

    {previewOpen ? <div className={styles.modalBackdrop}><div className={styles.modal}>
      <button className={styles.close} onClick={() => setPreviewOpen(false)}>×</button><h2>{th ? "ตรวจสอบก่อนสร้าง License" : "Review license"}</h2><dl className={styles.review}><dt>{th ? "ลูกค้า" : "Customer"}</dt><dd>{form.customer}</dd><dt>Plan</dt><dd>{form.plan}</dd><dt>Devices</dt><dd>{devices.join(" / ")}</dd><dt>{th ? "โหมดขาย" : "Modes"}</dt><dd>{salesModeText(form.features, th)}</dd><dt>{th ? "เริ่ม" : "Start"}</dt><dd>{form.notBefore}</dd><dt>{th ? "หมดอายุ" : "Expires"}</dt><dd>{form.expiryMode === "perpetual" ? (th ? "ไม่หมดอายุ" : "Perpetual") : form.expiryMode === "custom" ? form.customExpiry : `${form.expiryMode} days`}</dd></dl><p>{th ? "หลังสร้าง ให้คัดลอก License Key แบบเต็มไปใส่ในโปรแกรม ห้ามใช้ License ID" : "After issue, copy the full signed License Key into Desktop. Do not use License ID."}</p><div className={styles.actions}><button onClick={() => setPreviewOpen(false)}>{th ? "กลับ" : "Back"}</button><button className={styles.primary} disabled={busy} onClick={() => void issue()}>{busy ? (th ? "กำลังสร้าง..." : "Issuing...") : (th ? "ยืนยันสร้าง License" : "Issue license")}</button></div>
    </div></div> : null}
  </div>;
}
