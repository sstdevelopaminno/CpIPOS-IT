import { fail, ok } from "@/lib/http";
import { guardItAdminError, requireItAdmin } from "@/lib/it-admin-guard";
import { listItSupportChatHeads } from "@/lib/support-chat/support-chat-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    await requireItAdmin();
    const conversations = await listItSupportChatHeads();
    const unread_total = conversations.reduce((sum, row) => sum + Number(row.unread_it_count || 0), 0);
    return ok({ conversations, unread_total });
  } catch (error) {
    return guardItAdminError(error);
  }
}
