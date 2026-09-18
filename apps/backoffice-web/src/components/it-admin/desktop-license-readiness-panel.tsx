"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Language } from "@/lib/i18n";
import styles from "./desktop-license-readiness-panel.module.css";

type Section = { id: string; title: string; ready: boolean; status: string; count: number; message: string };
type Summary = {
  checked_at: string;
  desktop_version: string;
  sections: Section[];
  signer?: { configured?: boolean; key_matches_desktop?: boolean; public_key_fingerprint?: string | null; expected_public_key_fingerprint?: string | null; source?: string };
};
type ApiEnvelope<T> = { data: T | null; error: { message?: string; code?: string } | null };

const AUTO_KEY = "cpipos.it.license.readiness.auto.v1";
const CACHE_KEY = "cpipos.it.license.readiness.cache.v1";
const MIN_REFRESH_MS = 5 * 60 * 1000;
const AUTO_REFRESH_MS = 15 * 60 * 1000;

function formatWhen(value?: string | null, language: Language = "th") {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-US", { dateStyle: "short", timeStyle: "short" }).format(date);
}

function badgeClass(section: Section) {
  if (section.ready) return `${styles.badge} ${styles.ready}`;
  if (section.status.includes("key") || section.status.includes("missing")) return `${styles.badge} ${styles.warn}`;
  return styles.badge;
}

function statusText(loading: boolean, allReady: boolean, th: boolean) {
  if (loading) return th ? "กำลังตรวจ" : "Checking";
  return allReady ? (th ? "พร้อม" : "Ready") : (th ? "ต้องตรวจ" : "Check");
}

function readCache() {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) as Summary : null;
  } catch {
    return null;
  }
}

function writeCache(value: Summary) {
  try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(value)); } catch { /* best effort */ }
}

function readAuto() {
  try { return localStorage.getItem(AUTO_KEY) === "1"; } catch { return false; }
}

function writeAuto(value: boolean) {
  try { localStorage.setItem(AUTO_KEY, value ? "1" : "0"); } catch { /* best effort */ }
}

export function DesktopLicenseReadinessPanel({ language }: { language: Language }) {
  const th = language === "th";
  const [summary, setSummary] = useState<Summary | null>(() => readCache());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [autoCheck, setAutoCheck] = useState(() => readAuto());
  const lastFetchRef = useRef(0);

  const allReady = useMemo(() => Boolean(summary?.sections?.every((section) => section.ready)), [summary]);
  const readyCount = summary?.sections?.filter((section) => section.ready).length || 0;
  const totalCount = summary?.sections?.length || 6;

  const load = async (force = false) => {
    const now = Date.now();
    if (!force && summary && now - lastFetchRef.current < MIN_REFRESH_MS) return;
    lastFetchRef.current = now;
    setError("");
    setLoading(true);
    try {
      const response = await fetch("/api/it-admin/license-control-summary", { cache: "no-store" });
      const body = await response.json() as ApiEnvelope<Summary>;
      if (!response.ok || !body.data) throw new Error(body.error?.message || "LICENSE_CONTROL_SUMMARY_FAILED");
      setSummary(body.data);
      writeCache(body.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  useEffect(() => {
    writeAuto(autoCheck);
    if (!open || !autoCheck) return;
    const timer = window.setInterval(() => void load(false), AUTO_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [autoCheck, open]);

  const openModal = () => {
    setOpen(true);
    if (!summary) void load(true);
  };

  const body = <>
    {error ? <small className={styles.errorBadge}>{error}</small> : null}
    <div className={styles.grid}>
      {(summary?.sections || []).map((section) => <article className={styles.item} key={section.id}>
        <span className={badgeClass(section)}>{section.ready ? "READY" : section.status.toUpperCase()}</span>
        <strong>{section.title}</strong>
        <small>{section.message}</small>
      </article>)}
      {!summary && !error ? Array.from({ length: 6 }).map((_, index) => <article className={styles.item} key={index}><span className={styles.badge}>...</span><strong>{th ? "ยังไม่ได้ตรวจ" : "Not checked"}</strong><small>{th ? "กดตรวจสอบเมื่อจำเป็น" : "Run a manual check when needed."}</small></article>) : null}
    </div>
    <div className={styles.footer}>
      <span>{th ? "ตรวจล่าสุด" : "Last checked"}: {formatWhen(summary?.checked_at, language)} · Desktop {summary?.desktop_version || "0.3.1"}</span>
      <div className={styles.footerActions}>
        <button type="button" className={autoCheck ? styles.toggleOn : styles.toggle} onClick={() => setAutoCheck(value => !value)}>{autoCheck ? (th ? "Auto Check: เปิด" : "Auto: On") : (th ? "Auto Check: ปิด" : "Auto: Off")}</button>
        <button type="button" disabled={loading} onClick={() => void load(true)}>{loading ? (th ? "กำลังตรวจ..." : "Checking...") : (th ? "ตรวจสอบตอนนี้" : "Check now")}</button>
      </div>
    </div>
  </>;

  return <section className={styles.panel}>
    <button className={styles.compactButton} type="button" onClick={openModal}>
      <span className={allReady ? `${styles.badge} ${styles.ready}` : `${styles.badge} ${styles.warn}`}>{statusText(loading, allReady, th)}</span>
      <strong>{th ? "License Readiness" : "License Readiness"}</strong>
      <small className={styles.miniCount}>{readyCount}/{totalCount}</small>
      <b>{th ? "เปิด POP UP" : "Open"}</b>
    </button>

    {open ? <div className={styles.modalBackdrop} onMouseDown={() => setOpen(false)}>
      <section className={styles.modal} onMouseDown={(event) => event.stopPropagation()}>
        <header className={styles.modalHeader}>
          <div>
            <span className={styles.kicker}>DESKTOP LICENSE READINESS</span>
            <h2>{th ? "สถานะระบบออก License POS Desktop" : "Desktop License Control Readiness"}</h2>
            <p>{th ? "ตรวจ 6 ส่วนเมื่อจำเป็นเท่านั้น: Key, Preview, History, Device, Trial และ Audit/MDM เพื่อลดโหลดระบบ" : "Six-part readiness check runs only when needed to reduce system load."}</p>
          </div>
          <button type="button" aria-label={th ? "ปิด" : "Close"} onClick={() => setOpen(false)}>×</button>
        </header>
        {body}
      </section>
    </div> : null}
  </section>;
}
