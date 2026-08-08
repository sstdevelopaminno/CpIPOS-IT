import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase-admin";

export type LoginContextRow = {
  id: string;
  tenant_id: string;
  branch_id: string;
  store_code: string;
  device_code: string | null;
  status: string;
  expires_at: string;
  consumed_at: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
};

export type TenantRow = {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
};

export type BranchRow = {
  id: string;
  tenant_id: string;
  code: string | null;
  name: string | null;
  is_active: boolean;
};

export type BranchPolicyRow = {
  tenant_id: string;
  branch_id: string;
  allow_pin_login: boolean;
  allow_staff_card_login: boolean;
  allow_shared_devices: boolean;
  require_registered_device: boolean;
  max_devices: number;
};

type BranchDeviceRow = {
  id: string;
  tenant_id: string;
  branch_id: string;
  device_code: string;
  device_name: string;
  device_type: string;
  status: "active" | "inactive" | "maintenance";
  is_locked: boolean;
  allow_morning_shift: boolean;
  allow_afternoon_shift: boolean;
  last_seen_at: string | null;
  metadata?: { lock_mode?: unknown } | null;
};

export type LoginValidationErrorCode =
  | "missing_context"
  | "invalid_context"
  | "expired_context"
  | "context_consumed"
  | "context_replay_detected"
  | "inactive_tenant"
  | "inactive_branch"
  | "missing_policy"
  | "missing_device"
  | "unregistered_device"
  | "inactive_device"
  | "device_branch_mismatch"
  | "device_tenant_mismatch"
  | "device_not_allowed"
  | "device_policy_blocked";

type ValidationError = {
  ok: false;
  code: LoginValidationErrorCode;
  message: string;
};

export type ValidatedScanContext = {
  ok: true;
  context: LoginContextRow;
  tenant: TenantRow;
  branch: BranchRow;
  policy: BranchPolicyRow;
  device: BranchDeviceRow | null;
};

export type ScanValidationState = ValidatedScanContext | ValidationError;

type BaseContextValidation =
  | {
      ok: true;
      context: LoginContextRow;
      tenant: TenantRow;
      branch: BranchRow;
    }
  | ValidationError;

type BranchDeviceValidation =
  | {
      ok: true;
      device: BranchDeviceRow | null;
    }
  | ValidationError;

export function normalizeStoreCode(value: string | null | undefined): string {
  return String(value ?? "").trim().toUpperCase();
}

export function normalizeDeviceCode(value: string | null | undefined): string | null {
  const normalized = String(value ?? "").trim().toUpperCase();
  return normalized || null;
}

export async function resolveLoginContext(contextId: string): Promise<LoginContextRow | null> {
  const supabase = getSupabaseServiceClient();
  const { data } = await supabase
    .from("pos_login_contexts")
    .select("id,tenant_id,branch_id,store_code,device_code,status,expires_at,consumed_at,metadata,created_at")
    .eq("id", contextId)
    .maybeSingle<LoginContextRow>();
  return data ?? null;
}

export async function resolveBranchLoginPolicy({
  tenantId,
  branchId
}: {
  tenantId: string;
  branchId: string;
}): Promise<BranchPolicyRow | null> {
  const supabase = getSupabaseServiceClient();
  const { data } = await supabase
    .from("branch_login_policies")
    .select("tenant_id,branch_id,allow_pin_login,allow_staff_card_login,allow_shared_devices,require_registered_device,max_devices")
    .eq("tenant_id", tenantId)
    .eq("branch_id", branchId)
    .maybeSingle<BranchPolicyRow>();
  return data ?? null;
}

export async function validateLoginContext(ctx: string | null): Promise<BaseContextValidation> {
  if (!ctx) {
    return { ok: false, code: "missing_context", message: "Missing login context. Please start from store code selection." };
  }

  const supabase = getSupabaseServiceClient();
  const contextRow = await resolveLoginContext(ctx);
  if (!contextRow) {
    return { ok: false, code: "invalid_context", message: "Login context is invalid or already used." };
  }
  if (contextRow.status === "consumed") {
    return {
      ok: false,
      code: contextRow.consumed_at ? "context_replay_detected" : "context_consumed",
      message: "Login context is already consumed."
    };
  }
  if (contextRow.status !== "active") {
    return { ok: false, code: "context_consumed", message: "Login context is invalid or already used." };
  }

  const nowIso = new Date().toISOString();
  if (contextRow.expires_at <= nowIso) {
    await supabase.from("pos_login_contexts").update({ status: "expired" }).eq("id", contextRow.id).eq("status", "active");
    return { ok: false, code: "expired_context", message: "Login context has expired. Please restart from store code selection." };
  }

  const [{ data: tenantRow }, { data: branchRow }] = await Promise.all([
    supabase.from("tenants").select("id,code,name,is_active").eq("id", contextRow.tenant_id).maybeSingle<TenantRow>(),
    supabase.from("branches").select("id,tenant_id,code,name,is_active").eq("id", contextRow.branch_id).maybeSingle<BranchRow>()
  ]);

  if (!tenantRow || tenantRow.is_active === false || tenantRow.code !== contextRow.store_code) {
    return { ok: false, code: "inactive_tenant", message: "Tenant is inactive or does not match the login context." };
  }

  if (!branchRow || branchRow.is_active === false || branchRow.tenant_id !== tenantRow.id) {
    return { ok: false, code: "inactive_branch", message: "Branch is inactive or does not belong to this tenant." };
  }

  return {
    ok: true,
    context: contextRow,
    tenant: tenantRow,
    branch: branchRow
  };
}

export async function validateBranchDevice({
  tenantId,
  branchId,
  deviceCode,
  policy
}: {
  tenantId: string;
  branchId: string;
  deviceCode: string | null;
  policy: BranchPolicyRow;
}): Promise<BranchDeviceValidation> {
  const normalizedDeviceCode = normalizeDeviceCode(deviceCode);

  if (!normalizedDeviceCode) {
    if (policy.require_registered_device) {
      return {
        ok: false,
        code: "missing_device",
        message: "Device code is required by branch policy. Register this device before login."
      };
    }
    return { ok: true, device: null };
  }

  const supabase = getSupabaseServiceClient();
  const { data: deviceRows } = await supabase
    .from("branch_devices")
    .select("id,tenant_id,branch_id,device_code,device_name,device_type,status,is_locked,allow_morning_shift,allow_afternoon_shift,last_seen_at,metadata")
    .eq("device_code", normalizedDeviceCode);

  const normalizedRows = (deviceRows ?? []) as BranchDeviceRow[];
  if (normalizedRows.length === 0) {
    return { ok: false, code: "unregistered_device", message: "This device is not registered in branch_devices." };
  }

  const sameTenantRows = normalizedRows.filter((row) => row.tenant_id === tenantId);
  const scopedDevice = sameTenantRows.find((row) => row.branch_id === branchId) ?? null;

  if (!scopedDevice) {
    if (sameTenantRows.length > 0) {
      return {
        ok: false,
        code: "device_branch_mismatch",
        message: "Device code belongs to this tenant but not this branch."
      };
    }
    return {
      ok: false,
      code: "device_tenant_mismatch",
      message: "Device code belongs to a different tenant."
    };
  }

  if (scopedDevice.status === "inactive") {
    return { ok: false, code: "inactive_device", message: "Device is inactive. Contact owner/manager to activate it." };
  }

  if (scopedDevice.status !== "active") {
    return { ok: false, code: "device_not_allowed", message: "Device is not allowed in current status." };
  }

  if (policy.allow_shared_devices === false && scopedDevice.is_locked === false) {
    return {
      ok: false,
      code: "device_policy_blocked",
      message: "Branch policy requires locked device usage. This device is marked as shared."
    };
  }

  const lockMode =
    typeof scopedDevice.metadata === "object" &&
    scopedDevice.metadata &&
    typeof scopedDevice.metadata.lock_mode === "string"
      ? scopedDevice.metadata.lock_mode
      : null;
  if (lockMode === "disabled") {
    return {
      ok: false,
      code: "device_not_allowed",
      message: "Device lock_mode disabled this device for login."
    };
  }
  if (lockMode === "locked_only" && scopedDevice.is_locked === false) {
    return {
      ok: false,
      code: "device_policy_blocked",
      message: "Device lock_mode requires locked device access."
    };
  }

  await supabase.from("branch_devices").update({ last_seen_at: new Date().toISOString() }).eq("id", scopedDevice.id);
  return { ok: true, device: scopedDevice };
}

export async function validateScanContext(ctx: string | null): Promise<ScanValidationState> {
  const contextValidated = await validateLoginContext(ctx);
  if (!contextValidated.ok) {
    return contextValidated;
  }

  const { context, tenant, branch } = contextValidated;
  const policy = await resolveBranchLoginPolicy({ tenantId: tenant.id, branchId: branch.id });
  if (!policy) {
    return { ok: false, code: "missing_policy", message: "Branch login policy is missing. Please configure branch_login_policies." };
  }

  const deviceValidated = await validateBranchDevice({
    tenantId: tenant.id,
    branchId: branch.id,
    deviceCode: context.device_code,
    policy
  });
  if (!deviceValidated.ok) {
    return deviceValidated;
  }

  return {
    ok: true,
    context,
    tenant,
    branch,
    policy,
    device: deviceValidated.device
  };
}
