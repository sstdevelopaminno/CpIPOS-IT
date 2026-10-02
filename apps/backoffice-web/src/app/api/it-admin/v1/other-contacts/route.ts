import { fail, ok } from "@/lib/http";
import { guardItAdminError, ItAdminGuardError, requireItAdmin } from "@/lib/it-admin-guard";
import { getVerifiedSupabaseAccessToken } from "@/lib/supabase-server";
import {
  callWebsiteContactPlane,
  type WebsiteContactList,
  type WebsiteContactRow
} from "@/lib/services/it-admin/website-contact-service";

export const dynamic = "force-dynamic";

async function tokenFor(userId: string) {
  const token = await getVerifiedSupabaseAccessToken(userId);
  if (!token) throw new ItAdminGuardError("unauthorized", "Authentication is required.", 401);
  return token;
}

export async function GET(request: Request) {
  try {
    const context = await requireItAdmin();
    const token = await tokenFor(context.auth.userId);
    const url = new URL(request.url);
    const data = await callWebsiteContactPlane<WebsiteContactList>(token, {
      action: "list",
      search: String(url.searchParams.get("search") ?? "").trim().slice(0,160),
      status: String(url.searchParams.get("status") ?? "all").trim().slice(0,30)
    });
    const response = ok(data);
    response.headers.set("cache-control","private, no-store");
    return response;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("website_contact_bridge_")) {
      return fail("website_contacts_unavailable","ระบบการติดต่อยังไม่พร้อมใช้งานชั่วคราว",503);
    }
    return guardItAdminError(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireItAdmin();
    const token = await tokenFor(context.auth.userId);
    const body = await request.json().catch(() => null) as {
      action?: "update" | "delete";
      id?: string;
      patch?: Record<string,unknown>;
    } | null;
    const action = String(body?.action ?? "").trim();
    const id = String(body?.id ?? "").trim();
    if (!id) return fail("id_required","ไม่พบรหัสรายการติดต่อ",422);
    if (action === "update") {
      const data = await callWebsiteContactPlane<{ row: WebsiteContactRow }>(token, { action, id, patch: body?.patch ?? {} });
      return ok(data);
    }
    if (action === "delete") {
      const data = await callWebsiteContactPlane<{ deleted: true; id: string }>(token, { action, id });
      return ok(data);
    }
    return fail("unsupported_action","คำสั่งไม่ถูกต้อง",422);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("website_contact_bridge_")) {
      return fail("website_contacts_unavailable","ระบบการติดต่อยังไม่พร้อมใช้งานชั่วคราว",503);
    }
    return guardItAdminError(error);
  }
}
