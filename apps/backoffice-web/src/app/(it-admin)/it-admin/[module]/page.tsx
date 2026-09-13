import { notFound } from "next/navigation";
import { ItAdminModuleConsole } from "@/components/it-admin/it-admin-module-console";

const MODULES = new Set(["branches", "devices", "android", "printer", "entitlements", "incidents", "audit"] as const);
type DynamicModule = "branches" | "devices" | "android" | "printer" | "entitlements" | "incidents" | "audit";

export default async function ItAdminDynamicModulePage({ params }: { params: Promise<{ module: string }> }) {
  const { module } = await params;
  if (!MODULES.has(module as DynamicModule)) notFound();
  return <ItAdminModuleConsole module={module as DynamicModule} />;
}
