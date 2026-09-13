"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./it-admin-module-console.module.css";

type ModuleName = "tenants" | "branches" | "users" | "devices" | "android" | "printer" | "packages" | "entitlements" | "monitoring" | "incidents" | "audit";
type ModulePayload = {
  plane: "primary" | "operational";
  module: string;
  checked_at: string;
  summary: Record<string, number | string>;
  rows: Array<Record<string, unknown>>;
  note: string | null;
};
type Column = { key: string; label: string; kind?: "date" | "money" | "status" };
type ModuleConfig = {
  eyebrow: string;
  title: string;
  description: string;
  source: string;
  columns: Column[];
  summaryLabels: Record<string, string>;
  action?: { href: string; label: string };
};

const CONFIG: Record<ModuleName, ModuleConfig> = {
  tenants: {
    eyebrow: "CUSTOMERS & STORES",
    title: "Tenants / Stores",
    description: "ร้านค้าและสถานะจริงจาก CpiPOS-001 พร้อม Store Code, แพ็กเกจ, สาขา และอุปกรณ์",
    source: "CpiPOS-001 · Business Authority",
    summaryLabels: { total: "ร้านทั้งหมด", active: "เปิดใช้งาน", inactive: "ปิดใช้งาน", branches: "สาขา", devices: "อุปกรณ์" },
    action: { href: "/it-admin/store-provisioning", label: "เปิดร้านใหม่" },
    columns: [
      { key: "store_code", label: "Store Code" }, { key: "name", label: "ร้าน" }, { key: "internal_code", label: "Internal Code" },
      { key: "package", label: "แพ็กเกจ" }, { key: "branches", label: "สาขา" }, { key: "devices", label: "อุปกรณ์" }, { key: "status", label: "สถานะ", kind: "status" }
    ]
  },
  branches: {
    eyebrow: "BRANCH CONTROL",
    title: "สาขา",
    description: "โครงสร้างสาขาจริงจาก CpiPOS-001 พร้อมจำนวนอุปกรณ์และการพบอุปกรณ์ล่าสุด",
    source: "CpiPOS-001 · Branch Authority",
    summaryLabels: { total: "สาขาทั้งหมด", active: "เปิดใช้งาน", inactive: "ปิดใช้งาน", devices: "อุปกรณ์" },
    columns: [
      { key: "tenant", label: "ร้าน" }, { key: "code", label: "Branch Code" }, { key: "name", label: "สาขา" },
      { key: "devices", label: "อุปกรณ์" }, { key: "last_seen_at", label: "Seen ล่าสุด", kind: "date" }, { key: "status", label: "สถานะ", kind: "status" }
    ]
  },
  users: {
    eyebrow: "IDENTITY & ACCESS",
    title: "ผู้ใช้ / บทบาท / สิทธิ์",
    description: "บัญชีผู้ใช้จาก CpiPOS-001 โดยไม่ส่ง PIN hash หรือข้อมูล credential มายังหน้าเว็บ",
    source: "CpiPOS-001 · Identity Authority",
    summaryLabels: { total: "ผู้ใช้ทั้งหมด", active: "ใช้งาน", it_admin: "IT Admin", inactive: "ปิดใช้งาน" },
    columns: [
      { key: "name", label: "ชื่อ" }, { key: "email", label: "อีเมล" }, { key: "role", label: "Platform Role" },
      { key: "status", label: "สถานะ", kind: "status" }, { key: "updated_at", label: "อัปเดต", kind: "date" }
    ]
  },
  devices: {
    eyebrow: "DEVICES / MDM",
    title: "Devices / MDM",
    description: "ทะเบียนอุปกรณ์จาก CpiPOS-002 แยก Registry state ออกจาก Health telemetry จริงอย่างชัดเจน",
    source: "CpiPOS-002 · IT / MDM Operations",
    summaryLabels: { total: "อุปกรณ์ทั้งหมด", active: "Registry Active", health_reported: "มี Health", locked: "Locked" },
    columns: [
      { key: "tenant", label: "ร้าน" }, { key: "branch", label: "สาขา" }, { key: "device", label: "อุปกรณ์" },
      { key: "registry_status", label: "Registry", kind: "status" }, { key: "health", label: "Health", kind: "status" },
      { key: "app_version", label: "App" }, { key: "runtime_version", label: "Runtime" }, { key: "last_seen_at", label: "Seen ล่าสุด", kind: "date" }
    ]
  },
  android: {
    eyebrow: "ANDROID APP ROLLOUT",
    title: "Android App Rollout",
    description: "สถานะ MDM/App version ที่รายงานจริงจากอุปกรณ์ Android โดยแสดงเฉพาะ metadata ที่คัดกรองแล้ว",
    source: "CpiPOS-001 · Android Compatibility Authority",
    summaryLabels: { total: "Android ที่พบ", active: "Active", update_available: "มีอัปเดต" },
    columns: [
      { key: "tenant", label: "ร้าน" }, { key: "branch", label: "สาขา" }, { key: "device", label: "อุปกรณ์" },
      { key: "app_version", label: "App Version" }, { key: "channel", label: "Channel" }, { key: "update_status", label: "Update", kind: "status" },
      { key: "last_seen_at", label: "MDM Seen", kind: "date" }, { key: "status", label: "Registry", kind: "status" }
    ]
  },
  printer: {
    eyebrow: "PRINT OPERATIONS",
    title: "Printer / Print Agent",
    description: "เครื่องพิมพ์และ Print Agent ที่ลงทะเบียนจริง พร้อมสถานะการเชื่อมต่อและเวลาที่พบล่าสุด",
    source: "CpiPOS-001 · Print Authority",
    summaryLabels: { total: "รายการทั้งหมด", printers: "Printers", agents: "Agents", active: "Active" },
    columns: [
      { key: "kind", label: "ประเภท" }, { key: "tenant", label: "ร้าน" }, { key: "branch", label: "สาขา" }, { key: "name", label: "ชื่อ" },
      { key: "model", label: "รุ่น" }, { key: "connection", label: "Connection" }, { key: "version", label: "Version / Paper" },
      { key: "status", label: "สถานะ", kind: "status" }, { key: "last_seen_at", label: "Seen ล่าสุด", kind: "date" }
    ]
  },
  packages: {
    eyebrow: "COMMERCIAL",
    title: "แพ็กเกจ / Subscription",
    description: "Package catalog จริงจาก CpiPOS-001 พร้อมราคา โควตา และจำนวน Feature ที่รวมในแพ็กเกจ",
    source: "CpiPOS-001 · Subscription Authority",
    summaryLabels: { total: "แพ็กเกจทั้งหมด", active: "Active", features: "Feature links" },
    columns: [
      { key: "code", label: "Code" }, { key: "name", label: "แพ็กเกจ" }, { key: "monthly_price", label: "รายเดือน", kind: "money" },
      { key: "yearly_price", label: "รายปี", kind: "money" }, { key: "max_branches", label: "สาขา" }, { key: "max_devices", label: "อุปกรณ์" },
      { key: "max_users", label: "ผู้ใช้" }, { key: "features", label: "Features" }, { key: "status", label: "สถานะ", kind: "status" }
    ]
  },
  entitlements: {
    eyebrow: "FEATURE ACCESS",
    title: "Feature Entitlements",
    description: "Feature catalog และจำนวน Tenant ที่เปิดสิทธิ์จริงจาก CpiPOS-001",
    source: "CpiPOS-001 · Feature Authority",
    summaryLabels: { total: "Features", active: "Active", enabled_links: "Tenant links" },
    columns: [
      { key: "code", label: "Feature Code" }, { key: "name", label: "Feature" }, { key: "default", label: "Default" },
      { key: "enabled_tenants", label: "Tenant เปิดใช้" }, { key: "monthly_price", label: "ราคาเริ่มต้น", kind: "money" }, { key: "status", label: "สถานะ", kind: "status" }
    ]
  },
  monitoring: {
    eyebrow: "OPERATIONS",
    title: "Monitoring",
    description: "ภาพรวมคิว, งานค้าง, Print Queue และ API errors รายสาขาจาก CpiPOS-001 ภายใน 60 นาทีล่าสุด",
    source: "CpiPOS-001 · Runtime Monitoring",
    summaryLabels: { branches: "สาขาที่ตรวจ", queued_orders: "Queued", api_errors: "API errors", warnings: "Warning", critical: "Critical" },
    columns: [
      { key: "store", label: "ร้าน" }, { key: "branch", label: "สาขา" }, { key: "level", label: "สถานะ", kind: "status" },
      { key: "queued_orders", label: "Queued" }, { key: "stale_orders", label: "Stale" }, { key: "print_queue", label: "Print Queue" },
      { key: "dead_letters", label: "Dead Letters" }, { key: "api_errors", label: "API errors" }, { key: "api_5xx", label: "5xx" }
    ]
  },
  incidents: {
    eyebrow: "OPERATIONS",
    title: "Incidents",
    description: "Incident จาก CpiPOS-002 เท่านั้น ไม่สร้างสถานะจำลองเมื่อยังไม่มี telemetry",
    source: "CpiPOS-002 · IT / MDM Operations",
    summaryLabels: { recent: "รายการล่าสุด", open: "เปิดอยู่", critical: "Critical" },
    columns: [
      { key: "severity", label: "Severity", kind: "status" }, { key: "tenant", label: "ร้าน" }, { key: "branch", label: "สาขา" },
      { key: "device", label: "อุปกรณ์" }, { key: "code", label: "Code" }, { key: "title", label: "Incident" },
      { key: "detected_at", label: "ตรวจพบ", kind: "date" }, { key: "status", label: "สถานะ", kind: "status" }
    ]
  },
  audit: {
    eyebrow: "AUDIT",
    title: "Audit Logs",
    description: "กิจกรรมล่าสุดจาก CpiPOS-001 โดยไม่ส่ง before/after payload หรือ metadata ที่อาจมีข้อมูลละเอียด",
    source: "CpiPOS-001 · Audit Authority",
    summaryLabels: { recent: "รายการล่าสุด" },
    columns: [
      { key: "created_at", label: "เวลา", kind: "date" }, { key: "action", label: "Action" }, { key: "module", label: "Module" },
      { key: "target", label: "Target" }, { key: "actor", label: "Actor" }
    ]
  }
};

function formatValue(value: unknown, kind: Column["kind"]) {
  if (value === null || value === undefined || value === "") return "—";
  if (kind === "date") {
    const date = new Date(String(value));
    return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
  }
  if (kind === "money") {
    const amount = Number(value);
    return Number.isFinite(amount) ? new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB", maximumFractionDigits: 0 }).format(amount) : "—";
  }
  return String(value);
}

export function ItAdminModuleConsole({ module }: { module: ModuleName }) {
  const config = CONFIG[module];
  const [data, setData] = useState<ModulePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/it-admin/v1/modules/${module}`, { cache: "no-store", credentials: "include" });
      const body = (await response.json().catch(() => null)) as { data?: ModulePayload; error?: { message?: string } } | null;
      if (!response.ok || !body?.data) throw new Error(body?.error?.message ?? `Module request failed (${response.status}).`);
      setData(body.data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Module data is temporarily unavailable.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [module]);

  useEffect(() => {
    void load(false);
    const timer = window.setInterval(() => void load(true), 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const summary = useMemo(() => Object.entries(data?.summary ?? {}), [data?.summary]);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerCopy}>
          <span className={styles.eyebrow}>{config.eyebrow}</span>
          <h2>{config.title}</h2>
          <p>{config.description}</p>
        </div>
        <div className={styles.actions}>
          {config.action ? <Link href={config.action.href}>{config.action.label}</Link> : null}
          <button type="button" onClick={() => void load(false)} disabled={loading || refreshing}>{refreshing ? "กำลังอัปเดต..." : "รีเฟรช"}</button>
        </div>
      </header>

      <div className={styles.sourceLine}>
        <span className={`${styles.dot} ${error ? styles.dotWarn : styles.dotReady}`} />
        <strong>{config.source}</strong>
        <span>{data?.checked_at ? `อัปเดต ${new Date(data.checked_at).toLocaleString("th-TH")}` : loading ? "กำลังเชื่อมต่อ..." : "รอตรวจสอบ"}</span>
      </div>

      {error ? (
        <section className={styles.errorCard} role="alert">
          <div><strong>โมดูลยังเชื่อมต่อไม่สำเร็จ</strong><span>{error}</span></div>
          <button type="button" onClick={() => void load(false)}>ลองใหม่</button>
        </section>
      ) : null}

      <section className={styles.summaryGrid}>
        {summary.length ? summary.map(([key, value]) => (
          <article key={key} className={styles.summaryCard}>
            <span>{config.summaryLabels[key] ?? key}</span>
            <strong>{value}</strong>
          </article>
        )) : Array.from({ length: Math.min(4, Object.keys(config.summaryLabels).length || 3) }, (_, index) => (
          <article key={index} className={`${styles.summaryCard} ${styles.skeleton}`}><span>กำลังโหลด</span><strong>—</strong></article>
        ))}
      </section>

      <section className={styles.tableCard}>
        <div className={styles.tableHead}>
          <div><h3>ข้อมูลปัจจุบัน</h3><p>{data?.note ?? "ข้อมูลอ่านจาก Control Plane จริงและรีเฟรชได้โดยไม่ reload ทั้งหน้า"}</p></div>
          <strong>{data?.rows.length ?? 0} รายการ</strong>
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr>{config.columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr></thead>
            <tbody>
              {data?.rows.length ? data.rows.map((row, index) => (
                <tr key={String(row.id ?? `${module}-${index}`)}>
                  {config.columns.map((column) => {
                    const display = formatValue(row[column.key], column.kind);
                    return <td key={column.key}>{column.kind === "status" ? <span className={styles.statusBadge}>{display}</span> : display}</td>;
                  })}
                </tr>
              )) : !loading && !error ? <tr><td colSpan={config.columns.length} className={styles.empty}>ยังไม่มีข้อมูลจริงในโมดูลนี้</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
