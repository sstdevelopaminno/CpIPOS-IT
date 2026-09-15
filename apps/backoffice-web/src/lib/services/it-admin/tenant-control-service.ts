import "server-only";

import { appendAuditLog } from "@/lib/audit-log";
import { ItAdminGuardError, type ItAdminContext } from "@/lib/it-admin-guard";

const ACTIVE_CONTRACT_STATUSES = ["trial", "active", "suspended"] as const;
const BILLING_CYCLES = new Set(["monthly", "yearly", "custom"]);
const CONTRACT_STATUSES = new Set(["trial", "active", "suspended", "expired", "cancelled"]);

type JsonRecord = Record<string, unknown>;

type TenantRow = {
  id: string;
  tenant_code: string;
  name: string;
  display_name: string | null;
  tax_id: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  is_active: boolean;
  logo_url: string | null;
  company_address: string | null;
  created_at: string;
  updated_at: string;
};

type BranchRow = {
  id: string;
  tenant_id: string;
  branch_code: string;
  branch_name: string;
  address: unknown;
  status: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type PackageRow = {
  id: string;
  code: string;
  name: string;
  status: string;
  is_active: boolean;
  monthly_price: number | string | null;
  yearly_price: number | string | null;
  max_branches: number | null;
  max_devices: number | null;
  max_users: number | null;
  max_products: number | null;
  monthly_bill_limit: number | null;
  storage_limit_gb: number | string | null;
  retention_months: number | null;
};

type ContractRow = {
  id: string;
  tenant_id: string;
  package_id: string | null;
  billing_cycle: string;
  amount: number | string | null;
  currency: string;
  status: string;
  activated_at: string | null;
  start_at: string | null;
  end_at: string | null;
  trial_end_at: string | null;
  cancelled_at: string | null;
  metadata: unknown;
  created_at: string;
  updated_at: string;
};

export type TenantControlAction =
  | "update_profile"
  | "create_branch"
  | "update_branch"
  | "change_package"
  | "suspend_package"
  | "resume_package"
  | "cancel_subscription"
  | "deactivate_store"
  | "reactivate_store"
  | "delete_store";

export type TenantControlInput = {
  action?: string;
  display_name?: string;
  legal_name?: string;
  tax_id?: string;
  contact_email?: string;
  contact_phone?: string;
  company_address?: string;
  logo_url?: string;
  branch_id?: string;
  branch_code?: string;
  branch_name?: string;
  branch_address?: string;
  branch_active?: boolean;
  package_id?: string;
  billing_cycle?: string;
  admin_reason?: string;
  customer_message?: string;
  customer_title?: string;
  confirmation_code?: string;
};

function cleanText(value: unknown, max = 500): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function optionalText(value: unknown, max = 500): string | null {
  const text = cleanText(value, max);
  return text || null;
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...(value as JsonRecord) } : {};
}

function requireAction(raw: unknown): TenantControlAction {
  const action = cleanText(raw, 64) as TenantControlAction;
  const allowed: TenantControlAction[] = [
    "update_profile",
    "create_branch",
    "update_branch",
    "change_package",
    "suspend_package",
    "resume_package",
    "cancel_subscription",
    "deactivate_store",
    "reactivate_store",
    "delete_store"
  ];
  if (!allowed.includes(action)) {
    throw new ItAdminGuardError("invalid_tenant_action", "Unknown tenant control action.", 422);
  }
  return action;
}

async function loadTenant(context: ItAdminContext, tenantId: string): Promise<TenantRow> {
  const { data, error } = await context.supabase
    .from("tenants")
    .select("id,tenant_code,name,display_name,tax_id,contact_email,contact_phone,is_active,logo_url,company_address,created_at,updated_at")
    .eq("id", tenantId)
    .maybeSingle<TenantRow>();
  if (error) throw new Error(`tenant_query_failed:${error.message}`);
  if (!data) throw new ItAdminGuardError("tenant_not_found", "Tenant was not found.", 404);
  return data;
}

async function loadCurrentContract(context: ItAdminContext, tenantId: string): Promise<ContractRow | null> {
  const active = await context.supabase
    .from("tenant_subscription_contracts")
    .select("id,tenant_id,package_id,billing_cycle,amount,currency,status,activated_at,start_at,end_at,trial_end_at,cancelled_at,metadata,created_at,updated_at")
    .eq("tenant_id", tenantId)
    .in("status", [...ACTIVE_CONTRACT_STATUSES])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<ContractRow>();
  if (active.error) throw new Error(`tenant_contract_query_failed:${active.error.message}`);
  if (active.data) return active.data;

  const latest = await context.supabase
    .from("tenant_subscription_contracts")
    .select("id,tenant_id,package_id,billing_cycle,amount,currency,status,activated_at,start_at,end_at,trial_end_at,cancelled_at,metadata,created_at,updated_at")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<ContractRow>();
  if (latest.error) throw new Error(`tenant_contract_query_failed:${latest.error.message}`);
  return latest.data ?? null;
}

async function audit(
  context: ItAdminContext,
  tenantId: string | undefined,
  action: string,
  targetTable: string,
  targetId: string | undefined,
  beforeData: JsonRecord,
  afterData: JsonRecord,
  metadata: JsonRecord = {}
) {
  await appendAuditLog({
    tenantId,
    actorUserId: context.auth.userId,
    actorRole: context.auth.platformRole,
    action,
    targetTable,
    targetId,
    module: "it_admin",
    beforeData,
    afterData,
    metadata,
    ipAddress: context.requestMeta.ipAddress ?? undefined,
    userAgent: context.requestMeta.userAgent ?? undefined
  });
}

function packageAmount(pkg: PackageRow, billingCycle: string): number {
  const raw = billingCycle === "yearly" ? pkg.yearly_price : pkg.monthly_price;
  const amount = Number(raw ?? 0);
  return Number.isFinite(amount) && amount >= 0 ? amount : 0;
}

export async function loadTenantControlCenter(context: ItAdminContext, tenantId: string) {
  const tenant = await loadTenant(context, tenantId);
  const [branchesResult, packagesResult, contract] = await Promise.all([
    context.supabase
      .from("branches")
      .select("id,tenant_id,branch_code,branch_name,address,status,is_active,created_at,updated_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: true })
      .returns<BranchRow[]>(),
    context.supabase
      .from("subscription_packages")
      .select("id,code,name,status,is_active,monthly_price,yearly_price,max_branches,max_devices,max_users,max_products,monthly_bill_limit,storage_limit_gb,retention_months")
      .eq("is_active", true)
      .eq("status", "active")
      .order("display_order", { ascending: true })
      .returns<PackageRow[]>(),
    loadCurrentContract(context, tenantId)
  ]);

  if (branchesResult.error) throw new Error(`tenant_branches_query_failed:${branchesResult.error.message}`);
  if (packagesResult.error) throw new Error(`subscription_packages_query_failed:${packagesResult.error.message}`);

  let currentPackage: PackageRow | null = null;
  if (contract?.package_id) {
    const result = await context.supabase
      .from("subscription_packages")
      .select("id,code,name,status,is_active,monthly_price,yearly_price,max_branches,max_devices,max_users,max_products,monthly_bill_limit,storage_limit_gb,retention_months")
      .eq("id", contract.package_id)
      .maybeSingle<PackageRow>();
    if (result.error) throw new Error(`current_package_query_failed:${result.error.message}`);
    currentPackage = result.data ?? null;
  }

  const activeSince = new Date(Date.now() - 5 * 60_000).toISOString();
  const [devicesResult, usersResult] = await Promise.all([
    context.supabase.from("branch_devices").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("is_active", true),
    context.supabase.from("user_branch_roles").select("user_id", { count: "exact", head: true }).eq("tenant_id", tenantId)
  ]);
  if (devicesResult.error) throw new Error(`tenant_devices_count_failed:${devicesResult.error.message}`);
  if (usersResult.error) throw new Error(`tenant_users_count_failed:${usersResult.error.message}`);

  const onlineResult = await context.supabase
    .from("branch_devices")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .gte("last_seen_at", activeSince);
  if (onlineResult.error) throw new Error(`tenant_online_devices_count_failed:${onlineResult.error.message}`);

  return {
    tenant,
    branches: branchesResult.data ?? [],
    packages: packagesResult.data ?? [],
    contract,
    current_package: currentPackage,
    usage: {
      active_devices: devicesResult.count ?? 0,
      assigned_users: usersResult.count ?? 0,
      online_devices_5m: onlineResult.count ?? 0
    },
    pos_notice: contract
      ? {
          status: contract.status,
          title: cleanText(asRecord(contract.metadata).customer_title, 120) || null,
          message: cleanText(asRecord(contract.metadata).customer_message, 600) || null,
          admin_reason: cleanText(asRecord(contract.metadata).admin_reason, 600) || null
        }
      : null
  };
}

export async function applyTenantControlAction(context: ItAdminContext, tenantId: string, input: TenantControlInput) {
  const action = requireAction(input.action);
  const tenant = await loadTenant(context, tenantId);
  const now = new Date().toISOString();

  if (action === "update_profile") {
    const displayName = cleanText(input.display_name, 160);
    const legalName = cleanText(input.legal_name, 200);
    if (!displayName && !legalName) {
      throw new ItAdminGuardError("store_name_required", "Store display name or legal name is required.", 422);
    }
    const changes = {
      display_name: displayName || tenant.display_name || tenant.name,
      name: legalName || tenant.name,
      tax_id: optionalText(input.tax_id, 32),
      contact_email: optionalText(input.contact_email, 160),
      contact_phone: optionalText(input.contact_phone, 40),
      company_address: optionalText(input.company_address, 1000),
      logo_url: optionalText(input.logo_url, 1000),
      updated_at: now
    };
    const { error } = await context.supabase.from("tenants").update(changes).eq("id", tenantId);
    if (error) throw new Error(`tenant_profile_update_failed:${error.message}`);
    await audit(context, tenantId, "tenant_profile_updated", "tenants", tenantId, asRecord(tenant), asRecord(changes));
  }

  if (action === "create_branch") {
    const branchCode = cleanText(input.branch_code, 64);
    const branchName = cleanText(input.branch_name, 160);
    if (!branchCode || !branchName) {
      throw new ItAdminGuardError("branch_fields_required", "Branch code and branch name are required.", 422);
    }
    const row = {
      tenant_id: tenantId,
      branch_code: branchCode,
      branch_name: branchName,
      address: { text: cleanText(input.branch_address, 1000) },
      status: "active",
      is_active: true,
      updated_at: now
    };
    const { data, error } = await context.supabase.from("branches").insert(row).select("id").single<{ id: string }>();
    if (error || !data) throw new Error(`branch_create_failed:${error?.message ?? "unknown"}`);
    await audit(context, tenantId, "branch_created", "branches", data.id, {}, asRecord(row));
  }

  if (action === "update_branch") {
    const branchId = cleanText(input.branch_id, 80);
    if (!branchId) throw new ItAdminGuardError("branch_id_required", "branch_id is required.", 422);
    const before = await context.supabase
      .from("branches")
      .select("id,tenant_id,branch_code,branch_name,address,status,is_active,created_at,updated_at")
      .eq("id", branchId)
      .eq("tenant_id", tenantId)
      .maybeSingle<BranchRow>();
    if (before.error) throw new Error(`branch_query_failed:${before.error.message}`);
    if (!before.data) throw new ItAdminGuardError("branch_not_found", "Branch was not found.", 404);

    const nextActive = typeof input.branch_active === "boolean" ? input.branch_active : before.data.is_active;
    const changes = {
      branch_name: cleanText(input.branch_name, 160) || before.data.branch_name,
      address: input.branch_address === undefined ? before.data.address : { text: cleanText(input.branch_address, 1000) },
      is_active: nextActive,
      status: nextActive ? "active" : "inactive",
      updated_at: now
    };
    const { error } = await context.supabase.from("branches").update(changes).eq("id", branchId).eq("tenant_id", tenantId);
    if (error) throw new Error(`branch_update_failed:${error.message}`);
    await audit(context, tenantId, "branch_updated", "branches", branchId, asRecord(before.data), asRecord(changes));
  }

  if (action === "change_package") {
    const packageId = cleanText(input.package_id, 80);
    const billingCycle = cleanText(input.billing_cycle, 20) || "monthly";
    if (!packageId) throw new ItAdminGuardError("package_id_required", "package_id is required.", 422);
    if (!BILLING_CYCLES.has(billingCycle)) {
      throw new ItAdminGuardError("invalid_billing_cycle", "Billing cycle must be monthly, yearly, or custom.", 422);
    }
    const packageResult = await context.supabase
      .from("subscription_packages")
      .select("id,code,name,status,is_active,monthly_price,yearly_price,max_branches,max_devices,max_users,max_products,monthly_bill_limit,storage_limit_gb,retention_months")
      .eq("id", packageId)
      .eq("is_active", true)
      .eq("status", "active")
      .maybeSingle<PackageRow>();
    if (packageResult.error) throw new Error(`package_query_failed:${packageResult.error.message}`);
    if (!packageResult.data) throw new ItAdminGuardError("package_not_available", "Selected package is not available.", 409);

    const previous = await loadCurrentContract(context, tenantId);
    const reason = optionalText(input.admin_reason, 600);
    const newContract = {
      tenant_id: tenantId,
      package_id: packageId,
      billing_cycle: billingCycle,
      amount: packageAmount(packageResult.data, billingCycle),
      currency: "THB",
      status: "active",
      activated_at: now,
      start_at: now,
      metadata: {
        source: "cpipos_it_admin",
        changed_by: context.auth.userId,
        admin_reason: reason,
        previous_contract_id: previous?.id ?? null
      }
    };
    const inserted = await context.supabase
      .from("tenant_subscription_contracts")
      .insert(newContract)
      .select("id")
      .single<{ id: string }>();
    if (inserted.error || !inserted.data) throw new Error(`contract_create_failed:${inserted.error?.message ?? "unknown"}`);

    if (previous && previous.id !== inserted.data.id && previous.status !== "cancelled" && previous.status !== "expired") {
      const oldMeta = asRecord(previous.metadata);
      const previousUpdate = await context.supabase
        .from("tenant_subscription_contracts")
        .update({
          status: "cancelled",
          cancelled_at: now,
          end_at: now,
          updated_at: now,
          metadata: { ...oldMeta, superseded_by_contract_id: inserted.data.id, superseded_at: now, superseded_by: context.auth.userId }
        })
        .eq("id", previous.id)
        .eq("tenant_id", tenantId);
      if (previousUpdate.error) {
        await context.supabase.from("tenant_subscription_contracts").delete().eq("id", inserted.data.id);
        throw new Error(`previous_contract_close_failed:${previousUpdate.error.message}`);
      }
    }
    await audit(
      context,
      tenantId,
      "tenant_package_changed",
      "tenant_subscription_contracts",
      inserted.data.id,
      asRecord(previous ?? {}),
      asRecord(newContract),
      { package_code: packageResult.data.code, package_name: packageResult.data.name }
    );
  }

  if (["suspend_package", "resume_package", "cancel_subscription"].includes(action)) {
    const contract = await loadCurrentContract(context, tenantId);
    if (!contract) throw new ItAdminGuardError("subscription_not_found", "This store has no subscription contract.", 409);
    if (!CONTRACT_STATUSES.has(contract.status)) throw new ItAdminGuardError("invalid_contract_status", "Unsupported contract status.", 409);
    const beforeMeta = asRecord(contract.metadata);
    let nextStatus = contract.status;
    const nextMeta = { ...beforeMeta };
    const changes: JsonRecord = { updated_at: now };

    if (action === "suspend_package") {
      if (contract.status !== "active" && contract.status !== "trial") {
        throw new ItAdminGuardError("subscription_not_suspendable", "Only active or trial subscriptions can be suspended.", 409);
      }
      const reason = cleanText(input.admin_reason, 600);
      const message = cleanText(input.customer_message, 600);
      if (reason.length < 4 || message.length < 4) {
        throw new ItAdminGuardError("suspension_reason_required", "Internal reason and customer message are required.", 422);
      }
      nextStatus = "suspended";
      nextMeta.previous_status = contract.status;
      nextMeta.admin_reason = reason;
      nextMeta.customer_title = cleanText(input.customer_title, 120) || "ระบบถูกระงับชั่วคราว";
      nextMeta.customer_message = message;
      nextMeta.suspended_at = now;
      nextMeta.suspended_by = context.auth.userId;
    }

    if (action === "resume_package") {
      if (contract.status !== "suspended") {
        throw new ItAdminGuardError("subscription_not_suspended", "Only a suspended subscription can be resumed.", 409);
      }
      const previousStatus = cleanText(nextMeta.previous_status, 20);
      nextStatus = previousStatus === "trial" ? "trial" : "active";
      nextMeta.resumed_at = now;
      nextMeta.resumed_by = context.auth.userId;
      delete nextMeta.customer_title;
      delete nextMeta.customer_message;
      delete nextMeta.admin_reason;
      delete nextMeta.suspended_at;
      delete nextMeta.suspended_by;
    }

    if (action === "cancel_subscription") {
      if (contract.status === "cancelled" || contract.status === "expired") {
        throw new ItAdminGuardError("subscription_already_closed", "Subscription is already closed.", 409);
      }
      const reason = cleanText(input.admin_reason, 600);
      if (reason.length < 4) throw new ItAdminGuardError("cancellation_reason_required", "Cancellation reason is required.", 422);
      nextStatus = "cancelled";
      nextMeta.admin_reason = reason;
      nextMeta.customer_title = cleanText(input.customer_title, 120) || "แพ็กเกจสิ้นสุดการใช้งาน";
      nextMeta.customer_message = cleanText(input.customer_message, 600) || "แพ็กเกจของร้านนี้ถูกยกเลิก กรุณาติดต่อผู้ดูแลระบบ";
      nextMeta.cancelled_by = context.auth.userId;
      nextMeta.cancelled_at = now;
      changes.cancelled_at = now;
      changes.end_at = now;
    }

    changes.status = nextStatus;
    changes.metadata = nextMeta;
    const { error } = await context.supabase
      .from("tenant_subscription_contracts")
      .update(changes)
      .eq("id", contract.id)
      .eq("tenant_id", tenantId);
    if (error) throw new Error(`subscription_update_failed:${error.message}`);
    await audit(
      context,
      tenantId,
      action === "suspend_package" ? "tenant_subscription_suspended" : action === "resume_package" ? "tenant_subscription_resumed" : "tenant_subscription_cancelled",
      "tenant_subscription_contracts",
      contract.id,
      asRecord(contract),
      { ...changes, status: nextStatus }
    );
  }

  if (action === "deactivate_store" || action === "reactivate_store") {
    const nextActive = action === "reactivate_store";
    const reason = cleanText(input.admin_reason, 600);
    if (!nextActive && reason.length < 4) {
      throw new ItAdminGuardError("deactivation_reason_required", "Reason is required when deactivating a store.", 422);
    }
    const changes = { is_active: nextActive, updated_at: now };
    const { error } = await context.supabase.from("tenants").update(changes).eq("id", tenantId);
    if (error) throw new Error(`tenant_status_update_failed:${error.message}`);
    await audit(context, tenantId, nextActive ? "tenant_reactivated" : "tenant_deactivated", "tenants", tenantId, asRecord(tenant), asRecord(changes), { admin_reason: reason || null });
  }

  if (action === "delete_store") {
    const confirmationCode = cleanText(input.confirmation_code, 80);
    const reason = cleanText(input.admin_reason, 600);
    if (confirmationCode !== tenant.tenant_code) {
      throw new ItAdminGuardError("tenant_delete_confirmation_failed", "Store code confirmation does not match.", 422);
    }
    if (reason.length < 8) {
      throw new ItAdminGuardError("tenant_delete_reason_required", "A detailed deletion reason is required.", 422);
    }
    if (tenant.is_active) {
      throw new ItAdminGuardError("tenant_must_be_inactive", "Deactivate the store before permanent deletion.", 409);
    }
    const contract = await loadCurrentContract(context, tenantId);
    if (contract && contract.status !== "cancelled" && contract.status !== "expired") {
      throw new ItAdminGuardError("subscription_must_be_closed", "Cancel or expire the subscription before permanent deletion.", 409);
    }
    const onlineSince = new Date(Date.now() - 5 * 60_000).toISOString();
    const online = await context.supabase
      .from("branch_devices")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .gte("last_seen_at", onlineSince);
    if (online.error) throw new Error(`tenant_delete_device_check_failed:${online.error.message}`);
    if ((online.count ?? 0) > 0) {
      throw new ItAdminGuardError("tenant_devices_still_online", "A device from this store was online within the last 5 minutes.", 409);
    }

    const snapshot = { tenant_code: tenant.tenant_code, name: tenant.name, display_name: tenant.display_name, deleted_at: now };
    const { error } = await context.supabase.from("tenants").delete().eq("id", tenantId);
    if (error) throw new Error(`tenant_delete_failed:${error.message}`);
    await audit(context, undefined, "tenant_permanently_deleted", "tenants", tenantId, asRecord(tenant), {}, { ...snapshot, admin_reason: reason, deleted_tenant_id: tenantId });
    return { deleted: true, tenant_id: tenantId, tenant_code: tenant.tenant_code };
  }

  return loadTenantControlCenter(context, tenantId);
}
