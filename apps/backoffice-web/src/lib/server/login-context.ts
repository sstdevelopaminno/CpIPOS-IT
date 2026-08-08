import "server-only";

import {
  normalizeDeviceCode,
  resolveBranchLoginPolicy,
  resolveLoginContext,
  validateBranchDevice,
  type BranchPolicyRow,
  type BranchRow,
  type LoginContextRow,
  type TenantRow
} from "@/lib/server/login-security";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

export type LoginContextValidationErrorCode =
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

type LoginContextValidationError = {
  ok: false;
  code: LoginContextValidationErrorCode;
  message: string;
  context?: LoginContextRow;
};

export type ValidatedLoginContext = {
  ok: true;
  context: LoginContextRow;
  tenant: TenantRow;
  branch: BranchRow;
  policy: BranchPolicyRow;
  deviceCode: string | null;
  deviceId: string | null;
};

export type LoginContextValidationResult = ValidatedLoginContext | LoginContextValidationError;

async function resolveTenantAndBranch(context: LoginContextRow): Promise<{ tenant: TenantRow | null; branch: BranchRow | null }> {
  const supabase = getSupabaseServiceClient();
  const [{ data: tenant }, { data: branch }] = await Promise.all([
    supabase.from("tenants").select("id,code,name,is_active").eq("id", context.tenant_id).maybeSingle<TenantRow>(),
    supabase.from("branches").select("id,tenant_id,code,name,is_active").eq("id", context.branch_id).maybeSingle<BranchRow>()
  ]);
  return { tenant: tenant ?? null, branch: branch ?? null };
}

function mapConsumedCode(context: LoginContextRow): LoginContextValidationErrorCode {
  if (context.status === "consumed" && context.consumed_at) {
    return "context_replay_detected";
  }
  return "context_consumed";
}

export async function validateLoginContext(ctx: string | null): Promise<LoginContextValidationResult> {
  const contextId = String(ctx ?? "").trim();
  if (!contextId) {
    return { ok: false, code: "missing_context", message: "Missing login context. Restart from store selection." };
  }

  const supabase = getSupabaseServiceClient();
  const context = await resolveLoginContext(contextId);
  if (!context) {
    return { ok: false, code: "invalid_context", message: "Login context was not found." };
  }

  if (context.status !== "active") {
    return {
      ok: false,
      code: mapConsumedCode(context),
      message: context.status === "expired" ? "Login context expired. Please restart login." : "Login context is no longer active.",
      context
    };
  }

  const nowIso = new Date().toISOString();
  if (context.expires_at <= nowIso) {
    await supabase.from("pos_login_contexts").update({ status: "expired" }).eq("id", context.id).eq("status", "active");
    return { ok: false, code: "expired_context", message: "Login context expired. Please restart login.", context };
  }

  const { tenant, branch } = await resolveTenantAndBranch(context);
  if (!tenant || tenant.is_active === false || tenant.code !== context.store_code) {
    return { ok: false, code: "inactive_tenant", message: "Tenant is inactive or mismatched.", context };
  }
  if (!branch || branch.is_active === false || branch.tenant_id !== tenant.id) {
    return { ok: false, code: "inactive_branch", message: "Branch is inactive or mismatched.", context };
  }

  const policy = await resolveBranchLoginPolicy({ tenantId: tenant.id, branchId: branch.id });
  if (!policy) {
    return { ok: false, code: "missing_policy", message: "Branch login policy is missing.", context };
  }

  const deviceValidated = await validateBranchDevice({
    tenantId: tenant.id,
    branchId: branch.id,
    deviceCode: normalizeDeviceCode(context.device_code),
    policy
  });
  if (!deviceValidated.ok) {
    return { ok: false, code: deviceValidated.code, message: deviceValidated.message, context };
  }

  return {
    ok: true,
    context,
    tenant,
    branch,
    policy,
    deviceCode: normalizeDeviceCode(context.device_code),
    deviceId: deviceValidated.device?.id ?? null
  };
}

export async function consumeLoginContext(contextId: string): Promise<{ ok: true } | LoginContextValidationError> {
  const normalized = String(contextId ?? "").trim();
  if (!normalized) {
    return { ok: false, code: "missing_context", message: "Missing login context." };
  }

  const supabase = getSupabaseServiceClient();
  const nowIso = new Date().toISOString();
  const { data: updatedRows, error } = await supabase
    .from("pos_login_contexts")
    .update({ status: "consumed", consumed_at: nowIso })
    .eq("id", normalized)
    .eq("status", "active")
    .gt("expires_at", nowIso)
    .select("id");

  if (!error && (updatedRows?.length ?? 0) > 0) {
    return { ok: true };
  }

  const existing = await resolveLoginContext(normalized);
  if (!existing) {
    return { ok: false, code: "invalid_context", message: "Login context not found." };
  }
  if (existing.status === "consumed") {
    return { ok: false, code: "context_replay_detected", message: "Login context already consumed.", context: existing };
  }
  if (existing.status === "expired" || existing.expires_at <= nowIso) {
    return { ok: false, code: "expired_context", message: "Login context expired.", context: existing };
  }
  return { ok: false, code: "context_consumed", message: "Login context is not active.", context: existing };
}
