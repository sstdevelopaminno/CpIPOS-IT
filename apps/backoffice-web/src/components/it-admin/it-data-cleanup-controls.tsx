"use client";

import { useCallback, useEffect, useState } from "react";
import type { Language } from "@/lib/i18n";

type CleanupScope = "audit" | "monitoring" | "incidents" | "print_history";
type Preview = Record<CleanupScope, { total: number; [key: string]: number }>;
type Payload = {
  retention_days: number;
  timezone: string;
  cutoff_at: string;
  preview: Preview;
};

const COPY = {
  th: {
    title: "การจัดเก็บข้อมูลย้อนหลัง",
    retention: "ระบบเก็บข้อมูลส่วนนี้ย้อนหลัง 7 วัน",
    expired: "ล้างข้อมูลเก่ากว่า 7 วัน",
    all: "ลบทั้งหมด",
    preview: "ข้อมูลที่พ้นกำหนด",
    rows: "รายการ",
    loading: "กำลังตรวจสอบ...",
    running: "กำลังล้างข้อมูล...",
    success: "ล้างข้อมูลเรียบร้อยแล้ว",
    expiredConfirm: "ยืนยันล้างข้อมูลที่เก่ากว่า 7 วันตามนโยบาย Retention?",
    allPrompt: "การดำเนินการนี้ย้อนกลับไม่ได้\nพิมพ์ DELETE เพื่อยืนยันการลบทั้งหมด",
    failed: "ล้างข้อมูลไม่สำเร็จ",
    nothingExpired: "ไม่มีข้อมูลเก่ากว่า 7 วันที่ต้องล้าง",
    temporarilyUnavailable: "ฐานข้อมูลตอบสนองชั่วคราว กรุณาลองใหม่อีกครั้ง",
    noteAudit: "ประวัติ Cleanup จะถูกเก็บแยกไว้ใน Cleanup Ledger แม้ Audit Logs จะถูกล้าง",
    noteMonitoring: "สถานะเครื่องล่าสุด (pos_device_health_latest) จะไม่ถูกลบ",
    noteIncidents: "โหมด 7 วันลบเฉพาะ Incident ที่ปิดแล้วเกิน 7 วัน ส่วน “ลบทั้งหมด” จะลบทั้ง Incident เปิดและปิด",
    notePrint: "ระบบจะไม่ลบงานพิมพ์ที่ยัง active/retrying และจะล้างเฉพาะประวัติงานที่จบแล้ว"
  },
  en: {
    title: "Data retention",
    retention: "This operational history is retained for 7 days.",
    expired: "Clean records older than 7 days",
    all: "Delete all history",
    preview: "Expired records",
    rows: "records",
    loading: "Checking...",
    running: "Cleaning...",
    success: "Cleanup completed",
    expiredConfirm: "Clean records older than 7 days according to the retention policy?",
    allPrompt: "This action cannot be undone.\nType DELETE to confirm deleting all history.",
    failed: "Cleanup failed",
    nothingExpired: "No records older than 7 days need cleanup.",
    temporarilyUnavailable: "The database is temporarily slow. Please try again.",
    noteAudit: "Cleanup actions remain in a separate Cleanup Ledger even when Audit Logs are cleared.",
    noteMonitoring: "The latest device state (pos_device_health_latest) is never deleted.",
    noteIncidents: "7-day cleanup removes only resolved incidents older than 7 days. Delete all removes open and resolved incidents.",
    notePrint: "Active/retrying print jobs are preserved; only completed history is eligible for cleanup."
  }
} as const;

function noteFor(scope: CleanupScope, t: typeof COPY.th | typeof COPY.en) {
  if (scope === "audit") return t.noteAudit;
  if (scope === "monitoring") return t.noteMonitoring;
  if (scope === "incidents") return t.noteIncidents;
  return t.notePrint;
}

export function ItDataCleanupControls({
  scope,
  language,
  onCompleted
}: {
  scope: CleanupScope;
  language: Language;
  onCompleted?: () => void | Promise<void>;
}) {
  const t = COPY[language];
  const [payload, setPayload] = useState<Payload | null>(null);
  const [busy, setBusy] = useState<"expired" | "all" | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/it-admin/v1/maintenance/cleanup", { cache: "no-store" });
      const body = await response.json().catch(() => null) as { data?: Payload; error?: { message?: string } } | null;
      if (!response.ok || !body?.data) throw new Error(body?.error?.message || t.failed);
      setPayload(body.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.failed);
    }
  }, [t.failed]);

  useEffect(() => { void load(); }, [load]);

  async function execute(mode: "expired" | "all") {
    setError("");
    setMessage("");

    if (mode === "expired" && Number(payload?.preview?.[scope]?.total ?? 0) === 0) {
      setMessage(t.nothingExpired);
      return;
    }

    let confirmation = "CLEANUP_7D";
    if (mode === "expired") {
      if (!window.confirm(t.expiredConfirm)) return;
    } else {
      const typed = window.prompt(t.allPrompt, "");
      if (typed !== "DELETE") return;
      confirmation = "DELETE";
    }

    setBusy(mode);
    try {
      const response = await fetch("/api/it-admin/v1/maintenance/cleanup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope, mode, confirmation })
      });
      const body = await response.json().catch(() => null) as { data?: unknown; error?: { message?: string } } | null;
      if (!response.ok) {
        const serverMessage = body?.error?.message || t.failed;
        throw new Error(response.status === 503 ? t.temporarilyUnavailable : serverMessage);
      }
      setMessage(t.success);
      await load();
      await onCompleted?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : t.failed);
    } finally {
      setBusy(null);
    }
  }

  const total = payload?.preview?.[scope]?.total;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-sm font-black text-slate-900">{t.title}</div>
          <div className="mt-1 text-xs text-slate-500">{t.retention}</div>
          <div className="mt-1 text-xs text-slate-500">{noteFor(scope, t)}</div>
          <div className="mt-2 text-xs font-semibold text-slate-700">
            {t.preview}: {typeof total === "number" ? total.toLocaleString(language === "th" ? "th-TH" : "en-US") : t.loading} {t.rows}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy !== null || total === 0}
            onClick={() => void execute("expired")}
            className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-bold text-amber-900 disabled:opacity-50"
          >
            {busy === "expired" ? t.running : total === 0 ? t.nothingExpired : t.expired}
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void execute("all")}
            className="rounded-xl border border-red-300 bg-red-50 px-4 py-2 text-sm font-bold text-red-700 disabled:opacity-50"
          >
            {busy === "all" ? t.running : t.all}
          </button>
        </div>
      </div>
      {message ? <div className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">{message}</div> : null}
      {error ? <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{error}</div> : null}
    </section>
  );
}
