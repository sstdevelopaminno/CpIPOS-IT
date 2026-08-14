"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { LanguageSwitcher } from "@/components/language/language-switcher";
import type { Language } from "@/lib/i18n";
import styles from "./it-admin-shell.module.css";

export type ItAdminNavItem = {
  href: string;
  label: string;
  icon: "support" | "monitor" | "tenant" | "package" | "display" | "users" | "audit" | "settings";
  section: "operations" | "platform" | "governance";
};

const iconPaths: Record<ItAdminNavItem["icon"], ReactNode> = {
  support: <path d="M5 18a7 7 0 0 1 14 0v2h-4v-5h4M5 20H1v-2a11 11 0 0 1 22 0v2h-4M8 21h8M12 3v2" />,
  monitor: <path d="M3 4h18v12H3zM8 20h8M12 16v4M7 11l3-3 3 3 4-5" />,
  tenant: <path d="M3 21h18M5 21V8l7-5 7 5v13M9 21v-6h6v6M8 10h.01M16 10h.01" />,
  package: <path d="m4 7 8-4 8 4-8 4-8-4Zm0 0v10l8 4 8-4V7M12 11v10" />,
  display: <path d="M3 4h18v13H3zM8 21h8M12 17v4" />,
  users: <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />,
  audit: <path d="M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />,
  settings: <path d="M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5ZM19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.09A1.7 1.7 0 0 0 9 19.35a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3v-4h.09A1.7 1.7 0 0 0 4.65 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1.03-1.56V3h4v.09A1.7 1.7 0 0 0 15 4.65a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.56 1.03H21v4h-.09A1.7 1.7 0 0 0 19.4 15Z" />
};

function ShellIcon({ name }: { name: ItAdminNavItem["icon"] }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={styles.navIcon}>
      {iconPaths[name]}
    </svg>
  );
}

export function ItAdminShell({
  nav,
  language,
  languageLabel,
  thaiLabel,
  englishLabel,
  children
}: {
  nav: ItAdminNavItem[];
  language: Language;
  languageLabel: string;
  thaiLabel: string;
  englishLabel: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const sections: Array<{ key: ItAdminNavItem["section"]; label: string }> = [
    { key: "operations", label: language === "th" ? "ปฏิบัติการ" : "OPERATIONS" },
    { key: "platform", label: language === "th" ? "ลูกค้าและแพลตฟอร์ม" : "CUSTOMERS & PLATFORM" },
    { key: "governance", label: language === "th" ? "กำกับดูแล" : "GOVERNANCE" }
  ];

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <div className={styles.brandMark}>CP</div>
          <div>
            <strong>CpIPOS</strong>
            <span>Control Plane</span>
          </div>
        </div>

        <div className={styles.operatorBadge}>
          <span className={styles.liveDot} />
          <div>
            <strong>24/7 Support</strong>
            <span>{language === "th" ? "ศูนย์ดูแลระบบลูกค้า" : "Customer operations"}</span>
          </div>
        </div>

        <nav className={styles.nav} aria-label="IT Admin navigation">
          {sections.map((section) => {
            const items = nav.filter((item) => item.section === section.key);
            if (!items.length) return null;
            return (
              <div key={section.key} className={styles.navSection}>
                <div className={styles.navSectionLabel}>{section.label}</div>
                {items.map((item) => {
                  const active = pathname === item.href || (item.href !== "/it-admin" && pathname.startsWith(`${item.href}/`));
                  return (
                    <Link key={item.href} href={item.href} className={`${styles.navItem} ${active ? styles.navItemActive : ""}`}>
                      <ShellIcon name={item.icon} />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </nav>

        <div className={styles.sidebarFooter}>
          <div className={styles.environmentLabel}>{language === "th" ? "สภาพแวดล้อม" : "ENVIRONMENT"}</div>
          <div className={styles.environmentValue}><span /> Production Operations</div>
        </div>
      </aside>

      <div className={styles.workspace}>
        <header className={styles.topbar}>
          <div>
            <div className={styles.eyebrow}>CPIPOS / OPERATIONS</div>
            <div className={styles.topbarTitle}>{language === "th" ? "ศูนย์ควบคุมและบริการลูกค้า" : "Customer Operations Center"}</div>
          </div>
          <div className={styles.topbarTools}>
            <div className={styles.statusChip}><span /> API & MDM</div>
            <LanguageSwitcher
              currentLanguage={language}
              label={languageLabel}
              thaiLabel={thaiLabel}
              englishLabel={englishLabel}
              compact
            />
          </div>
        </header>
        <main className={styles.content}>{children}</main>
      </div>
    </div>
  );
}
