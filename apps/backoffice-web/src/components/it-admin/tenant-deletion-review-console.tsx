"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./tenant-deletion-review-console.module.css";
import type { Language } from "@/lib/i18n";

type ReviewRow = {
  tenant_id: string;
  store_name: string;
  store_code: string;
  lifecycle_kind: "trial" | "subscription";
  service_ended_at: string;
  access_grace_until: string;
  deletion_review_at: string;
  review_status: string;
  mdm_release_required: boolean;
  mdm_release_completed_at: string | null;
  it_notified_at: string | null;
  confirmed_at: string | null;
  confirmation_note: string | null;
};

type Payload = {
  rows: ReviewRow[];
  counts: {
    total: number;
    watching: number;
    retention: number;
    ready: number;
    mdm_pending: number;
    ready_to_delete: number;
  };
};

type Envelope<T> = { data: T | null; error: { code?: string; message?: string } | null };

const copy = {
  th: {
    title: "ร้านรอตรวจสอบการลบ",
    subtitle: "เมนูอันตรายสำหรับ IT: ระบบไม่ลบร้านอัตโนมัติ จนกว่า IT Support จะยืนยันหลังครบช่วงรักษาข้อมูล",
    refresh: "รีเฟรช",
    ready: "รอ IT ยืนยัน",
    retention: "อยู่ช่วงรักษาข้อมูล",
    mdm: "รอปลด MDM",
    final: "พร้อมลบถาวร",
    empty: "ยังไม่มีร้านที่เข้าเงื่อนไข",
    trial: "ทดลองใช้",
    subscription: "แพ็กเกจจริง",
    ended: "สิ้นสุดบริการ",
    grace: "สิทธิ์ใช้งานถึง",
    deleteReview: "ตรวจลบได้",
    keep: "เก็บร้านไว้",
    delete: "ตรวจสอบและยืนยันลบ",
    releaseMdm: "ส่งคำสั่งปลด MDM อีกครั้ง",
    finalize: "ยืนยันลบข้อมูลถาวร",
    note: "หมายเหตุ IT",
    notePlaceholder: "ระบุเหตุผล/หมายเหตุสำหรับ Audit",
    confirmDelete: "ยืนยันลบร้านนี้ถาวร? ระบบจะตัดสิทธิ์และลบข้อมูลเมื่อผ่านเงื่อนไข MDM แล้ว",
    working: "กำลังดำเนินการ...",
    mdmBlocked: "ยังปลด MDM ไม่ได้: อุปกรณ์บางเครื่องต้องอัปเดตแอปที่รองรับ Device Owner Release ก่อน แล้วจึงกดส่งคำสั่งปลด MDM อีกครั้ง",
    mdmQueued: "ส่งคำสั่งปลด MDM แล้ว ระบบจะรออุปกรณ์ออนไลน์และยืนยันผลก่อนเปิดขั้นตอนลบถาวร",
    mdmRequired: "ต้องปลด Android Device Owner ก่อน เพื่อให้ลูกค้าถอนติดตั้งแอปเองได้",
    mdmDone: "ปลด MDM แล้ว",
    autoRule: "Trial: ใช้งาน 7 วัน → รักษาข้อมูลถึงวันที่ 15 → IT ยืนยันลบ · Paid: หลังหมดแพ็กเกจใช้งานต่อ 3 วัน → รักษาข้อมูล 30 วัน → IT ยืนยันลบ"
  },
  en: {
    title: "Tenant deletion review",
    subtitle: "Danger-zone workflow for IT. No tenant is permanently deleted until IT Support confirms after the retention window.",
    refresh: "Refresh",
    ready: "Waiting for IT",
    retention: "Retention window",
    mdm: "Waiting for MDM release",
    final: "Ready to delete",
    empty: "No stores currently match this workflow.",
    trial: "Trial",
    subscription: "Paid package",
    ended: "Service ended",
    grace: "Access until",
    deleteReview: "Deletion review",
    keep: "Keep store",
    delete: "Review & confirm deletion",
    releaseMdm: "Retry MDM release",
    finalize: "Confirm final deletion",
    note: "IT note",
    notePlaceholder: "Reason / audit note",
    confirmDelete: "Permanently delete this store? Access will be revoked and data deleted after MDM release conditions are satisfied.",
    working: "Working...",
    mdmBlocked: "MDM release is blocked: one or more devices must update to a build that supports Device Owner Release before retrying.",
    mdmQueued: "MDM release command queued. The workflow will wait for the device to come online and acknowledge release before permanent deletion.",
    mdmRequired: "Android Device Owner must be released first so the customer can uninstall the app normally.",
    mdmDone: "MDM released",
    autoRule: "Trial: 7 days access → retain until day 15 → IT confirms deletion · Paid: 3 days access grace → 30 days data retention → IT confirms deletion"
  }
} as const;

function fmt(value: string | null, language: Language) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok"
  }).format(date);
}

function badge(status: string, language: Language) {
  const t = copy[language];
  if (status === "ready_for_it_review") return t.ready;
  if (status === "retention_window") return t.retention;
  if (status === "mdm_release_pending") return t.mdm;
  if (status === "ready_to_delete") return t.final;
  if (status === "keep") return language === "th" ? "เก็บร้านไว้" : "Keep";
  if (status === "watching") return language === "th" ? "ยังไม่หมดอายุ" : "Watching";
  if (status === "cancelled") return language === "th" ? "ยกเลิกคำขอ" : "Cancelled";
  return status;
}

async function readQueue(): Promise<Payload> {
  const response = await fetch("/api/it-admin/v1/deletion-reviews", {
    cache: "no-store",
    credentials: "include"
  });
  const body = await response.json().catch(() => null) as Envelope<Payload> | null;
  if (!response.ok || !body?.data) throw new Error(body?.error?.message ?? "Unable to load deletion reviews.");
  return body.data;
}


type DestructiveAction = "delete" | "finalize";

export function TenantDeletionReviewConsole({ language }: { language: Language }) {
  const t = copy[language];
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{ row: ReviewRow; action: DestructiveAction } | null>(null);
  const [typedCode, setTypedCode] = useState("");
  const [confirmationNote, setConfirmationNote] = useState("");

  const load = useCallback(async () => {
    try {
      setError(null);
      setData(await readQueue());
    } catch (err) {
      setError(err instanceof Error ? err.message : "load_failed");
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const actionable = useMemo(
    () => (data?.rows ?? []).filter((row) =>
      ["ready_for_it_review", "mdm_release_pending", "ready_to_delete"].includes(row.review_status)
    ).length,
    [data]
  );

  const visibleRows = useMemo(() => (data?.rows ?? []).filter((row) => {
    const search = query.trim().toLocaleLowerCase();
    const matchesQuery = !search ||
      row.store_name.toLocaleLowerCase().includes(search) ||
      row.store_code.toLocaleLowerCase().includes(search);
    const matchesFilter = filter === "all" ||
      (filter === "actionable" && ["ready_for_it_review", "mdm_release_pending", "ready_to_delete"].includes(row.review_status)) ||
      row.review_status === filter;
    return matchesQuery && matchesFilter;
  }), [data, filter, query]);

  const act = useCallback(async (
    row: ReviewRow,
    action: "keep" | "delete" | "release_mdm" | "finalize",
    note = notes[row.tenant_id] ?? "",
    confirmationCode?: string
  ) => {
    if (busy) return;
    if (action === "release_mdm" && !window.confirm(
      language === "th"
        ? "ส่งคำสั่งปลด Device Owner สำหรับร้าน " + row.store_name + " ใช่หรือไม่?"
        : "Queue Device Owner release for " + row.store_name + "?"
    )) return;
    const key = row.tenant_id + ":" + action;
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/it-admin/v1/deletion-reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          action,
          tenant_id: row.tenant_id,
          note,
          confirmation_code: confirmationCode
        })
      });
      const body = await response.json().catch(() => null) as Envelope<Payload & Record<string, unknown>> | null;
      if (!response.ok) throw new Error(body?.error?.message ?? "Request failed (" + response.status + ")");
      if (body?.data?.rows) {
        setData({ rows: body.data.rows, counts: body.data.counts });
      } else {
        await load();
      }
      setConfirmation(null);
      setExpanded(null);
      const mdm = body?.data?.mdm && typeof body.data.mdm === "object"
        ? body.data.mdm as { queued?: number; blocked?: Array<{ device_id?: string; reason?: string }>; device_count?: number }
        : null;
      if (mdm) {
        const blocked = Array.isArray(mdm.blocked) ? mdm.blocked : [];
        if (blocked.length > 0) setNotice(t.mdmBlocked + " (" + blocked.length + "/" + (mdm.device_count ?? blocked.length) + ")");
        else if ((mdm.queued ?? 0) > 0) setNotice(t.mdmQueued);
      } else {
        setNotice(language === "th" ? "ดำเนินการสำเร็จ ระบบบันทึกผลแล้ว" : "Action completed and recorded.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "action_failed");
    } finally {
      setBusy(null);
    }
  }, [busy, load, notes, language, t.mdmBlocked, t.mdmQueued]);

  const openConfirmation = (row: ReviewRow, action: DestructiveAction) => {
    setTypedCode("");
    setConfirmationNote(notes[row.tenant_id] ?? "");
    setConfirmation({ row, action });
  };

  const isConfirmed = confirmation !== null &&
    confirmation.row.store_code.trim().length > 0 &&
    typedCode.trim() === confirmation.row.store_code.trim() &&
    confirmationNote.trim().length > 0;

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>IT ADMIN / TENANT LIFECYCLE</span>
          <h1>{t.title}</h1>
          <p>{t.subtitle}</p>
        </div>
        <button type="button" className={styles.secondaryButton} onClick={() => void load()} disabled={Boolean(busy)}>
          ↻ {t.refresh}
        </button>
      </header>

      <div className={styles.policy}>
        <strong>{language === "th" ? "นโยบายการรักษาข้อมูล" : "Retention policy"}</strong>
        <span>{t.autoRule}</span>
      </div>

      <div className={styles.stats}>
        <Stat label={language === "th" ? "ทั้งหมด" : "Total"} value={data?.counts.total ?? 0} />
        <Stat label={t.ready} value={data?.counts.ready ?? 0} danger />
        <Stat label={t.retention} value={data?.counts.retention ?? 0} />
        <Stat label={t.mdm} value={data?.counts.mdm_pending ?? 0} danger />
        <Stat label={t.final} value={data?.counts.ready_to_delete ?? 0} danger />
      </div>

      {error ? <div className={styles.error} role="alert">{error}</div> : null}
      {notice ? <div className={styles.notice} role="status">{notice}</div> : null}

      <div className={styles.panel}>
        <div className={styles.toolbar}>
          <label className={styles.searchGroup}>
            <span>{language === "th" ? "ค้นหาร้านค้า" : "Search stores"}</span>
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)}
              placeholder={language === "th" ? "ชื่อร้าน หรือรหัสร้าน..." : "Store name or code..."} />
          </label>
          <label className={styles.filterGroup}>
            <span>{language === "th" ? "สถานะ" : "Status"}</span>
            <select value={filter} onChange={(event) => setFilter(event.target.value)}>
              <option value="all">{language === "th" ? "ทุกสถานะ" : "All"}</option>
              <option value="actionable">{language === "th" ? "ต้องดำเนินการ" : "Requires action"}</option>
              <option value="ready_for_it_review">{t.ready}</option>
              <option value="retention_window">{t.retention}</option>
              <option value="mdm_release_pending">{t.mdm}</option>
              <option value="ready_to_delete">{t.final}</option>
              <option value="watching">{language === "th" ? "ติดตาม" : "Watching"}</option>
            </select>
          </label>
          <span className={styles.resultCount}>
            {language === "th" ? "พบ " + visibleRows.length + " รายการ" : visibleRows.length + " results"}
          </span>
        </div>

        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{language === "th" ? "ร้านค้า / รหัส" : "Store / Code"}</th>
                <th>{language === "th" ? "ประเภท" : "Plan"}</th>
                <th>{t.ended}</th>
                <th>{t.grace}</th>
                <th>{t.deleteReview}</th>
                <th>{language === "th" ? "สถานะ" : "Status"}</th>
                <th>MDM</th>
                <th className={styles.actionsCell}>{language === "th" ? "จัดการ" : "Actions"}</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => {
                const isActionable = ["ready_for_it_review", "mdm_release_pending", "ready_to_delete"].includes(row.review_status);
                const isExpanded = expanded === row.tenant_id;
                return (
                  <FragmentRow key={row.tenant_id}>
                    <tr className={isActionable ? styles.actionRow : undefined}>
                      <td>
                        <strong className={styles.storeName}>{row.store_name}</strong>
                        <span className={styles.storeCode}>{row.store_code || row.tenant_id.slice(0, 8)}</span>
                      </td>
                      <td>{row.lifecycle_kind === "trial" ? t.trial : t.subscription}</td>
                      <td className={styles.date}>{fmt(row.service_ended_at, language)}</td>
                      <td className={styles.date}>{fmt(row.access_grace_until, language)}</td>
                      <td className={styles.date}>{fmt(row.deletion_review_at, language)}</td>
                      <td><span className={isActionable ? styles.badgeAlert : styles.badge}>{badge(row.review_status, language)}</span></td>
                      <td><span className={row.mdm_release_required && !row.mdm_release_completed_at ? styles.mdmPending : styles.mdmClear}>
                        {row.mdm_release_required ? (row.mdm_release_completed_at ? t.mdmDone : t.mdmRequired) : "—"}
                      </span></td>
                      <td className={styles.actionsCell}>
                        {isActionable ? (
                          <button type="button" className={styles.rowButton} disabled={Boolean(busy)}
                            aria-expanded={isExpanded} onClick={() => setExpanded(isExpanded ? null : row.tenant_id)}>
                            {language === "th" ? "จัดการ" : "Review"} {isExpanded ? "⌃" : "⌄"}
                          </button>
                        ) : <span className={styles.muted}>—</span>}
                      </td>
                    </tr>
                    {isExpanded ? (
                      <tr className={styles.detailsRow}>
                        <td colSpan={8}>
                          <div className={styles.detailContent}>
                            <label className={styles.noteField}>
                              <span>{t.note}</span>
                              <textarea rows={2} value={notes[row.tenant_id] ?? ""}
                                onChange={(event) => setNotes((current) => ({ ...current, [row.tenant_id]: event.target.value }))}
                                placeholder={t.notePlaceholder} disabled={Boolean(busy)} />
                            </label>
                            <div className={styles.rowActions}>
                              {row.review_status === "ready_for_it_review" ? (
                                <>
                                  <button type="button" className={styles.secondaryButton} disabled={Boolean(busy)} onClick={() => void act(row, "keep")}>{t.keep}</button>
                                  <button type="button" className={styles.dangerButton} disabled={Boolean(busy)} onClick={() => openConfirmation(row, "delete")}>{t.delete}</button>
                                </>
                              ) : null}
                              {row.review_status === "mdm_release_pending" ? (
                                <button type="button" className={styles.secondaryButton} disabled={Boolean(busy)} onClick={() => void act(row, "release_mdm")}>{t.releaseMdm}</button>
                              ) : null}
                              {row.review_status === "ready_to_delete" ? (
                                <button type="button" className={styles.dangerButton} disabled={Boolean(busy)} onClick={() => openConfirmation(row, "finalize")}>{t.finalize}</button>
                              ) : null}
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </FragmentRow>
                );
              })}
            </tbody>
          </table>
        </div>
        {!data ? <div className={styles.empty}>{t.working}</div> : null}
        {data && visibleRows.length === 0 ? <div className={styles.empty}>{t.empty}</div> : null}
      </div>
      <p className={styles.footer}>
        {language === "th" ? "รายการที่ต้องดำเนินการ: " + actionable + " · การลบถาวรต้องยืนยันรหัสร้านและเหตุผล" :
          "Actions required: " + actionable + " · Permanent deletion requires store code and a reason."}
      </p>

      {confirmation ? (
        <div className={styles.overlay}>
          <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="delete-dialog-title">
            <div className={styles.dialogHeader}>
              <span className={styles.dangerMark}>!</span>
              <div>
                <h2 id="delete-dialog-title">{language === "th" ? "ยืนยันการลบร้านถาวร" : "Confirm permanent deletion"}</h2>
                <p>{t.confirmDelete}</p>
              </div>
            </div>
            <div className={styles.dialogStore}>
              <strong>{confirmation.row.store_name}</strong>
              <span>{confirmation.row.store_code}</span>
              <small>{language === "th" ? "การดำเนินการนี้ไม่สามารถย้อนกลับได้" : "This action cannot be undone"}</small>
            </div>
            <label className={styles.dialogField}>
              <span>{language === "th" ? "พิมพ์รหัสร้านเพื่อยืนยัน" : "Type the store code to confirm"}</span>
              <input value={typedCode} onChange={(event) => setTypedCode(event.target.value)}
                autoComplete="off" placeholder={confirmation.row.store_code} disabled={Boolean(busy)} />
            </label>
            <label className={styles.dialogField}>
              <span>{language === "th" ? "เหตุผลการลบ (บังคับ)" : "Deletion reason (required)"}</span>
              <textarea rows={3} value={confirmationNote} onChange={(event) => setConfirmationNote(event.target.value)}
                placeholder={t.notePlaceholder} disabled={Boolean(busy)} />
            </label>
            <div className={styles.dialogActions}>
              <button type="button" className={styles.secondaryButton} disabled={Boolean(busy)}
                onClick={() => setConfirmation(null)}>{language === "th" ? "ยกเลิก" : "Cancel"}</button>
              <button type="button" className={styles.dangerButton} disabled={!isConfirmed || Boolean(busy)}
                onClick={() => void act(confirmation.row, confirmation.action, confirmationNote.trim(), typedCode.trim())}>
                {busy ? t.working : confirmation.action === "delete" ? t.delete : t.finalize}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

// Keep a fragment wrapper for each row's independently expandable details.
function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function Stat({ label, value, danger = false }: { label: string; value: number; danger?: boolean }) {
  return (
    <div className={styles.statCard}>
      <span>{label}</span>
      <strong className={danger && value > 0 ? styles.statDanger : undefined}>{value}</strong>
    </div>
  );
}
