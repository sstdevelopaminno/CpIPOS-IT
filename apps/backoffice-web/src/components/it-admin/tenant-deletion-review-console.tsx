"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
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
    delete: "ยืนยันลบถาวร",
    releaseMdm: "ส่งคำสั่งปลด MDM อีกครั้ง",
    finalize: "ลบข้อมูลทั้งหมดต่อ",
    note: "หมายเหตุ IT",
    notePlaceholder: "ระบุเหตุผล/หมายเหตุสำหรับ Audit",
    confirmDelete: "ยืนยันลบร้านนี้ถาวร? ระบบจะตัดสิทธิ์และลบข้อมูลเมื่อผ่านเงื่อนไข MDM แล้ว",
    working: "กำลังดำเนินการ...",
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
    delete: "Confirm permanent deletion",
    releaseMdm: "Retry MDM release",
    finalize: "Finalize all deletion",
    note: "IT note",
    notePlaceholder: "Reason / audit note",
    confirmDelete: "Permanently delete this store? Access will be revoked and data deleted after MDM release conditions are satisfied.",
    working: "Working...",
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
    timeStyle: "short"
  }).format(date);
}

function badge(status: string, language: Language) {
  const t = copy[language];
  if (status === "ready_for_it_review") return t.ready;
  if (status === "retention_window") return t.retention;
  if (status === "mdm_release_pending") return t.mdm;
  if (status === "ready_to_delete") return t.final;
  if (status === "keep") return language === "th" ? "เก็บร้านไว้" : "Keep";
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

export function TenantDeletionReviewConsole({ language }: { language: Language }) {
  const t = copy[language];
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

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

  const act = useCallback(async (row: ReviewRow, action: "keep" | "delete" | "release_mdm" | "finalize") => {
    if (busy) return;
    if (action === "delete" && !window.confirm(t.confirmDelete)) return;
    const key = `${row.tenant_id}:${action}`;
    setBusy(key);
    setError(null);
    try {
      const response = await fetch("/api/it-admin/v1/deletion-reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          action,
          tenant_id: row.tenant_id,
          note: notes[row.tenant_id] ?? ""
        })
      });
      const body = await response.json().catch(() => null) as Envelope<Payload & Record<string, unknown>> | null;
      if (!response.ok) throw new Error(body?.error?.message ?? `Request failed (${response.status})`);
      if (body?.data?.rows) {
        setData({ rows: body.data.rows, counts: body.data.counts });
      } else {
        await load();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "action_failed");
    } finally {
      setBusy(null);
    }
  }, [busy, load, notes, t.confirmDelete]);

  return (
    <section style={page}>
      <header style={header}>
        <div>
          <h1 style={{ margin: 0, fontSize: 28 }}>{t.title}</h1>
          <p style={{ margin: "8px 0 0", color: "#52657f", maxWidth: 900 }}>{t.subtitle}</p>
        </div>
        <button type="button" style={button} onClick={() => void load()} disabled={Boolean(busy)}>{t.refresh}</button>
      </header>

      <div style={dangerNote}>
        <strong>{language === "th" ? "นโยบายปัจจุบัน" : "Current policy"}</strong>
        <span>{t.autoRule}</span>
      </div>

      <div style={stats}>
        <Stat label={t.ready} value={data?.counts.ready ?? 0} danger />
        <Stat label={t.retention} value={data?.counts.retention ?? 0} />
        <Stat label={t.mdm} value={data?.counts.mdm_pending ?? 0} danger />
        <Stat label={t.final} value={data?.counts.ready_to_delete ?? 0} danger />
      </div>

      {error ? <div style={errorBox}>{error}</div> : null}
      {!data ? <div style={emptyBox}>{t.working}</div> : null}
      {data && data.rows.length === 0 ? <div style={emptyBox}>{t.empty}</div> : null}

      <div style={{ display: "grid", gap: 14 }}>
        {(data?.rows ?? []).map((row) => {
          const isActionable = ["ready_for_it_review", "mdm_release_pending", "ready_to_delete"].includes(row.review_status);
          return (
            <article key={row.tenant_id} style={{
              ...card,
              borderColor: isActionable ? "#fecaca" : "#dbe5f3",
              background: isActionable ? "#fffafa" : "#fff"
            }}>
              <div style={cardTop}>
                <div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <h2 style={{ margin: 0, fontSize: 20 }}>{row.store_name}</h2>
                    <span style={pill}>{row.store_code || row.tenant_id.slice(0, 8)}</span>
                    <span style={row.review_status.includes("ready") || row.review_status.includes("pending") ? dangerPill : pill}>
                      {badge(row.review_status, language)}
                    </span>
                  </div>
                  <p style={{ margin: "6px 0 0", color: "#64748b" }}>
                    {row.lifecycle_kind === "trial" ? t.trial : t.subscription}
                  </p>
                </div>
                <strong style={{ color: actionable > 0 && isActionable ? "#b91c1c" : "#334155" }}>
                  {fmt(row.deletion_review_at, language)}
                </strong>
              </div>

              <div style={dateGrid}>
                <DateCell label={t.ended} value={fmt(row.service_ended_at, language)} />
                <DateCell label={t.grace} value={fmt(row.access_grace_until, language)} />
                <DateCell label={t.deleteReview} value={fmt(row.deletion_review_at, language)} />
              </div>

              {row.mdm_release_required ? (
                <div style={mdmBox}>
                  <strong>{row.mdm_release_completed_at ? t.mdmDone : t.mdmRequired}</strong>
                  {row.mdm_release_completed_at ? <span>{fmt(row.mdm_release_completed_at, language)}</span> : null}
                </div>
              ) : null}

              {isActionable ? (
                <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#475569" }}>{t.note}</span>
                    <textarea
                      rows={2}
                      value={notes[row.tenant_id] ?? ""}
                      onChange={(event) => setNotes((current) => ({ ...current, [row.tenant_id]: event.target.value }))}
                      placeholder={t.notePlaceholder}
                      style={textarea}
                      disabled={Boolean(busy)}
                    />
                  </label>
                  <div style={actions}>
                    {row.review_status === "ready_for_it_review" ? (
                      <>
                        <button type="button" style={button} disabled={Boolean(busy)} onClick={() => void act(row, "keep")}>{t.keep}</button>
                        <button type="button" style={dangerButton} disabled={Boolean(busy)} onClick={() => void act(row, "delete")}>{t.delete}</button>
                      </>
                    ) : null}
                    {row.review_status === "mdm_release_pending" ? (
                      <button type="button" style={dangerButton} disabled={Boolean(busy)} onClick={() => void act(row, "release_mdm")}>{t.releaseMdm}</button>
                    ) : null}
                    {row.review_status === "ready_to_delete" ? (
                      <button type="button" style={dangerButton} disabled={Boolean(busy)} onClick={() => void act(row, "finalize")}>{t.finalize}</button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
      <p style={{ margin: "14px 0 0", color: "#64748b", fontSize: 12 }}>
        {language === "th"
          ? `รายการที่ต้องดำเนินการตอนนี้: ${actionable}`
          : `Actionable reviews now: ${actionable}`}
      </p>
    </section>
  );
}

function Stat({ label, value, danger = false }: { label: string; value: number; danger?: boolean }) {
  return (
    <div style={{ ...statCard, borderColor: danger && value > 0 ? "#fecaca" : "#dbe5f3" }}>
      <span style={{ color: "#64748b", fontSize: 13 }}>{label}</span>
      <strong style={{ fontSize: 28, color: danger && value > 0 ? "#b91c1c" : "#0f172a" }}>{value}</strong>
    </div>
  );
}

function DateCell({ label, value }: { label: string; value: string }) {
  return <div style={{ display: "grid", gap: 4 }}><span style={{ color: "#64748b", fontSize: 12 }}>{label}</span><strong>{value}</strong></div>;
}

const page: CSSProperties = { display: "grid", gap: 18, paddingBottom: 28 };
const header: CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" };
const stats: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 12 };
const statCard: CSSProperties = { border: "1px solid #dbe5f3", borderRadius: 16, padding: 16, background: "#fff", display: "grid", gap: 6 };
const card: CSSProperties = { border: "1px solid #dbe5f3", borderRadius: 18, padding: 18, boxShadow: "0 8px 24px rgba(15,23,42,.05)" };
const cardTop: CSSProperties = { display: "flex", justifyContent: "space-between", gap: 14, alignItems: "flex-start", flexWrap: "wrap" };
const dateGrid: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12, marginTop: 14, padding: 14, borderRadius: 14, background: "#f8fafc" };
const pill: CSSProperties = { display: "inline-flex", alignItems: "center", minHeight: 26, padding: "3px 9px", borderRadius: 999, background: "#eef4ff", color: "#2455a6", fontSize: 12, fontWeight: 800 };
const dangerPill: CSSProperties = { ...pill, background: "#fee2e2", color: "#991b1b" };
const button: CSSProperties = { minHeight: 40, padding: "8px 14px", borderRadius: 12, border: "1px solid #cbd5e1", background: "#fff", color: "#334155", fontWeight: 800, cursor: "pointer" };
const dangerButton: CSSProperties = { ...button, background: "#b91c1c", color: "#fff", borderColor: "#b91c1c" };
const actions: CSSProperties = { display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" };
const textarea: CSSProperties = { width: "100%", resize: "vertical", border: "1px solid #cbd5e1", borderRadius: 12, padding: 10, font: "inherit" };
const dangerNote: CSSProperties = { display: "grid", gap: 5, padding: 14, borderRadius: 14, border: "1px solid #fecaca", background: "#fff7f7", color: "#7f1d1d" };
const mdmBox: CSSProperties = { marginTop: 12, display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", padding: 12, borderRadius: 12, border: "1px solid #fde68a", background: "#fffbeb", color: "#92400e" };
const errorBox: CSSProperties = { padding: 12, borderRadius: 12, border: "1px solid #fecaca", background: "#fff1f2", color: "#b91c1c", fontWeight: 700 };
const emptyBox: CSSProperties = { padding: 22, borderRadius: 14, border: "1px dashed #cbd5e1", color: "#64748b", textAlign: "center" };
