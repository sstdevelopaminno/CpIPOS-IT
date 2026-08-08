import "server-only";

import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

type LoginMethodResult =
  | {
      ok: true;
      userId: string;
      metadata: Record<string, unknown>;
    }
  | {
      ok: false;
      code: "auth_failed" | "staff_card_missing" | "staff_card_invalid" | "staff_card_inactive" | "staff_card_lost" | "staff_card_revoked" | "staff_card_scope_mismatch" | "staff_card_role_not_allowed";
      message: string;
    };

type UserRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  pin_hash: string | null;
  is_active: boolean;
};

type BranchRoleRow = {
  user_id: string;
  tenant_id: string;
  branch_id: string;
  role: "owner" | "manager" | "staff" | "accountant";
};

type StaffCardRow = {
  id: string;
  tenant_id: string;
  branch_id: string;
  user_id: string;
  status: "active" | "inactive" | "lost" | "revoked";
  expires_at: string | null;
  card_hash: string | null;
  card_code: string | null;
  metadata: Record<string, unknown> | null;
};

function normalizeAuthSecret(value: string | null | undefined): string | null {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function hashSecret(secret: string): string {
  return crypto.createHash("sha256").update(secret, "utf8").digest("hex");
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function extractTokenFromPayload(payload: unknown): string | null {
  if (typeof payload === "string") {
    return normalizeAuthSecret(payload);
  }
  if (!payload || typeof payload !== "object") return null;

  const tokenCandidates = ["token", "value", "code", "card_code", "staff_card_code"];
  for (const field of tokenCandidates) {
    const value = (payload as Record<string, unknown>)[field];
    if (typeof value === "string" && value.trim()) {
      return normalizeAuthSecret(value);
    }
  }

  return null;
}

async function resolveActiveUserById(userId: string): Promise<UserRow | null> {
  const supabase = getSupabaseServiceClient();
  const { data } = await supabase
    .from("users_profiles")
    .select("id,email,full_name,pin_hash,is_active")
    .eq("id", userId)
    .maybeSingle<UserRow>();

  if (!data || data.is_active === false) {
    return null;
  }
  return data;
}

async function verifyPinAgainstUsers(pin: string, users: UserRow[]): Promise<UserRow | null> {
  for (const user of users) {
    if (!user.pin_hash || user.is_active === false) continue;
    const matched = await bcrypt.compare(pin, user.pin_hash);
    if (matched) return user;
  }
  return null;
}

async function resolvePinCandidateUsers(input: {
  tenantId: string;
  branchId: string;
  userIdentifier: string | null;
}): Promise<UserRow[]> {
  const supabase = getSupabaseServiceClient();
  const identifier = normalizeAuthSecret(input.userIdentifier);

  if (identifier) {
    if (isUuid(identifier)) {
      const { data } = await supabase
        .from("users_profiles")
        .select("id,email,full_name,pin_hash,is_active")
        .eq("id", identifier)
        .eq("is_active", true)
        .limit(1);
      return ((data ?? []) as UserRow[]).filter((row) => row.pin_hash);
    }

    const { data } = await supabase
      .from("users_profiles")
      .select("id,email,full_name,pin_hash,is_active")
      .ilike("email", identifier)
      .eq("is_active", true)
      .limit(1);
    return ((data ?? []) as UserRow[]).filter((row) => row.pin_hash);
  }

  const { data: roleRows } = await supabase
    .from("user_branch_roles")
    .select("user_id")
    .eq("tenant_id", input.tenantId)
    .eq("branch_id", input.branchId);

  const userIds = Array.from(new Set((roleRows ?? []).map((row) => String((row as { user_id?: string }).user_id ?? "")).filter(Boolean)));
  if (userIds.length === 0) return [];

  const { data: users } = await supabase
    .from("users_profiles")
    .select("id,email,full_name,pin_hash,is_active")
    .in("id", userIds)
    .eq("is_active", true);

  return ((users ?? []) as UserRow[]).filter((row) => row.pin_hash);
}

function resolveStaffCardCode(staffCardCode: string | null, cardPayload: unknown): string | null {
  const direct = normalizeAuthSecret(staffCardCode);
  if (direct) return direct;
  return extractTokenFromPayload(cardPayload);
}

async function findStaffCardRow(tenantId: string, branchId: string, cardCode: string): Promise<StaffCardRow | null> {
  const supabase = getSupabaseServiceClient();
  const cardHash = hashSecret(cardCode);
  const { data: hashedRow } = await supabase
    .from("pos_staff_cards")
    .select("id,tenant_id,branch_id,user_id,status,expires_at,card_hash,card_code,metadata")
    .eq("card_hash", cardHash)
    .limit(1)
    .maybeSingle<StaffCardRow>();

  if (hashedRow) return hashedRow;

  const { data: legacyRow } = await supabase
    .from("pos_staff_cards")
    .select("id,tenant_id,branch_id,user_id,status,expires_at,card_hash,card_code,metadata")
    .eq("tenant_id", tenantId)
    .eq("branch_id", branchId)
    .eq("card_code", cardCode)
    .limit(1)
    .maybeSingle<StaffCardRow>();

  if (!legacyRow) return null;

  await supabase
    .from("pos_staff_cards")
    .update({
      card_hash: cardHash,
      card_code: null
    })
    .eq("id", legacyRow.id)
    .is("card_hash", null);

  return { ...legacyRow, card_hash: cardHash, card_code: null };
}

export async function verifyPinLogin(input: {
  tenantId: string;
  branchId: string;
  pin: string;
  userIdentifier: string | null;
}): Promise<LoginMethodResult> {
  const pin = String(input.pin ?? "");
  if (!pin) {
    return { ok: false, code: "auth_failed", message: "PIN is required." };
  }

  const candidates = await resolvePinCandidateUsers(input);
  if (candidates.length === 0) {
    return { ok: false, code: "auth_failed", message: "Authentication failed." };
  }

  const matchedUser = await verifyPinAgainstUsers(pin, candidates);
  if (!matchedUser) {
    return { ok: false, code: "auth_failed", message: "Authentication failed." };
  }

  return {
    ok: true,
    userId: matchedUser.id,
    metadata: {
      auth_method: "pin",
      user_identifier_provided: Boolean(normalizeAuthSecret(input.userIdentifier))
    }
  };
}

export async function verifyStaffCardLogin(input: {
  tenantId: string;
  branchId: string;
  staffCardCode: string | null;
  cardPayload: unknown;
}): Promise<LoginMethodResult> {
  const cardCode = resolveStaffCardCode(input.staffCardCode, input.cardPayload);
  if (!cardCode) {
    return { ok: false, code: "staff_card_missing", message: "Staff card code is required." };
  }

  const row = await findStaffCardRow(input.tenantId, input.branchId, cardCode);
  if (!row) {
    return { ok: false, code: "staff_card_invalid", message: "Staff card is invalid." };
  }

  if (row.tenant_id !== input.tenantId || row.branch_id !== input.branchId) {
    return { ok: false, code: "staff_card_scope_mismatch", message: "Staff card scope mismatch." };
  }

  if (row.status === "revoked") {
    return { ok: false, code: "staff_card_revoked", message: "Staff card revoked." };
  }
  if (row.status === "lost") {
    return { ok: false, code: "staff_card_lost", message: "Staff card reported lost." };
  }
  if (row.status !== "active") {
    return { ok: false, code: "staff_card_inactive", message: "Staff card inactive." };
  }
  if (row.expires_at && row.expires_at <= new Date().toISOString()) {
    return { ok: false, code: "staff_card_inactive", message: "Staff card expired." };
  }

  const user = await resolveActiveUserById(row.user_id);
  if (!user) {
    return { ok: false, code: "staff_card_invalid", message: "Staff card user is inactive." };
  }

  const role = await resolveUserBranchRole({
    tenantId: input.tenantId,
    branchId: input.branchId,
    userId: user.id
  });
  if (!role.ok) {
    return { ok: false, code: "staff_card_role_not_allowed", message: role.message };
  }

  return {
    ok: true,
    userId: user.id,
    metadata: {
      staff_card_id: row.id,
      auth_method: "staff_card"
    }
  };
}

export async function resolveUserBranchRole(input: {
  tenantId: string;
  branchId: string;
  userId: string;
}): Promise<{ ok: true; role: "owner" | "manager" | "staff" | "accountant" } | { ok: false; code: "role_not_allowed" | "auth_failed"; message: string }> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("user_branch_roles")
    .select("user_id,tenant_id,branch_id,role")
    .eq("tenant_id", input.tenantId)
    .eq("branch_id", input.branchId)
    .eq("user_id", input.userId)
    .maybeSingle<BranchRoleRow>();

  if (error) {
    return { ok: false, code: "auth_failed", message: "Cannot resolve user branch role." };
  }
  if (!data) {
    return { ok: false, code: "role_not_allowed", message: "User has no role in this branch." };
  }

  if (data.role !== "owner" && data.role !== "manager" && data.role !== "staff" && data.role !== "accountant") {
    return { ok: false, code: "role_not_allowed", message: "User role is not allowed for POS login." };
  }

  return { ok: true, role: data.role };
}
