import { TenantDirectoryConsole } from "@/components/it-admin/tenant-directory-console";
import { getCurrentLanguage } from "@/lib/i18n";

export default async function TenantsPage() {
  const language = await getCurrentLanguage();
  return <TenantDirectoryConsole language={language} />;
}
