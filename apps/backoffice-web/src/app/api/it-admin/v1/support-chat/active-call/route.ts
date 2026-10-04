import { ok } from "@/lib/http";
import { guardItAdminError, requireItAdmin } from "@/lib/it-admin-guard";
import { callSupportChat, issueItSupportChatBridge } from "@/lib/support-chat/support-chat-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const auth = await requireItAdmin();
    const bridge = await issueItSupportChatBridge(auth);
    const data = await callSupportChat<{
      call: Record<string, unknown> | null;
      conversation: Record<string, unknown> | null;
      head: Record<string, unknown> | null;
    }>(bridge, "get_it_voice_call");
    const response = ok(data);
    response.headers.set("cache-control", "private, no-store");
    return response;
  } catch (error) {
    return guardItAdminError(error);
  }
}
