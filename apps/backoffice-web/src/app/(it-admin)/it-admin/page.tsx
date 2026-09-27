import { redirect } from "next/navigation";
import { ItAdminDashboard } from "@/components/it-admin/it-admin-dashboard";
import { getAuthContext } from "@/lib/auth-context";
import { getCurrentLanguage } from "@/lib/i18n";

export default async function ItAdminHomePage() {
  const auth = await getAuthContext({ requireBranchScope: false }).catch(() => null);
  if (!auth) redirect("/it-admin/login");
  if (auth.platformRole === "it_admin") redirect("/it-admin/tenants");
  const lang = await getCurrentLanguage();
  return <ItAdminDashboard language={lang} />;
}
