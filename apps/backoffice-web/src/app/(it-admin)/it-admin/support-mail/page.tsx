import { redirect } from "next/navigation";
import { SupportMailConsole } from "@/components/it-admin/support-mail-console";
import { getAuthContext } from "@/lib/auth-context";

export default async function SupportMailPage() {
  const auth = await getAuthContext({ requireBranchScope: false }).catch(() => null);
  if (!auth || !["it_admin", "it_support"].includes(auth.platformRole)) redirect("/it-admin");
  return <SupportMailConsole />;
}
