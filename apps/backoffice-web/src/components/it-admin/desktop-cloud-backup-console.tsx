"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Language } from "@/lib/i18n";
import styles from "./desktop-cloud-backup-console.module.css";

type ApiEnvelope<T> = { data: T | null; error: { code?: string; message?: string } | null };
type Plan = { code: string; days: number; label_th: string; label_en: string; price_thb: number | null; active: boolean };
type ContractRef = { license_id?: string; customer_name?: string } | null;
type DeviceRef = { device_code?: string; device_name?: string; last_seen_at?: string | null } | null;
type Purchase = {
  id: string;
  plan_code: string;
  plan_days: number;
  price_thb: number | null;
  status: string;
  requested_at: string;
  decided_at?: string | null;
  decision_note?: string | null;
  contract?: ContractRef;
  device?: DeviceRef;
};
type Entitlement = {
  id: string;
  purchase_request_id: string;
  plan_code: string;
  cloud_code: string;
  status: string;
  starts_at: string;
  expires_at: string;
  last_backup_at?: string | null;
  expired_at?: string | null;
  cancelled_at?: string | null;
  cancellation_reason?: string | null;
  contract?: ContractRef;
  device?: DeviceRef;
};
type AdminState = { plans: Plan[]; requests: Purchase[]; entitlements: Entitlement[]; expired_pending_count?: number; checked_at: string };

function money(value: number | null) {
  if (value == null) return "ยังไม่กำหนดราคา";
  return new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB", maximumFractionDigits: 2 }).format(value);
}
function when(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("th-TH");
}

export function DesktopCloudBackupConsole({ language }: { language: Language }) {
  const th = language === "th";
  const [state, setState] = useState<AdminState | null>(null);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setMessage("");
    try {
      const response = await fetch("/api/it-admin/cloud-backup", { cache: "no-store" });
      const body = await response.json() as ApiEnvelope<AdminState>;
      if (!response.ok || !body.data) throw new Error(body.error?.message || "CLOUD_LOAD_FAILED");
      setState(body.data);
      setPrices(current => {
        const next = { ...current };
        for (const plan of body.data?.plans ?? []) if (next[plan.code] == null) next[plan.code] = plan.price_thb == null ? "" : String(plan.price_thb);
        return next;
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "CLOUD_LOAD_FAILED");
    }
  }, []);

  useEffect(() => {
    void load(false);
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(true); }, 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const act = async (payload: Record<string, unknown>, key: string) => {
    setBusy(key); setMessage("");
    try {
      const response = await fetch("/api/it-admin/cloud-backup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json() as ApiEnvelope<unknown>;
      if (!response.ok || !body.data) throw new Error(body.error?.message || "CLOUD_ACTION_FAILED");
      setMessage(th ? "บันทึกเรียบร้อย" : "Saved");
      await load(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "CLOUD_ACTION_FAILED");
    } finally { setBusy(""); }
  };

  const pending = useMemo(() => (state?.requests ?? []).filter(row => row.status === "pending"), [state]);
  const active = useMemo(() => (state?.entitlements ?? []).filter(row => row.status === "active"), [state]);
  const expired = useMemo(() => (state?.entitlements ?? []).filter(row => row.status === "expired_pending"), [state]);

  const renew = (row: Entitlement) => void act({ action: "renew", entitlementId: row.id, note: "Renewed from CpIPOS IT Cloud console" }, `renew:${row.id}`);
  const cancel = (row: Entitlement) => {
    const detail = th
      ? `ยืนยันยกเลิก Cloud ${row.cloud_code}? ข้อมูลสำรองและข้อมูลขายบน Cloud ของเครื่อง ${row.device?.device_code || "นี้"} จะถูกลบทันทีและไม่สามารถกู้คืนจากระบบ Cloud ได้`
      : `Cancel ${row.cloud_code}? Cloud backup and archived sales for this device will be deleted immediately.`;
    if (!window.confirm(detail)) return;
    void act({ action: "cancel", entitlementId: row.id, note: "Cancelled and purged from CpIPOS IT Cloud console" }, `cancel:${row.id}`);
  };

  return <section className={styles.panel}>
    <header className={styles.head}>
      <div><span className={styles.kicker}>CLOUD BACKUP / ONLINE SERVER</span><h2>{th ? "Cloud สำรองข้อมูล CpIPOS Desktop" : "CpIPOS Desktop Cloud Backup"}</h2><p>{th ? "Desktop ส่งคำขอซื้อ → IT ยืนยัน → Cloud Code เปิดใช้งาน → ระบบสำรองและย้ายข้อมูลเก่าอัตโนมัติเมื่อพื้นที่เครื่องต่ำ" : "Purchase request → IT approval → automatic archive and storage offload."}</p></div>
      <button className={styles.refresh} onClick={() => void load(false)} disabled={Boolean(busy)}>{th ? "รีเฟรช" : "Refresh"}</button>
    </header>

    {expired.length ? <section className={styles.expiryAlert}>
      <div><strong>{th ? `ต้องตรวจสอบ Cloud หมดอายุ ${expired.length} รายการ` : `${expired.length} expired cloud subscriptions need review`}</strong><span>{th ? "ข้อมูลยังถูกเก็บไว้ชั่วคราวและเปิดอ่านได้ แต่หยุดรับ Backup ใหม่จนกว่า IT จะเลือกต่ออายุหรือยกเลิก" : "Archived data is retained read-only until IT renews or cancels."}</span></div>
      <b>{expired.length}</b>
    </section> : null}

    <div className={styles.planGrid}>{(state?.plans ?? []).map(plan => <article className={styles.planCard} key={plan.code}>
      <span>{plan.code}</span><strong>{th ? plan.label_th : plan.label_en}</strong><small>{plan.days} {th ? "วัน" : "days"}</small>
      <label>{th ? "ราคาขาย (บาท)" : "Price (THB)"}<input inputMode="decimal" value={prices[plan.code] ?? ""} onChange={e => setPrices(v => ({ ...v, [plan.code]: e.target.value.replace(/[^0-9.]/g, "") }))} placeholder={th ? "กำหนดโดยบริษัท" : "Set by company"} /></label>
      <div className={styles.row}><button onClick={() => void act({ action: "update_plan", planCode: plan.code, priceThb: prices[plan.code] === "" ? null : Number(prices[plan.code]), active: plan.active }, `plan:${plan.code}`)} disabled={Boolean(busy)}>{busy === `plan:${plan.code}` ? "..." : (th ? "บันทึกราคา" : "Save price")}</button><em>{money(plan.price_thb)}</em></div>
    </article>)}</div>

    <div className={styles.sectionTitle}><strong>{th ? `คำขอซื้อที่รอยืนยัน (${pending.length})` : `Pending purchases (${pending.length})`}</strong></div>
    {pending.length ? <div className={styles.tableWrap}><table><thead><tr><th>{th ? "ลูกค้า / License" : "Customer / License"}</th><th>Device</th><th>{th ? "แพ็กเกจ" : "Plan"}</th><th>{th ? "ราคา" : "Price"}</th><th>{th ? "ขอซื้อเมื่อ" : "Requested"}</th><th /></tr></thead><tbody>{pending.map(row => <tr key={row.id}><td><strong>{row.contract?.customer_name || "—"}</strong><small>{row.contract?.license_id || "—"}</small></td><td><strong>{row.device?.device_name || "POS"}</strong><small>{row.device?.device_code || "—"}</small></td><td>{row.plan_days} {th ? "วัน" : "days"}<small>{row.plan_code}</small></td><td>{money(row.price_thb)}</td><td>{when(row.requested_at)}</td><td><div className={styles.actions}><button className={styles.approve} disabled={Boolean(busy)} onClick={() => void act({ action: "approve", requestId: row.id }, `approve:${row.id}`)}>{th ? "ยืนยัน Cloud" : "Approve"}</button><button className={styles.reject} disabled={Boolean(busy)} onClick={() => void act({ action: "reject", requestId: row.id, note: "Rejected by IT" }, `reject:${row.id}`)}>{th ? "ไม่อนุมัติ" : "Reject"}</button></div></td></tr>)}</tbody></table></div> : <div className={styles.empty}>{th ? "ยังไม่มีคำขอซื้อ Cloud ที่รอยืนยัน" : "No pending cloud purchases."}</div>}

    <div className={styles.sectionTitle}><strong>{th ? `Cloud หมดอายุรอคำสั่ง IT (${expired.length})` : `Expired / awaiting IT decision (${expired.length})`}</strong></div>
    {expired.length ? <div className={styles.expiredGrid}>{expired.map(row => <article key={row.id}>
      <div className={styles.expiredHead}><span>● EXPIRED · DATA HOLD</span><strong>{row.cloud_code}</strong></div>
      <div className={styles.expiredMeta}><span>{row.contract?.customer_name || "—"}<small>{row.contract?.license_id || "—"}</small></span><span>{row.device?.device_name || "POS"}<small>{row.device?.device_code || "—"}</small></span><span>{row.plan_code}<small>{th ? "หมดอายุ" : "Expired"} {when(row.expires_at)}</small></span></div>
      <p>{th ? "หยุด Backup ใหม่ แต่ข้อมูล Cloud เดิมยังไม่ถูกลบจนกว่า IT จะตัดสินใจ" : "New backups are paused. Existing cloud data is retained until IT decides."}</p>
      <div className={styles.expiredActions}><button className={styles.renew} disabled={Boolean(busy)} onClick={() => renew(row)}>{busy === `renew:${row.id}` ? "..." : (th ? "ต่อ Cloud" : "Renew")}</button><button className={styles.purge} disabled={Boolean(busy)} onClick={() => cancel(row)}>{busy === `cancel:${row.id}` ? "..." : (th ? "ยกเลิก Cloud + ลบข้อมูล" : "Cancel + purge")}</button></div>
    </article>)}</div> : <div className={styles.empty}>{th ? "ไม่มี Cloud หมดอายุที่รอการตัดสินใจ" : "No expired cloud subscriptions awaiting review."}</div>}

    <div className={styles.sectionTitle}><strong>{th ? `Cloud ที่เปิดใช้งาน (${active.length})` : `Active cloud connections (${active.length})`}</strong></div>
    {active.length ? <div className={styles.activeGrid}>{active.map(row => <article key={row.id}><span className={styles.online}>● ONLINE CLOUD</span><strong>{row.cloud_code}</strong><small>{row.contract?.customer_name || "—"} · {row.device?.device_code || "—"}</small><small>{row.plan_code} · {th ? "หมดอายุ" : "expires"} {when(row.expires_at)}</small><small>{th ? "สำรองล่าสุด" : "last backup"}: {when(row.last_backup_at)}</small></article>)}</div> : <div className={styles.empty}>{th ? "ยังไม่มี Cloud ที่เปิดใช้งาน" : "No active cloud connection."}</div>}
    {message ? <div className={styles.message}>{message}</div> : null}
  </section>;
}
