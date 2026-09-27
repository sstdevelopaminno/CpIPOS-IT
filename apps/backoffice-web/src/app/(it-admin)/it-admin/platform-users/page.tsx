import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth-context";

export default async function PlatformUsersPage() {
  const auth = await getAuthContext({ requireBranchScope: false }).catch(() => null);
  if (!auth) redirect("/it-admin/login");
  if (auth.platformRole !== "it_admin" && auth.platformRole !== "it_support") redirect("/it-admin/login");
  redirect("/it-admin/pos-users");
}
