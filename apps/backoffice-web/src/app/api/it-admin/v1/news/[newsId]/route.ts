import { appendAuditLog } from "@/lib/audit-log";
import { guardItAdminError, ItAdminGuardError, requireItAdmin } from "@/lib/it-admin-guard";
import { ok } from "@/lib/http";
import { NEWS_SELECT, UUID, validateNewsEditor } from "@/lib/platform-news-admin";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ newsId: string }> };

async function getId(context: Context) {
  const { newsId } = await context.params;
  if (!UUID.test(newsId)) throw new ItAdminGuardError("invalid_news_id", "Invalid announcement ID.", 422);
  return newsId;
}

export async function GET(_req: Request, ctx: Context) {
  try {
    const { supabase } = await requireItAdmin();
    const id = await getId(ctx);
    const result = await supabase.from("platform_news_posts").select(NEWS_SELECT)
      .eq("id", id).neq("status", "archived").maybeSingle();
    if (result.error) throw new Error("news_lookup_failed");
    if (!result.data) throw new ItAdminGuardError("news_not_found", "Announcement not found.", 404);
    const response = ok({ item: result.data });
    response.headers.set("cache-control", "private, no-store");
    return response;
  } catch (error) { return guardItAdminError(error); }
}

export async function PATCH(req: Request, ctx: Context) {
  try {
    const { auth, supabase, requestMeta } = await requireItAdmin();
    const id = await getId(ctx);
    const existing = await supabase.from("platform_news_posts").select(NEWS_SELECT)
      .eq("id", id).neq("status", "archived").maybeSingle();
    if (existing.error) throw new Error("news_lookup_failed");
    if (!existing.data) throw new ItAdminGuardError("news_not_found", "Announcement not found.", 404);
    const editor = await validateNewsEditor(await req.json().catch(() => null));
    const now = new Date().toISOString();
    const updated = await supabase.from("platform_news_posts")
      .update({
        ...editor,
        updated_by: auth.userId, updated_at: now,
        published_at: editor.status === "published" ? (existing.data.published_at ?? now) : null
      }).eq("id", id).neq("status", "archived").select(NEWS_SELECT).single();
    if (updated.error || !updated.data) throw new Error("news_update_failed");
    await appendAuditLog({
      actorUserId: auth.userId, actorRole: auth.platformRole,
      action: "platform_news_updated", module: "it_admin",
      targetTable: "platform_news_posts", targetId: id,
      beforeData: { title: existing.data.title, status: existing.data.status },
      afterData: { title: editor.title, status: editor.status, target_tenant_id: editor.target_tenant_id },
      ipAddress: requestMeta.ipAddress ?? undefined, userAgent: requestMeta.userAgent ?? undefined
    });
    return ok({ item: updated.data });
  } catch (error) { return guardItAdminError(error); }
}

export async function DELETE(_req: Request, ctx: Context) {
  try {
    const { auth, supabase, requestMeta } = await requireItAdmin();
    const id = await getId(ctx);
    const result = await supabase.from("platform_news_posts")
      .update({ status: "archived", updated_by: auth.userId, updated_at: new Date().toISOString() })
      .eq("id", id).neq("status", "archived").select("id,title").maybeSingle();
    if (result.error) throw new Error("news_archive_failed");
    if (!result.data) throw new ItAdminGuardError("news_not_found", "Announcement not found.", 404);
    await appendAuditLog({
      actorUserId: auth.userId, actorRole: auth.platformRole,
      action: "platform_news_archived", module: "it_admin",
      targetTable: "platform_news_posts", targetId: id,
      afterData: { id, archived: true },
      ipAddress: requestMeta.ipAddress ?? undefined, userAgent: requestMeta.userAgent ?? undefined
    });
    return ok({ id, archived: true });
  } catch (error) { return guardItAdminError(error); }
}
