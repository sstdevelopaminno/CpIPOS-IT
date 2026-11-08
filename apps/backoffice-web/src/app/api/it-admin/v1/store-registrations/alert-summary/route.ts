import { guardItAdminError, requireItAdmin } from "@/lib/it-admin-guard";
import { ok } from "@/lib/http";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { retryStoreRegistrationSupportEmails } from "@/lib/services/it-admin/store-registration-support-alerts";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    const { supabase } = await requireItAdmin();
    const result = await supabase.from("store_registration_requests")
      .select("id,status,store_name,created_at", { count: "exact" })
      .in("status", ["pending", "failed"])
      .order("created_at", { ascending: false })
      .limit(8);
    if (result.error) throw result.error;
    const response = ok({
      total: result.count ?? 0,
      latest: result.data ?? []
    });
    response.headers.set("cache-control", "private, no-store");
    return response;
  } catch (error) {
    return guardItAdminError(error);
  }
}

// Authenticated, rate-limited retry only. No public mail dispatch endpoint.
export async function POST() {
  try {
    const ctx = await requireItAdmin();
    const rate = await enforceRateLimit({
      namespace: "it_registration_support_email_retry",
      key: ctx.auth.userId,
      max: 4,
      windowMs: 60_000
    });
    if (!rate.ok) {
      const response = ok({ checked: 0, sent: 0, throttled: true });
      response.headers.set("cache-control", "private, no-store");
      return response;
    }
    const result = await retryStoreRegistrationSupportEmails(4);
    const response = ok(result);
    response.headers.set("cache-control", "private, no-store");
    return response;
  } catch (error) {
    return guardItAdminError(error);
  }
}
