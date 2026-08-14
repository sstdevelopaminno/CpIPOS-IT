import type { ReactNode } from "react";
import { ItAdminShell, type ItAdminNavItem } from "@/components/it-admin/it-admin-shell";
import { getCurrentLanguage, t } from "@/lib/i18n";

export default async function ItAdminLayout({ children }: { children: ReactNode }) {
  const lang = await getCurrentLanguage();

  const nav: ItAdminNavItem[] = [
    {
      href: "/it-admin/support",
      label: lang === "th" ? "ศูนย์บริการ 24/7" : "24/7 Support Center",
      icon: "support",
      section: "operations"
    },
    {
      href: "/it-admin/monitoring",
      label: t(lang, "monitoring"),
      icon: "monitor",
      section: "operations"
    },
    {
      href: "/it-admin/tenants",
      label: t(lang, "tenants"),
      icon: "tenant",
      section: "platform"
    },
    {
      href: "/it-admin/packages",
      label: t(lang, "packages"),
      icon: "package",
      section: "platform"
    },
    {
      href: "/it-admin/customer-display",
      label: t(lang, "customer_display_devices"),
      icon: "display",
      section: "platform"
    },
    {
      href: "/it-admin/platform-users",
      label: t(lang, "platform_users"),
      icon: "users",
      section: "governance"
    },
    {
      href: "/audit-logs",
      label: t(lang, "audit_report"),
      icon: "audit",
      section: "governance"
    },
    {
      href: "/it-admin/settings/language",
      label: t(lang, "common_settings"),
      icon: "settings",
      section: "governance"
    }
  ];

  return (
    <ItAdminShell
      nav={nav}
      language={lang}
      languageLabel={t(lang, "language")}
      thaiLabel={t(lang, "thai")}
      englishLabel={t(lang, "english")}
    >
      {children}
    </ItAdminShell>
  );
}
