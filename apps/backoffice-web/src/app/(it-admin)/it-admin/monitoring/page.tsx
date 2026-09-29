import { ItAdminMonitoringConsole } from "@/components/it-admin/it-admin-monitoring-console";
import { getCurrentLanguage } from "@/lib/i18n";

export default async function MonitoringPage() {
  const language = await getCurrentLanguage();
  return <ItAdminMonitoringConsole language={language} />;
}
