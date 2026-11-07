import "server-only";

import { ItAdminGuardError } from "@/lib/it-admin-guard";
import { getPrimarySupabaseServiceClient } from "@/lib/supabase-admin";

export type NewsStatus = "draft" | "published" | "archived";
export type NewsEditor = {
  title: string;
  body: string;
  image_url: string | null;
  link_url: string | null;
  target_tenant_id: string | null;
  status: NewsStatus;
};

export const NEWS_SELECT = "id,title,body,image_url,link_url,target_tenant_id,status,published_at,created_by,updated_by,created_at,updated_at";
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function safeHttps(value: unknown, max: number) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return null;
  if (text.length > max) throw new ItAdminGuardError("url_too_long", "URL exceeds the maximum length.", 422);
  let url: URL;
  try { url = new URL(text); }
  catch { throw new ItAdminGuardError("invalid_url", "Only absolute HTTPS links are permitted.", 422); }
  if (url.protocol !== "https:" || url.username || url.password || !url.hostname) {
    throw new ItAdminGuardError("invalid_url", "Only absolute HTTPS links are permitted.", 422);
  }
  return url.toString();
}

function safeImageUrl(value: unknown) {
  const url = safeHttps(value, 1000);
  if (!url) return null;
  const db = getPrimarySupabaseServiceClient();
  const testUrl = db.storage.from("platform-news").getPublicUrl("__prefix__").data.publicUrl;
  const prefix = testUrl.slice(0, -"__prefix__".length);
  if (!url.startsWith(prefix)) {
    throw new ItAdminGuardError("invalid_news_image", "Upload the news image through the IT image upload form.", 422);
  }
  return url;
}

export async function validateNewsEditor(raw: unknown): Promise<NewsEditor> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ItAdminGuardError("invalid_news_body", "Announcement data is required.", 422);
  }
  const body = raw as Record<string, unknown>;
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const description = typeof body.body === "string" ? body.body.trim() : "";
  if (title.length < 2 || title.length > 180) {
    throw new ItAdminGuardError("news_title_required", "Enter a title between 2 and 180 characters.", 422);
  }
  if (description.length < 2 || description.length > 10000) {
    throw new ItAdminGuardError("news_body_required", "Enter announcement details between 2 and 10000 characters.", 422);
  }
  if (body.status !== "draft" && body.status !== "published") {
    throw new ItAdminGuardError("invalid_news_status", "Choose draft or published.", 422);
  }
  const target = typeof body.target_tenant_id === "string" ? body.target_tenant_id.trim() : "";
  if (target && !UUID.test(target)) {
    throw new ItAdminGuardError("invalid_target_tenant", "A tenant ID must be a UUID.", 422);
  }
  if (target) {
    const result = await getPrimarySupabaseServiceClient().from("tenants")
      .select("id").eq("id", target).maybeSingle();
    if (result.error) throw new Error("target_tenant_lookup_failed");
    if (!result.data) throw new ItAdminGuardError("target_tenant_not_found", "Target tenant not found.", 422);
  }
  return {
    title, body: description,
    image_url: safeImageUrl(body.image_url),
    link_url: safeHttps(body.link_url, 1000),
    target_tenant_id: target || null,
    status: body.status
  };
}
