import { redirect } from "next/navigation";
import { ItSystemUsersConsole } from "@/components/it-admin/it-system-users-console";
import { getAuthContext } from "@/lib/auth-context";

export default async function UserSettingsPage() {
  const auth = await getAuthContext({ requireBranchScope: false }).catch(() => null);
  if (!auth) redirect("/it-admin/login");
  if (auth.platformRole !== "it_support") redirect("/it-admin/settings/email-footer");
  return <ItSystemUsersConsole />;
}
