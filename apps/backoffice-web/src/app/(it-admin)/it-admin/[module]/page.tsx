import { notFound } from "next/navigation";
import { ItAdminModuleConsole } from "@/components/it-admin/it-admin-module-console";
import { ItAdminIncidentsConsole } from "@/components/it-admin/it-admin-incidents-console";
import { ItAdminAuditConsole } from "@/components/it-admin/it-admin-audit-console";
import { ItAdminPrinterConsole } from "@/components/it-admin/it-admin-printer-console";
import { ItAdminDevicesConsole } from "@/components/it-admin/it-admin-devices-console";
import { getCurrentLanguage } from "@/lib/i18n";

const MODULES = new Set(["branches", "devices", "android", "printer", "entitlements", "incidents", "audit"] as const);
type DynamicModule = "branches" | "devices" | "android" | "printer" | "entitlements" | "incidents" | "audit";

export default async function ItAdminDynamicModulePage({ params }: { params: Promise<{ module: string }> }) {
  const { module } = await params;
  if (!MODULES.has(module as DynamicModule)) notFound();
  const language = await getCurrentLanguage();
  if (module === "incidents") return <ItAdminIncidentsConsole language={language} />;
  if (module === "audit") return <ItAdminAuditConsole language={language} />;
  if (module === "printer") return <ItAdminPrinterConsole language={language} />;
  if (module === "devices") return <ItAdminDevicesConsole language={language} />;
  return <ItAdminModuleConsole module={module as DynamicModule} />;
}
