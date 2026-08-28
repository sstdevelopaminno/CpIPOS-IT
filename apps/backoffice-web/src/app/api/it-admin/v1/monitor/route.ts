import { mapWithConcurrency } from "@/lib/async-batch";
import { fail, ok } from "@/lib/http";
import { guardItAdminError, requireItAdmin } from "@/lib/it-admin-guard";
import { POS_GUARDS } from "@/lib/pos-resilience";
import { readThroughRuntimeCache } from "@/lib/route-runtime-cache";

function isSchemaMissing(message: string) {
  const normalized = message.toLowerCase();
  return normalized.includes("does not exist") || normalized.includes("undefined column") || normalized.includes("pgrst");
}

function parseMinutes(searchParams: URLSearchParams) {
  const value = Number(searchParams.get("minutes") ?? POS_GUARDS.deadLetterWindowMinutes);
  if (!Number.isFinite(value)) return POS_GUARDS.deadLetterWindowMinutes;
  return Math.max(5, Math.min(1440, Math.trunc(value)));
}

function normalizeStatusCode(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 100 && parsed <= 599 ? Math.trunc(parsed) : null;
}

function normalizeRouteName(value: unknown) {
  return typeof value === "string" && value.startsWith("/") ? value.slice(0, 160) : "unknown";
}

export async function GET(request: Request) {
  const startedAt = Date.now();

  try {
    const { supabase, auth } = await requireItAdmin();
    const { searchParams } = new URL(request.url);
    const minutes = parseMinutes(searchParams);
    const requestedBranchId = String(searchParams.get("branch_id") ?? "").trim() || null;
    const cacheKey = `it-admin-pos-monitor:${auth.userId}:${minutes}:${requestedBranchId ?? "all"}`;

    const { value: payload, source } = await readThroughRuntimeCache({
      key: cacheKey,
      ttlMs: 5_000,
      loader: async () => {
        const staleSince = new Date(Date.now() - POS_GUARDS.staleQueuedMinutes * 60_000).toISOString();
        const windowSince = new Date(Date.now() - minutes * 60_000).toISOString();

        let branchQuery = supabase
          .from("branches")
          .select("id,name,tenant_id")
          .eq("is_active", true)
          .order("name")
          .limit(250);
        if (requestedBranchId) branchQuery = branchQuery.eq("id", requestedBranchId);

        const { data: branches, error: branchError } = await branchQuery;
        if (branchError) throw new Error(`branches_query_failed:${branchError.message}`);

        const tenantIds = [...new Set((branches ?? []).map((row) => String(row.tenant_id)).filter(Boolean))];
        const tenantResult = tenantIds.length
          ? await supabase.from("tenants").select("id,code,name").in("id", tenantIds)
          : { data: [], error: null };
        if (tenantResult.error) throw new Error(`tenants_query_failed:${tenantResult.error.message}`);

        const tenantMap = new Map(
          (tenantResult.data ?? []).map((tenant) => [
            String(tenant.id),
            { code: String(tenant.code ?? ""), name: String(tenant.name ?? "") }
          ])
        );
        const degradedSources = new Set<string>();

        const safeCount = async (
          sourceName: string,
          query: PromiseLike<{ count: number | null; error: { message: string } | null }>
        ) => {
          const result = await query;
          if (result.error) {
            if (isSchemaMissing(result.error.message)) {
              degradedSources.add(sourceName);
              return 0;
            }
            throw new Error(`${sourceName}_query_failed:${result.error.message}`);
          }
          return result.count ?? 0;
        };

        const items = await mapWithConcurrency({
          items: branches ?? [],
          concurrency: 4,
          worker: async (branch) => {
            const branchId = String(branch.id);
            const tenantId = String(branch.tenant_id);

            const readPerf = async () => {
              const { data, error } = await supabase
                .from("audit_logs")
                .select("metadata")
                .eq("tenant_id", tenantId)
                .eq("branch_id", branchId)
                .eq("action", "pos_route_perf")
                .gt("created_at", windowSince)
                .order("created_at", { ascending: false })
                .limit(500);

              if (error) {
                if (isSchemaMissing(error.message)) {
                  degradedSources.add("audit_logs.pos_route_perf");
                  return { total: 0, c4xx: 0, c409: 0, c5xx: 0, topRoutes: [] as Array<{ route: string; count: number }> };
                }
                throw new Error(`pos_route_perf_query_failed:${error.message}`);
              }

              let total = 0;
              let c4xx = 0;
              let c409 = 0;
              let c5xx = 0;
              const routeCounts = new Map<string, number>();

              for (const row of data ?? []) {
                const metadata = (row as { metadata?: Record<string, unknown> | null }).metadata ?? {};
                const status = normalizeStatusCode(metadata.status_code);
                if (!status || status < 400) continue;
                total += 1;
                if (status >= 500) c5xx += 1;
                else c4xx += 1;
                if (status === 409) c409 += 1;
                const route = normalizeRouteName(metadata.route);
                routeCounts.set(route, (routeCounts.get(route) ?? 0) + 1);
              }

              return {
                total,
                c4xx,
                c409,
                c5xx,
                topRoutes: [...routeCounts.entries()]
                  .map(([route, count]) => ({ route, count }))
                  .sort((left, right) => right.count - left.count)
                  .slice(0, 3)
              };
            };

            const [queued, stale, printQueue, printFailed, deadLetters, orderDeadLetters, paymentDeadLetters, perf] = await Promise.all([
              safeCount(
                "orders.queued",
                supabase
                  .from("orders")
                  .select("id", { count: "exact", head: true })
                  .eq("tenant_id", tenantId)
                  .eq("branch_id", branchId)
                  .eq("status", "queued")
              ),
              safeCount(
                "orders.stale",
                supabase
                  .from("orders")
                  .select("id", { count: "exact", head: true })
                  .eq("tenant_id", tenantId)
                  .eq("branch_id", branchId)
                  .eq("status", "queued")
                  .lt("created_at", staleSince)
              ),
              safeCount(
                "print_jobs.queue",
                supabase
                  .from("print_jobs")
                  .select("id", { count: "exact", head: true })
                  .eq("tenant_id", tenantId)
                  .eq("branch_id", branchId)
                  .in("status", ["pending", "printing", "retrying"])
              ),
              safeCount(
                "print_jobs.failed",
                supabase
                  .from("print_jobs")
                  .select("id", { count: "exact", head: true })
                  .eq("tenant_id", tenantId)
                  .eq("branch_id", branchId)
                  .eq("status", "failed")
                  .gt("created_at", windowSince)
              ),
              safeCount(
                "audit_logs.dead_letters",
                supabase
                  .from("audit_logs")
                  .select("id", { count: "exact", head: true })
                  .eq("tenant_id", tenantId)
                  .eq("branch_id", branchId)
                  .in("action", ["pos_order_dead_letter", "pos_payment_dead_letter", "pos_print_dead_letter"])
                  .gt("created_at", windowSince)
              ),
              safeCount(
                "audit_logs.order_dead_letters",
                supabase
                  .from("audit_logs")
                  .select("id", { count: "exact", head: true })
                  .eq("tenant_id", tenantId)
                  .eq("branch_id", branchId)
                  .eq("action", "pos_order_dead_letter")
                  .gt("created_at", windowSince)
              ),
              safeCount(
                "audit_logs.payment_dead_letters",
                supabase
                  .from("audit_logs")
                  .select("id", { count: "exact", head: true })
                  .eq("tenant_id", tenantId)
                  .eq("branch_id", branchId)
                  .eq("action", "pos_payment_dead_letter")
                  .gt("created_at", windowSince)
              ),
              readPerf()
            ]);

            let level: "ok" | "warn" | "critical" = "ok";
            if (queued >= POS_GUARDS.orderQueueHardLimit || printQueue >= POS_GUARDS.printQueueHardLimit || perf.c5xx >= 3) {
              level = "critical";
            } else if (stale > 0 || deadLetters > 0 || printFailed > 0 || perf.total > 0) {
              level = "warn";
            }

            const tenant = tenantMap.get(tenantId);
            return {
              branch_id: branchId,
              branch_name: `${tenant?.code || "STORE"} · ${String(branch.name ?? branchId)}`,
              level,
              queued_orders: queued,
              queued_orders_stale: stale,
              print_queue_depth: printQueue,
              print_failed_recent: printFailed,
              dead_letters_recent: deadLetters,
              order_dead_letters_recent: orderDeadLetters,
              payment_dead_letters_recent: paymentDeadLetters,
              api_errors_recent_total: perf.total,
              api_errors_4xx_recent: perf.c4xx,
              api_errors_409_recent: perf.c409,
              api_errors_5xx_recent: perf.c5xx,
              api_error_routes_top: perf.topRoutes
            };
          }
        });

        const totals = items.reduce(
          (summary, row) => {
            summary.queued_orders += row.queued_orders;
            summary.dead_letters_recent += row.dead_letters_recent + row.print_failed_recent;
            summary.order_dead_letters_recent += row.order_dead_letters_recent;
            summary.payment_dead_letters_recent += row.payment_dead_letters_recent;
            summary.api_errors_recent_total += row.api_errors_recent_total;
            summary.api_errors_4xx_recent += row.api_errors_4xx_recent;
            summary.api_errors_409_recent += row.api_errors_409_recent;
            summary.api_errors_5xx_recent += row.api_errors_5xx_recent;
            if (row.level === "critical") summary.critical += 1;
            if (row.level === "warn") summary.warn += 1;
            return summary;
          },
          {
            branches: items.length,
            queued_orders: 0,
            dead_letters_recent: 0,
            order_dead_letters_recent: 0,
            payment_dead_letters_recent: 0,
            critical: 0,
            warn: 0,
            api_errors_recent_total: 0,
            api_errors_4xx_recent: 0,
            api_errors_409_recent: 0,
            api_errors_5xx_recent: 0
          }
        );

        return {
          generated_at: new Date().toISOString(),
          filters: { minutes, branch_id: requestedBranchId },
          limits: {
            order_queue_limit: POS_GUARDS.orderQueueHardLimit,
            print_queue_limit: POS_GUARDS.printQueueHardLimit
          },
          integration: {
            mode: "shared_supabase",
            source: "cpipos_pos_runtime"
          },
          degraded_sources: [...degradedSources].sort(),
          totals,
          items
        };
      }
    });

    const response = ok(payload);
    response.headers.set("cache-control", "no-store");
    response.headers.set("x-it-admin-pos-monitor-cache", source);
    response.headers.set("x-admin-api-ms", String(Date.now() - startedAt));
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message.startsWith("branches_query_failed:") || message.startsWith("tenants_query_failed:")) {
      const response = fail("monitor_query_failed", "Unable to load POS monitoring data.", 500);
      response.headers.set("x-admin-api-ms", String(Date.now() - startedAt));
      return response;
    }
    const response = guardItAdminError(error);
    response.headers.set("x-admin-api-ms", String(Date.now() - startedAt));
    return response;
  }
}
