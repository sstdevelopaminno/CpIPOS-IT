import { ItMaintenanceConsole } from "@/components/it-admin/it-maintenance-console";
import { getCurrentLanguage } from "@/lib/i18n";

export default async function MaintenancePage() {
  const language = await getCurrentLanguage();
  return <ItMaintenanceConsole language={language} />;
}
