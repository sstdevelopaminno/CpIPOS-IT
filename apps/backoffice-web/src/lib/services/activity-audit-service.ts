import "server-only";

import type { ApprovalAction, BranchRole, PlatformRole } from "@pos/shared-types";
import { appendAuditLog } from "@/lib/audit-log";
import type { AuthContext } from "@/lib/auth-context";
import { validateManagerPin } from "@/lib/pin-approval";
import { buildPaginationMeta, parsePositiveInt, sanitizeSearchTerm } from "@/lib/query-params";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

type JsonObject = Record<string, unknown>;

type AuditLogRow = {
  id: string;
  tenant_id: string | null;
  branch_id: string | null;
  actor_user_id: string | null;
  actor_role: string | null;
  target_user_id: string | null;
  action: string;
  target_table: string | null;
  target_id: string | null;
  device_code: string | null;
  pos_session_id: string | null;
  module: string | null;
  entity_type: string | null;
  entity_id: string | null;
  override_by_user_id: string | null;
  created_at: string;
  metadata: JsonObject | null;
};

type UserRow = {
  id: string;
  full_name: string | null;
  email: string | null;
};

type EmployeeRow = {
  user_id: string;
  employee_code: string | null;
};

type BranchRow = {
  id: string;
  name: string | null;
  code: string | null;
};

export type ActivityAuditPeriod = "day" | "month" | "year";

export type ActivityAuditInput = {
  manager_pin?: string;
  period?: ActivityAuditPeriod;
  date?: string;
  branch_id?: string;
  module?: string;
  search?: string;
  page?: number;
  page_size?: number;
};

export type ActivityAuditItem = {
  id: string;
  tenant_id: string | null;
  branch_id: string | null;
  branch_name: string;
  branch_code: string;
  actor_user_id: string | null;
  actor_name: string;
  actor_email: string;
  actor_employee_code: string;
  actor_role: string;
  approver_user_id: string | null;
  approver_name: string;
  approver_role: string;
  target_user_id: string | null;
  target_user_name: string;
  target_employee_code: string;
  action: string;
  module: string;
  menu: string;
  target_table: string;
  target_id: string | null;
  device_code: string;
  device_name: string;
  pos_session_id: string | null;
  created_at: string;
  metadata: JsonObject;
  is_delete_action: boolean;
  is_pin_action: boolean;
};

function trimText(value: unknown) {
  return String(value ?? "").trim();
}

function canViewActivityAudit(auth: AuthContext) {
  return auth.platformRole === "it_admin" || auth.branchRole === "owner" || auth.branchRole === "manager";
}

function normalizePeriod(value: unknown): ActivityAuditPeriod {
  if (value === "month" || value === "year") return value;
  return "day";
}

function resolveDateRange(period: ActivityAuditPeriod, value: string | undefined) {
  const now = new Date();
  const fallbackDay = now.toISOString().slice(0, 10);
  const normalized = trimText(value);

  if (period === "year") {
    const year = Number.parseInt(normalized || String(now.getUTCFullYear()), 10);
    const safeYear = Number.isFinite(year) && year > 2000 ? year : now.getUTCFullYear();
    const from = new Date(`${safeYear}-01-01T00:00:00+07:00`);
    const to = new Date(`${safeYear + 1}-01-01T00:00:00+07:00`);
    return { fromIso: from.toISOString(), toIso: to.toISOString(), label: String(safeYear) };
  }

  if (period === "month") {
    const [yearPart, monthPart] = (normalized || fallbackDay.slice(0, 7)).split("-");
    const year = Number.parseInt(yearPart ?? "", 10);
    const month = Number.parseInt(monthPart ?? "", 10);
    const safeYear = Number.isFinite(year) && year > 2000 ? year : now.getUTCFullYear();
    const safeMonth = Number.isFinite(month) && month >= 1 && month <= 12 ? month : now.getUTCMonth() + 1;
    const from = new Date(`${safeYear}-${String(safeMonth).padStart(2, "0")}-01T00:00:00+07:00`);
    const to = new Date(from);
    to.setUTCMonth(to.getUTCMonth() + 1);
    return { fromIso: from.toISOString(), toIso: to.toISOString(), label: `${safeYear}-${String(safeMonth).padStart(2, "0")}` };
  }

  const day = /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : fallbackDay;
  const from = new Date(`${day}T00:00:00+07:00`);
  const to = new Date(from);
  to.setUTCDate(to.getUTCDate() + 1);
  return { fromIso: from.toISOString(), toIso: to.toISOString(), label: day };
}

function inferMenu(row: AuditLogRow) {
  const moduleName = trimText(row.module) || trimText(row.target_table) || "general";
  if (moduleName === "pos_sales") return "หน้าขาย";
  if (moduleName === "stock") return "จัดการสินค้า";
  if (moduleName === "shift") return "เปิด/ปิดกะ";
  if (moduleName === "staff") return "ผู้ใช้งาน";
  if (moduleName === "settings" || moduleName === "pos_settings") return "ตั้งค่า";
  if (moduleName === "settings_activity_audit") return "ตรวจสอบพฤติกรรมการใช้งาน";
  if (moduleName === "it_admin") return "ระบบหลังบ้าน IT";
  return moduleName;
}

function isDeleteAction(action: string) {
  const normalized = action.toLowerCase();
  return normalized.includes("delete") || normalized.includes("deleted") || normalized.includes("cancel") || normalized.includes("revoked");
}

function isPinAction(action: string) {
  return action.toLowerCase().includes("pin") || action.toLowerCase().includes("approval");
}

async function loadUsers(tenantId: string, rows: AuditLogRow[]) {
  const userIds = new Set<string>();
  for (const row of rows) {
    if (row.actor_user_id) userIds.add(row.actor_user_id);
    if (row.target_user_id) userIds.add(row.target_user_id);
    if (row.override_by_user_id) userIds.add(row.override_by_user_id);
    const approvedBy = trimText(row.metadata?.approved_by ?? row.metadata?.approvedBy);
    if (approvedBy) userIds.add(approvedBy);
  }

  const ids = [...userIds];
  if (!ids.length) {
    return {
      profileById: new Map<string, UserRow>(),
      employeeCodeById: new Map<string, string>()
    };
  }

  const supabase = getSupabaseServiceClient();
  const [profilesResult, employeeResult] = await Promise.all([
    supabase.from("users_profiles").select("id,full_name,email").in("id", ids),
    supabase.from("pos_user_profiles").select("user_id,employee_code").eq("tenant_id", tenantId).in("user_id", ids)
  ]);

  if (profilesResult.error) throw new Error(profilesResult.error.message);
  if (employeeResult.error) throw new Error(employeeResult.error.message);

  const profileById = new Map((profilesResult.data ?? []).map((row) => [row.id, row as UserRow]));
  const employeeCodeById = new Map(
    ((employeeResult.data ?? []) as EmployeeRow[])
      .map((row) => [row.user_id, trimText(row.employee_code)] as const)
      .filter((entry) => Boolean(entry[1]))
  );

  return { profileById, employeeCodeById };
}

async function loadBranches(tenantId: string, rows: AuditLogRow[]) {
  const branchIds = [...new Set(rows.map((row) => row.branch_id).filter((id): id is string => Boolean(id)))];
  if (!branchIds.length) return new Map<string, BranchRow>();
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase.from("branches").select("id,name,code").eq("tenant_id", tenantId).in("id", branchIds);
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((row) => [row.id, row as BranchRow]));
}

function actorRole(auth: AuthContext): BranchRole | PlatformRole {
  return auth.platformRole === "it_admin" ? "it_admin" : auth.branchRole ?? "manager";
}

export async function loadActivityAudit(auth: AuthContext, input: ActivityAuditInput, requestMeta: { ipAddress?: string | null; userAgent?: string | null } = {}) {
  if (!auth.tenantId || !auth.branchId) throw new Error("Missing tenant/branch scope.");
  if (!canViewActivityAudit(auth)) throw new Error("Only owner or manager can view activity audit.");

  const pin = trimText(input.manager_pin);
  const approval = await validateManagerPin("sales_record_edit" as ApprovalAction, pin, {
    tenantId: auth.tenantId,
    branchId: auth.branchId
  });

  if (!approval.approved || !approval.approverUserId || !approval.approverRole) {
    await appendAuditLog({
      tenantId: auth.tenantId,
      branchId: auth.branchId,
      actorUserId: auth.userId,
      actorRole: actorRole(auth),
      action: "settings_activity_audit_pin_failed",
      targetTable: "audit_logs",
      module: "settings_activity_audit",
      entityType: "audit_logs",
      metadata: { requested_module: "settings_activity_audit" },
      ipAddress: requestMeta.ipAddress ?? undefined,
      userAgent: requestMeta.userAgent ?? undefined
    });
    throw new Error("PIN approval rejected.");
  }

  const period = normalizePeriod(input.period);
  const range = resolveDateRange(period, input.date);
  const page = Math.max(1, Number(input.page ?? 1));
  const pageSize = Math.min(50, Math.max(7, parsePositiveInt(String(input.page_size ?? "7"), 7)));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const search = sanitizeSearchTerm(input.search ?? null);
  const branchId = trimText(input.branch_id);
  const moduleFilter = trimText(input.module);
  const supabase = getSupabaseServiceClient();

  let query = supabase
    .from("audit_logs")
    .select(
      "id,tenant_id,branch_id,actor_user_id,actor_role,target_user_id,action,target_table,target_id,device_code,pos_session_id,module,entity_type,entity_id,override_by_user_id,created_at,metadata",
      { count: "exact" }
    )
    .eq("tenant_id", auth.tenantId)
    .gte("created_at", range.fromIso)
    .lt("created_at", range.toIso)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (branchId && branchId !== "all") query = query.eq("branch_id", branchId);
  if (moduleFilter && moduleFilter !== "all") query = query.eq("module", moduleFilter);
  if (search) query = query.or(`action.ilike.%${search}%,target_table.ilike.%${search}%,module.ilike.%${search}%,entity_type.ilike.%${search}%`);

  const { data, error, count } = await query;
  if (error) throw new Error(error.message);

  const rows = ((data ?? []) as AuditLogRow[]).filter((row) => row.action !== "settings_activity_audit_pin_failed");
  const [{ profileById, employeeCodeById }, branchById] = await Promise.all([loadUsers(auth.tenantId, rows), loadBranches(auth.tenantId, rows)]);

  const items: ActivityAuditItem[] = rows.map((row) => {
    const metadata = row.metadata ?? {};
    const actor = row.actor_user_id ? profileById.get(row.actor_user_id) : undefined;
    const target = row.target_user_id ? profileById.get(row.target_user_id) : undefined;
    const approverId = trimText(metadata.approved_by ?? metadata.approvedBy) || row.override_by_user_id || null;
    const approver = approverId ? profileById.get(approverId) : undefined;
    const branch = row.branch_id ? branchById.get(row.branch_id) : undefined;

    return {
      id: row.id,
      tenant_id: row.tenant_id,
      branch_id: row.branch_id,
      branch_name: trimText(branch?.name) || "-",
      branch_code: trimText(branch?.code),
      actor_user_id: row.actor_user_id,
      actor_name: trimText(actor?.full_name) || row.actor_user_id || "-",
      actor_email: trimText(actor?.email),
      actor_employee_code: row.actor_user_id ? employeeCodeById.get(row.actor_user_id) ?? "" : "",
      actor_role: trimText(row.actor_role) || trimText(metadata.actor_role) || "-",
      approver_user_id: approverId,
      approver_name: trimText(approver?.full_name) || approverId || "-",
      approver_role: trimText(metadata.approver_role ?? metadata.approverRole),
      target_user_id: row.target_user_id,
      target_user_name: trimText(target?.full_name) || row.target_user_id || "-",
      target_employee_code: row.target_user_id ? employeeCodeById.get(row.target_user_id) ?? "" : "",
      action: row.action,
      module: trimText(row.module) || trimText(row.target_table) || "general",
      menu: inferMenu(row),
      target_table: trimText(row.target_table ?? row.entity_type),
      target_id: row.target_id ?? row.entity_id,
      device_code: trimText(row.device_code ?? metadata.device_code),
      device_name: trimText(metadata.device_name),
      pos_session_id: row.pos_session_id,
      created_at: row.created_at,
      metadata,
      is_delete_action: isDeleteAction(row.action),
      is_pin_action: isPinAction(row.action)
    };
  });

  await appendAuditLog({
    tenantId: auth.tenantId,
    branchId: branchId && branchId !== "all" ? branchId : auth.branchId,
    actorUserId: auth.userId,
    actorRole: actorRole(auth),
    action: "settings_activity_audit_viewed",
    targetTable: "audit_logs",
    module: "settings_activity_audit",
    entityType: "audit_logs",
    overrideByUserId: approval.approverUserId,
    metadata: {
      period,
      period_label: range.label,
      branch_id: branchId || "all",
      module: moduleFilter || "all",
      search: search ?? null,
      page,
      page_size: pageSize,
      result_count: items.length,
      approved_by: approval.approverUserId,
      approver_role: approval.approverRole,
      it_admin_visibility: "audit_logs"
    },
    ipAddress: requestMeta.ipAddress ?? undefined,
    userAgent: requestMeta.userAgent ?? undefined
  });

  return {
    items,
    pagination: buildPaginationMeta(page, pageSize, count),
    filters: {
      period,
      date: range.label,
      branch_id: branchId || "all",
      module: moduleFilter || "all",
      search: search ?? ""
    },
    approved_by: approval.approverUserId,
    approver_role: approval.approverRole
  };
}
