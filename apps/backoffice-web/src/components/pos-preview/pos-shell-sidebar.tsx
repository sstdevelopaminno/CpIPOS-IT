"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MouseEvent, useEffect, useState } from "react";
import { PackageLockDialog } from "@/components/pos-preview/package-lock-dialog";
import { PosStaffMenu } from "@/components/pos-preview/pos-staff-menu";
import { t, type Language } from "@/lib/i18n";
import {
  POS_MENU_LOCK_TITLE_EN,
  POS_MENU_LOCK_TITLE_TH,
  featureForPosRoute
} from "@/lib/pos-feature-map";
type PosRole = "owner" | "manager" | "staff" | "accountant";
type MainMenuPlacement = "left" | "top" | "bottom";
const POS_ROLE_STORAGE_KEY = "pos_session_role_v1";
const POS_ROLE_EVENT_NAME = "pos-session-role-updated";

function normalizePosRole(value: string): PosRole | null {
  if (value === "owner" || value === "manager" || value === "staff" || value === "accountant") return value;
  return null;
}

function LogoutIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

type Props = {
  lang: Language;
  settingsLabel: string;
  placement: MainMenuPlacement;
};

const COMPACT_SIDEBAR_QUERY = "(min-width: 768px) and (max-width: 1180px) and (orientation: landscape)";

export function PosShellSidebar({ lang, settingsLabel, placement }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();
  const [sessionRole, setSessionRole] = useState<PosRole | null>(null);
  const [enabledFeatures, setEnabledFeatures] = useState<Record<string, boolean> | null>(null);
  const [packageLockOpen, setPackageLockOpen] = useState(false);
  const [logoutModalOpen, setLogoutModalOpen] = useState(false);
  const [logoutBusyMode, setLogoutBusyMode] = useState<"switch_device" | "full" | null>(null);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const isHorizontal = placement === "top" || placement === "bottom";
  const isSettingsActive = pathname === "/preview/pos/settings";
  const showAdvancedMenus = sessionRole === null || sessionRole === "owner";
  const settingsFeature = featureForPosRoute("/preview/pos/settings");
  const isSettingsLocked = Boolean(enabledFeatures !== null && settingsFeature && enabledFeatures[settingsFeature] === false);

  useEffect(() => {
    const mediaQuery = window.matchMedia(COMPACT_SIDEBAR_QUERY);
    if (mediaQuery.matches) {
      setCollapsed(true);
    }

    const collapseForCompactWidth = (event: MediaQueryListEvent) => {
      if (event.matches) {
        setCollapsed(true);
      }
    };

    mediaQuery.addEventListener("change", collapseForCompactWidth);
    return () => {
      mediaQuery.removeEventListener("change", collapseForCompactWidth);
    };
  }, []);

  useEffect(() => {
    const applyStoredRole = () => {
      try {
        const storedRole = window.sessionStorage.getItem(POS_ROLE_STORAGE_KEY);
        const normalized = normalizePosRole(storedRole ?? "");
        setSessionRole(normalized);
        return normalized;
      } catch {
        setSessionRole(null);
        return null;
      }
    };

    const onSessionRoleUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ role?: string | null }>).detail;
      const nextRole = normalizePosRole(String(detail?.role ?? ""));
      setSessionRole(nextRole);
    };

    applyStoredRole();
    window.addEventListener(POS_ROLE_EVENT_NAME, onSessionRoleUpdated as EventListener);
    return () => {
      window.removeEventListener(POS_ROLE_EVENT_NAME, onSessionRoleUpdated as EventListener);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadFeatures() {
      try {
        const response = await fetch("/api/pos/features", { cache: "no-store" });
        const body = (await response.json().catch(() => null)) as { data?: { features?: Record<string, boolean> } | null } | null;
        if (!cancelled && response.ok) {
          setEnabledFeatures(body?.data?.features ?? {});
        }
      } catch {
        if (!cancelled) setEnabledFeatures({});
      }
    }
    void loadFeatures();
    return () => {
      cancelled = true;
    };
  }, []);

  function handleSettingsNavigate(event: MouseEvent<HTMLAnchorElement>) {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    if (pathname === "/preview/pos/settings") {
      event.preventDefault();
      return;
    }
    if (isSettingsLocked) {
      event.preventDefault();
      setPackageLockOpen(true);
      return;
    }
  }

  async function submitLogout(mode: "switch_device" | "full") {
    if (logoutBusyMode) return;
    setLogoutBusyMode(mode);
    setLogoutError(null);
    try {
      const response = await fetch("/api/auth/session/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode })
      });
      const body = (await response.json().catch(() => null)) as { data?: { redirect_to?: string } | null; error?: { message?: string } | null } | null;
      if (!response.ok) {
        throw new Error(body?.error?.message ?? (lang === "th" ? "ไม่สามารถออกจากระบบได้" : "Unable to logout."));
      }
      window.sessionStorage.removeItem(POS_ROLE_STORAGE_KEY);
      window.dispatchEvent(new CustomEvent(POS_ROLE_EVENT_NAME, { detail: { role: null } }));
      window.location.assign(body?.data?.redirect_to ?? "/login/store");
    } catch (error) {
      setLogoutError(error instanceof Error ? error.message : lang === "th" ? "ไม่สามารถออกจากระบบได้" : "Unable to logout.");
    } finally {
      setLogoutBusyMode(null);
    }
  }

  return (
    <aside
      className={`pos-shell-sidebar pos-shell-sidebar--${placement} hidden min-h-0 shrink-0 overflow-hidden border-slate-900/40 bg-[radial-gradient(circle_at_80%_-20%,rgba(56,189,248,0.28),transparent_45%),radial-gradient(circle_at_20%_120%,rgba(37,99,235,0.26),transparent_40%),linear-gradient(185deg,#07142c,#081c3b_45%,#071731)] p-3 text-white md:flex ${
        isHorizontal
          ? "h-[78px] w-full flex-row items-center gap-3 border-r-0"
          : `h-full flex-col border-r ${collapsed ? "md:w-[68px] xl:w-[70px]" : "md:w-[188px] xl:w-[214px]"}`
      } ${!isHorizontal && collapsed ? "is-collapsed" : "is-expanded"}`}
    >
      <div className={`pos-shell-sidebar__brand shrink-0 ${collapsed || isHorizontal ? "flex justify-center" : ""}`}>
        <div
          className={`pos-shell-sidebar__logo ${
            collapsed || isHorizontal ? "pos-shell-sidebar__logo--collapsed" : ""
          }`}
        >
          <span
            role="img"
            aria-label="CpIPOS"
            className="pos-shell-sidebar__logo-mark"
          />
        </div>
      </div>

      {!isHorizontal ? (
        <div className={`mt-3 flex shrink-0 items-center ${collapsed ? "justify-center" : "justify-between"}`}>
          {!collapsed ? <p className="text-[12px] font-semibold text-slate-200">{t(lang, "pos_sidebar_staff_menu")}</p> : null}
          <button
            type="button"
            className="inline-flex h-[34px] min-w-[34px] items-center justify-center rounded-lg border border-white/20 bg-slate-900/45 p-0 text-slate-100 transition hover:bg-slate-900/70"
            onClick={() => setCollapsed((current) => !current)}
            aria-label={collapsed ? t(lang, "pos_sidebar_expand_labels") : t(lang, "pos_sidebar_collapse_labels")}
            title={collapsed ? t(lang, "pos_sidebar_expand") : t(lang, "pos_sidebar_collapse")}
          >
            <svg viewBox="0 0 20 20" width="14" height="14" fill="currentColor" aria-hidden>
              {collapsed ? <path d="M7 4l6 6-6 6" /> : <path d="M13 4l-6 6 6 6" />}
            </svg>
          </button>
        </div>
      ) : null}

      <div className={`${isHorizontal ? "min-w-0 flex-1 overflow-hidden" : "pos-shell-sidebar__menu-scroll mt-2 min-h-0 flex-1 overflow-y-auto overscroll-contain"}`} suppressHydrationWarning>
        <div className={`${isHorizontal ? "flex min-w-0 items-center gap-1" : "flex min-h-full flex-col justify-start"}`}>
          <PosStaffMenu
            lang={lang}
            collapsed={isHorizontal ? false : collapsed}
            orientation={isHorizontal ? "horizontal" : "vertical"}
            sessionRole={sessionRole}
            enabledFeatures={enabledFeatures}
            onLockedFeature={() => setPackageLockOpen(true)}
          />

          {showAdvancedMenus ? (
            <Link
              href="/preview/pos/settings"
              onClick={handleSettingsNavigate}
              className={`group relative inline-flex min-h-[40px] items-center text-[13px] font-semibold leading-tight transition ${
                isHorizontal
                  ? "w-auto shrink-0 justify-center gap-2 px-3"
                  : collapsed
                    ? "mt-0.5 w-full justify-center px-2"
                    : "mt-0.5 w-full justify-start gap-2 px-2"
              } ${
                isSettingsActive
                  ? "rounded-xl border border-blue-400/40 bg-blue-500/25 text-white"
                  : isSettingsLocked
                    ? "rounded-xl text-slate-400/70"
                    : "rounded-xl text-slate-100/90 hover:bg-white/5 hover:text-white"
              }`}
              title={collapsed && !isHorizontal ? settingsLabel : isSettingsLocked ? (lang === "th" ? POS_MENU_LOCK_TITLE_TH : POS_MENU_LOCK_TITLE_EN) : undefined}
              aria-disabled={isSettingsLocked}
            >
              <span className="inline-flex w-4 justify-center" aria-hidden>
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.7 1.7 0 0 0 .33 1.82l.03.03a2 2 0 1 1-2.83 2.83l-.03-.03A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21a2 2 0 1 1-4 0v-.04A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.82.33l-.03.03a2 2 0 1 1-2.83-2.83l.03-.03A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H2.96a2 2 0 1 1 0-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.33-1.82l-.03-.03a2 2 0 1 1 2.83-2.83l.03.03A1.7 1.7 0 0 0 9 4.6c.36 0 .7-.13 1-.38.27-.25.43-.6.4-.96V3a2 2 0 1 1 4 0v.04c-.03.37.12.72.4.96.3.25.64.38 1 .38a1.7 1.7 0 0 0 1.82-.33l.03-.03a2 2 0 1 1 2.83 2.83l-.03.03a1.7 1.7 0 0 0-.33 1.82c.1.38.35.73.72.95.29.18.62.27.95.25H21a2 2 0 1 1 0 4h-.04c-.37-.03-.72.12-.96.4-.24.3-.37.64-.36 1z" />
                </svg>
              </span>
              {(!collapsed || isHorizontal) ? <span className="truncate text-[13px]">{settingsLabel}</span> : null}
            </Link>
          ) : null}
        </div>
      </div>

      <div className={`${isHorizontal ? "shrink-0" : "grid shrink-0 gap-2 pt-2"}`}>
        <button
          type="button"
          onClick={() => {
            if (!logoutBusyMode) setLogoutModalOpen(true);
          }}
          disabled={Boolean(logoutBusyMode)}
          className={`group inline-flex min-h-[42px] items-center text-[13px] font-semibold leading-tight text-slate-100/90 transition hover:bg-white/8 hover:text-white disabled:cursor-wait disabled:opacity-60 ${
            isHorizontal
              ? "w-auto justify-center gap-2 rounded-xl px-3"
              : collapsed
                ? "w-full justify-center rounded-xl px-2"
                : "w-full justify-start gap-2 rounded-xl px-2"
          }`}
          title={collapsed && !isHorizontal ? t(lang, "pos_menu_logout") : undefined}
          aria-label={t(lang, "pos_menu_logout")}
        >
          <span className="inline-flex w-4 justify-center">
            <LogoutIcon />
          </span>
          {(!collapsed || isHorizontal) ? <span className="truncate text-[13px]">{t(lang, "pos_menu_logout")}</span> : null}
        </button>
      </div>

      {logoutModalOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[90] grid place-items-center bg-slate-950/55 p-4"
          onClick={() => {
            if (!logoutBusyMode) {
              setLogoutModalOpen(false);
              setLogoutError(null);
            }
          }}
        >
          <section
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-4 text-slate-900 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-lg font-extrabold">{t(lang, "pos_logout_title")}</h3>
            <p className="mt-1 text-sm text-slate-600">{t(lang, "pos_logout_desc")}</p>
            {logoutError ? <p className="mt-2 text-sm font-semibold text-red-600">{logoutError}</p> : null}
            <div className="mt-4 grid gap-2">
              <button
                type="button"
                disabled={Boolean(logoutBusyMode)}
                onClick={() => void submitLogout("switch_device")}
                className="h-10 rounded-xl border border-blue-200 bg-blue-50 px-3 text-sm font-semibold text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {logoutBusyMode === "switch_device" ? t(lang, "pos_logout_loading") : t(lang, "pos_logout_switch_device")}
              </button>
              <button
                type="button"
                disabled={Boolean(logoutBusyMode)}
                onClick={() => void submitLogout("full")}
                className="h-10 rounded-xl border border-orange-200 bg-orange-50 px-3 text-sm font-semibold text-orange-700 transition hover:bg-orange-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {logoutBusyMode === "full" ? t(lang, "pos_logout_loading") : t(lang, "pos_logout_full")}
              </button>
            </div>
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700"
                disabled={Boolean(logoutBusyMode)}
                onClick={() => {
                  setLogoutModalOpen(false);
                  setLogoutError(null);
                }}
              >
                {t(lang, "sales_list_cancel")}
              </button>
            </div>
          </section>
        </div>
      ) : null}
      <PackageLockDialog lang={lang} open={packageLockOpen} onClose={() => setPackageLockOpen(false)} />
    </aside>
  );
}
