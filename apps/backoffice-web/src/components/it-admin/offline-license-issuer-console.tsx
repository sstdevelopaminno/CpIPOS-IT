"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./offline-license-issuer-console.module.css";

type Language = "th" | "en";

type LicensePayload = {
  v: 1;
  product: string;
  issuer: string;
  licenseId: string;
  customer: string;
  plan: string;
  issuedAt: string;
  notBefore: string;
  expiresAt: string | null;
  maxDevices: 1 | 2;
  devices: string[];
  features: string[];
};

type IssueResult = {
  generated_at: string;
  token: string;
  payload: LicensePayload;
  publicKeyFingerprint: string;
};

type ApiEnvelope<T> = { data: T | null; error: { code: string; message: string } | null };

type ExpiryMode = "perpetual" | "30" | "365" | "custom";

const DEVICE_PATTERN = /^CP-[A-F0-9]{5}-[A-F0-9]{5}-[A-F0-9]{5}-[A-F0-9]{5}$/;
const FEATURE_OPTIONS = [
  { id: "offline-pos", th: "ขายหน้าร้านออฟไลน์", en: "Offline POS" },
  { id: "inventory", th: "สินค้าและสต็อก", en: "Inventory" },
  { id: "reports", th: "รายงาน", en: "Reports" },
  { id: "receipt-printing", th: "พิมพ์ใบเสร็จ", en: "Receipt printing" },
  { id: "employee-pin", th: "พนักงานและ PIN", en: "Employees & PIN" }
] as const;

const copy = {
  th: {
    keyReady: "Private Key พร้อมใช้งาน",
    keyMissing: "ยังไม่ได้ตั้งค่า Private Key",
    customer: "ชื่อลูกค้า / ร้านค้า",
    plan: "แพ็กเกจ",
    devices: "จำนวนเครื่อง",
    device1: "Device Code เครื่องที่ 1",
    device2: "Device Code เครื่องที่ 2",
    notBefore: "วันที่เริ่มใช้งาน",
    expiry: "อายุ License",
    perpetual: "ไม่หมดอายุ",
    days30: "30 วัน",
    days365: "1 ปี (365 วัน)",
    custom: "กำหนดวันหมดอายุ",
    expiresAt: "วันหมดอายุ",
    features: "สิทธิ์ที่อนุญาต",
    issue: "สร้าง License",
    issuing: "กำลังสร้าง License...",
    token: "License Key สำหรับนำไปใส่ใน CpIPOS Desktop",
    copy: "คัดลอกรหัส",
    copied: "คัดลอกแล้ว",
    downloadTxt: "ดาวน์โหลด .txt",
    downloadJson: "ดาวน์โหลดรายละเอียด .json",
    clear: "สร้างรายการใหม่",
    deviceHelp: "คัดลอก Device Code จากหน้า License ของ CpIPOS Desktop ให้ตรงทุกตัวอักษร",
    privateKeyHelp: "Private Key อยู่เฉพาะ Environment Secret ของระบบหลังบ้าน และไม่ถูกส่งไป Browser",
    resultTitle: "ออก License สำเร็จ",
    lifetime: "ถาวร",
    validation: "ตรวจสอบข้อมูลก่อนสร้าง License"
  },
  en: {
    keyReady: "Private key configured",
    keyMissing: "Private key is not configured",
    customer: "Customer / store",
    plan: "Plan",
    devices: "Device count",
    device1: "Device Code #1",
    device2: "Device Code #2",
    notBefore: "Activation date",
    expiry: "License term",
    perpetual: "No expiry",
    days30: "30 days",
    days365: "1 year (365 days)",
    custom: "Custom expiry date",
    expiresAt: "Expiry date",
    features: "Allowed features",
    issue: "Issue license",
    issuing: "Issuing license...",
    token: "License Key for CpIPOS Desktop",
    copy: "Copy license",
    copied: "Copied",
    downloadTxt: "Download .txt",
    downloadJson: "Download details .json",
    clear: "New license",
    deviceHelp: "Copy the exact Device Code from the CpIPOS Desktop License screen.",
    privateKeyHelp: "The private key stays in the backoffice server environment and is never sent to the browser.",
    resultTitle: "License issued",
    lifetime: "Perpetual",
    validation: "Check the form before issuing the license"
  }
} as const;

function normalizeDevice(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

function asBangkokStart(date: string) {
  return date ? `${date}T00:00:00+07:00` : null;
}

function asBangkokEnd(date: string) {
  return date ? `${date}T23:59:59+07:00` : null;
}

function downloadText(name: string, text: string, type = "text/plain;charset=utf-8") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function OfflineLicenseIssuerConsole({ language }: { language: Language }) {
  const text = copy[language];
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [customer, setCustomer] = useState("");
  const [plan, setPlan] = useState("Offline Standard");
  const [deviceCount, setDeviceCount] = useState<1 | 2>(1);
  const [device1, setDevice1] = useState("");
  const [device2, setDevice2] = useState("");
  const [notBefore, setNotBefore] = useState("");
  const [expiryMode, setExpiryMode] = useState<ExpiryMode>("perpetual");
  const [customExpiry, setCustomExpiry] = useState("");
  const [features, setFeatures] = useState<string[]>(FEATURE_OPTIONS.map((item) => item.id));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<IssueResult | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void fetch("/api/it-admin/license-issuer", { cache: "no-store" })
      .then(async (response) => (await response.json()) as ApiEnvelope<{ configured: boolean }>)
      .then((payload) => setConfigured(Boolean(payload.data?.configured)))
      .catch(() => setConfigured(false));
  }, []);

  const deviceValues = useMemo(
    () => [normalizeDevice(device1), ...(deviceCount === 2 ? [normalizeDevice(device2)] : [])],
    [device1, device2, deviceCount]
  );

  const validationError = useMemo(() => {
    if (!customer.trim()) return text.customer;
    if (!plan.trim()) return text.plan;
    if (deviceValues.some((value) => !DEVICE_PATTERN.test(value))) return text.deviceHelp;
    if (new Set(deviceValues).size !== deviceValues.length) return language === "th" ? "Device Code ห้ามซ้ำกัน" : "Device Codes must be unique";
    if (expiryMode === "custom" && !customExpiry) return text.expiresAt;
    return "";
  }, [customer, plan, deviceValues, expiryMode, customExpiry, language, text]);

  const toggleFeature = (feature: string) => {
    if (feature === "offline-pos") return;
    setFeatures((current) => current.includes(feature) ? current.filter((item) => item !== feature) : [...current, feature]);
  };

  const submit = async () => {
    if (validationError) {
      setMessage(`${text.validation}: ${validationError}`);
      return;
    }
    setBusy(true);
    setMessage("");
    setResult(null);
    setCopied(false);
    try {
      const body = {
        customer: customer.trim(),
        plan: plan.trim(),
        devices: deviceValues,
        notBefore: asBangkokStart(notBefore),
        validDays: expiryMode === "30" ? 30 : expiryMode === "365" ? 365 : null,
        expiresAt: expiryMode === "custom" ? asBangkokEnd(customExpiry) : null,
        features
      };
      const response = await fetch("/api/it-admin/license-issuer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      const payload = (await response.json()) as ApiEnvelope<IssueResult>;
      if (!response.ok || !payload.data) throw new Error(payload.error?.message || "LICENSE_ISSUE_FAILED");
      setResult(payload.data);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "LICENSE_ISSUE_FAILED");
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setCustomer("");
    setPlan("Offline Standard");
    setDeviceCount(1);
    setDevice1("");
    setDevice2("");
    setNotBefore("");
    setExpiryMode("perpetual");
    setCustomExpiry("");
    setFeatures(FEATURE_OPTIONS.map((item) => item.id));
    setMessage("");
    setResult(null);
    setCopied(false);
  };

  return (
    <div className={styles.stack}>
      <section className={styles.securityCard}>
        <div className={`${styles.keyStatus} ${configured ? styles.ready : styles.notReady}`}>
          <span className={styles.statusDot} />
          <strong>{configured ? text.keyReady : text.keyMissing}</strong>
        </div>
        <p>{text.privateKeyHelp}</p>
      </section>

      <section className={styles.formCard}>
        <div className={styles.grid}>
          <label className={styles.wide}>
            <span>{text.customer}</span>
            <input value={customer} maxLength={120} onChange={(event) => setCustomer(event.target.value)} placeholder="ร้านตัวอย่าง / Example Store" />
          </label>

          <label>
            <span>{text.plan}</span>
            <select value={plan} onChange={(event) => setPlan(event.target.value)}>
              <option value="Offline Standard">Offline Standard</option>
              <option value="Offline Pro">Offline Pro</option>
              <option value="Offline 2 Devices">Offline 2 Devices</option>
              <option value="Offline Lifetime">Offline Lifetime</option>
            </select>
          </label>

          <label>
            <span>{text.devices}</span>
            <select value={deviceCount} onChange={(event) => setDeviceCount(Number(event.target.value) as 1 | 2)}>
              <option value={1}>1</option>
              <option value={2}>2</option>
            </select>
          </label>

          <label className={styles.wide}>
            <span>{text.device1}</span>
            <input value={device1} onChange={(event) => setDevice1(event.target.value.toUpperCase())} placeholder="CP-AAAAA-BBBBB-CCCCC-DDDDD" spellCheck={false} />
          </label>

          {deviceCount === 2 ? (
            <label className={styles.wide}>
              <span>{text.device2}</span>
              <input value={device2} onChange={(event) => setDevice2(event.target.value.toUpperCase())} placeholder="CP-11111-22222-33333-44444" spellCheck={false} />
            </label>
          ) : null}

          <p className={styles.help}>{text.deviceHelp}</p>

          <label>
            <span>{text.notBefore}</span>
            <input type="date" value={notBefore} onChange={(event) => setNotBefore(event.target.value)} />
          </label>

          <label>
            <span>{text.expiry}</span>
            <select value={expiryMode} onChange={(event) => setExpiryMode(event.target.value as ExpiryMode)}>
              <option value="perpetual">{text.perpetual}</option>
              <option value="30">{text.days30}</option>
              <option value="365">{text.days365}</option>
              <option value="custom">{text.custom}</option>
            </select>
          </label>

          {expiryMode === "custom" ? (
            <label>
              <span>{text.expiresAt}</span>
              <input type="date" value={customExpiry} onChange={(event) => setCustomExpiry(event.target.value)} />
            </label>
          ) : null}
        </div>

        <fieldset className={styles.features}>
          <legend>{text.features}</legend>
          {FEATURE_OPTIONS.map((option) => (
            <label key={option.id} className={styles.featureItem}>
              <input
                type="checkbox"
                checked={features.includes(option.id)}
                disabled={option.id === "offline-pos"}
                onChange={() => toggleFeature(option.id)}
              />
              <span>{option[language]}</span>
            </label>
          ))}
        </fieldset>

        {message ? <div className={styles.error}>{message}</div> : null}

        <div className={styles.actions}>
          <button type="button" className={styles.primary} disabled={busy || configured === false} onClick={() => void submit()}>
            {busy ? text.issuing : text.issue}
          </button>
          <button type="button" className={styles.secondary} disabled={busy} onClick={reset}>{text.clear}</button>
        </div>
      </section>

      {result ? (
        <section className={styles.resultCard}>
          <div className={styles.resultHeader}>
            <div>
              <span className={styles.resultEyebrow}>{text.resultTitle}</span>
              <h3>{result.payload.licenseId}</h3>
            </div>
            <span className={styles.successBadge}>SIGNED</span>
          </div>

          <div className={styles.summaryGrid}>
            <div><span>Customer</span><strong>{result.payload.customer}</strong></div>
            <div><span>Plan</span><strong>{result.payload.plan}</strong></div>
            <div><span>Devices</span><strong>{result.payload.maxDevices}</strong></div>
            <div><span>Expires</span><strong>{result.payload.expiresAt ? new Date(result.payload.expiresAt).toLocaleString(language === "th" ? "th-TH" : "en-US") : text.lifetime}</strong></div>
          </div>

          <div className={styles.deviceList}>
            {result.payload.devices.map((device) => <code key={device}>{device}</code>)}
          </div>

          <label className={styles.tokenBox}>
            <span>{text.token}</span>
            <textarea readOnly value={result.token} rows={7} spellCheck={false} />
          </label>

          <div className={styles.actions}>
            <button type="button" className={styles.primary} onClick={async () => {
              await navigator.clipboard.writeText(result.token);
              setCopied(true);
            }}>{copied ? text.copied : text.copy}</button>
            <button type="button" className={styles.secondary} onClick={() => downloadText(`${result.payload.licenseId}.txt`, `${result.token}\n`)}>{text.downloadTxt}</button>
            <button type="button" className={styles.secondary} onClick={() => downloadText(`${result.payload.licenseId}.json`, JSON.stringify(result, null, 2), "application/json;charset=utf-8")}>{text.downloadJson}</button>
          </div>

          <p className={styles.fingerprint}>Signer public-key fingerprint: <code>{result.publicKeyFingerprint}</code></p>
        </section>
      ) : null}
    </div>
  );
}
