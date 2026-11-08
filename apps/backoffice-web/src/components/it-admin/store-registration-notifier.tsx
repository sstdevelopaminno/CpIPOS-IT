"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const ENDPOINT = "/api/it-admin/v1/store-registrations/alert-summary";
const SEEN_KEY = "cpipos-it-store-registration-alerted-v1";
const LIST_PATH = "/it-admin/store-registrations";

type AlertRow = { id: string; status: string; store_name: string; created_at: string };
type AlertSummary = { total: number; latest: AlertRow[] };
type PushPayload = { kind?: string; title?: string; body?: string; url?: string; tag?: string };
type Toast = { id: string; title: string; body: string };

function broadcast(total: number) {
  window.dispatchEvent(new CustomEvent("cpipos-store-registration-unread", {
    detail: { total: Math.max(0, total) }
  }));
}

async function readSummary(): Promise<AlertSummary> {
  const response = await fetch(ENDPOINT, { cache: "no-store", credentials: "include" });
  const envelope = await response.json().catch(() => null) as {
    data?: AlertSummary; error?: { message?: string };
  } | null;
  if (!response.ok || !envelope?.data) {
    throw new Error(envelope?.error?.message || "registration_alert_unavailable");
  }
  return {
    total: Math.max(0, Number(envelope.data.total) || 0),
    latest: Array.isArray(envelope.data.latest) ? envelope.data.latest : []
  };
}

function readSeen(): Set<string> {
  try {
    const values = JSON.parse(window.sessionStorage.getItem(SEEN_KEY) || "[]") as unknown;
    return new Set(Array.isArray(values) ? values.filter((v): v is string => typeof v === "string") : []);
  } catch {
    return new Set();
  }
}

function saveSeen(seen: Set<string>) {
  try {
    window.sessionStorage.setItem(SEEN_KEY, JSON.stringify(Array.from(seen).slice(-100)));
  } catch {
    // The in-memory Set remains effective when storage is disabled.
  }
}

export function StoreRegistrationNotifier() {
  const [toast, setToast] = useState<Toast | null>(null);

  useEffect(() => {
    let alive = true;
    let inFlight = false;
    const seen = readSeen();

    const showToast = (row: Toast) => {
      if (!alive || seen.has(row.id)) return;
      seen.add(row.id);
      saveSeen(seen);
      setToast(row);
      if ("Notification" in window && Notification.permission === "granted") {
        try {
          new Notification(row.title, {
            body: row.body,
            icon: "/brand/cpipos-symbol-sidebar.png",
            tag: "registration-" + row.id
          });
        } catch {
          // In-app popup still works without OS notification permission.
        }
      }
    };

    const refresh = async () => {
      if (inFlight || !alive) return;
      inFlight = true;
      try {
        const state = await readSummary();
        if (!alive) return;
        broadcast(state.total);
        const unseen = state.latest.filter((row) => !seen.has(row.id));
        if (unseen.length) {
          const latest = unseen[0];
          // Record every fetched unseen item so reconnects and page reloads
          // do not flood the operator with a stack of old popup windows.
          for (const row of unseen.slice(1)) seen.add(row.id);
          saveSeen(seen);
          showToast({
            id: latest.id,
            title: latest.status === "failed" ? "มีคำขอเปิดร้านที่ต้องตรวจสอบ" : "มีคำขอเปิดร้านใหม่",
            body: state.total > 1
              ? "มีคำขอรอดำเนินการ " + state.total + " รายการ · ล่าสุดร้าน " + latest.store_name
              : "ร้าน " + latest.store_name + " ส่งคำขอจากเว็บไซต์ กรุณาตรวจสอบ"
          });
        }
      } catch {
        // Preserve the prior count if the network temporarily fails; don't
        // misrepresent a failed poll as zero pending applications.
      } finally {
        inFlight = false;
      }
    };

    const retryEmail = () => {
      if (!alive || document.visibilityState !== "visible") return;
      void fetch(ENDPOINT, {
        method: "POST", credentials: "include", cache: "no-store"
      }).catch(() => null);
    };
    const onPush = (event: Event) => {
      const payload = (event as CustomEvent<PushPayload>).detail;
      if (payload?.kind !== "request" || !payload.url?.startsWith(LIST_PATH)) return;
      const id = String(payload.tag || "").replace(/^store-registration:/, "");
      if (id && /^[0-9a-f-]{36}$/i.test(id)) {
        showToast({
          id, title: payload.title || "มีคำขอเปิดร้านใหม่",
          body: payload.body || "ตรวจสอบคำขอจากเว็บไซต์ในเมนูคำขอเปิดร้าน"
        });
      }
      void refresh();
    };
    const onFocus = () => { void refresh(); };
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 15_000);
    const retry = window.setInterval(retryEmail, 120_000);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("cpipos-it-push-notification", onPush);
    void refresh();
    retryEmail();

    return () => {
      alive = false;
      window.clearInterval(poll);
      window.clearInterval(retry);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("cpipos-it-push-notification", onPush);
    };
  }, []);

  if (!toast) return null;
  return (
    <section role="alert" aria-live="assertive"
      className="fixed right-4 top-20 z-[220] w-[min(390px,calc(100vw-2rem))] rounded-2xl border border-blue-200 bg-white p-4 shadow-2xl">
      <div className="flex items-start justify-between gap-3">
        <strong className="text-sm font-black text-blue-900">{toast.title}</strong>
        <button type="button" aria-label="ปิดการแจ้งเตือน" onClick={() => setToast(null)}
          className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-500">ปิด ✕</button>
      </div>
      <p className="mt-2 text-sm leading-6 text-slate-700">{toast.body}</p>
      <Link href={LIST_PATH} onClick={() => setToast(null)}
        className="mt-3 inline-flex rounded-xl bg-blue-700 px-4 py-2 text-xs font-black text-white">
        เปิดเมนูคำขอเปิดร้าน
      </Link>
    </section>
  );
}
