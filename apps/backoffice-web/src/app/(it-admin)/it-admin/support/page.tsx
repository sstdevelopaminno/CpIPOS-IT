import { SupportCenterConsole } from "@/components/it-admin/support-center-console";
import { getCurrentLanguage } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function ItAdminSupportPage() {
  const language = await getCurrentLanguage();
  return <SupportCenterConsole language={language} />;
}
