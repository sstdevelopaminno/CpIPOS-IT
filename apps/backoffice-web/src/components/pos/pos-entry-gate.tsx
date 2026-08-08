"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { t } from "@/lib/i18n";

type Lang = "th" | "en";

type SessionCurrentResponse = {
  data?: {
    session: { id: string; status: string; expires_at: string };
    tenant: { id: string; code: string | null; name: string | null };
    branch: { id: string; code: string | null; name: string | null };
    user: { id: string; full_name: string };
    role: string;
    permissions: string[];
    device: {
      id: string | null;
      code: string | null;
      name?: string | null;
      status?: "active" | "inactive" | "maintenance" | "unknown";
      block_sales?: boolean;
      reason_code?: string | null;
    };
    shift: { id: string; status: string; opened_at: string; closed_at: string | null } | null;
    has_active_shift: boolean;
  } | null;
  error?: { code: string; message: string } | null;
};

const DEFAULT_LOAD_TIMEOUT_MS = process.env.NODE_ENV === "development" ? 60000 : 20000;
const DEFAULT_LOAD_RETRIES = 1;
const POS_DISPLAY_TIMEZONE = "Asia/Bangkok";
const POS_ROLE_STORAGE_KEY = "pos_session_role_v1";
const POS_ROLE_EVENT_NAME = "pos-session-role-updated";
const POS_SESSION_EVENT_NAME = "pos-session-current-updated";
const POS_SKIP_ENTRY_GATE_SPLASH_KEY = "pos_skip_entry_gate_overlay_once_v1";
const loadPosSalesModule = () => import("@/components/pos/pos-sales-module");
const PosSalesModule = dynamic(
  () => loadPosSalesModule().then((module) => module.PosSalesModule),
  {
    ssr: false,
    loading: () => (
      <section className="surface" style={{ maxWidth: 760, margin: "0 auto", display: "grid", gap: 12 }}>
        <h2 style={{ margin: 0 }}>กำลังเตรียมหน้าขาย...</h2>
      </section>
    )
  }
);
const SESSION_EXPIRED_CODES = new Set([
  "missing_pos_session",
  "invalid_handoff_token",
  "session_not_found",
  "session_not_active",
  "session_expired",
  "session_claim_mismatch",
  "session_user_inactive",
  "session_tenant_inactive"
]);

function normalizeSessionRole(value: string): "owner" | "manager" | "staff" | "accountant" | null {
  if (value === "owner" || value === "manager" || value === "staff" || value === "accountant") return value;
  return null;
}

function publishSessionRole(role: string | null) {
  if (typeof window === "undefined") return;
  const normalizedRole = normalizeSessionRole(String(role ?? ""));
  if (normalizedRole) {
    window.sessionStorage.setItem(POS_ROLE_STORAGE_KEY, normalizedRole);
  } else {
    window.sessionStorage.removeItem(POS_ROLE_STORAGE_KEY);
  }
  window.dispatchEvent(new CustomEvent(POS_ROLE_EVENT_NAME, { detail: { role: normalizedRole } }));
}

async function fetchJsonWithTimeout(url: string, timeoutMs = DEFAULT_LOAD_TIMEOUT_MS, retries = DEFAULT_LOAD_RETRIES) {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { cache: "no-store", signal: controller.signal });
      const body = await response.json().catch(() => null);
      return { response, body };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        lastError = new Error(`Request timeout while loading ${url}. Please retry.`);
      } else if (error instanceof Error) {
        lastError = error;
      } else {
        lastError = new Error("Unknown network error.");
      }
      if (attempt > retries) break;
      await new Promise((resolve) => window.setTimeout(resolve, 350 * attempt));
    } finally {
      window.clearTimeout(timeoutId);
    }
  }
  throw lastError ?? new Error("Unknown network error.");
}

function normalizeRoleLabel(role: string, lang: Lang) {
  if (role === "owner") return lang === "th" ? "เจ้าของร้าน" : t(lang, "pos_role_owner");
  if (role === "manager") return lang === "th" ? "ผู้จัดการ" : t(lang, "pos_role_manager");
  if (role === "accountant") return lang === "th" ? "บัญชี" : t(lang, "pos_role_accountant");
  return lang === "th" ? "พนักงาน" : t(lang, "pos_role_staff");
}

function formatDateTime(value: string, lang: Lang) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  const locale = lang === "th" ? "th-TH" : "en-US";
  return date.toLocaleString(locale, {
    timeZone: POS_DISPLAY_TIMEZONE,
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

function SummaryIcon({ type }: { type: "store" | "branch" | "user" | "role" | "device" | "session" | "power" | "maintenance" }) {
  if (type === "store") {
    return (
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
        <path d="M4 10V20H20V10" />
        <path d="M3 10L5 4H19L21 10" />
        <path d="M8 20V14H16V20" />
      </svg>
    );
  }
  if (type === "branch") {
    return (
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
        <rect x="4" y="3" width="16" height="18" rx="2" />
        <path d="M8 7h2M12 7h2M8 11h2M12 11h2M8 15h2M12 15h2" />
      </svg>
    );
  }
  if (type === "user") {
    return (
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
        <circle cx="12" cy="8" r="3.5" />
        <path d="M4.5 20c1.3-3.6 4.1-5.4 7.5-5.4s6.2 1.8 7.5 5.4" />
      </svg>
    );
  }
  if (type === "role") {
    return (
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
        <path d="M12 3l7 4v5c0 5-3 8-7 9-4-1-7-4-7-9V7l7-4z" />
      </svg>
    );
  }
  if (type === "device") {
    return (
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
        <rect x="4" y="7" width="16" height="10" rx="2" />
        <path d="M8 17v3M16 17v3M7 11h10" />
      </svg>
    );
  }
  if (type === "power") {
    return (
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
        <path d="M12 3v9" />
        <path d="M7.1 6.2a8 8 0 1 0 9.8 0" />
      </svg>
    );
  }
  if (type === "maintenance") {
    return (
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
        <path d="M14.7 6.3 17.7 3.3l3 3-3 3" />
        <path d="m16.9 8.1-8.8 8.8-3.4.8.8-3.4 8.8-8.8" />
        <path d="M13 19h8" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4l2.8 1.8" />
    </svg>
  );
}

type DeviceRuntimeStatus = NonNullable<SessionCurrentResponse["data"]>["device"]["status"];

function getDeviceStatusLabel(status: DeviceRuntimeStatus | undefined, lang: Lang) {
  if (status === "inactive") return lang === "th" ? "ปิดใช้งาน" : "Disabled";
  if (status === "maintenance") return lang === "th" ? "บำรุงรักษา" : "Maintenance";
  if (status === "active") return lang === "th" ? "ใช้งาน" : "Active";
  return lang === "th" ? "ไม่ทราบสถานะ" : "Unknown";
}

export function PosEntryGate({ lang }: { lang: Lang }) {
  const [loading, setLoading] = useState(true);
  const [loadingSeconds, setLoadingSeconds] = useState(0);
  const [session, setSession] = useState<SessionCurrentResponse["data"]>(null);
  const [error, setError] = useState<string | null>(null);
  const [sessionExpiredError, setSessionExpiredError] = useState(false);
  const [skipSplashOnce, setSkipSplashOnce] = useState(false);

  const hasActiveShift = Boolean(session?.has_active_shift && session.shift?.status === "open");
  const canEnterSales = Boolean(session?.permissions.includes("sales:enter"));
  const deviceBlocksSales = Boolean(session?.device.block_sales);
  const blockedDeviceStatus = session?.device.status;
  const loginUrl = "/login/store";
  const shiftMenuUrl = "/preview/pos/shift";
  const reloginNowLabel = lang === "th" ? "เข้าสู่ระบบใหม่ตอนนี้" : "Sign in again now";
  const text = useMemo(
    () =>
      lang === "th"
        ? {
            loading: "กำลังตรวจสอบสิทธิ์เข้าใช้งาน POS...",
            quickLoading: "กำลังพาเข้าหน้าขาย...",
            missingSessionTitle: "ยังไม่พบ session สำหรับเข้าหน้าขาย",
            missingSessionBody: "กรุณาเข้าสู่ระบบผ่านหน้าร้านค้า แล้วเลือกสาขา พนักงาน และเครื่องแคชเชียร์ก่อน",
            sessionExpiredHint: "Session หมดอายุหรือไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่",
            goLogin: "ไปหน้าล็อกอิน",
            retry: "ตรวจสอบอีกครั้ง",
            timeoutTitle: "โหลด session ไม่สำเร็จ",
            timeoutBody: "ระบบใช้เวลานานเกินไปในการโหลด session POS กรุณาตรวจสอบอีกครั้ง หรือเข้าสู่ระบบใหม่",
            permissionDeniedTitle: "ไม่มีสิทธิ์เข้าหน้าขาย",
            permissionDeniedBody: "บัญชีนี้ยังไม่มีสิทธิ์ sales:enter สำหรับเข้าหน้าขาย กรุณาใช้รหัสพนักงานที่มีสิทธิ์ หรือให้ผู้ดูแลปรับสิทธิ์",
            deviceInactiveTitle: "เครื่องแคชเชียร์ถูกปิดใช้งาน",
            deviceInactiveBody: "เครื่องนี้ถูกปิดใช้งานจากเมนูเพิ่มเครื่องแคชเชียร์ จึงยังไม่สามารถเข้าหน้าขายได้ กรุณาให้ผู้ดูแลเปิดใช้งานเครื่องอีกครั้ง",
            deviceMaintenanceTitle: "เครื่องแคชเชียร์อยู่ระหว่างบำรุงรักษา",
            deviceMaintenanceBody: "เครื่องนี้ถูกตั้งเป็นบำรุงรักษา จึงพักการขายไว้ชั่วคราว กรุณาใช้งานเครื่องอื่น หรือให้ผู้ดูแลเปลี่ยนสถานะเมื่อพร้อมใช้งาน",
            deviceStatusLabel: "สถานะเครื่อง",
            shiftRequiredTitle: "กรุณาเปิดกะก่อนทุกครั้ง",
            summaryTitle: "สรุปก่อนเข้า POS",
            tenantLabel: "ร้าน",
            branchLabel: "สาขา",
            userLabel: "ผู้ใช้งาน",
            roleLabel: "บทบาท",
            deviceLabel: "เครื่องแคชเชียร์",
            expiresLabel: "Session หมดอายุ",
            shiftRequiredBody: "ยังไม่พบกะที่เปิดอยู่สำหรับ session นี้ กรุณาไปที่เมนูเปิด/ปิดกะ เพื่อเปิดกะก่อนเข้าหน้าขาย",
            goShiftMenu: "ไปเมนูเปิด/ปิดกะ"
          }
        : {
            loading: "Checking POS access...",
            quickLoading: "Opening sales screen...",
            missingSessionTitle: "No POS session found",
            missingSessionBody: "Please complete login flow (store, branch, employee, device) before entering sales.",
            sessionExpiredHint: "Your session is invalid or expired. Please sign in again.",
            goLogin: "Go to login",
            retry: "Retry",
            timeoutTitle: "POS session failed to load",
            timeoutBody: "Loading the current POS session took too long. Please retry or sign in again.",
            permissionDeniedTitle: "Sales access denied",
            permissionDeniedBody: "This account does not have the sales:enter permission required for the sales screen. Use an authorized employee code or update permissions.",
            deviceInactiveTitle: "Cashier device is disabled",
            deviceInactiveBody: "This cashier device was disabled from cashier device settings, so the sales screen is locked. Ask an admin to enable it again.",
            deviceMaintenanceTitle: "Cashier device is under maintenance",
            deviceMaintenanceBody: "This cashier device is marked for maintenance. Use another device or ask an admin to switch it back to active when ready.",
            deviceStatusLabel: "Device status",
            shiftRequiredTitle: "Please open shift before entering sales",
            summaryTitle: "POS Access Summary",
            tenantLabel: "Store",
            branchLabel: "Branch",
            userLabel: "User",
            roleLabel: "Role",
            deviceLabel: "Device",
            expiresLabel: "Session expires",
            shiftRequiredBody: "No active shift was found for this session. Go to Open/Close Shift menu first.",
            goShiftMenu: "Go to Open/Close Shift"
          },
    [lang]
  );

  useEffect(() => {
    void loadPosSalesModule();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const flagged = window.sessionStorage.getItem(POS_SKIP_ENTRY_GATE_SPLASH_KEY) === "1";
    if (flagged) {
      setSkipSplashOnce(true);
      window.sessionStorage.removeItem(POS_SKIP_ENTRY_GATE_SPLASH_KEY);
    }
  }, []);

  useEffect(() => {
    if (!loading) {
      setLoadingSeconds(0);
      return;
    }
    const intervalId = window.setInterval(() => {
      setLoadingSeconds((current) => current + 1);
    }, 1000);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [loading]);

  const load = useCallback(async () => {
    const startedAt = performance.now();
    let sessionMs = 0;
    setLoading(true);
    setError(null);
    setSessionExpiredError(false);
    try {
      const sessionStartedAt = performance.now();
      const { response: sessionRes, body: sessionBodyRaw } = await fetchJsonWithTimeout("/api/pos/session/current");
      sessionMs = Math.round(performance.now() - sessionStartedAt);
      const sessionBody = sessionBodyRaw as SessionCurrentResponse | null;
      if (!sessionRes.ok || !sessionBody?.data) {
        const sessionCode = sessionBody?.error?.code ?? "";
        if (SESSION_EXPIRED_CODES.has(sessionCode)) {
          setSession(null);
          publishSessionRole(null);
          setSessionExpiredError(true);
          setError(text.sessionExpiredHint);
          return;
        }
        throw new Error(sessionBody?.error?.message ?? "Cannot load POS session.");
      }

      setSession(sessionBody.data);
      publishSessionRole(sessionBody.data.role);
      window.dispatchEvent(new CustomEvent(POS_SESSION_EVENT_NAME, { detail: sessionBody.data }));
      const totalMs = Math.round(performance.now() - startedAt);
      if (totalMs > 1000) {
        console.info("[pos-entry-gate] load timing", { sessionMs, totalMs });
      }
    } catch (loadError) {
      setSessionExpiredError(false);
      setError(loadError instanceof Error ? loadError.message : "Unknown error.");
    } finally {
      setLoading(false);
    }
  }, [text.sessionExpiredHint]);

  useEffect(() => {
    void load();
  }, [load]);

  const summaryItems = useMemo(() => {
    if (!session) return [];
    const tenantName = session.tenant.name ?? session.tenant.code ?? session.tenant.id;
    const branchName = session.branch.name ?? session.branch.code ?? session.branch.id;
    const deviceCode = session.device.code ?? "-";
    const deviceStatus = getDeviceStatusLabel(session.device.status, lang);
    const roleLabel = normalizeRoleLabel(session.role, lang);
    return [
      { label: text.tenantLabel, value: tenantName, icon: "store" as const },
      { label: text.branchLabel, value: branchName, icon: "branch" as const },
      { label: text.userLabel, value: session.user.full_name, icon: "user" as const },
      { label: text.roleLabel, value: roleLabel, icon: "role" as const },
      { label: text.deviceLabel, value: deviceCode, icon: "device" as const },
      { label: text.deviceStatusLabel, value: deviceStatus, icon: session.device.status === "maintenance" ? "maintenance" as const : session.device.status === "inactive" ? "power" as const : "device" as const },
      { label: text.expiresLabel, value: formatDateTime(session.session.expires_at, lang), icon: "session" as const }
    ];
  }, [lang, session, text.branchLabel, text.deviceLabel, text.deviceStatusLabel, text.expiresLabel, text.roleLabel, text.tenantLabel, text.userLabel]);

  async function resetSessionAndGoLogin() {
    publishSessionRole(null);
    try {
      await fetch("/api/auth/session/context", {
        method: "DELETE",
        cache: "no-store"
      });
    } catch {
      // Ignore cleanup network failure and continue redirect to restart login flow.
    } finally {
      window.location.assign(loginUrl);
    }
  }

  function goToShiftMenu() {
    window.location.assign(shiftMenuUrl);
  }

  if (loading && skipSplashOnce) {
    return (
      <section className="surface" style={{ maxWidth: 760, margin: "0 auto", display: "grid", gap: 12 }}>
        <h2 style={{ margin: 0 }}>{text.quickLoading}</h2>
      </section>
    );
  }

  if (loading) {
    return (
      <section className="pos-entry-gate">
        <div className="pos-entry-gate__overlay" />
        <div role="status" aria-live="polite" className="pos-entry-gate__panel">
          <header className="pos-entry-gate__header">
            <div className="pos-entry-gate__header-icon">
              <SummaryIcon type="session" />
            </div>
            <div>
              <h2>{text.loading}</h2>
              <p>
                {lang === "th" ? "กำลังเตรียมหน้าขายและตรวจสอบ session..." : "Preparing sales screen and validating session..."}
              </p>
            </div>
          </header>
          <section className="pos-entry-gate__summary">
            <h3>{lang === "th" ? "สถานะการโหลด" : "Loading status"}</h3>
            <div className="pos-entry-gate__summary-grid">
              <article className="pos-entry-gate__summary-card">
                <div className="pos-entry-gate__summary-icon">
                  <SummaryIcon type="store" />
                </div>
                <div>
                  <p>{lang === "th" ? "เวลาที่รอ" : "Elapsed"}</p>
                  <strong>{loadingSeconds}s</strong>
                </div>
              </article>
              <article className="pos-entry-gate__summary-card">
                <div className="pos-entry-gate__summary-icon">
                  <SummaryIcon type="device" />
                </div>
                <div>
                  <p>{lang === "th" ? "สถานะระบบ" : "System status"}</p>
                  <strong>{lang === "th" ? "กำลังโหลด" : "Loading"}</strong>
                </div>
              </article>
            </div>
          </section>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button type="button" onClick={() => void load()} style={{ minHeight: 42 }}>
              {text.retry}
            </button>
            <button type="button" onClick={() => void resetSessionAndGoLogin()} style={{ minHeight: 42 }}>
              {text.goLogin}
            </button>
          </div>
        </div>
      </section>
    );
  }

  if (!session && error && error.toLowerCase().includes("timeout")) {
    return (
      <section className="pos-entry-gate">
        <div className="pos-entry-gate__overlay" />
        <div role="alertdialog" aria-modal="true" className="pos-entry-gate__panel">
          <header className="pos-entry-gate__header">
            <div className="pos-entry-gate__header-icon">
              <SummaryIcon type="session" />
            </div>
            <div>
              <h2>{text.timeoutTitle}</h2>
              <p>{text.timeoutBody}</p>
            </div>
          </header>
          <div className="pos-entry-gate__button-row">
            <button type="button" className="pos-entry-gate__primary-btn" onClick={() => void load()}>
              {text.retry}
            </button>
            <button type="button" className="pos-entry-gate__ghost-btn" onClick={() => void resetSessionAndGoLogin()}>
              {text.goLogin}
            </button>
          </div>
        </div>
      </section>
    );
  }

  if (session && !canEnterSales && !deviceBlocksSales) {
    return (
      <section className="pos-entry-gate">
        <div className="pos-entry-gate__overlay" />
        <div role="alertdialog" aria-modal="true" className="pos-entry-gate__panel">
          <header className="pos-entry-gate__header">
            <div className="pos-entry-gate__header-icon">
              <SummaryIcon type="role" />
            </div>
            <div>
              <h2>{text.permissionDeniedTitle}</h2>
              <p>{text.permissionDeniedBody}</p>
            </div>
          </header>

          <section className="pos-entry-gate__summary">
            <h3>{text.summaryTitle}</h3>
            <div className="pos-entry-gate__summary-grid">
              {summaryItems.map((item) => (
                <article key={item.label} className="pos-entry-gate__summary-card">
                  <div className="pos-entry-gate__summary-icon">
                    <SummaryIcon type={item.icon} />
                  </div>
                  <div>
                    <p>{item.label}</p>
                    <strong>{item.value}</strong>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <div className="pos-entry-gate__button-row">
            <button type="button" className="pos-entry-gate__primary-btn" onClick={() => void resetSessionAndGoLogin()}>
              {text.goLogin}
            </button>
            <button type="button" className="pos-entry-gate__secondary-btn" onClick={() => void load()}>
            {text.retry}
          </button>
          </div>
        </div>
      </section>
    );
  }

  if (session && deviceBlocksSales) {
    const isMaintenance = blockedDeviceStatus === "maintenance";
    return (
      <section className="pos-entry-gate">
        <div className="pos-entry-gate__overlay" />
        <div role="alertdialog" aria-modal="true" className="pos-entry-gate__panel pos-entry-gate__panel--device-blocked">
          <header className="pos-entry-gate__header">
            <div className={`pos-entry-gate__header-icon ${isMaintenance ? "pos-entry-gate__header-icon--warning" : "pos-entry-gate__header-icon--danger"}`}>
              <SummaryIcon type={isMaintenance ? "maintenance" : "power"} />
            </div>
            <div>
              <h2>{isMaintenance ? text.deviceMaintenanceTitle : text.deviceInactiveTitle}</h2>
              <p>{isMaintenance ? text.deviceMaintenanceBody : text.deviceInactiveBody}</p>
            </div>
          </header>

          <section className="pos-entry-gate__summary">
            <h3>{text.summaryTitle}</h3>
            <div className="pos-entry-gate__summary-grid">
              {summaryItems.map((item) => (
                <article key={item.label} className="pos-entry-gate__summary-card">
                  <div className="pos-entry-gate__summary-icon">
                    <SummaryIcon type={item.icon} />
                  </div>
                  <div>
                    <p>{item.label}</p>
                    <strong>{item.value}</strong>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <div className="pos-entry-gate__button-row">
            <button type="button" className="pos-entry-gate__secondary-btn" onClick={() => void load()}>
              {text.retry}
            </button>
            <button type="button" className="pos-entry-gate__ghost-btn" onClick={() => void resetSessionAndGoLogin()}>
              {text.goLogin}
            </button>
          </div>
        </div>
      </section>
    );
  }

  if (!session) {
    return (
      <section className="surface" style={{ maxWidth: 760, margin: "0 auto", display: "grid", gap: 12 }}>
        <h2 style={{ margin: 0 }}>{text.missingSessionTitle}</h2>
        <p style={{ margin: 0, color: "var(--muted)" }}>{text.missingSessionBody}</p>
        {error ? (
          <p role="alert" style={{ margin: 0, color: "#b91c1c", fontWeight: 700 }}>
            {error}
          </p>
        ) : null}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {sessionExpiredError ? (
            <button type="button" onClick={() => void resetSessionAndGoLogin()} style={{ minHeight: 40 }}>
              {reloginNowLabel}
            </button>
          ) : null}
          <button type="button" onClick={() => void resetSessionAndGoLogin()} style={{ minHeight: 40 }}>
            {text.goLogin}
          </button>
          <button type="button" onClick={() => void load()} style={{ minHeight: 40 }}>
            {text.retry}
          </button>
        </div>
      </section>
    );
  }

  if (hasActiveShift && canEnterSales) {
    return <PosSalesModule lang={lang} />;
  }

  return (
    <section className="pos-entry-gate">
      <div className="pos-entry-gate__overlay" />
      <div role="dialog" aria-modal="true" className="pos-entry-gate__panel">
        <header className="pos-entry-gate__header">
          <div className="pos-entry-gate__header-icon">
            <SummaryIcon type="role" />
          </div>
          <div>
            <h2>{text.shiftRequiredTitle}</h2>
            <p>{text.shiftRequiredBody}</p>
          </div>
        </header>

        <section className="pos-entry-gate__summary">
          <h3>{text.summaryTitle}</h3>
          <div className="pos-entry-gate__summary-grid">
            {summaryItems.map((item) => (
              <article key={item.label} className="pos-entry-gate__summary-card">
                <div className="pos-entry-gate__summary-icon">
                  <SummaryIcon type={item.icon} />
                </div>
                <div>
                  <p>{item.label}</p>
                  <strong>{item.value}</strong>
                </div>
              </article>
            ))}
          </div>
        </section>

        {error ? (
          <p role="alert" className="pos-entry-gate__error">
            {error}
          </p>
        ) : null}

        <div className="pos-entry-gate__button-row">
          <button type="button" className="pos-entry-gate__primary-btn" onClick={goToShiftMenu}>
            {text.goShiftMenu}
          </button>
          <button type="button" className="pos-entry-gate__secondary-btn" onClick={() => void load()}>
            {text.retry}
          </button>
          <button type="button" className="pos-entry-gate__ghost-btn" onClick={() => void resetSessionAndGoLogin()}>
            {text.goLogin}
          </button>
        </div>
      </div>
    </section>
  );
}
