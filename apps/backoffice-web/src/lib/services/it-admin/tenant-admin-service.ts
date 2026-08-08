import "server-only";

import { appendAuditLog } from "@/lib/audit-log";
import { invalidateTenantFeatureGateCache } from "@/lib/feature-gate";
import type { ItAdminContext } from "@/lib/it-admin-guard";

export type TenantSummaryStatus = "active" | "inactive" | "suspended" | "all";

export type TenantSummaryQuery = {
  limit?: number;
  cursor?: string | null;
  search?: string | null;
  status?: TenantSummaryStatus;
  packageCode?: string | null;
};

export type TenantCreateInput = {
  code?: string;
  name?: string;
  owner?: {
    name?: string | null;
    phone?: string | null;
    email?: string | null;
  } | null;
  initial_branch?: {
    code?: string | null;
    name?: string | null;
    address?: string | null;
  } | null;
  package_id?: string | null;
  contract?: {
    status?: "trial" | "active" | "suspended" | "expired" | "cancelled";
    billing_interval?: "monthly" | "yearly";
    max_branches?: number | null;
    max_devices?: number | null;
    max_users?: number | null;
    amount_per_cycle?: number | null;
    currency?: string | null;
  } | null;
};

export type TenantPatchInput = {
  code?: string;
  name?: string;
  owner_name?: string | null;
  owner_phone?: string | null;
  owner_email?: string | null;
  package_id?: string | null;
  is_active?: boolean;
  reason?: string | null;
};

type TenantSummaryRow = {
  id: string;
  code: string;
  name: string;
  owner_name: string | null;
  owner_phone: string | null;
  package_id: string | null;
  package_code: string | null;
  package_name: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  contract_id: string | null;
  contract_status: string | null;
  contract_started_at: string | null;
  contract_ended_at: string | null;
  branch_count: number;
  active_branch_count: number;
  device_count: number;
  active_device_count: number;
  active_session_count: number;
  open_shift_count: number;
};

type TenantRow = {
  id: string;
  code: string;
  name: string;
  owner_name: string | null;
  owner_phone: string | null;
  package_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type BranchRow = {
  id: string;
  tenant_id: string;
  code: string;
  name: string;
  address: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type ContractRow = {
  id: string;
  tenant_id: string;
  package_id: string;
  status: string;
  branch_limit: number | null;
  terminal_limit_per_branch: number | null;
  max_branches: number | null;
  max_devices: number | null;
  max_users: number | null;
  amount_per_cycle: number | null;
  currency: string | null;
  started_at: string;
  ended_at: string | null;
  created_at: string;
};

type ContractSummaryRow = {
  id: string;
  tenant_id: string;
  package_id: string;
  status: string;
  started_at: string;
  ended_at: string | null;
  created_at: string;
};

const DEFAULT_TENANT_LIMIT = 50;
const MAX_TENANT_LIMIT = 100;

function clampLimit(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_TENANT_LIMIT;
  return Math.max(1, Math.min(MAX_TENANT_LIMIT, Math.trunc(parsed)));
}

function normalizeCode(value: unknown) {
  return String(value ?? "").trim().toUpperCase();
}

function normalizeBranchCode(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeText(value: unknown, maxLength = 160) {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, maxLength) : "";
}

function parseCursor(cursor: string | null | undefined): { createdAt: string; id: string } | null {
  if (!cursor) return null;
  try {
    const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { created_at?: string; id?: string };
    const createdAt = String(decoded.created_at ?? "").trim();
    const id = String(decoded.id ?? "").trim();
    if (!createdAt || !id) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

function buildCursor(row: Pick<TenantSummaryRow, "created_at" | "id">) {
  return Buffer.from(JSON.stringify({ created_at: row.created_at, id: row.id }), "utf8").toString("base64url");
}

function normalizeStatus(value: unknown): TenantSummaryStatus {
  const status = String(value ?? "all").trim().toLowerCase();
  if (status === "active" || status === "inactive" || status === "suspended") return status;
  return "all";
}

function isMissingTenantSummaryRpc(error: unknown) {
  const message = String((error as { message?: unknown })?.message ?? "").toLowerCase();
  return message.includes("get_it_admin_tenant_summary") || message.includes("it_admin_tenant_summary_v");
}

async function listTenantSummariesFallback(context: ItAdminContext, input: TenantSummaryQuery) {
  const { supabase } = context;
  const limit = clampLimit(input.limit);
  const status = normalizeStatus(input.status);
  const search = normalizeText(input.search, 120).toLowerCase();
  const packageCode = normalizeText(input.packageCode, 80);

  let tenantQuery = supabase
    .from("tenants")
    .select("id,code,name,owner_name,owner_phone,package_id,is_active,created_at,updated_at")
    .order("created_at", { ascending: false })
    .limit(limit + 1);

  if (status === "active") tenantQuery = tenantQuery.eq("is_active", true);
  if (status === "inactive") tenantQuery = tenantQuery.eq("is_active", false);
  if (search) {
    tenantQuery = tenantQuery.or(`code.ilike.%${search}%,name.ilike.%${search}%,owner_name.ilike.%${search}%,owner_phone.ilike.%${search}%`);
  }

  const { data: tenants, error } = await tenantQuery.returns<TenantRow[]>();
  if (error) throw new Error(error.message);

  const tenantRows = tenants ?? [];
  const tenantIds = tenantRows.map((tenant) => tenant.id);
  const packageIds = tenantRows.map((tenant) => tenant.package_id).filter((id): id is string => Boolean(id));

  const [{ data: packages }, { data: contracts }, { data: branches }, { data: devices }, { data: sessions }, { data: shifts }] = await Promise.all([
    packageIds.length
      ? supabase.from("subscription_packages").select("id,code,name").in("id", packageIds).returns<Array<{ id: string; code: string; name: string }>>()
      : Promise.resolve({ data: [] }),
    tenantIds.length
      ? supabase
          .from("tenant_subscription_contracts")
          .select("id,tenant_id,package_id,status,started_at,ended_at,created_at")
          .in("tenant_id", tenantIds)
          .order("created_at", { ascending: false })
          .returns<Array<{ id: string; tenant_id: string; package_id: string; status: string; started_at: string; ended_at: string | null; created_at: string }>>()
      : Promise.resolve({ data: [] }),
    tenantIds.length ? supabase.from("branches").select("tenant_id,id,is_active").in("tenant_id", tenantIds) : Promise.resolve({ data: [] }),
    tenantIds.length ? supabase.from("branch_devices").select("tenant_id,id,status").in("tenant_id", tenantIds) : Promise.resolve({ data: [] }),
    tenantIds.length
      ? supabase.from("pos_sessions").select("tenant_id,id,status,expires_at").in("tenant_id", tenantIds).eq("status", "active")
      : Promise.resolve({ data: [] }),
    tenantIds.length ? supabase.from("shifts").select("tenant_id,id,status").in("tenant_id", tenantIds).eq("status", "open") : Promise.resolve({ data: [] })
  ]);

  const packageById = new Map((packages ?? []).map((pkg) => [pkg.id, pkg]));
  const contractRows = (contracts ?? []) as ContractSummaryRow[];
  const latestContractByTenant = new Map<string, ContractSummaryRow>();
  for (const contract of contractRows) {
    if (!latestContractByTenant.has(contract.tenant_id)) latestContractByTenant.set(contract.tenant_id, contract);
  }

  const countByTenant = <T extends { tenant_id: string }>(rows: T[] | null | undefined, predicate: (row: T) => boolean = () => true) => {
    const counts = new Map<string, number>();
    for (const row of rows ?? []) {
      if (!predicate(row)) continue;
      counts.set(row.tenant_id, (counts.get(row.tenant_id) ?? 0) + 1);
    }
    return counts;
  };

  const branchCount = countByTenant(branches as Array<{ tenant_id: string; is_active: boolean }>);
  const activeBranchCount = countByTenant(branches as Array<{ tenant_id: string; is_active: boolean }>, (row) => row.is_active);
  const deviceCount = countByTenant(devices as Array<{ tenant_id: string; status: string }>);
  const activeDeviceCount = countByTenant(devices as Array<{ tenant_id: string; status: string }>, (row) => row.status === "active");
  const nowIso = new Date().toISOString();
  const activeSessionCount = countByTenant(sessions as Array<{ tenant_id: string; expires_at: string }>, (row) => row.expires_at > nowIso);
  const openShiftCount = countByTenant(shifts as Array<{ tenant_id: string }>);

  const rows = tenantRows
    .map((tenant): TenantSummaryRow => {
      const pkg = tenant.package_id ? packageById.get(tenant.package_id) : null;
      const contract = latestContractByTenant.get(tenant.id) ?? null;
      return {
        ...tenant,
        package_code: pkg?.code ?? null,
        package_name: pkg?.name ?? null,
        contract_id: contract?.id ?? null,
        contract_status: contract?.status ?? null,
        contract_started_at: contract?.started_at ?? null,
        contract_ended_at: contract?.ended_at ?? null,
        branch_count: branchCount.get(tenant.id) ?? 0,
        active_branch_count: activeBranchCount.get(tenant.id) ?? 0,
        device_count: deviceCount.get(tenant.id) ?? 0,
        active_device_count: activeDeviceCount.get(tenant.id) ?? 0,
        active_session_count: activeSessionCount.get(tenant.id) ?? 0,
        open_shift_count: openShiftCount.get(tenant.id) ?? 0
      };
    })
    .filter((row) => !packageCode || row.package_code === packageCode)
    .filter((row) => status !== "suspended" || row.contract_status === "suspended");

  const pageRows = rows.slice(0, limit);
  return {
    tenants: pageRows,
    next_cursor: rows.length > limit ? buildCursor(pageRows[pageRows.length - 1]) : null,
    source: "fallback"
  };
}

export async function listTenantSummaries(context: ItAdminContext, input: TenantSummaryQuery = {}) {
  const { supabase } = context;
  const limit = clampLimit(input.limit);
  const cursor = parseCursor(input.cursor);
  const status = normalizeStatus(input.status);

  const { data, error } = await supabase
    .rpc("get_it_admin_tenant_summary", {
      p_limit: limit + 1,
      p_cursor_created_at: cursor?.createdAt ?? null,
      p_cursor_id: cursor?.id ?? null,
      p_search: normalizeText(input.search, 120) || null,
      p_status: status,
      p_package_code: normalizeText(input.packageCode, 80) || null
    });

  if (error) {
    if (isMissingTenantSummaryRpc(error)) {
      return listTenantSummariesFallback(context, input);
    }
    throw new Error(error.message);
  }

  const rows = (data ?? []) as TenantSummaryRow[];
  const tenants = rows.slice(0, limit);
  return {
    tenants,
    next_cursor: rows.length > limit ? buildCursor(tenants[tenants.length - 1]) : null,
    source: "rpc"
  };
}

export async function getTenantDetail(context: ItAdminContext, tenantId: string) {
  const { supabase } = context;
  const [{ data: tenant, error: tenantError }, { data: branches, error: branchError }, { data: contract, error: contractError }] = await Promise.all([
    supabase
      .from("tenants")
      .select("id,code,name,owner_name,owner_phone,package_id,is_active,created_at,updated_at")
      .eq("id", tenantId)
      .maybeSingle<TenantRow>(),
    supabase
      .from("branches")
      .select("id,tenant_id,code,name,address,is_active,created_at,updated_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .returns<BranchRow[]>(),
    supabase
      .from("tenant_subscription_contracts")
      .select("id,tenant_id,package_id,status,branch_limit,terminal_limit_per_branch,max_branches,max_devices,max_users,amount_per_cycle,currency,started_at,ended_at,created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<ContractRow>()
  ]);

  if (tenantError) throw new Error(tenantError.message);
  if (branchError) throw new Error(branchError.message);
  if (contractError) throw new Error(contractError.message);
  if (!tenant) return null;

  return {
    tenant,
    branches: branches ?? [],
    contract: contract ?? null
  };
}

export async function createTenant(context: ItAdminContext, input: TenantCreateInput) {
  const { auth, supabase, requestMeta } = context;
  const code = normalizeCode(input.code);
  const name = normalizeText(input.name);
  const ownerName = normalizeText(input.owner?.name, 160) || null;
  const ownerPhone = normalizeText(input.owner?.phone, 40) || null;
  const packageId = normalizeText(input.package_id, 80) || null;

  if (!code || !name) {
    throw new Error("invalid_tenant_payload: code and name are required.");
  }

  const { data: tenant, error: tenantError } = await supabase
    .from("tenants")
    .insert({
      code,
      name,
      owner_name: ownerName,
      owner_phone: ownerPhone,
      package_id: packageId,
      is_active: true
    })
    .select("id,code,name,owner_name,owner_phone,package_id,is_active,created_at,updated_at")
    .single<TenantRow>();

  if (tenantError) {
    if (tenantError.code === "23505") throw new Error("tenant_code_duplicate: Tenant code already exists.");
    throw new Error(tenantError.message);
  }

  const created: { tenant: TenantRow; branch: BranchRow | null; contract: ContractRow | null } = {
    tenant,
    branch: null,
    contract: null
  };

  const branchCode = normalizeBranchCode(input.initial_branch?.code);
  const branchName = normalizeText(input.initial_branch?.name);
  if (branchCode && branchName) {
    const { data: branch, error: branchError } = await supabase
      .from("branches")
      .insert({
        tenant_id: tenant.id,
        code: branchCode,
        name: branchName,
        address: normalizeText(input.initial_branch?.address, 500) || null,
        is_active: true
      })
      .select("id,tenant_id,code,name,address,is_active,created_at,updated_at")
      .single<BranchRow>();
    if (branchError) throw new Error(branchError.message);
    created.branch = branch;
  }

  if (packageId) {
    const contract = input.contract ?? {};
    const maxBranches = Math.max(1, Math.trunc(Number(contract.max_branches ?? 1)));
    const maxDevices = Math.max(1, Math.trunc(Number(contract.max_devices ?? 1)));
    const maxUsers = contract.max_users == null ? null : Math.max(1, Math.trunc(Number(contract.max_users)));
    const { data, error } = await supabase
      .from("tenant_subscription_contracts")
      .insert({
        tenant_id: tenant.id,
        package_id: packageId,
        contract_type: "saas",
        billing_interval: contract.billing_interval ?? "monthly",
        deployment_mode: "cloud",
        status: contract.status ?? "trial",
        branch_limit: maxBranches,
        terminal_limit_per_branch: maxDevices,
        max_branches: maxBranches,
        max_devices: maxDevices,
        max_users: maxUsers,
        amount_per_cycle: Math.max(0, Number(contract.amount_per_cycle ?? 0)),
        currency: normalizeText(contract.currency, 3).toUpperCase() || "THB",
        started_at: new Date().toISOString(),
        ended_at: null
      })
      .select("id,tenant_id,package_id,status,branch_limit,terminal_limit_per_branch,max_branches,max_devices,max_users,amount_per_cycle,currency,started_at,ended_at,created_at")
      .single<ContractRow>();
    if (error) throw new Error(error.message);
    created.contract = data;
  }

  await appendAuditLog({
    tenantId: tenant.id,
    branchId: created.branch?.id,
    actorUserId: auth.userId,
    actorRole: "it_admin",
    action: "tenant_created",
    targetTable: "tenants",
    targetId: tenant.id,
    afterData: created as unknown as Record<string, never>,
    ipAddress: requestMeta.ipAddress ?? undefined,
    userAgent: requestMeta.userAgent ?? undefined
  });

  return created;
}

export async function updateTenant(context: ItAdminContext, tenantId: string, input: TenantPatchInput) {
  const { auth, supabase, requestMeta } = context;
  const { data: current, error: currentError } = await supabase
    .from("tenants")
    .select("id,code,name,owner_name,owner_phone,package_id,is_active,created_at,updated_at")
    .eq("id", tenantId)
    .maybeSingle<TenantRow>();
  if (currentError) throw new Error(currentError.message);
  if (!current) return null;

  const patch: Record<string, unknown> = {};
  if (typeof input.code === "string" && input.code.trim()) patch.code = normalizeCode(input.code);
  if (typeof input.name === "string" && input.name.trim()) patch.name = normalizeText(input.name);
  if ("owner_name" in input) patch.owner_name = normalizeText(input.owner_name, 160) || null;
  if ("owner_phone" in input) patch.owner_phone = normalizeText(input.owner_phone, 40) || null;
  if ("package_id" in input) patch.package_id = normalizeText(input.package_id, 80) || null;
  if (typeof input.is_active === "boolean") patch.is_active = input.is_active;

  if (!Object.keys(patch).length) {
    throw new Error("empty_patch: No tenant update fields provided.");
  }

  const { data: updated, error } = await supabase
    .from("tenants")
    .update(patch)
    .eq("id", tenantId)
    .select("id,code,name,owner_name,owner_phone,package_id,is_active,created_at,updated_at")
    .single<TenantRow>();
  if (error) throw new Error(error.message);

  invalidateTenantFeatureGateCache(tenantId);

  await appendAuditLog({
    tenantId,
    actorUserId: auth.userId,
    actorRole: "it_admin",
    action: "tenant_updated",
    targetTable: "tenants",
    targetId: tenantId,
    beforeData: current as unknown as Record<string, never>,
    afterData: updated as unknown as Record<string, never>,
    metadata: {
      reason: input.reason ?? null,
      changed_fields: Object.keys(patch)
    },
    ipAddress: requestMeta.ipAddress ?? undefined,
    userAgent: requestMeta.userAgent ?? undefined
  });

  return updated;
}

export async function setTenantOperationalState(context: ItAdminContext, tenantId: string, action: "suspend" | "reactivate" | "soft_delete", reason?: string | null) {
  const { auth, supabase, requestMeta } = context;
  const active = action === "reactivate";
  const tenant = await updateTenant(context, tenantId, { is_active: active, reason });
  if (!tenant) return null;

  if (action !== "reactivate") {
    await Promise.all([
      supabase
        .from("pos_sessions")
        .update({ status: "revoked", revoked_at: new Date().toISOString() })
        .eq("tenant_id", tenantId)
        .eq("status", "active"),
      supabase.from("branch_devices").update({ status: "inactive", is_locked: true }).eq("tenant_id", tenantId)
    ]);
  }

  if (action === "suspend" || action === "soft_delete") {
    const contractPatch: Record<string, unknown> = {
      status: action === "suspend" ? "suspended" : "cancelled"
    };
    if (action === "soft_delete") {
      contractPatch.ended_at = new Date().toISOString();
    }
    await supabase
      .from("tenant_subscription_contracts")
      .update(contractPatch)
      .eq("tenant_id", tenantId)
      .in("status", ["trial", "active"]);
  }

  invalidateTenantFeatureGateCache(tenantId);

  await appendAuditLog({
    tenantId,
    actorUserId: auth.userId,
    actorRole: "it_admin",
    action: action === "soft_delete" ? "tenant_soft_deleted" : action === "suspend" ? "tenant_suspended" : "tenant_reactivated",
    targetTable: "tenants",
    targetId: tenantId,
    afterData: tenant as unknown as Record<string, never>,
    metadata: {
      reason: reason ?? null,
      sessions_revoked: action !== "reactivate",
      devices_locked: action !== "reactivate"
    },
    ipAddress: requestMeta.ipAddress ?? undefined,
    userAgent: requestMeta.userAgent ?? undefined
  });

  return tenant;
}
