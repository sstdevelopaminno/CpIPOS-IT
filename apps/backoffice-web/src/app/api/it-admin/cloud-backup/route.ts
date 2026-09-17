import { getAuthContext } from "@/lib/auth-context";
import {
  approveDesktopCloudPurchase,
  cancelDesktopCloudEntitlement,
  listDesktopCloudAdmin,
  rejectDesktopCloudPurchase,
  renewDesktopCloudEntitlement,
  updateDesktopCloudPlan
} from "@/lib/desktop-cloud-backup";
import { fail, ok } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireItAdmin() {
  const auth = await getAuthContext({ requireBranchScope: false });
  if (auth.platformRole !== "it_admin") throw new Error("FORBIDDEN");
  return auth;
}

export async function GET() {
  try {
    await requireItAdmin();
    return ok({ ...(await listDesktopCloudAdmin()), checked_at: new Date().toISOString() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "CLOUD_ADMIN_FAILED";
    if (message === "FORBIDDEN") return fail("forbidden", "Only IT admin can manage desktop cloud backup.", 403);
    return fail("cloud_admin_failed", message, 500);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireItAdmin();
    const body = (await request.json()) as {
      action?: "approve" | "reject" | "update_plan" | "renew" | "cancel";
      requestId?: string;
      entitlementId?: string;
      planCode?: string;
      priceThb?: number | null;
      active?: boolean;
      note?: string | null;
    };
    if (body.action === "approve") {
      return ok(await approveDesktopCloudPurchase(String(body.requestId ?? ""), auth.userId, body.note ?? null));
    }
    if (body.action === "reject") {
      return ok(await rejectDesktopCloudPurchase(String(body.requestId ?? ""), auth.userId, body.note ?? null));
    }
    if (body.action === "renew") {
      return ok(await renewDesktopCloudEntitlement(String(body.entitlementId ?? ""), auth.userId, body.note ?? "Renewed by IT"));
    }
    if (body.action === "cancel") {
      return ok(await cancelDesktopCloudEntitlement(String(body.entitlementId ?? ""), auth.userId, body.note ?? "Cancelled by IT"));
    }
    if (body.action === "update_plan") {
      return ok(await updateDesktopCloudPlan(String(body.planCode ?? ""), body.priceThb, body.active));
    }
    return fail("cloud_action_invalid", "Unknown cloud backup action.", 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "CLOUD_ADMIN_FAILED";
    if (message === "FORBIDDEN") return fail("forbidden", "Only IT admin can manage desktop cloud backup.", 403);
    if (message.startsWith("CLOUD_")) return fail("cloud_action_failed", message, 400);
    return fail("cloud_admin_failed", message, 500);
  }
}
