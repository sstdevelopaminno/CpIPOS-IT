import { fail, ok } from "@/lib/http";
import { assertItSupportAction, guardItAdminError, requireItAdmin } from "@/lib/it-admin-guard";

export const dynamic = "force-dynamic";

function clean(value: unknown, max = 80) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function isTransient(error: unknown) {
  const message = error instanceof Error
    ? error.message
    : typeof error === "object" && error && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : String(error ?? "");
  return /timeout|timed out|fetch failed|connection|socket|gateway|warp server/i.test(message);
}

async function rpcWithRetry(
  context: Awaited<ReturnType<typeof requireItAdmin>>,
  fn: string,
  args?: Record<string, unknown>
) {
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const result = args ? await context.supabase.rpc(fn, args) : await context.supabase.rpc(fn);
      if (!result.error) return result;
      lastError = result.error;
      if (!isTransient(result.error)) return result;
    } catch (error) {
      lastError = error;
      if (!isTransient(error)) throw error;
    }

    if (attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }

  return { data: null, error: lastError };
}

export async function GET() {
  try {
    const context = await requireItAdmin();
    const result = await rpcWithRetry(context, "it_retention_maintenance_overview");

    if (result.error) {
      if (isTransient(result.error)) {
        return fail(
          "maintenance_database_temporarily_unavailable",
          "ฐานข้อมูลตอบสนองชั่วคราว กรุณารีเฟรชอีกครั้ง",
          503
        );
      }
      throw result.error;
    }

    return ok(result.data ?? {});
  } catch (error) {
    return guardItAdminError(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireItAdmin();
    assertItSupportAction(context, "การสั่งงาน Maintenance อนุญาตเฉพาะ IT Support");

    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const action = clean(body?.action);
    const confirmation = clean(body?.confirmation);

    if (confirmation !== "RUN_RETENTION") {
      return fail("maintenance_confirmation_required", "กรุณายืนยัน RUN_RETENTION", 422);
    }

    if (action === "run_operational_retention") {
      const result = await rpcWithRetry(context, "it_run_operational_cleanup_7d", {
        p_scope: "all",
        p_mode: "expired",
        p_actor_user_id: context.auth.userId,
        p_actor_role: context.auth.platformRole
      });

      if (result.error) {
        if (isTransient(result.error)) {
          return fail("maintenance_database_temporarily_unavailable", "ฐานข้อมูลตอบสนองชั่วคราว กรุณาลองใหม่", 503);
        }
        throw result.error;
      }

      return ok({ action, result: result.data });
    }

    if (action === "run_sales_retention") {
      const result = await rpcWithRetry(context, "it_invoke_sales_retention_worker");

      if (result.error) {
        if (isTransient(result.error)) {
          return fail("maintenance_database_temporarily_unavailable", "ฐานข้อมูลตอบสนองชั่วคราว กรุณาลองใหม่", 503);
        }
        throw result.error;
      }

      return ok({ action, request_id: result.data });
    }

    return fail("maintenance_action_invalid", "Maintenance action ไม่ถูกต้อง", 422);
  } catch (error) {
    return guardItAdminError(error);
  }
}
