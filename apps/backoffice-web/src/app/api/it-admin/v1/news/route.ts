import { appendAuditLog } from "@/lib/audit-log";
import { guardItAdminError, requireItAdmin } from "@/lib/it-admin-guard";
import { ok } from "@/lib/http";
import { NEWS_SELECT, validateNewsEditor } from "@/lib/platform-news-admin";
import { dispatchNativeNewsFcm } from "@/lib/native-news-fcm-push";
import { after } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const { supabase } = await requireItAdmin();
    const result = await supabase.from("platform_news_posts")
      .select(NEWS_SELECT).neq("status", "archived")
      .order("created_at", { ascending: false }).limit(200);
    if (result.error) throw new Error("platform_news_list_failed");
    const response = ok({ items: result.data ?? [] });
    response.headers.set("cache-control", "private, no-store");
    return response;
  } catch (error) { return guardItAdminError(error); }
}

export async function POST(request: Request) {
  try {
    const { auth, supabase, requestMeta } = await requireItAdmin();
    const editor = await validateNewsEditor(await request.json().catch(() => null));
    const now = new Date().toISOString();
    const result = await supabase.from("platform_news_posts")
      .insert({
        ...editor, published_at: editor.status === "published" ? now : null,
        created_by: auth.userId, updated_by: auth.userId
      }).select(NEWS_SELECT).single();
    if (result.error || !result.data) throw new Error("platform_news_create_failed");
    await appendAuditLog({
      actorUserId: auth.userId, actorRole: auth.platformRole,
      action: "platform_news_created", module: "it_admin",
      targetTable: "platform_news_posts", targetId: result.data.id,
      afterData: { id: result.data.id, title: editor.title, status: editor.status, target_tenant_id: editor.target_tenant_id },
      ipAddress: requestMeta.ipAddress ?? undefined, userAgent: requestMeta.userAgent ?? undefined
    });
    if (editor.status === "published") {
      after(() => dispatchNativeNewsFcm(result.data));
    }
    const response = ok({ item: result.data }, 201);
    response.headers.set("cache-control", "private, no-store");
    return response;
  } catch (error) { return guardItAdminError(error); }
}
