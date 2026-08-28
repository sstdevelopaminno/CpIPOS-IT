"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { LanguageSwitcher } from "@/components/language/language-switcher";
import type { Language } from "@/lib/i18n";
import styles from "./app-shell.module.css";

export type AppShellNavIcon =
  | "dashboard"
  | "store"
  | "provision"
  | "branch"
  | "users"
  | "device"
  | "android"
  | "printer"
  | "package"
  | "entitlement"
  | "monitoring"
  | "incident"
  | "audit"
  | "settings";

export type AppShellNavItem = {
  href?: string;
  label: string;
  group: string;
  icon: AppShellNavIcon;
  disabled?: boolean;
};

function NavIcon({ name }: { name: AppShellNavIcon }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true
  };

  if (name === "dashboard") {
    return (
      <svg {...common}>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </svg>
    );
  }

  if (name === "store") {
    return (
      <svg {...common}>
        <path d="M4 10v10h16V10" />
        <path d="M3 10l2-6h14l2 6" />
        <path d="M8 20v-6h8v6" />
      </svg>
    );
  }

  if (name === "provision") {
    return (
      <svg {...common}>
        <rect x="4" y="4" width="16" height="16" rx="3" />
        <path d="M12 8v8M8 12h8" />
      </svg>
    );
  }

  if (name === "branch") {
    return (
      <svg {...common}>
        <circle cx="6" cy="6" r="2" />
        <circle cx="18" cy="6" r="2" />
        <circle cx="12" cy="18" r="2" />
        <path d="M8 7.2l3 8M16 7.2l-3 8M8 6h8" />
      </svg>
    );
  }

  if (name === "users") {
    return (
      <svg {...common}>
        <circle cx="9" cy="8" r="3" />
        <path d="M4 20c.4-4 2.2-6 5-6s4.6 2 5 6" />
        <path d="M16 5.5a3 3 0 010 5M16 14c2.3.4 3.6 2.4 4 5" />
      </svg>
    );
  }

  if (name === "device" || name === "android") {
    return (
      <svg {...common}>
        <rect x="6" y="2.5" width="12" height="19" rx="2.5" />
        <path d="M10 5h4M11 18.5h2" />
      </svg>
    );
  }

  if (name === "printer") {
    return (
      <svg {...common}>
        <path d="M7 8V3h10v5" />
        <rect x="4" y="8" width="16" height="9" rx="2" />
        <path d="M7 14h10v7H7zM17 11h.01" />
      </svg>
    );
  }

  if (name === "package") {
    return (
      <svg {...common}>
        <path d="M4 7l8-4 8 4-8 4-8-4z" />
        <path d="M4 7v10l8 4 8-4V7M12 11v10" />
      </svg>
    );
  }

  if (name === "entitlement") {
    return (
      <svg {...common}>
        <path d="M12 3l7 3v5c0 4.8-2.7 8.1-7 10-4.3-1.9-7-5.2-7-10V6l7-3z" />
        <path d="M9 12l2 2 4-4" />
      </svg>
    );
  }

  if (name === "monitoring") {
    return (
      <svg {...common}>
        <path d="M3 12h4l2-5 4 10 2-5h6" />
        <path d="M4 4h16v16H4z" opacity=".35" />
      </svg>
    );
  }

  if (name === "incident") {
    return (
      <svg {...common}>
        <path d="M12 3l9 17H3L12 3z" />
        <path d="M12 9v4M12 17h.01" />
      </svg>
    );
  }

  if (name === "audit") {
    return (
      <svg {...common}>
        <path d="M8 4h8M9 2h6v4H9z" />
        <rect x="5" y="4" width="14" height="17" rx="2" />
        <path d="M8 10h8M8 14h8M8 18h5" />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19 12a7 7 0 01-.1 1.2l2 1.6-2 3.4-2.5-1a8 8 0 01-2.1 1.2L14 21h-4l-.3-2.6a8 8 0 01-2.1-1.2l-2.5 1-2-3.4 2-1.6A7 7 0 015 12c0-.4 0-.8.1-1.2l-2-1.6 2-3.4 2.5 1a8 8 0 012.1-1.2L10 3h4l.3 2.6a8 8 0 012.1 1.2l2.5-1 2 3.4-2 1.6c.1.4.1.8.1 1.2z" />
    </svg>
  );
}

function matchesPath(pathname: string, href: string) {
  if (href === "/it-admin") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({
  title,
  subtitle,
  nav,
  language,
  languageLabel,
  thaiLabel,
  englishLabel,
  roleLabel,
  unavailableLabel,
  children
}: {
  title: string;
  subtitle: string;
  nav: AppShellNavItem[];
  language: Language;
  languageLabel: string;
  thaiLabel: string;
  englishLabel: string;
  roleLabel: string;
  unavailableLabel: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const groups = useMemo(() => {
    const ordered = new Map<string, AppShellNavItem[]>();
    for (const item of nav) {
      const items = ordered.get(item.group) ?? [];
      items.push(item);
      ordered.set(item.group, items);
    }
    return Array.from(ordered.entries());
  }, [nav]);

  const activeItem = useMemo(
    () =>
      nav
        .filter((item): item is AppShellNavItem & { href: string } => Boolean(item.href && !item.disabled))
        .filter((item) => matchesPath(pathname, item.href))
        .sort((left, right) => right.href.length - left.href.length)[0] ?? null,
    [nav, pathname]
  );

  const dashboardItem = nav.find((item) => item.href === "/it-admin") ?? null;

  return (
    <div className={styles.shell}>
      <button
        type="button"
        className={`${styles.backdrop} ${mobileOpen ? styles.backdropVisible : ""}`}
        aria-label="Close navigation"
        aria-hidden={!mobileOpen}
        tabIndex={mobileOpen ? 0 : -1}
        onClick={() => setMobileOpen(false)}
      />

      <aside className={`${styles.sidebar} ${mobileOpen ? styles.sidebarOpen : ""}`} aria-label="IT Admin navigation">
        <div className={styles.brandBlock}>
          <Link href="/it-admin" className={styles.brandLink} onClick={() => setMobileOpen(false)}>
            <Image src="/brand/cpipos-logo.png" alt="CpIPOS" width={148} height={44} className={styles.brandLogo} priority />
          </Link>
          <div className={styles.brandCopy}>
            <strong>IT Control Plane</strong>
            <span>{subtitle}</span>
          </div>
        </div>

        <nav className={styles.navigation}>
          {groups.map(([group, items]) => (
            <div key={group} className={styles.navGroup}>
              <div className={styles.navGroupLabel}>{group}</div>
              <div className={styles.navGroupItems}>
                {items.map((item) => {
                  const active = Boolean(item.href && !item.disabled && matchesPath(pathname, item.href));
                  if (!item.href || item.disabled) {
                    return (
                      <div key={`${group}-${item.label}`} className={`${styles.navItem} ${styles.navItemDisabled}`} aria-disabled="true">
                        <span className={styles.navIcon}><NavIcon name={item.icon} /></span>
                        <span className={styles.navLabel}>{item.label}</span>
                        <span className={styles.soonBadge}>{unavailableLabel}</span>
                      </div>
                    );
                  }

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMobileOpen(false)}
                      className={`${styles.navItem} ${active ? styles.navItemActive : ""}`}
                      aria-current={active ? "page" : undefined}
                    >
                      <span className={styles.navIcon}><NavIcon name={item.icon} /></span>
                      <span className={styles.navLabel}>{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className={styles.sidebarFooter}>
          <div className={styles.internalBadge}>
            <span className={styles.internalDot} />
            CpIPOS Internal Operations
          </div>
          <div className={styles.sidebarMeta}>CpiPOS-001 · CpiPOS-002</div>
        </div>
      </aside>

      <div className={styles.workspace}>
        <header className={styles.topbar}>
          <div className={styles.topbarLeft}>
            <button
              type="button"
              className={styles.menuButton}
              aria-label="Open navigation"
              aria-expanded={mobileOpen}
              onClick={() => setMobileOpen(true)}
            >
              <span />
              <span />
              <span />
            </button>

            <div className={styles.headingBlock}>
              <div className={styles.breadcrumbs} aria-label="Breadcrumb">
                {dashboardItem?.href ? (
                  <Link href={dashboardItem.href}>{dashboardItem.label}</Link>
                ) : (
                  <span>{dashboardItem?.label ?? "Dashboard"}</span>
                )}
                {activeItem && activeItem.href !== dashboardItem?.href ? (
                  <>
                    <span className={styles.breadcrumbSeparator}>/</span>
                    <span aria-current="page">{activeItem.label}</span>
                  </>
                ) : null}
              </div>
              <h1>{activeItem?.label ?? title}</h1>
            </div>
          </div>

          <div className={styles.topbarActions}>
            <LanguageSwitcher
              currentLanguage={language}
              label={languageLabel}
              thaiLabel={thaiLabel}
              englishLabel={englishLabel}
              compact
            />
            <div className={styles.roleChip} title={roleLabel}>
              <span className={styles.avatar}>IT</span>
              <span className={styles.roleCopy}>
                <strong>{roleLabel}</strong>
                <small>Control Plane</small>
              </span>
            </div>
          </div>
        </header>

        <main className={styles.content}>{children}</main>
      </div>
    </div>
  );
}
