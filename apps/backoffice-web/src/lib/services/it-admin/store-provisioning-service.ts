import "server-only";

import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { appendAuditLog } from "@/lib/audit-log";
import type { ItAdminContext } from "@/lib/it-admin-guard";

export type StoreProvisioningInput = {
  request_id?: string;
  store?: { name?: string; owner_phone?: string | null };
  package_id?: string;
  contract?: { status?: "trial" | "active"; billing_interval?: "monthly" | "yearly" };
  initial_branch?: { code?: string; name?: string; address?: string | null };
  owner?: { name?: string; email?: string; phone?: string | null; employee_code?: string; pin?: string };
};

type CoreProvisioningResult = {
  request_id: string;
  tenant: { id: string; code: string; name: string; is_active: boolean };
  store_code: string;
  branch: { id: string; code: string; name: string; address: string | null };
  package: {
    id: string;
    code: string;
    name: string;
    max_branches: number;
    max_devices: number;
    max_users: number;
    amount_per_cycle: number;
    billing_interval: "monthly" | "yearly";
    currency: string;
  };
  contract: { id: string; status: string; billing_interval: string; amount_per_cycle: number; currency: string };
  lifecycle: {
    status: string;
    data_home: string;
    desired_data_home: string;
    migration_status: string;
    trial_started_at: string | null;
    trial_expires_at: string | null;
    routing_version: number;
  };
};

type ProfileRow = { id: string; email: string; full_name: string; pin_hash: string | null; is_active: boolean };
type PosProfileRow = { user_id: string; employee_code: string };

export class StoreProvisioningError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 422) {
    super(message);
    this.name = "StoreProvisioningError";
    this.code = code;
    this.status = status;
  }
}

function text(value: unknown, max = 180) {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized.slice(0, max) : "";
}

function normalizeEmail(value: unknown) {
  return text(value, 254).toLowerCase();
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function createInternalTenantCode() {
  return `T-${crypto.randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase()}`;
}

function normalizeCoreResult(value: unknown): CoreProvisioningResult {
  if (!value || typeof value !== "object") {
    throw new StoreProvisioningError("store_core_invalid_result", "Store provisioning returned an invalid result.", 500);
  }
  const result = value as CoreProvisioningResult;
  if (!result.tenant?.id || !result.branch?.id || !result.store_code || !result.package?.id) {
    throw new StoreProvisioningError("store_core_incomplete_result", "Store provisioning did not return required identifiers.", 500);
  }
  return result;
}

async function findAuthUserByEmail(context: ItAdminContext, email: string) {
  const perPage = 200;
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await context.supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw new StoreProvisioningError("owner_auth_lookup_failed", "Unable to resolve Owner authentication identity.", 500);
    const users = data?.users ?? [];
    const match = users.find((user) => String(user.email ?? "").trim().toLowerCase() === email);
    if (match) return match;
    if (users.length < perPage) return null;
  }
  throw new StoreProvisioningError("owner_auth_lookup_limit_reached", "Owner identity lookup exceeded the safe pagination limit.", 409);
}

async function resolveOrCreateOwnerIdentity(context: ItAdminContext, input: { email: string; fullName: string; pin: string }) {
  const { supabase } = context;
  const { data: profiles, error: profileLookupError } = await supabase
    .from("users_profiles")
    .select("id,email,full_name,pin_hash,is_active")
    .ilike("email", input.email)
    .limit(3)
    .returns<ProfileRow[]>();

  if (profileLookupError) throw new StoreProvisioningError("owner_profile_lookup_failed", "Unable to resolve Owner profile.", 500);
  if ((profiles ?? []).length > 1) throw new StoreProvisioningError("owner_email_ambiguous", "More than one Owner profile uses this email.", 409);

  let profile = profiles?.[0] ?? null;
  if (profile && !profile.is_active) {
    throw new StoreProvisioningError("owner_identity_inactive", "This Owner identity is inactive and cannot be silently reactivated.", 409);
  }

  if (profile) {
    const authResult = await supabase.auth.admin.getUserById(profile.id);
    if (authResult.error || !authResult.data.user) {
      throw new StoreProvisioningError("owner_auth_lookup_failed", "Owner profile is not linked to a valid Auth user.", 409);
    }
  }

  if (!profile) {
    let authUser = await findAuthUserByEmail(context, input.email);
    if (!authUser) {
      const created = await supabase.auth.admin.createUser({
        email: input.email,
        password: crypto.randomBytes(32).toString("base64url"),
        email_confirm: true,
        user_metadata: { full_name: input.fullName, source: "it_store_provisioning_p0" }
      });
      if (created.error || !created.data.user) {
        authUser = await findAuthUserByEmail(context, input.email).catch(() => null);
        if (!authUser) throw new StoreProvisioningError("owner_auth_create_failed", "Unable to create Owner authentication identity.", 500);
      } else {
        authUser = created.data.user;
      }
    }

    const pinHash = await bcrypt.hash(input.pin, 12);
    const { data: insertedProfile, error: insertProfileError } = await supabase
      .from("users_profiles")
      .upsert(
        {
          id: authUser.id,
          email: input.email,
          full_name: input.fullName,
          platform_role: "tenant_user",
          pin_hash: pinHash,
          is_active: true
        },
        { onConflict: "id" }
      )
      .select("id,email,full_name,pin_hash,is_active")
      .single<ProfileRow>();
    if (insertProfileError || !insertedProfile) {
      throw new StoreProvisioningError("owner_profile_create_failed", "Owner Auth exists but POS profile creation failed; retry the same request.", 500);
    }
    profile = insertedProfile;
  }

  if (!profile) throw new StoreProvisioningError("owner_profile_missing", "Owner profile could not be resolved.", 500);

  if (profile.pin_hash) {
    const pinMatches = await bcrypt.compare(input.pin, profile.pin_hash);
    if (!pinMatches) {
      throw new StoreProvisioningError(
        "owner_pin_conflict_existing_identity",
        "This email already belongs to an identity with another PIN. Use the existing PIN or another Owner email.",
        409
      );
    }
  } else {
    const pinHash = await bcrypt.hash(input.pin, 12);
    const { error } = await supabase.from("users_profiles").update({ pin_hash: pinHash }).eq("id", profile.id).is("pin_hash", null);
    if (error) throw new StoreProvisioningError("owner_pin_create_failed", "Unable to initialize Owner PIN.", 500);
  }

  return { userId: profile.id, email: input.email };
}

async function bindOwnerToStore(context: ItAdminContext, input: { tenantId: string; branchId: string; userId: string; employeeCode: string }) {
  const { supabase } = context;
  const { data: employeeCodeOwner, error: employeeLookupError } = await supabase
    .from("pos_user_profiles")
    .select("user_id,employee_code")
    .eq("tenant_id", input.tenantId)
    .eq("employee_code", input.employeeCode)
    .maybeSingle<PosProfileRow>();
  if (employeeLookupError) throw new StoreProvisioningError("owner_employee_code_lookup_failed", "Unable to validate Owner employee code.", 500);
  if (employeeCodeOwner && employeeCodeOwner.user_id !== input.userId) {
    throw new StoreProvisioningError("owner_employee_code_conflict", "Owner employee code is already used in this store.", 409);
  }

  const { data: currentPosProfile, error: currentProfileError } = await supabase
    .from("pos_user_profiles")
    .select("user_id,employee_code")
    .eq("tenant_id", input.tenantId)
    .eq("user_id", input.userId)
    .maybeSingle<PosProfileRow>();
  if (currentProfileError) throw new StoreProvisioningError("owner_pos_profile_lookup_failed", "Unable to resolve Owner POS identity.", 500);
  if (currentPosProfile && currentPosProfile.employee_code !== input.employeeCode) {
    throw new StoreProvisioningError(
      "owner_employee_code_request_mismatch",
      `This provisioning request already bound Owner to employee code ${currentPosProfile.employee_code}.`,
      409
    );
  }

  if (!currentPosProfile) {
    const { error } = await supabase.from("pos_user_profiles").insert({
      tenant_id: input.tenantId,
      user_id: input.userId,
      employee_code: input.employeeCode,
      position_title: "Owner",
      permission_role: "pos_user"
    });
    if (error) throw new StoreProvisioningError("owner_pos_profile_create_failed", "Unable to create Owner POS identity.", error.code === "23505" ? 409 : 500);
  }

  const { error: roleError } = await supabase.from("user_branch_roles").upsert(
    { user_id: input.userId, tenant_id: input.tenantId, branch_id: input.branchId, role: "owner", is_default: true },
    { onConflict: "user_id,tenant_id,branch_id" }
  );
  if (roleError) throw new StoreProvisioningError("owner_role_create_failed", "Unable to assign Owner role to the initial branch.", 500);
}

async function markProvisioningRequest(context: ItAdminContext, requestId: string, patch: Record<string, unknown>) {
  const { error } = await context.supabase
    .from("it_store_provisioning_requests")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("request_key", requestId);
  if (error) console.error("[store-provisioning] request ledger update failed", { requestId, error: error.message });
}

function parseDbProvisioningError(message: string) {
  const known = [
    "invalid_provisioning_request",
    "invalid_provisioning_payload",
    "invalid_contract_status",
    "paid_activation_requires_approval",
    "invalid_billing_interval",
    "package_not_available",
    "package_requires_manual_contract",
    "package_invalid_quota",
    "package_billing_interval_unavailable",
    "provisioning_request_conflict",
    "provisioning_request_payload_mismatch",
    "provisioning_request_incomplete",
    "tenant_control_plane_provision_failed"
  ];
  const code = known.find((candidate) => message.includes(candidate));
  if (!code) return null;
  const status = code.includes("mismatch") || code.includes("conflict") || code.includes("incomplete") ? 409 : code.includes("failed") ? 500 : 422;
  return new StoreProvisioningError(code, message.replace(/^.*?:\s*/, "") || code, status);
}

export async function provisionStore(context: ItAdminContext, input: StoreProvisioningInput) {
  const requestId = text(input.request_id, 64) || crypto.randomUUID();
  const storeName = text(input.store?.name, 180);
  const ownerName = text(input.owner?.name, 180);
  const ownerEmail = normalizeEmail(input.owner?.email);
  const ownerPhone = text(input.owner?.phone ?? input.store?.owner_phone, 40);
  const branchCode = text(input.initial_branch?.code, 40).toLowerCase();
  const branchName = text(input.initial_branch?.name, 180);
  const branchAddress = text(input.initial_branch?.address, 500);
  const packageId = text(input.package_id, 64);
  const employeeCode = text(input.owner?.employee_code, 32).replace(/\s+/g, "") || "100001";
  const pin = String(input.owner?.pin ?? "").trim();
  const contractStatus = input.contract?.status ?? "trial";
  const billingInterval = input.contract?.billing_interval ?? "monthly";

  if (!isUuid(requestId)) throw new StoreProvisioningError("invalid_request_id", "request_id must be a UUID.");
  if (!storeName || !branchCode || !branchName || !packageId || !ownerName || !ownerEmail) {
    throw new StoreProvisioningError("invalid_store_provisioning_payload", "Store name, package, initial branch and Owner name/email are required.");
  }
  if (!isUuid(packageId)) throw new StoreProvisioningError("invalid_package_id", "package_id must be a UUID.");
  if (!isEmail(ownerEmail)) throw new StoreProvisioningError("invalid_owner_email", "Owner email is invalid.");
  if (!/^\d{1,32}$/.test(employeeCode)) throw new StoreProvisioningError("invalid_owner_employee_code", "Owner employee code must contain digits only.");
  if (!/^\d{4,8}$/.test(pin)) throw new StoreProvisioningError("invalid_owner_pin", "Owner PIN must contain 4 to 8 digits.");
  if (contractStatus !== "trial") {
    throw new StoreProvisioningError(
      "paid_activation_requires_approval",
      "Store Provisioning may only start a trial; paid activation must use the existing IT approval flow."
    );
  }

  const { data: rpcData, error: rpcError } = await context.supabase.rpc("provision_it_store_core", {
    p_request_id: requestId,
    p_actor_user_id: context.auth.userId,
    p_internal_code: createInternalTenantCode(),
    p_store_name: storeName,
    p_owner_name: ownerName,
    p_owner_phone: ownerPhone || null,
    p_owner_email: ownerEmail,
    p_branch_code: branchCode,
    p_branch_name: branchName,
    p_branch_address: branchAddress || null,
    p_package_id: packageId,
    p_contract_status: "trial",
    p_billing_interval: billingInterval
  });

  if (rpcError) {
    const parsed = parseDbProvisioningError(rpcError.message);
    if (parsed) throw parsed;
    if (rpcError.code === "23505") throw new StoreProvisioningError("store_unique_conflict", "Store or branch identifier already exists.", 409);
    throw new StoreProvisioningError("store_core_provision_failed", "Unable to provision Store core data.", 500);
  }

  const core = normalizeCoreResult(rpcData);
  try {
    const owner = await resolveOrCreateOwnerIdentity(context, { email: ownerEmail, fullName: ownerName, pin });
    await bindOwnerToStore(context, { tenantId: core.tenant.id, branchId: core.branch.id, userId: owner.userId, employeeCode });

    const result = {
      ...core,
      owner: { user_id: owner.userId, name: ownerName, email: owner.email, employee_code: employeeCode, role: "owner" as const },
      activation: { status: "ready_for_device_enrollment" as const, next_step: "register_device" as const }
    };

    await markProvisioningRequest(context, requestId, {
      owner_user_id: owner.userId,
      owner_email: ownerEmail,
      status: "completed",
      result,
      last_error: null
    });

    await appendAuditLog({
      tenantId: core.tenant.id,
      branchId: core.branch.id,
      actorUserId: context.auth.userId,
      actorRole: "it_admin",
      action: "store_provisioned",
      targetTable: "tenants",
      targetId: core.tenant.id,
      targetUserId: owner.userId,
      module: "it_admin",
      metadata: {
        request_id: requestId,
        store_code: core.store_code,
        package_code: core.package.code,
        owner_employee_code: employeeCode,
        billing_interval: core.contract.billing_interval,
        contract_status: core.contract.status
      },
      ipAddress: context.requestMeta.ipAddress ?? undefined,
      userAgent: context.requestMeta.userAgent ?? undefined
    });
    return result;
  } catch (error) {
    const safeCode = error instanceof StoreProvisioningError ? error.code : "owner_provisioning_failed";
    await markProvisioningRequest(context, requestId, { status: "owner_failed", owner_email: ownerEmail, last_error: safeCode });
    await appendAuditLog({
      tenantId: core.tenant.id,
      branchId: core.branch.id,
      actorUserId: context.auth.userId,
      actorRole: "it_admin",
      action: "store_provisioning_owner_failed",
      targetTable: "tenants",
      targetId: core.tenant.id,
      module: "it_admin",
      metadata: { request_id: requestId, store_code: core.store_code, error_code: safeCode },
      ipAddress: context.requestMeta.ipAddress ?? undefined,
      userAgent: context.requestMeta.userAgent ?? undefined
    });
    if (error instanceof StoreProvisioningError) throw error;
    throw new StoreProvisioningError("owner_provisioning_failed", "Store core is safe, but Owner provisioning failed. Retry using the same request_id.", 500);
  }
}
