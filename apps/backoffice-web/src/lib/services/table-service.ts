import type { BranchRole, PlatformRole, TableStatus } from "@pos/shared-types";
import type { AuthContext } from "@/lib/auth-context";
import { appendAuditLog } from "@/lib/audit-log";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

type AuditFn = (input: {
  tenantId?: string;
  branchId?: string;
  actorUserId: string;
  actorRole: BranchRole | PlatformRole;
  action: string;
  targetTable: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}) => Promise<unknown>;

type TableLookupRow = {
  id: string;
  table_code: string;
  table_name: string | null;
  status: TableStatus;
  is_active: boolean;
};

type OpenSessionRow = {
  id: string;
  table_id: string;
  status: "open" | "ordering" | "pending_payment" | "closed" | "cancelled";
  order_id: string | null;
  opened_at: string;
};

type OpenBillSessionPerf = {
  table_lookup_ms?: number;
  active_session_check_ms?: number;
  insert_session_ms?: number;
  update_table_status_ms?: number;
  rollback_session_delete_ms?: number;
};

type OpenBillSessionSuccess = {
  ok: true;
  data: {
    id: string;
    table_id: string;
    table_code: string;
    table_name: string | null;
    status: "open" | "ordering" | "pending_payment" | "closed" | "cancelled";
    opened_at: string;
  };
  perf: OpenBillSessionPerf;
};

type OpenBillSessionFailure = {
  ok: false;
  code: string;
  message: string;
  status: number;
  perf: OpenBillSessionPerf;
};

export async function openTableBillSession(args: {
  auth: AuthContext;
  tableId: string;
  metadata?: Record<string, unknown>;
  appendAudit?: AuditFn;
  supabaseClient?: ReturnType<typeof getSupabaseServiceClient>;
}) {
  const { auth, tableId, metadata = {}, appendAudit = appendAuditLog } = args;
  const perf: OpenBillSessionPerf = {};
  const markStep = (step: keyof OpenBillSessionPerf, startedAt: number) => {
    perf[step] = Date.now() - startedAt;
  };
  if (!auth.tenantId || !auth.branchId) {
    return { ok: false as const, code: "missing_scope", message: "Missing tenant/branch scope.", status: 401, perf } satisfies OpenBillSessionFailure;
  }

  const supabase = args.supabaseClient ?? getSupabaseServiceClient();
  const tableLookupStartedAt = Date.now();
  const tableResult = await supabase
    .from("dining_tables")
    .select("id,table_code,table_name,status,is_active")
    .eq("tenant_id", auth.tenantId)
    .eq("branch_id", auth.branchId)
    .eq("id", tableId)
    .maybeSingle<TableLookupRow>();
  markStep("table_lookup_ms", tableLookupStartedAt);
  const { data: tableRow, error: tableError } = tableResult;

  if (tableError) {
    return { ok: false as const, code: "table_query_failed", message: tableError.message, status: 500, perf } satisfies OpenBillSessionFailure;
  }

  if (!tableRow) {
    return { ok: false as const, code: "table_not_found", message: "Table not found in current branch.", status: 404, perf } satisfies OpenBillSessionFailure;
  }

  if (!tableRow.is_active || tableRow.status === "disabled") {
    return { ok: false as const, code: "table_disabled", message: "Disabled table cannot open bill.", status: 409, perf } satisfies OpenBillSessionFailure;
  }

  if (tableRow.status === "reserved") {
    return { ok: false as const, code: "table_reserved", message: "Reserved table cannot open bill.", status: 409, perf } satisfies OpenBillSessionFailure;
  }

  if (tableRow.status === "occupied" || tableRow.status === "ordering" || tableRow.status === "pending_payment") {
    return {
      ok: false as const,
      code: "table_already_occupied",
      message: "This table already has an active bill session.",
      status: 409,
      perf
    } satisfies OpenBillSessionFailure;
  }

  const activeSessionCheckStartedAt = Date.now();
  const { data: activeSession, error: activeSessionError } = await supabase
    .from("table_bill_sessions")
    .select("id,status")
    .eq("tenant_id", auth.tenantId)
    .eq("branch_id", auth.branchId)
    .eq("table_id", tableId)
    .in("status", ["open", "ordering", "pending_payment"])
    .order("opened_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; status: OpenSessionRow["status"] }>();
  markStep("active_session_check_ms", activeSessionCheckStartedAt);

  if (activeSessionError) {
    return { ok: false as const, code: "active_session_query_failed", message: activeSessionError.message, status: 500, perf } satisfies OpenBillSessionFailure;
  }

  if (activeSession) {
    return {
      ok: false as const,
      code: "table_already_occupied",
      message: "This table already has an active bill session.",
      status: 409,
      perf
    } satisfies OpenBillSessionFailure;
  }

  const insertSessionStartedAt = Date.now();
  const { data: sessionRow, error: insertError } = await supabase
    .from("table_bill_sessions")
    .insert({
      tenant_id: auth.tenantId,
      branch_id: auth.branchId,
      table_id: tableId,
      opened_by: auth.userId,
      status: "open",
      metadata
    })
    .select("id,table_id,status,order_id,opened_at")
    .single<OpenSessionRow>();
  markStep("insert_session_ms", insertSessionStartedAt);

  if (insertError) {
    if (insertError.code === "23505") {
      return {
        ok: false as const,
        code: "table_already_occupied",
        message: "This table already has an active bill session.",
        status: 409,
        perf
      } satisfies OpenBillSessionFailure;
    }
    return { ok: false as const, code: "open_session_failed", message: insertError.message, status: 500, perf } satisfies OpenBillSessionFailure;
  }

  const updateTableStatusStartedAt = Date.now();
  const { error: tableStatusError } = await supabase
    .from("dining_tables")
    .update({ status: "occupied" })
    .eq("tenant_id", auth.tenantId)
    .eq("branch_id", auth.branchId)
    .eq("id", tableId);
  markStep("update_table_status_ms", updateTableStatusStartedAt);
  if (tableStatusError) {
    const rollbackDeleteStartedAt = Date.now();
    await supabase
      .from("table_bill_sessions")
      .delete()
      .eq("tenant_id", auth.tenantId)
      .eq("branch_id", auth.branchId)
      .eq("id", sessionRow.id);
    markStep("rollback_session_delete_ms", rollbackDeleteStartedAt);
    return {
      ok: false as const,
      code: "table_status_update_failed",
      message: tableStatusError.message,
      status: 500,
      perf
    } satisfies OpenBillSessionFailure;
  }

  void appendAudit({
    tenantId: auth.tenantId,
    branchId: auth.branchId,
    actorUserId: auth.userId,
    actorRole: auth.branchRole ?? auth.platformRole,
    action: "bill_opened_from_table",
    targetTable: "table_bill_sessions",
    targetId: sessionRow.id,
    metadata: {
      table_id: tableId,
      table_code: tableRow.table_code
    }
  });

  return {
    ok: true as const,
    data: {
      id: sessionRow.id,
      table_id: tableId,
      table_code: tableRow.table_code,
      table_name: tableRow.table_name,
      status: sessionRow.status,
      opened_at: sessionRow.opened_at
    },
    perf
  } satisfies OpenBillSessionSuccess;
}

export async function attachOrderToTableSession(args: {
  auth: AuthContext;
  tableId: string;
  orderId: string;
  orderNo: string;
  supabaseClient?: ReturnType<typeof getSupabaseServiceClient>;
}) {
  const { auth, tableId, orderId, orderNo } = args;
  if (!auth.tenantId || !auth.branchId) {
    return;
  }

  const supabase = args.supabaseClient ?? getSupabaseServiceClient();
  const { data: activeSession } = await supabase
    .from("table_bill_sessions")
    .select("id")
    .eq("tenant_id", auth.tenantId)
    .eq("branch_id", auth.branchId)
    .eq("table_id", tableId)
    .in("status", ["open", "ordering", "pending_payment"])
    .limit(1)
    .maybeSingle<{ id: string }>();

  if (!activeSession) {
    return;
  }

  const { error: sessionUpdateError } = await supabase
    .from("table_bill_sessions")
    .update({
      status: "ordering",
      order_id: orderId,
      metadata: {
        last_order_id: orderId,
        last_order_no: orderNo
      }
    })
    .eq("tenant_id", auth.tenantId)
    .eq("branch_id", auth.branchId)
    .eq("id", activeSession.id);
  if (sessionUpdateError) {
    return;
  }

  await supabase
    .from("dining_tables")
    .update({ status: "ordering" })
    .eq("tenant_id", auth.tenantId)
    .eq("branch_id", auth.branchId)
    .eq("id", tableId);
}
