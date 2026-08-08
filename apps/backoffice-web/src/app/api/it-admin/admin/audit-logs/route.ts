import { ok } from "@/lib/http";
import { buildPaginationMeta, parsePagination, sanitizeSearchTerm } from "@/lib/query-params";
import { guardItAdminError, requireItAdmin } from "@/lib/it-admin-guard";

export async function GET(req: Request) {
  try {
    const { supabase } = await requireItAdmin();
    const { searchParams } = new URL(req.url);
    const tenantId = searchParams.get("tenant_id")?.trim();
    const branchId = searchParams.get("branch_id")?.trim();
    const actorUserId = searchParams.get("actor_user_id")?.trim();
    const action = searchParams.get("action")?.trim();
    const dateFrom = searchParams.get("date_from")?.trim();
    const dateTo = searchParams.get("date_to")?.trim();
    const search = sanitizeSearchTerm(searchParams.get("search"));
    const { page, pageSize } = parsePagination(searchParams, 20);
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = supabase
      .from("audit_logs")
      .select(
        "id,tenant_id,branch_id,actor_user_id,target_user_id,device_code,pos_session_id,action,target_table,target_type,target_id,module,entity_type,entity_id,created_at,metadata",
        { count: "exact" }
      )
      .order("created_at", { ascending: false })
      .range(from, to);

    if (tenantId) query = query.eq("tenant_id", tenantId);
    if (branchId) query = query.eq("branch_id", branchId);
    if (actorUserId) query = query.eq("actor_user_id", actorUserId);
    if (action) query = query.eq("action", action);
    if (dateFrom) query = query.gte("created_at", `${dateFrom}T00:00:00.000Z`);
    if (dateTo) query = query.lte("created_at", `${dateTo}T23:59:59.999Z`);
    if (search) {
      query = query.or(`action.ilike.%${search}%,target_table.ilike.%${search}%,entity_type.ilike.%${search}%`);
    }

    const { data, error, count } = await query;
    if (error) {
      throw new Error(error.message);
    }

    return ok({
      items: data ?? [],
      pagination: buildPaginationMeta(page, pageSize, count)
    });
  } catch (error) {
    return guardItAdminError(error);
  }
}
