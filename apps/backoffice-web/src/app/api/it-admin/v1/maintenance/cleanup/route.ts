import { fail, ok } from "@/lib/http";
import { assertItSupportAction, guardItAdminError, requireItAdmin } from "@/lib/it-admin-guard";

export const dynamic = "force-dynamic";

const scopes = new Set(["all", "audit", "monitoring", "incidents", "print_history"]);
const modes = new Set(["expired", "all"]);

function clean(value: unknown, max = 40) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function isTransientDatabaseError(error: unknown) {
  const message = error instanceof Error
    ? error.message
    : typeof error === "object" && error && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : String(error ?? "");
  return /timeout|timed out|fetch failed|connection|socket|gateway|warp server/i.test(message);
}

async function runCleanupRpc(
  context: Awaited<ReturnType<typeof requireItAdmin>>,
  args: Record<string, unknown>
) {
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const result = await context.supabase.rpc("it_run_operational_cleanup_7d", args);
      if (!result.error) return result;
      lastError = result.error;
      if (!isTransientDatabaseError(result.error)) return result;
    } catch (error) {
      lastError = error;
      if (!isTransientDatabaseError(error)) throw error;
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
    const [previewResult, runs] = await Promise.all([
      context.supabase.rpc("it_operational_cleanup_preview_7d"),
      context.supabase.from("it_data_cleanup_runs")
        .select("id,scope,mode,cutoff_at,source,actor_user_id,actor_role,deleted_counts,created_at")
        .order("created_at", { ascending: false })
        .limit(20)
    ]);

    if (previewResult.error) throw previewResult.error;
    if (runs.error) throw runs.error;

    const preview = (previewResult.data ?? {}) as Record<string, unknown>;
    return ok({
      ...preview,
      recent_runs: runs.data ?? []
    });
  } catch (error) {
    return guardItAdminError(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireItAdmin();
    assertItSupportAction(context, "การล้างข้อมูลย้อนหลังอนุญาตเฉพาะ IT Support");

    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const scope = clean(body?.scope) || "all";
    const mode = clean(body?.mode) || "expired";
    const confirmation = clean(body?.confirmation, 40);

    if (!scopes.has(scope)) return fail("cleanup_scope_invalid", "ขอบเขตการล้างข้อมูลไม่ถูกต้อง", 422);
    if (!modes.has(mode)) return fail("cleanup_mode_invalid", "โหมดการล้างข้อมูลไม่ถูกต้อง", 422);
    if (mode === "all" && confirmation !== "DELETE") {
      return fail("cleanup_confirmation_required", "พิมพ์ DELETE เพื่อยืนยันการลบทั้งหมด", 422);
    }
    if (mode === "expired" && confirmation !== "CLEANUP_7D") {
      return fail("cleanup_confirmation_required", "กรุณายืนยัน CLEANUP_7D", 422);
    }

    const result = await runCleanupRpc(context, {
      p_scope: scope,
      p_mode: mode,
      p_actor_user_id: context.auth.userId,
      p_actor_role: context.auth.platformRole
    });

    if (result.error) {
      if (isTransientDatabaseError(result.error)) {
        return fail(
          "cleanup_database_temporarily_unavailable",
          "ฐานข้อมูลตอบสนองชั่วคราว กรุณาลองใหม่อีกครั้ง",
          503
        );
      }
      throw result.error;
    }

    return ok(result.data ?? { ok: true, scope, mode });
  } catch (error) {
    return guardItAdminError(error);
  }
}
