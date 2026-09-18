"use client";

import { useEffect, useMemo, useState } from "react";
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

export function DesktopLicenseReadinessPanel({ language }: { language: Language }) {
  const th = language === "th";
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const allReady = useMemo(() => Boolean(summary?.sections?.every((section) => section.ready)), [summary]);

  const load = async () => {
    setError("");
    try {
      const response = await fetch("/api/it-admin/license-control-summary", { cache: "no-store" });
      const body = await response.json() as ApiEnvelope<Summary>;
      if (!response.ok || !body.data) throw new Error(body.error?.message || "LICENSE_CONTROL_SUMMARY_FAILED");
      setSummary(body.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 30000);
    return () => window.clearInterval(timer);
  }, []);

  return <section className={styles.panel}>
    <div className={styles.header}>
      <div>
        <h2>{th ? "สถานะระบบออก License POS Desktop" : "Desktop License Control Readiness"}</h2>
        <p>{th ? "ตรวจครบ 6 ส่วนก่อนออกลายเส้นจริง: Key, Preview, History, Device, Trial และ Audit/MDM" : "Six-part readiness check: Key, Preview, History, Device, Trial and Audit/MDM."}</p>
      </div>
      <span className={styles.status}>{loading ? (th ? "กำลังตรวจ..." : "Checking...") : allReady ? (th ? "พร้อมใช้งานครบ" : "Ready") : (th ? "ต้องตรวจบางส่วน" : "Needs attention")}</span>
    </div>

    {error ? <small className={styles.badge}>{error}</small> : null}

    <div className={styles.grid}>
      {(summary?.sections || []).map((section) => <article className={styles.item} key={section.id}>
        <span className={badgeClass(section)}>{section.ready ? "READY" : section.status.toUpperCase()}</span>
        <strong>{section.title}</strong>
        <small>{section.message}</small>
      </article>)}
      {!summary && !error ? Array.from({ length: 6 }).map((_, index) => <article className={styles.item} key={index}><span className={styles.badge}>...</span><strong>{th ? "กำลังโหลด" : "Loading"}</strong><small>—</small></article>) : null}
    </div>

    <div className={styles.footer}>
      <span>{th ? "ตรวจล่าสุด" : "Last checked"}: {formatWhen(summary?.checked_at, language)} · Desktop {summary?.desktop_version || "0.3.1"}</span>
      <button type="button" onClick={() => void load()}>{th ? "ตรวจสอบอีกครั้ง" : "Refresh check"}</button>
    </div>
  </section>;
}
