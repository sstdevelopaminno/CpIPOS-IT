import { redirect } from "next/navigation";
import { SupportChatConsole } from "@/components/it-admin/support-chat-console";
import { getAuthContext } from "@/lib/auth-context";

export default async function SupportChatHistoryPage() {
  const auth = await getAuthContext({ requireBranchScope: false }).catch(() => null);
  if (!auth || !["it_admin", "it_support"].includes(auth.platformRole)) redirect("/it-admin");
  return <SupportChatConsole historyOnly />;
}
