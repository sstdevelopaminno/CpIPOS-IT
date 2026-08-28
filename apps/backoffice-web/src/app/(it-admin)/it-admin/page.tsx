import { ItAdminDashboard } from "@/components/it-admin/it-admin-dashboard";
import { getCurrentLanguage } from "@/lib/i18n";

export default async function ItAdminHomePage() {
  const lang = await getCurrentLanguage();
  return <ItAdminDashboard language={lang} />;
}
