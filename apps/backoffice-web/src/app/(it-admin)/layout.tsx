import { AppShell, type AppShellNavItem } from "@/components/layout/app-shell";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth-context";
import { getCurrentLanguage, t, type Language } from "@/lib/i18n";
import { SupportChatNotifier } from "@/components/it-admin/support-chat-notifier";
import { SupportRequestNotifier } from "@/components/it-admin/support-request-notifier";
import "./it-admin-scroll.css";

const copy = {
  th: {
    subtitle: "ระบบหลังบ้านบริษัท",
    roleAdmin: "IT Admin",
    roleSupport: "IT Support",
    unavailable: "เร็ว ๆ นี้",
    groups: {
      overview: "ภาพรวม",
      customer: "ลูกค้าและร้านค้า",
      devices: "อุปกรณ์และแอป",
      commercial: "แพ็กเกจและสิทธิ์",
      operations: "ปฏิบัติการ",
      development: "การพัฒนา",
      system: "ระบบ"
    },
    items: {
      dashboard: "แดชบอร์ด",
      tenants: "Tenants / Stores",
      provisioning: "เปิดร้านใหม่",
      registrations: "คำขอเปิดร้าน",
      branches: "สาขา",
      users: "ผู้ใช้งาน / สิทธิ์ POS",
      devices: "Devices / MDM",
      android: "Android App Rollout",
      printer: "เครื่องพิมพ์ / Print Agent",
      packages: "แพ็กเกจ / Subscription",
      subscriptionPayments: "ตารางชำระแพ็กเกจ",
      desktopLicense: "ออก License POS Desktop",
      entitlements: "Feature Entitlements",
      monitoring: "มอนิเตอร์ระบบ",
      incidents: "เหตุขัดข้อง",
      audit: "บันทึกตรวจสอบ",
      emergencyBroadcast: "ส่งข้อความฉุกเฉิน",
      supportChat: "แชท",
      customerRequests: "คำขอจากลูกค้า",
      supportChatInbox: "กล่องสนทนา",
      supportHistory: "สมุดบันทึกแชท",
      development: "Development / Source Control",
      settings: "ตั้งค่า / Security",
      settingsUsers: "ตั้งค่า USER ใช้งาน",
      settingsEmailFooter: "ตั้งค่า ข้อความท้ายอีเมล์",
      settingsLanguage: "ตั้งค่าภาษา"
    }
  },
  en: {
    subtitle: "Company backoffice",
    roleAdmin: "IT Admin",
    roleSupport: "IT Support",
    unavailable: "Soon",
    groups: {
      overview: "Overview",
      customer: "Customers & Stores",
      devices: "Devices & Apps",
      commercial: "Plans & Access",
      operations: "Operations",
      development: "Development",
      system: "System"
    },
    items: {
      dashboard: "Dashboard",
      tenants: "Tenants / Stores",
      provisioning: "Store Provisioning",
      registrations: "Store Requests",
      branches: "Branches",
      users: "POS Users / Permissions",
      devices: "Devices / MDM",
      android: "Android App Rollout",
      printer: "Printer / Print Agent",
      packages: "Packages / Subscriptions",
      subscriptionPayments: "Subscription Payments",
      desktopLicense: "Issue POS Desktop License",
      entitlements: "Feature Entitlements",
      monitoring: "Monitoring",
      incidents: "Incidents",
      audit: "Audit Logs",
      emergencyBroadcast: "Emergency Broadcast",
      supportChat: "Chat",
      customerRequests: "Customer Requests",
      supportChatInbox: "Inbox",
      supportHistory: "Chat Notebook",
      development: "Development / Source Control",
      settings: "Settings / Security",
      settingsUsers: "User Settings",
      settingsEmailFooter: "Email Footer Settings",
      settingsLanguage: "Language Settings"
    }
  }
} as const;

function buildNavigation(lang: Language, role: "it_admin" | "it_support"): AppShellNavItem[] {
  const text = copy[lang];

  const settingsChildren = role === "it_support"
    ? [
        { href: "/it-admin/settings/users", label: text.items.settingsUsers },
        { href: "/it-admin/settings/email-footer", label: text.items.settingsEmailFooter },
        { href: "/it-admin/settings/language", label: text.items.settingsLanguage }
      ]
    : [
        { href: "/it-admin/settings/email-footer", label: text.items.settingsEmailFooter },
        { href: "/it-admin/settings/language", label: text.items.settingsLanguage }
      ];

  const settings: AppShellNavItem = {
    href: "/it-admin/settings/email-footer",
    label: text.items.settings,
    group: text.groups.system,
    icon: "settings",
    children: settingsChildren
  };

  if (role === "it_admin") {
    return [
      { href: "/it-admin/tenants", label: text.items.tenants, group: text.groups.customer, icon: "store" },
      { href: "/it-admin/store-provisioning", label: text.items.provisioning, group: text.groups.customer, icon: "provision" },
      { href: "/it-admin/store-registrations", label: text.items.registrations, group: text.groups.customer, icon: "provision" },
      { href: "/it-admin/branches", label: text.items.branches, group: text.groups.customer, icon: "branch" },
      { href: "/it-admin/pos-users", label: text.items.users, group: text.groups.customer, icon: "users" },
      { href: "/it-admin/subscription-payments", label: text.items.subscriptionPayments, group: text.groups.commercial, icon: "package" },
      { href: "/it-admin/license-issuer", label: text.items.desktopLicense, group: text.groups.commercial, icon: "entitlement" },
      { href: "/it-admin/support-chat", label: text.items.supportChat, group: text.groups.operations, icon: "chat",
        children: [
          { href: "/it-admin/support-chat", label: text.items.supportChatInbox },
          { href: "/it-admin/support-chat/history", label: text.items.supportHistory }
        ] },
      settings
    ];
  }

  return [
    { href: "/it-admin", label: text.items.dashboard, group: text.groups.overview, icon: "dashboard" },
    { href: "/it-admin/tenants", label: text.items.tenants, group: text.groups.customer, icon: "store" },
    { href: "/it-admin/store-provisioning", label: text.items.provisioning, group: text.groups.customer, icon: "provision" },
    { href: "/it-admin/store-registrations", label: text.items.registrations, group: text.groups.customer, icon: "provision" },
    { href: "/it-admin/branches", label: text.items.branches, group: text.groups.customer, icon: "branch" },
    { href: "/it-admin/pos-users", label: text.items.users, group: text.groups.customer, icon: "users" },
    { href: "/it-admin/devices", label: text.items.devices, group: text.groups.devices, icon: "device" },
    { href: "/it-admin/android", label: text.items.android, group: text.groups.devices, icon: "android" },
    { href: "/it-admin/printer", label: text.items.printer, group: text.groups.devices, icon: "printer" },
    { href: "/it-admin/packages", label: text.items.packages, group: text.groups.commercial, icon: "package" },
    { href: "/it-admin/subscription-payments", label: text.items.subscriptionPayments, group: text.groups.commercial, icon: "package" },
    { href: "/it-admin/license-issuer", label: text.items.desktopLicense, group: text.groups.commercial, icon: "entitlement" },
    { href: "/it-admin/entitlements", label: text.items.entitlements, group: text.groups.commercial, icon: "entitlement" },
    { href: "/it-admin/monitoring", label: text.items.monitoring, group: text.groups.operations, icon: "monitoring" },
    { href: "/it-admin/incidents", label: text.items.incidents, group: text.groups.operations, icon: "incident" },
    { href: "/it-admin/audit", label: text.items.audit, group: text.groups.operations, icon: "audit" },
    { href: "/it-admin/emergency-broadcast", label: text.items.emergencyBroadcast, group: text.groups.operations, icon: "broadcast" },
    { href: "/it-admin/support-chat", label: text.items.supportChat, group: text.groups.operations, icon: "chat",
        children: [
          { href: "/it-admin/support-chat", label: text.items.supportChatInbox },
          { href: "/it-admin/support-chat/history", label: text.items.supportHistory }
        ] },
    { href: "/it-admin/development", label: text.items.development, group: text.groups.development, icon: "code" },
    settings
  ];
}

export default async function ItAdminLayout({ children }: { children: ReactNode }) {
  const auth = await getAuthContext({ requireBranchScope: false }).catch(() => null);
  if (!auth || (auth.platformRole !== "it_admin" && auth.platformRole !== "it_support")) redirect("/it-admin/login");

  const lang = await getCurrentLanguage();
  const text = copy[lang];
  return (
    <AppShell
      title={t(lang, "it_admin_title")}
      subtitle={text.subtitle}
      nav={buildNavigation(lang, auth.platformRole)}
      language={lang}
      languageLabel={t(lang, "language")}
      thaiLabel={t(lang, "thai")}
      englishLabel={t(lang, "english")}
      roleLabel={auth.platformRole === "it_support" ? text.roleSupport : text.roleAdmin}
      unavailableLabel={text.unavailable}
      accessRole={auth.platformRole}
      restrictToNavigation={auth.platformRole === "it_admin"}
    >
      <SupportChatNotifier />
      <SupportRequestNotifier />
      {children}
    </AppShell>
  );
}
