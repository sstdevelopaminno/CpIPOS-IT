import "server-only";

import crypto from "node:crypto";
import { appendAuditLog } from "@/lib/audit-log";
import { invalidateTenantFeatureGateCache } from "@/lib/feature-gate";
import { normalizePosSalesModes, toPosSalesModeViews, type PosSalesModeMap } from "@/lib/pos-sales-modes";
import { ItAdminGuardError, type ItAdminContext } from "@/lib/it-admin-guard";

const ACTIVE_CONTRACT_STATUSES = ["trial", "active", "suspended"] as const;
const BILLING_CYCLES = new Set(["monthly", "yearly"]);
const CONTRACT_STATUSES = new Set(["trial", "active", "suspended", "expired", "cancelled"]);
const DAY_MS = 86_400_000;

type JsonRecord = Record<string, unknown>;

type TenantDbRow = {
  id: string;
  code: string;
  name: string;
  display_name: string | null;
  owner_name: string | null;
  owner_phone: string | null;
  contact_phone: string | null;
  package_id: string | null;
  is_active: boolean;
  logo_url: string | null;
  company_address: string | null;
  created_at: string;
  updated_at: string;
};

type AccessCodeRow = {
  tenant_id: string;
  access_code: string;
  purpose: string | null;
  is_active: boolean;
  issued_at: string;
};

type BranchDbRow = {
  id: string;
  tenant_id: string;
  code: string;
  name: string;
  address: string | null;
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
  metadata?: unknown;
};

type ContractDbRow = {
  id: string;
  tenant_id: string;
  package_id: string;
  contract_type: string;
  billing_interval: string;
  deployment_mode: string;
  status: string;
  branch_limit: number | null;
  terminal_limit_per_branch: number | null;
  max_branches: number | null;
  max_devices: number | null;
  max_users: number | null;
  amount_per_cycle: number | string | null;
  currency: string;
  auto_renew: boolean;
  started_at: string;
  ended_at: string | null;
  metadata: unknown;
  created_at: string;
  updated_at: string;
};

type PaymentRequestRow = {
  id: string;
  tenant_id: string;
  requested_package_id: string | null;
  request_type: string;
  amount_reported: number | string | null;
  currency: string | null;
  status: string;
  evidence_url: string | null;
  submitted_at: string | null;
  reviewed_at: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

type ReceiptRow = {
  id: string;
  tenant_id: string;
  payment_request_id: string;
  receipt_number: string;
  issued_at: string;
  amount: number | string;
  currency: string;
};

type LifecycleRow = {
  tenant_id: string;
  lifecycle_status: string;
  trial_started_at: string | null;
  trial_expires_at: string | null;
  first_package_started_at: string | null;
  current_package_started_at: string | null;
  subscription_expires_at: string | null;
  access_locked: boolean;
  lock_reason: string | null;
  metadata: unknown;
};

export type TenantControlAction =
  | "update_profile"
  | "create_branch"
  | "update_branch"
  | "update_contract"
  | "prepare_paid_package"
  | "change_package"
  | "update_sales_modes"
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
  start_date?: string;
  end_date?: string;
  auto_calculate_end?: boolean;
  auto_renew?: boolean;
  admin_reason?: string;
  customer_message?: string;
  customer_title?: string;
  sales_modes?: Partial<PosSalesModeMap>;
  confirmation_code?: string;
};

const TENANT_SELECT = "id,code,name,display_name,owner_name,owner_phone,contact_phone,package_id,is_active,logo_url,company_address,created_at,updated_at";
const BRANCH_SELECT = "id,tenant_id,code,name,address,is_active,created_at,updated_at";
const PACKAGE_SELECT = "id,code,name,status,is_active,monthly_price,yearly_price,max_branches,max_devices,max_users,max_products,monthly_bill_limit,storage_limit_gb,retention_months,metadata";
const CONTRACT_SELECT = "id,tenant_id,package_id,contract_type,billing_interval,deployment_mode,status,branch_limit,terminal_limit_per_branch,max_branches,max_devices,max_users,amount_per_cycle,currency,auto_renew,started_at,ended_at,metadata,created_at,updated_at";
const LIFECYCLE_SELECT = "tenant_id,lifecycle_status,trial_started_at,trial_expires_at,first_package_started_at,current_package_started_at,subscription_expires_at,access_locked,lock_reason,metadata";

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
    "update_contract",
    "prepare_paid_package",
    "change_package",
    "update_sales_modes",
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

function requireBillingCycle(value: unknown, fallback = "monthly") {
  const cycle = cleanText(value, 20) || fallback;
  if (!BILLING_CYCLES.has(cycle)) {
    throw new ItAdminGuardError("invalid_billing_cycle", "Billing cycle must be monthly or yearly.", 422);
  }
  return cycle as "monthly" | "yearly";
}

function parseContractDate(value: unknown, field: string): string {
  const date = cleanText(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new ItAdminGuardError("invalid_contract_date", `${field} must use YYYY-MM-DD.`, 422);
  }
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new ItAdminGuardError("invalid_contract_date", `${field} is not a valid calendar date.`, 422);
  }
  return parsed.toISOString();
}

function addBillingPeriod(startIso: string, billingCycle: "monthly" | "yearly"): string {
  const source = new Date(startIso);
  const sourceYear = source.getUTCFullYear();
  const sourceMonth = source.getUTCMonth();
  const sourceDay = source.getUTCDate();
  const monthDelta = billingCycle === "yearly" ? 12 : 1;
  const absoluteMonth = sourceMonth + monthDelta;
  const targetYear = sourceYear + Math.floor(absoluteMonth / 12);
  const targetMonth = ((absoluteMonth % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const targetDay = Math.min(sourceDay, lastDay);
  return new Date(
    Date.UTC(
      targetYear,
      targetMonth,
      targetDay,
      source.getUTCHours(),
      source.getUTCMinutes(),
      source.getUTCSeconds(),
      source.getUTCMilliseconds()
    )
  ).toISOString();
}

function validateContractWindow(startIso: string, endIso: string) {
  if (new Date(endIso).getTime() <= new Date(startIso).getTime()) {
    throw new ItAdminGuardError("invalid_contract_window", "Contract expiry must be after the contract start date.", 422);
  }
}

function packageAmount(pkg: PackageRow, billingCycle: "monthly" | "yearly"): number {
  const raw = billingCycle === "yearly" ? pkg.yearly_price : pkg.monthly_price;
  const amount = Number(raw ?? 0);
  return Number.isFinite(amount) && amount >= 0 ? amount : 0;
}

function effectiveContractStatus(contract: ContractDbRow | null) {
  if (!contract) return "none";
  if ((contract.status === "active" || contract.status === "trial") && contract.ended_at) {
    const endMs = new Date(contract.ended_at).getTime();
    if (Number.isFinite(endMs) && endMs <= Date.now()) return "expired";
  }
  return contract.status;
}

function normalizeContract(contract: ContractDbRow | null, lifecycle: LifecycleRow | null) {
  if (!contract) return null;
  const metadata = asRecord(contract.metadata);
  const effectiveStatus = effectiveContractStatus(contract);
  const trialEndsAt = contract.status === "trial" ? lifecycle?.trial_expires_at ?? contract.ended_at : null;
  const displayedEndAt = contract.status === "trial" ? trialEndsAt : contract.ended_at;
  return {
    id: contract.id,
    tenant_id: contract.tenant_id,
    package_id: contract.package_id,
    contract_type: contract.contract_type,
    billing_cycle: contract.billing_interval,
    billing_interval: contract.billing_interval,
    amount: contract.amount_per_cycle,
    amount_per_cycle: contract.amount_per_cycle,
    currency: contract.currency,
    status: contract.status,
    effective_status: effectiveStatus,
    auto_renew: contract.auto_renew,
    activated_at: contract.started_at,
    start_at: contract.started_at,
    started_at: contract.started_at,
    end_at: displayedEndAt,
    ended_at: displayedEndAt,
    trial_end_at: trialEndsAt,
    cancelled_at: cleanText(metadata.cancelled_at, 80) || null,
    max_branches: contract.max_branches ?? contract.branch_limit,
    max_devices: contract.max_devices ?? contract.terminal_limit_per_branch,
    max_users: contract.max_users,
    metadata: contract.metadata,
    created_at: contract.created_at,
    updated_at: contract.updated_at,
    days_remaining: displayedEndAt ? Math.max(0, Math.ceil((new Date(displayedEndAt).getTime() - Date.now()) / DAY_MS)) : null
  };
}

async function loadTenant(context: ItAdminContext, tenantId: string): Promise<TenantDbRow> {
  const { data, error } = await context.supabase.from("tenants").select(TENANT_SELECT).eq("id", tenantId).maybeSingle<TenantDbRow>();
  if (error) throw new Error(`tenant_query_failed:${error.message}`);
  if (!data) throw new ItAdminGuardError("tenant_not_found", "Tenant was not found.", 404);
  return data;
}

async function loadLatestAccessCode(context: ItAdminContext, tenantId: string): Promise<AccessCodeRow | null> {
  const { data, error } = await context.supabase
    .from("tenant_access_codes")
    .select("tenant_id,access_code,purpose,is_active,issued_at")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order("issued_at", { ascending: false })
    .limit(1)
    .returns<AccessCodeRow[]>();
  if (error) throw new Error(`tenant_access_code_query_failed:${error.message}`);
  return data?.[0] ?? null;
}

async function loadCurrentContract(context: ItAdminContext, tenantId: string): Promise<ContractDbRow | null> {
  const latest = await context.supabase
    .from("tenant_subscription_contracts")
    .select(CONTRACT_SELECT)
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<ContractDbRow>();
  if (latest.error) throw new Error(`tenant_contract_query_failed:${latest.error.message}`);
  return latest.data ?? null;
}

async function loadLifecycle(context: ItAdminContext, tenantId: string): Promise<LifecycleRow | null> {
  const { data, error } = await context.supabase.from("tenant_data_lifecycle").select(LIFECYCLE_SELECT).eq("tenant_id", tenantId).maybeSingle<LifecycleRow>();
  if (error) throw new Error(`tenant_lifecycle_query_failed:${error.message}`);
  return data ?? null;
}

async function updateLifecycle(context: ItAdminContext, tenantId: string, patch: JsonRecord) {
  const current = await loadLifecycle(context, tenantId);
  if (!current) return;
  const { error } = await context.supabase
    .from("tenant_data_lifecycle")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId);
  if (error) throw new Error(`tenant_lifecycle_update_failed:${error.message}`);
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

export async function loadTenantControlCenter(context: ItAdminContext, tenantId: string) {
  const tenant = await loadTenant(context, tenantId);
  const [branchesResult, packagesResult, contract, accessCode, lifecycle, paymentRequestResult, receiptResult] = await Promise.all([
    context.supabase.from("branches").select(BRANCH_SELECT).eq("tenant_id", tenantId).order("created_at", { ascending: true }).returns<BranchDbRow[]>(),
    context.supabase
      .from("subscription_packages")
      .select(PACKAGE_SELECT)
      .eq("is_active", true)
      .eq("status", "active")
      .order("display_order", { ascending: true })
      .returns<PackageRow[]>(),
    loadCurrentContract(context, tenantId),
    loadLatestAccessCode(context, tenantId),
    loadLifecycle(context, tenantId),
    context.supabase
      .from("tenant_subscription_payment_requests")
      .select("id,tenant_id,requested_package_id,request_type,amount_reported,currency,status,evidence_url,submitted_at,reviewed_at,metadata,created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<PaymentRequestRow>(),
    context.supabase
      .from("tenant_subscription_receipts")
      .select("id,tenant_id,payment_request_id,receipt_number,issued_at,amount,currency")
      .eq("tenant_id", tenantId)
      .order("issued_at", { ascending: false })
      .limit(1)
      .maybeSingle<ReceiptRow>()
  ]);

  if (branchesResult.error) throw new Error(`tenant_branches_query_failed:${branchesResult.error.message}`);
  if (packagesResult.error) throw new Error(`subscription_packages_query_failed:${packagesResult.error.message}`);
  if (paymentRequestResult.error) throw new Error(`subscription_payment_request_query_failed:${paymentRequestResult.error.message}`);
  if (receiptResult.error) throw new Error(`subscription_receipt_query_failed:${receiptResult.error.message}`);

  const packages = packagesResult.data ?? [];
  const currentPackageId = contract?.package_id ?? tenant.package_id;
  let currentPackage = currentPackageId ? packages.find((pkg) => pkg.id === currentPackageId) ?? null : null;
  if (!currentPackage && currentPackageId) {
    const result = await context.supabase.from("subscription_packages").select(PACKAGE_SELECT).eq("id", currentPackageId).maybeSingle<PackageRow>();
    if (result.error) throw new Error(`current_package_query_failed:${result.error.message}`);
    currentPackage = result.data ?? null;
  }

  const activeSince = new Date(Date.now() - 5 * 60_000).toISOString();
  const [devicesResult, cashierResult, onlineResult, userRolesResult] = await Promise.all([
    context.supabase.from("branch_devices").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("is_active", true),
    context.supabase.from("branch_devices").select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId).eq("device_type", "pos_terminal").eq("status", "active").eq("is_active", true),
    context.supabase.from("branch_devices").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("is_active", true).gte("last_seen_at", activeSince),
    context.supabase.from("user_branch_roles").select("user_id").eq("tenant_id", tenantId).returns<Array<{ user_id: string }>>()
  ]);
  if (devicesResult.error) throw new Error(`tenant_devices_count_failed:${devicesResult.error.message}`);
  if (cashierResult.error) throw new Error(`tenant_cashier_count_failed:${cashierResult.error.message}`);
  if (onlineResult.error) throw new Error(`tenant_online_devices_count_failed:${onlineResult.error.message}`);
  if (userRolesResult.error) throw new Error(`tenant_users_count_failed:${userRolesResult.error.message}`);

  const storeCode = accessCode?.access_code ?? tenant.code;
  const contractView = normalizeContract(contract, lifecycle);
  const metadata = asRecord(contract?.metadata);
  const salesModes = toPosSalesModeViews(metadata.sales_modes);
  const uniqueUsers = new Set((userRolesResult.data ?? []).map((row) => row.user_id).filter(Boolean));

  return {
    tenant: {
      id: tenant.id,
      tenant_code: storeCode,
      store_code: storeCode,
      internal_code: tenant.code,
      name: tenant.name,
      display_name: tenant.display_name,
      tax_id: null,
      contact_email: null,
      contact_phone: tenant.contact_phone ?? tenant.owner_phone,
      is_active: tenant.is_active,
      logo_url: tenant.logo_url,
      company_address: tenant.company_address,
      package_id: tenant.package_id,
      created_at: tenant.created_at,
      updated_at: tenant.updated_at
    },
    branches: (branchesResult.data ?? []).map((branch) => ({
      ...branch,
      branch_code: branch.code,
      branch_name: branch.name,
      status: branch.is_active ? "active" : "inactive"
    })),
    packages,
    contract: contractView,
    current_package: currentPackage,
    lifecycle,
    usage: {
      active_devices: devicesResult.count ?? 0,
      cashier_active: cashierResult.count ?? 0,
      assigned_users: uniqueUsers.size,
      online_devices_5m: onlineResult.count ?? 0
    },
    sales_modes: salesModes,
    billing: {
      latest_request: paymentRequestResult.data ? {
        id: paymentRequestResult.data.id,
        requested_package_id: paymentRequestResult.data.requested_package_id,
        request_type: paymentRequestResult.data.request_type,
        amount_reported: paymentRequestResult.data.amount_reported,
        currency: paymentRequestResult.data.currency ?? "THB",
        status: paymentRequestResult.data.status,
        has_evidence: Boolean(paymentRequestResult.data.evidence_url),
        submitted_at: paymentRequestResult.data.submitted_at,
        reviewed_at: paymentRequestResult.data.reviewed_at,
        kind: paymentRequestResult.data.metadata?.kind === "payment_notice" ? "payment_notice" : "renewal_intent",
        billing_interval: paymentRequestResult.data.metadata?.billing_interval === "yearly" ? "yearly" : "monthly",
        expected_amount: paymentRequestResult.data.metadata?.expected_amount == null
          ? null
          : Number(paymentRequestResult.data.metadata.expected_amount),
        source: typeof paymentRequestResult.data.metadata?.source === "string"
          ? paymentRequestResult.data.metadata.source
          : "unknown"
      } : null,
      latest_receipt: receiptResult.data ? {
        id: receiptResult.data.id,
        payment_request_id: receiptResult.data.payment_request_id,
        number: receiptResult.data.receipt_number,
        issued_at: receiptResult.data.issued_at,
        amount: Number(receiptResult.data.amount),
        currency: receiptResult.data.currency || "THB"
      } : null
    },
    pos_notice: contract
      ? {
          status: contractView?.effective_status ?? contract.status,
          title: cleanText(metadata.customer_title, 120) || null,
          message: cleanText(metadata.customer_message, 600) || null,
          admin_reason: cleanText(metadata.admin_reason, 600) || null
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
    const branchCode = cleanText(input.branch_code, 64).toLowerCase();
    const branchName = cleanText(input.branch_name, 160);
    if (!branchCode || !branchName) {
      throw new ItAdminGuardError("branch_fields_required", "Branch code and branch name are required.", 422);
    }
    const row = {
      tenant_id: tenantId,
      code: branchCode,
      name: branchName,
      address: optionalText(input.branch_address, 1000),
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
    const before = await context.supabase.from("branches").select(BRANCH_SELECT).eq("id", branchId).eq("tenant_id", tenantId).maybeSingle<BranchDbRow>();
    if (before.error) throw new Error(`branch_query_failed:${before.error.message}`);
    if (!before.data) throw new ItAdminGuardError("branch_not_found", "Branch was not found.", 404);
    const changes = {
      name: cleanText(input.branch_name, 160) || before.data.name,
      address: input.branch_address === undefined ? before.data.address : optionalText(input.branch_address, 1000),
      is_active: typeof input.branch_active === "boolean" ? input.branch_active : before.data.is_active,
      updated_at: now
    };
    const { error } = await context.supabase.from("branches").update(changes).eq("id", branchId).eq("tenant_id", tenantId);
    if (error) throw new Error(`branch_update_failed:${error.message}`);
    await audit(context, tenantId, "branch_updated", "branches", branchId, asRecord(before.data), asRecord(changes));
  }

  if (action === "update_contract") {
    const contract = await loadCurrentContract(context, tenantId);
    if (!contract) throw new ItAdminGuardError("subscription_not_found", "This store has no subscription contract.", 409);
    if (contract.status === "cancelled" || contract.status === "expired") {
      throw new ItAdminGuardError("subscription_closed", "Closed contracts cannot be edited. Activate a package to create a new contract.", 409);
    }
    const paidActiveContract = contract.status === "active" && Number(contract.amount_per_cycle ?? 0) > 0;
    const currentBillingCycle = BILLING_CYCLES.has(contract.billing_interval) ? contract.billing_interval : "monthly";
    const requestedBillingCycle = requireBillingCycle(input.billing_cycle, currentBillingCycle);
    if (paidActiveContract && requestedBillingCycle !== currentBillingCycle) {
      throw new ItAdminGuardError(
        "paid_contract_cycle_managed_by_settlement",
        "แพ็กเกจที่ชำระเงินจริงเปลี่ยนรอบรายเดือน/รายปีได้ผ่านตารางชำระแพ็กเกจเท่านั้น เพื่อให้ Settlement และใบเสร็จตรงกัน",
        409
      );
    }
    const correctionReason = optionalText(input.admin_reason, 600);
    if (paidActiveContract && (!correctionReason || correctionReason.length < 4)) {
      throw new ItAdminGuardError(
        "paid_contract_correction_reason_required",
        "กรุณาระบุเหตุผลการแก้ไขสัญญาอย่างน้อย 4 ตัวอักษร เพื่อบันทึก Audit",
        422
      );
    }
    const billingCycle = paidActiveContract ? currentBillingCycle : requestedBillingCycle;
    const startIso = input.start_date ? parseContractDate(input.start_date, "start_date") : contract.started_at;
    const endIso = input.auto_calculate_end === false && input.end_date
      ? parseContractDate(input.end_date, "end_date")
      : input.end_date
        ? parseContractDate(input.end_date, "end_date")
        : addBillingPeriod(startIso, billingCycle);
    validateContractWindow(startIso, endIso);

    const packageResult = await context.supabase.from("subscription_packages").select(PACKAGE_SELECT).eq("id", contract.package_id).maybeSingle<PackageRow>();
    if (packageResult.error) throw new Error(`package_query_failed:${packageResult.error.message}`);
    const contractMetadata = asRecord(contract.metadata);
    const changes: JsonRecord = {
      billing_interval: billingCycle,
      amount_per_cycle: paidActiveContract
        ? contract.amount_per_cycle
        : packageResult.data ? packageAmount(packageResult.data, billingCycle) : contract.amount_per_cycle,
      auto_renew: typeof input.auto_renew === "boolean" ? input.auto_renew : contract.auto_renew,
      started_at: startIso,
      ended_at: endIso,
      updated_at: now
    };
    if (paidActiveContract) {
      changes.metadata = {
        ...contractMetadata,
        last_admin_contract_correction: {
          reason: correctionReason,
          corrected_at: now,
          corrected_by: context.auth.userId,
          previous_started_at: contract.started_at,
          previous_ended_at: contract.ended_at,
          new_started_at: startIso,
          new_ended_at: endIso,
          settlement_rows_unchanged: true,
          receipt_rows_unchanged: true
        }
      };
    }
    const { error } = await context.supabase.from("tenant_subscription_contracts").update(changes).eq("id", contract.id).eq("tenant_id", tenantId);
    if (error) throw new Error(`contract_update_failed:${error.message}`);

    const lifecycle = await loadLifecycle(context, tenantId);
    if (lifecycle) {
      const expiresInPast = Date.parse(endIso) <= Date.now();
      const lifecyclePatch: JsonRecord = contract.status === "trial"
        ? { trial_started_at: startIso, trial_expires_at: endIso, access_locked: expiresInPast, lock_reason: expiresInPast ? "trial_expired" : null }
        : {
            current_package_started_at: startIso,
            subscription_expires_at: endIso,
            lifecycle_status: contract.status === "active" ? (expiresInPast ? "expired" : "active") : lifecycle.lifecycle_status,
            access_locked: contract.status === "suspended" || expiresInPast,
            lock_reason: contract.status === "suspended" ? lifecycle.lock_reason : expiresInPast ? "subscription_expired" : null
          };
      await updateLifecycle(context, tenantId, lifecyclePatch);
    }
    invalidateTenantFeatureGateCache(tenantId);
    await audit(
      context,
      tenantId,
      paidActiveContract ? "tenant_paid_contract_admin_corrected" : "tenant_contract_dates_updated",
      "tenant_subscription_contracts",
      contract.id,
      asRecord(contract),
      asRecord(changes),
      paidActiveContract ? { admin_reason: correctionReason, settlement_rows_unchanged: true, receipt_rows_unchanged: true } : {}
    );
  }

  if (action === "change_package") {
    throw new ItAdminGuardError(
      "paid_activation_requires_settlement",
      "ห้ามเปิดหรือเปลี่ยนแพ็กเกจที่มีค่าบริการจาก Tenants / Stores โดยตรง กรุณาสร้างรายการชำระแล้วไปอนุมัติในตารางชำระแพ็กเกจ",
      409
    );
  }

  if (action === "prepare_paid_package") {
    const packageId = cleanText(input.package_id, 80);
    if (!packageId) throw new ItAdminGuardError("package_id_required", "package_id is required.", 422);
    const billingCycle = requireBillingCycle(input.billing_cycle);
    const packageResult = await context.supabase
      .from("subscription_packages")
      .select(PACKAGE_SELECT)
      .eq("id", packageId)
      .eq("is_active", true)
      .eq("status", "active")
      .maybeSingle<PackageRow>();
    if (packageResult.error) throw new Error(`package_query_failed:${packageResult.error.message}`);
    if (!packageResult.data) throw new ItAdminGuardError("package_not_available", "Selected package is not available.", 409);

    const expectedAmount = packageAmount(packageResult.data, billingCycle);
    if (!Number.isFinite(expectedAmount) || expectedAmount <= 0) {
      throw new ItAdminGuardError(
        billingCycle === "yearly" ? "yearly_price_not_configured" : "package_price_not_configured",
        billingCycle === "yearly"
          ? "แพ็กเกจนี้ยังไม่มีราคารายปี กรุณาตั้งราคาในระบบ IT ก่อนสร้างรายการชำระ"
          : "แพ็กเกจนี้ไม่มีราคากลาง กรุณาใช้สัญญา CUSTOM ที่กำหนดราคาเฉพาะร้าน",
        422
      );
    }

    const existing = await context.supabase
      .from("tenant_subscription_payment_requests")
      .select("id,status,requested_package_id,metadata")
      .eq("tenant_id", tenantId)
      .in("status", ["pending", "under_review"])
      .limit(1)
      .maybeSingle<{ id: string; status: string; requested_package_id: string | null; metadata: Record<string, unknown> | null }>();
    if (existing.error) throw new Error(`subscription_open_request_query_failed:${existing.error.message}`);
    if (existing.data) {
      throw new ItAdminGuardError(
        "open_payment_request_exists",
        "ร้านนี้มีรายการชำระที่กำลังรอตรวจสอบอยู่แล้ว กรุณาเปิดตารางชำระแพ็กเกจเพื่อตรวจสอบรายการเดิม",
        409
      );
    }

    const previous = await loadCurrentContract(context, tenantId);
    const requestType = !previous
      ? "new_subscription"
      : previous.status === "trial"
        ? "trial_conversion"
        : previous.package_id !== packageId
          ? "package_change"
          : "renewal";
    const reason = optionalText(input.admin_reason, 600);
    const requestId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const metadata = {
      kind: "payment_notice",
      billing_interval: billingCycle,
      expected_amount: expectedAmount,
      source: "it_tenant_control",
      created_by_it: context.auth.userId,
      payer_name: "",
      transfer_reference: "",
      transfer_at: "",
      note: reason ?? "",
      requested_start_date: cleanText(input.start_date, 10) || null,
      auto_renew_requested: typeof input.auto_renew === "boolean" ? input.auto_renew : false,
      receipt_policy: "issue_only_after_verified_settlement"
    };

    const inserted = await context.supabase
      .from("tenant_subscription_payment_requests")
      .insert({
        id: requestId,
        tenant_id: tenantId,
        requested_package_id: packageId,
        request_type: requestType,
        amount_reported: null,
        currency: "THB",
        evidence_url: null,
        status: "pending",
        metadata
      })
      .select("id")
      .single<{ id: string }>();
    if (inserted.error || !inserted.data) {
      if (inserted.error?.code === "23505") {
        throw new ItAdminGuardError(
          "open_payment_request_exists",
          "ร้านนี้มีรายการชำระที่กำลังรอตรวจสอบอยู่แล้ว กรุณาเปิดตารางชำระแพ็กเกจเพื่อตรวจสอบรายการเดิม",
          409
        );
      }
      throw new Error(`subscription_payment_request_create_failed:${inserted.error?.message ?? "unknown"}`);
    }

    await audit(
      context,
      tenantId,
      "subscription_payment_request_created_by_it",
      "tenant_subscription_payment_requests",
      inserted.data.id,
      {},
      {
        tenant_id: tenantId,
        requested_package_id: packageId,
        request_type: requestType,
        expected_amount: expectedAmount,
        billing_interval: billingCycle,
        status: "pending",
        created_at: createdAt
      },
      {
        package_code: packageResult.data.code,
        package_name: packageResult.data.name,
        first_paid_activation: previous?.status === "trial" || !previous,
        receipt_policy: "automatic_after_verified_settlement"
      }
    );
  }

  if (action === "update_sales_modes") {
    const contract = await loadCurrentContract(context, tenantId);
    if (!contract) throw new ItAdminGuardError("subscription_not_found", "This store has no subscription contract.", 409);
    if (contract.status === "cancelled" || effectiveContractStatus(contract) === "expired") {
      throw new ItAdminGuardError("subscription_closed", "Closed contracts cannot update POS sales modes.", 409);
    }
    const nextModes = normalizePosSalesModes(input.sales_modes);
    if (!Object.values(nextModes).some(Boolean)) {
      throw new ItAdminGuardError("sales_mode_required", "At least one POS sales mode must stay enabled.", 422);
    }
    const beforeMeta = asRecord(contract.metadata);
    const reason = optionalText(input.admin_reason, 600);
    const changes = {
      updated_at: now,
      metadata: {
        ...beforeMeta,
        sales_modes: nextModes,
        sales_modes_updated_at: now,
        sales_modes_updated_by: context.auth.userId,
        sales_modes_admin_reason: reason
      }
    };
    const { error } = await context.supabase.from("tenant_subscription_contracts").update(changes).eq("id", contract.id).eq("tenant_id", tenantId);
    if (error) throw new Error(`sales_modes_update_failed:${error.message}`);
    invalidateTenantFeatureGateCache(tenantId);
    await audit(context, tenantId, "tenant_sales_modes_updated", "tenant_subscription_contracts", contract.id, asRecord(contract), asRecord(changes), { sales_modes: nextModes, admin_reason: reason });
  }
  if (["suspend_package", "resume_package", "cancel_subscription"].includes(action)) {
    const contract = await loadCurrentContract(context, tenantId);
    if (!contract) throw new ItAdminGuardError("subscription_not_found", "This store has no subscription contract.", 409);
    if (!CONTRACT_STATUSES.has(contract.status)) throw new ItAdminGuardError("invalid_contract_status", "Unsupported contract status.", 409);
    const beforeMeta = asRecord(contract.metadata);
    let nextStatus = contract.status;
    const nextMeta = { ...beforeMeta };
    const changes: JsonRecord = { updated_at: now };
    let customerTitle: string | null = null;
    let customerMessage: string | null = null;

    if (action === "suspend_package") {
      if (!ACTIVE_CONTRACT_STATUSES.includes(contract.status as (typeof ACTIVE_CONTRACT_STATUSES)[number]) || contract.status === "suspended") {
        throw new ItAdminGuardError("subscription_not_suspendable", "Only active or trial subscriptions can be suspended.", 409);
      }
      const reason = cleanText(input.admin_reason, 600);
      const message = cleanText(input.customer_message, 600);
      if (reason.length < 4 || message.length < 4) {
        throw new ItAdminGuardError("suspension_reason_required", "Internal reason and customer message are required.", 422);
      }
      nextStatus = "suspended";
      customerTitle = cleanText(input.customer_title, 120) || "ระบบถูกระงับชั่วคราว";
      customerMessage = message;
      nextMeta.previous_status = contract.status;
      nextMeta.admin_reason = reason;
      nextMeta.customer_title = customerTitle;
      nextMeta.customer_message = customerMessage;
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
      customerTitle = cleanText(input.customer_title, 120) || "แพ็กเกจสิ้นสุดการใช้งาน";
      customerMessage = cleanText(input.customer_message, 600) || "แพ็กเกจของร้านนี้ถูกยกเลิก กรุณาติดต่อผู้ดูแลระบบ";
      nextMeta.admin_reason = reason;
      nextMeta.customer_title = customerTitle;
      nextMeta.customer_message = customerMessage;
      nextMeta.cancelled_by = context.auth.userId;
      nextMeta.cancelled_at = now;
      changes.ended_at = now;
    }

    changes.status = nextStatus;
    changes.metadata = nextMeta;
    const { error } = await context.supabase.from("tenant_subscription_contracts").update(changes).eq("id", contract.id).eq("tenant_id", tenantId);
    if (error) throw new Error(`subscription_update_failed:${error.message}`);

    const lifecycle = await loadLifecycle(context, tenantId);
    if (lifecycle) {
      const lifecycleMeta = asRecord(lifecycle.metadata);
      if (action === "suspend_package") {
        await updateLifecycle(context, tenantId, {
          lifecycle_status: "suspended",
          access_locked: true,
          lock_reason: "subscription_suspended",
          metadata: { ...lifecycleMeta, pos_notice: { status: "suspended", title: customerTitle, message: customerMessage, updated_at: now } }
        });
      } else if (action === "resume_package") {
        await updateLifecycle(context, tenantId, {
          lifecycle_status: nextStatus === "trial" ? "trial" : "active",
          access_locked: false,
          lock_reason: null,
          metadata: { ...lifecycleMeta, pos_notice: null }
        });
      } else {
        await updateLifecycle(context, tenantId, {
          lifecycle_status: "expired",
          subscription_expires_at: now,
          access_locked: true,
          lock_reason: "subscription_cancelled",
          metadata: { ...lifecycleMeta, pos_notice: { status: "cancelled", title: customerTitle, message: customerMessage, updated_at: now } }
        });
      }
    }

    invalidateTenantFeatureGateCache(tenantId);
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
    const accessCode = await loadLatestAccessCode(context, tenantId);
    const confirmationCode = cleanText(input.confirmation_code, 80);
    const expectedCode = accessCode?.access_code ?? tenant.code;
    const reason = cleanText(input.admin_reason, 600);
    if (confirmationCode !== expectedCode) {
      throw new ItAdminGuardError("tenant_delete_confirmation_failed", "Store code confirmation does not match.", 422);
    }
    if (reason.length < 8) {
      throw new ItAdminGuardError("tenant_delete_reason_required", "A detailed deletion reason is required.", 422);
    }
    if (tenant.is_active) {
      throw new ItAdminGuardError("tenant_must_be_inactive", "Deactivate the store before permanent deletion.", 409);
    }

    // A single database transaction removes primary store rows and exclusive Auth
    // identities. An active trial is deleted with the store; no separate contract
    // cancellation is required. Shared users and IT accounts are never removed.
    const { data: deleted, error: deletionError } = await context.supabase.rpc("it_delete_tenant_cascade", {
      p_tenant_id: tenantId,
      p_confirmation_code: confirmationCode,
      p_admin_reason: reason,
      p_actor_user_id: context.auth.userId
    });
    if (deletionError || !deleted?.deleted) {
      const dbCode = String(deletionError?.message ?? "");
      const code = dbCode.match(/tenant_delete_[a-z_]+|tenant_must_be_inactive|tenant_devices_still_online|tenant_not_found/)?.[0];
      const messages: Record<string, string> = {
        tenant_delete_cross_plane_requires_reconciliation: "Store data may be on another database. Reconcile data routing before permanent deletion.",
        tenant_delete_desktop_license_requires_reconciliation: "This store has a separate Desktop license. Resolve the license and its receipts before deleting the store.",
        tenant_delete_unmanaged_table: "A store data table needs a safe deletion rule. Nothing has been deleted.",
        tenant_delete_confirmation_failed: "Store code confirmation does not match.",
        tenant_delete_reason_required: "A detailed deletion reason is required.",
        tenant_devices_still_online: "A device from this store was online within the last 5 minutes.",
        tenant_must_be_inactive: "Deactivate the store before permanent deletion.",
        tenant_not_found: "Store was already removed or could not be found."
      };
      if (code) {
        throw new ItAdminGuardError(code, messages[code] ?? "Store deletion was rolled back. Contact IT with the error code.", 409);
      }
      console.error("[tenant-permanent-delete] atomic transaction failed", {
        tenantId, code: deletionError?.code, message: deletionError?.message
      });
      throw new ItAdminGuardError("tenant_delete_transaction_failed", "Unable to delete all related store data atomically. No store data was removed.", 409);
    }

    const files = (Array.isArray(deleted.storage_objects) ? deleted.storage_objects : []) as Array<{
      bucket: string; path: string
    }>;
    let storageCleanupPending = files.length > 0;
    if (storageCleanupPending) {
      try {
        const byBucket = new Map<string, string[]>();
        for (const file of files) {
          if (!file.bucket || !file.path?.startsWith(tenantId + "/")) {
            throw new Error("Invalid tenant-scoped storage path");
          }
          byBucket.set(file.bucket, [...(byBucket.get(file.bucket) ?? []), file.path]);
        }
        for (const [bucket, paths] of byBucket) {
          for (let offset = 0; offset < paths.length; offset += 100) {
            const { error } = await context.supabase.storage.from(bucket).remove(paths.slice(offset, offset + 100));
            if (error) throw error;
          }
        }
        const { error: cleanupError } = await context.supabase
          .from("it_tenant_deletion_cleanup")
          .update({ status: "complete", completed_at: new Date().toISOString() })
          .eq("tenant_id", tenantId);
        if (cleanupError) throw cleanupError;
        storageCleanupPending = false;
      } catch (cleanupError) {
        // The durable journal still contains every tenant-owned storage path,
        // so support can retry without ever resurrecting or duplicating a tenant.
        console.error("[tenant-permanent-delete] storage cleanup pending", {
          tenantId, message: cleanupError instanceof Error ? cleanupError.message : "unknown"
        });
      }
    }

    invalidateTenantFeatureGateCache(tenantId);
    const snapshot = { store_code: expectedCode, internal_code: tenant.code, name: tenant.name, deleted_at: now };
    await audit(context, undefined, "tenant_permanently_deleted", "tenants", tenantId, asRecord(tenant), {}, {
      ...snapshot, admin_reason: reason, deleted_tenant_id: tenantId,
      auth_users_deleted: deleted.auth_users_deleted,
      shared_users_preserved: deleted.shared_users_preserved,
      storage_cleanup_pending: storageCleanupPending
    });
    return {
      deleted: true,
      tenant_id: tenantId,
      tenant_code: expectedCode,
      auth_users_deleted: deleted.auth_users_deleted,
      shared_users_preserved: deleted.shared_users_preserved,
      storage_cleanup_pending: storageCleanupPending
    };
  }

  return loadTenantControlCenter(context, tenantId);
}
