import type { BranchRole, PlatformRole } from "@pos/shared-types";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

export type AppendAuditLogInput = {
  tenantId?: string;
  branchId?: string;
  actorUserId: string;
  actorRole: BranchRole | PlatformRole;
  action: string;
  targetTable: string;
  targetId?: string;
  targetUserId?: string;
  metadata?: Record<string, unknown>;
  module?: string;
  entityType?: string;
  entityId?: string;
  beforeData?: JsonObject;
  afterData?: JsonObject;
  overrideByUserId?: string;
  ipAddress?: string;
  userAgent?: string;
};

type AuditLogRow = {
  tenant_id: string | null;
  branch_id: string | null;
  actor_user_id: string;
  actor_role: string;
  target_user_id: string | null;
  action: string;
  target_table: string;
  target_id: string | null;
  metadata: JsonObject;
  user_id: string;
  role: string;
  module: string;
  entity_type: string;
  entity_id: string | null;
  before_data: JsonObject;
  after_data: JsonObject;
  override_by_user_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
};

type AppendAuditLogDeps = {
  writeRow?: (row: AuditLogRow) => Promise<void>;
};

const missingAuditColumns = new Set<string>();
const compatibilityNoticeColumns = new Set<string>();

function normalizeJsonObject(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as JsonObject;
}

function inferModule(targetTable: string, action: string): string {
  if (targetTable === "orders" || targetTable === "order_items" || targetTable === "payments") {
    return "pos_sales";
  }

  if (targetTable === "stock_movements" || targetTable === "ingredients" || targetTable === "recipes") {
    return "stock";
  }

  if (targetTable === "shifts") {
    return "shift";
  }

  if (targetTable === "users_profiles" || targetTable === "user_branch_roles") {
    return "staff";
  }

  if (targetTable === "tenants" || targetTable === "subscription_packages" || targetTable === "tenant_billing_cycles") {
    return "it_admin";
  }

  const guessed = action.split("_")[0];
  return guessed || "general";
}

function mapInputToRow(input: AppendAuditLogInput): AuditLogRow {
  const metadata = normalizeJsonObject(input.metadata);
  const beforeData = input.beforeData ?? normalizeJsonObject(metadata.before_data);
  const afterData = input.afterData ?? normalizeJsonObject(metadata.after_data);

  return {
    tenant_id: input.tenantId ?? null,
    branch_id: input.branchId ?? null,
    actor_user_id: input.actorUserId,
    actor_role: input.actorRole,
    target_user_id: input.targetUserId ?? null,
    action: input.action,
    target_table: input.targetTable,
    target_id: input.targetId ?? null,
    metadata,
    user_id: input.actorUserId,
    role: input.actorRole,
    module: input.module ?? inferModule(input.targetTable, input.action),
    entity_type: input.entityType ?? input.targetTable,
    entity_id: input.entityId ?? input.targetId ?? null,
    before_data: beforeData,
    after_data: afterData,
    override_by_user_id: input.overrideByUserId ?? null,
    ip_address: input.ipAddress ?? null,
    user_agent: input.userAgent ?? null
  };
}

async function writeAuditLogRow(row: AuditLogRow): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const baseRow: Record<string, unknown> = { ...row };
  for (const missingColumn of missingAuditColumns) {
    delete baseRow[missingColumn];
  }

  let attemptRow: Record<string, unknown> = baseRow;
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const { error } = await supabase.from("audit_logs").insert(attemptRow);
    if (!error) {
      return;
    }

    const message = String(error.message ?? "");
    const missingColumnMatch = message.match(/Could not find the '([^']+)' column of 'audit_logs'/i);
    const missingColumn = missingColumnMatch?.[1]?.trim() ?? "";
    if (!missingColumn) {
      throw new Error(message || "Unknown audit log insert error.");
    }
    if (!(missingColumn in attemptRow)) {
      throw new Error(message || "Unknown audit log insert error.");
    }

    missingAuditColumns.add(missingColumn);
    if (!compatibilityNoticeColumns.has(missingColumn)) {
      compatibilityNoticeColumns.add(missingColumn);
      console.warn("[audit-log] compatibility fallback: missing audit_logs column skipped", {
        column: missingColumn
      });
    }

    const nextRow = { ...attemptRow };
    delete nextRow[missingColumn];
    attemptRow = nextRow;
  }

  throw new Error("Audit log insert failed after compatibility retries.");
}

export async function appendAuditLog(input: AppendAuditLogInput, deps: AppendAuditLogDeps = {}) {
  const row = mapInputToRow(input);
  const writeRow = deps.writeRow ?? writeAuditLogRow;

  try {
    await writeRow(row);
    return {
      inserted: true,
      at: new Date().toISOString(),
      action: row.action,
      entity_type: row.entity_type,
      entity_id: row.entity_id
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown audit log write error.";

    // Keep business flow running even if audit persistence fails.
    console.error("[audit-log] write failed", {
      action: row.action,
      module: row.module,
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      tenant_id: row.tenant_id,
      branch_id: row.branch_id,
      error: message
    });

    return {
      inserted: false,
      at: new Date().toISOString(),
      action: row.action,
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      error: "audit_log_write_failed"
    };
  }
}

