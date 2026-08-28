import { AppShell } from "@/components/layout/app-shell";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth-context";
import { getCurrentLanguage, t } from "@/lib/i18n";

const nav = [
  { href: "/it-admin", key: "dashboard" },
  { href: "/it-admin/tenants", key: "tenants" },
  { href: "/tenants", key: "tenants" },
  { href: "/audit-logs", key: "audit_report" },
  { href: "/it-admin/packages", key: "packages" },
  { href: "/it-admin/customer-display", key: "customer_display_devices" },
  { href: "/it-admin/platform-users", key: "platform_users" },
  { href: "/it-admin/devices", label: "Devices / MDM" },
  { href: "/it-admin/monitoring", key: "monitoring" },
  { href: "/it-admin/settings/language", key: "common_settings" }
] as const;

export default async function ItAdminLayout({ children }: { children: ReactNode }) {
  const auth = await getAuthContext({ requireBranchScope: false }).catch(() => null);
  if (!auth || auth.platformRole !== "it_admin") {
    redirect("/it-admin/login");
  }

  const lang = await getCurrentLanguage();

  return (
    <AppShell
      title={t(lang, "it_admin_title")}
      nav={nav.map((item) => ({
        href: item.href,
        label: "label" in item ? item.label : t(lang, item.key)
      }))}
      language={lang}
      languageLabel={t(lang, "language")}
      thaiLabel={t(lang, "thai")}
      englishLabel={t(lang, "english")}
    >
      {children}
    </AppShell>
  );
}
