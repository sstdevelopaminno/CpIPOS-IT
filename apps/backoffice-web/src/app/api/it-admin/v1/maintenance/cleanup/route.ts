import { fail, ok } from "@/lib/http";
import { assertItSupportAction, guardItAdminError, requireItAdmin } from "@/lib/it-admin-guard";

export const dynamic = "force-dynamic";

const scopes = new Set(["all", "audit", "monitoring", "incidents", "print_history"]);
const modes = new Set(["expired", "all"]);

function clean(value: unknown, max = 40) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function bangkokCutoff7d() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const midnightBangkok = Date.parse(`${value.year}-${value.month}-${value.day}T00:00:00+07:00`);
  return new Date(midnightBangkok - 7 * 24 * 60 * 60 * 1000).toISOString();
}

async function countOld(
  supabase: Awaited<ReturnType<typeof requireItAdmin>>["supabase"],
  table: string,
  dateColumn: string,
  cutoff: string,
  configure?: (query: any) => any
) {
  let query: any = supabase.from(table).select("id", { count: "exact", head: true }).lt(dateColumn, cutoff);
  if (configure) query = configure(query);
  const result = await query;
  if (result.error) throw result.error;
  return Number(result.count ?? 0);
}

export async function GET() {
  try {
    const context = await requireItAdmin();
    const cutoff = bangkokCutoff7d();

    const [
      audit,
      snapshots,
      perf,
      logins,
      printerHistory,
      incidents,
      manualIncidents,
      printAttempts,
      printJobs,
      runs
    ] = await Promise.all([
      countOld(context.supabase, "audit_logs", "created_at", cutoff),
      countOld(context.supabase, "pos_device_health_snapshots", "created_at", cutoff),
      countOld(context.supabase, "table_management_perf_events", "created_at", cutoff),
      countOld(context.supabase, "login_attempts", "created_at", cutoff),
      countOld(context.supabase, "printer_device_history", "created_at", cutoff),
      countOld(context.supabase, "pos_device_incidents", "resolved_at", cutoff, (q) => q.not("resolved_at", "is", null)),
      countOld(context.supabase, "it_manual_incidents", "resolved_at", cutoff, (q) => q.not("resolved_at", "is", null)),
      countOld(context.supabase, "print_job_attempts", "created_at", cutoff),
      countOld(context.supabase, "print_jobs", "created_at", cutoff, (q) => q.in("status", ["printed", "failed"])),
      context.supabase.from("it_data_cleanup_runs")
        .select("id,scope,mode,cutoff_at,source,actor_user_id,actor_role,deleted_counts,created_at")
        .order("created_at", { ascending: false })
        .limit(20)
    ]);

    if (runs.error) throw runs.error;

    return ok({
      retention_days: 7,
      timezone: "Asia/Bangkok",
      cutoff_at: cutoff,
      preview: {
        audit: { audit_logs: audit, total: audit },
        monitoring: {
          pos_device_health_snapshots: snapshots,
          table_management_perf_events: perf,
          login_attempts: logins,
          printer_device_history: printerHistory,
          total: snapshots + perf + logins + printerHistory
        },
        incidents: {
          pos_device_incidents: incidents,
          it_manual_incidents: manualIncidents,
          total: incidents + manualIncidents
        },
        print_history: {
          print_job_attempts: printAttempts,
          print_jobs: printJobs,
          total: printAttempts + printJobs
        }
      },
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

    const result = await context.supabase.rpc("it_run_operational_cleanup_7d", {
      p_scope: scope,
      p_mode: mode,
      p_actor_user_id: context.auth.userId,
      p_actor_role: context.auth.platformRole
    });
    if (result.error) throw result.error;

    return ok(result.data ?? { ok: true, scope, mode });
  } catch (error) {
    return guardItAdminError(error);
  }
}
