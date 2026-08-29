import { AppShell, type AppShellNavItem } from "@/components/layout/app-shell";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth-context";
import { getCurrentLanguage, t, type Language } from "@/lib/i18n";

const copy = {
  th: {
    subtitle: "ระบบหลังบ้านบริษัท",
    role: "ผู้ดูแล IT",
    unavailable: "เร็ว ๆ นี้",
    groups: {
      overview: "ภาพรวม",
      customer: "ลูกค้าและร้านค้า",
      devices: "อุปกรณ์และแอป",
      commercial: "แพ็กเกจและสิทธิ์",
      operations: "ปฏิบัติการ",
      system: "ระบบ"
    },
    items: {
      dashboard: "แดชบอร์ด",
      tenants: "Tenants / Stores",
      provisioning: "เปิดร้านใหม่",
      branches: "สาขา",
      users: "ผู้ใช้ / บทบาท / สิทธิ์",
      devices: "Devices / MDM",
      android: "Android App Rollout",
      printer: "Printer / Print Agent",
      packages: "แพ็กเกจ / Subscription",
      entitlements: "Feature Entitlements",
      monitoring: "Monitoring",
      incidents: "Incidents",
      audit: "Audit Logs",
      settings: "ตั้งค่า / Security"
    }
  },
  en: {
    subtitle: "Company backoffice",
    role: "IT Administrator",
    unavailable: "Soon",
    groups: {
      overview: "Overview",
      customer: "Customers & Stores",
      devices: "Devices & Apps",
      commercial: "Plans & Access",
      operations: "Operations",
      system: "System"
    },
    items: {
      dashboard: "Dashboard",
      tenants: "Tenants / Stores",
      provisioning: "Store Provisioning",
      branches: "Branches",
      users: "Users / Roles / Permissions",
      devices: "Devices / MDM",
      android: "Android App Rollout",
      printer: "Printer / Print Agent",
      packages: "Packages / Subscriptions",
      entitlements: "Feature Entitlements",
      monitoring: "Monitoring",
      incidents: "Incidents",
      audit: "Audit Logs",
      settings: "Settings / Security"
    }
  }
} as const;

function buildNavigation(lang: Language): AppShellNavItem[] {
  const text = copy[lang];
  return [
    { href: "/it-admin", label: text.items.dashboard, group: text.groups.overview, icon: "dashboard" },
    { href: "/it-admin/tenants", label: text.items.tenants, group: text.groups.customer, icon: "store" },
    { href: "/it-admin/store-provisioning", label: text.items.provisioning, group: text.groups.customer, icon: "provision" },
    { href: "/it-admin/branches", label: text.items.branches, group: text.groups.customer, icon: "branch" },
    { href: "/it-admin/platform-users", label: text.items.users, group: text.groups.customer, icon: "users" },
    { href: "/it-admin/devices", label: text.items.devices, group: text.groups.devices, icon: "device" },
    { href: "/it-admin/android", label: text.items.android, group: text.groups.devices, icon: "android" },
    { href: "/it-admin/printer", label: text.items.printer, group: text.groups.devices, icon: "printer" },
    { href: "/it-admin/packages", label: text.items.packages, group: text.groups.commercial, icon: "package" },
    { href: "/it-admin/entitlements", label: text.items.entitlements, group: text.groups.commercial, icon: "entitlement" },
    { href: "/it-admin/monitoring", label: text.items.monitoring, group: text.groups.operations, icon: "monitoring" },
    { href: "/it-admin/incidents", label: text.items.incidents, group: text.groups.operations, icon: "incident" },
    { href: "/it-admin/audit", label: text.items.audit, group: text.groups.operations, icon: "audit" },
    { href: "/it-admin/settings/language", label: text.items.settings, group: text.groups.system, icon: "settings" }
  ];
}

export default async function ItAdminLayout({ children }: { children: ReactNode }) {
  const auth = await getAuthContext({ requireBranchScope: false }).catch(() => null);
  if (!auth || auth.platformRole !== "it_admin") redirect("/it-admin/login");

  const lang = await getCurrentLanguage();
  const text = copy[lang];
  return (
    <AppShell
      title={t(lang, "it_admin_title")}
      subtitle={text.subtitle}
      nav={buildNavigation(lang)}
      language={lang}
      languageLabel={t(lang, "language")}
      thaiLabel={t(lang, "thai")}
      englishLabel={t(lang, "english")}
      roleLabel={text.role}
      unavailableLabel={text.unavailable}
    >
      {children}
    </AppShell>
  );
}
