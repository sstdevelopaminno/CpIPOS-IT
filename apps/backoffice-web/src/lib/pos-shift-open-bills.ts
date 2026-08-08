import "server-only";

import { appendAuditLog } from "@/lib/audit-log";
import { invalidatePosScopeRuntimeCaches } from "@/lib/pos-cache-invalidation";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

export const BLOCKING_ORDER_STATUSES = ["draft", "queued", "preparing"];
export const BLOCKING_TABLE_SESSION_STATUSES = ["open", "ordering", "pending_payment"];
export const SHIFT_CLEAR_OPEN_BILLS_REASON = "เคลียร์บิลค้างก่อนต่อกะ";

type BlockingOrder = {
  id: string;
  order_no: string | null;
  status: string;
  table_id: string | null;
};

type BlockingTableSession = {
  id: string;
  table_id: string;
  order_id: string | null;
  status: string;
};

export type ClearShiftOpenBillsResult = {
  shift_id: string;
  cleared_order_count: number;
  cleared_table_session_count: number;
  released_table_count: number;
};

export async function clearShiftOpenBills(args: {
  tenantId: string;
  branchId: string;
  shiftId: string;
  userId: string;
  role: string;
  posSessionId: string;
  reason?: string;
}): Promise<ClearShiftOpenBillsResult> {
  const reason = args.reason ?? SHIFT_CLEAR_OPEN_BILLS_REASON;
  const supabase = getSupabaseServiceClient();
  const { data: orders, error: ordersError } = await supabase
    .from("orders")
    .select("id,order_no,status,table_id")
    .eq("tenant_id", args.tenantId)
    .eq("branch_id", args.branchId)
    .eq("shift_id", args.shiftId)
    .in("status", BLOCKING_ORDER_STATUSES)
    .limit(200);

  if (ordersError) {
    throw new Error(`shift_open_bills_query_failed: ${ordersError.message}`);
  }

  const blockingOrders = (orders ?? []) as BlockingOrder[];
  const orderIds = blockingOrders.map((order) => order.id);
  const orderTableIds = blockingOrders.map((order) => order.table_id).filter((id): id is string => Boolean(id));

  let clearedOrderCount = 0;
  if (orderIds.length > 0) {
    const { data: cancelledOrders, error: cancelError } = await supabase
      .from("orders")
      .update({
        status: "cancelled",
        cancelled_by: args.userId,
        cancelled_reason: reason
      })
      .eq("tenant_id", args.tenantId)
      .eq("branch_id", args.branchId)
      .eq("shift_id", args.shiftId)
      .in("id", orderIds)
      .in("status", BLOCKING_ORDER_STATUSES)
      .select("id");

    if (cancelError) {
      throw new Error(`shift_clear_orders_failed: ${cancelError.message}`);
    }
    clearedOrderCount = cancelledOrders?.length ?? 0;
  }

  const { data: tableSessions, error: tableSessionsError } = await supabase
    .from("table_bill_sessions")
    .select("id,table_id,order_id,status")
    .eq("tenant_id", args.tenantId)
    .eq("branch_id", args.branchId)
    .in("status", BLOCKING_TABLE_SESSION_STATUSES)
    .limit(200);

  if (tableSessionsError) {
    throw new Error(`shift_open_tables_query_failed: ${tableSessionsError.message}`);
  }

  const blockingTableSessions = (tableSessions ?? []) as BlockingTableSession[];
  const tableSessionIds = blockingTableSessions.map((session) => session.id);
  const tableSessionTableIds = blockingTableSessions.map((session) => session.table_id).filter(Boolean);
  const tableIds = Array.from(new Set([...orderTableIds, ...tableSessionTableIds]));
  const closedAt = new Date().toISOString();

  let clearedTableSessionCount = 0;
  if (tableSessionIds.length > 0) {
    const { data: cancelledSessions, error: cancelSessionError } = await supabase
      .from("table_bill_sessions")
      .update({
        status: "cancelled",
        closed_by: args.userId,
        closed_at: closedAt
      })
      .eq("tenant_id", args.tenantId)
      .eq("branch_id", args.branchId)
      .in("id", tableSessionIds)
      .in("status", BLOCKING_TABLE_SESSION_STATUSES)
      .select("id");

    if (cancelSessionError) {
      throw new Error(`shift_clear_table_sessions_failed: ${cancelSessionError.message}`);
    }
    clearedTableSessionCount = cancelledSessions?.length ?? 0;
  }

  if (tableIds.length > 0) {
    const { error: releaseTablesError } = await supabase
      .from("dining_tables")
      .update({ status: "available" })
      .eq("tenant_id", args.tenantId)
      .eq("branch_id", args.branchId)
      .in("id", tableIds);

    if (releaseTablesError) {
      throw new Error(`shift_release_tables_failed: ${releaseTablesError.message}`);
    }
  }

  void appendAuditLog({
    tenantId: args.tenantId,
    branchId: args.branchId,
    actorUserId: args.userId,
    actorRole: args.role as "owner" | "manager" | "staff" | "accountant",
    action: "pos_shift_open_bills_cleared",
    targetTable: "shifts",
    targetId: args.shiftId,
    metadata: {
      pos_session_id: args.posSessionId,
      reason,
      cleared_order_count: clearedOrderCount,
      cleared_table_session_count: clearedTableSessionCount,
      released_table_count: tableIds.length,
      order_ids: orderIds.slice(0, 50),
      order_nos: blockingOrders.map((order) => order.order_no).filter(Boolean).slice(0, 20),
      table_session_ids: tableSessionIds.slice(0, 50)
    }
  });

  invalidatePosScopeRuntimeCaches({ tenantId: args.tenantId, branchId: args.branchId });

  return {
    shift_id: args.shiftId,
    cleared_order_count: clearedOrderCount,
    cleared_table_session_count: clearedTableSessionCount,
    released_table_count: tableIds.length
  };
}
