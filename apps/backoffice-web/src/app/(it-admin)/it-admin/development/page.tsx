import { redirect } from "next/navigation";
import { DevelopmentCenterConsole } from "@/components/it-admin/development-center-console";
import { getAuthContext } from "@/lib/auth-context";

export default async function DevelopmentCenterPage() {
  const auth = await getAuthContext({ requireBranchScope: false }).catch(() => null);
  if (!auth || auth.platformRole !== "it_support") redirect("/it-admin");
  return <DevelopmentCenterConsole />;
}
