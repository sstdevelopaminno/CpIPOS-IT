import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase-admin";

export type BranchRole = "owner" | "manager" | "staff" | "accountant";

type EmployeeRow = {
  id: string;
  email: string;
  full_name: string;
  is_active: boolean;
  role: BranchRole;
  employee_code: string | null;
};

export type EmployeeIdentity = {
  userId: string;
  fullName: string;
  role: BranchRole;
  employeeCode: string;
  permissions: string[];
};

export type DevicePublicStatus = "ready" | "in_use" | "offline" | "disabled";

export type DeviceCandidate = {
  id: string;
  tenant_id: string;
  branch_id: string;
  device_code: string;
  device_name: string;
  status: "active" | "inactive" | "maintenance";
  last_seen_at: string | null;
  metadata: Record<string, unknown> | null;
};

export type DeviceSessionOccupancy = {
  session_id: string;
  device_id: string | null;
  device_code: string | null;
  user_id: string;
  user_name: string | null;
};

export function deriveEmployeeCode(userId: string) {
  const normalized = String(userId).replace(/-/g, "").toUpperCase();
  return `EMP-${normalized.slice(-6)}`;
}

function deriveDemoEmployeeCode(input: { userId: string; email: string; role: BranchRole }) {
  const email = String(input.email ?? "").toLowerCase();
  const isDemoUser = email.endsWith(".local") || email.endsWith("@demo.local");
  if (!isDemoUser) return null;
  if (input.role === "owner" && (email.startsWith("owner@") || email.startsWith("owner."))) return "182536";
  const suffix = String(input.userId).replace(/-/g, "").slice(-6).toUpperCase();
  if (input.role === "manager") return `MGR-${suffix}`;
  if (input.role === "accountant") return `ACC-${suffix}`;
  return `STF-${suffix}`;
}

function isDemoOwnerEmployeeCode(input: { email: string; role: BranchRole; codeCandidates: Set<string> }) {
  const email = String(input.email ?? "").toLowerCase();
  const isDemoUser = email.endsWith(".local") || email.endsWith("@demo.local");
  return isDemoUser && input.role === "owner" && input.codeCandidates.has("182536");
}

export function normalizeEmployeeCode(value: string) {
  return String(value ?? "").trim().toUpperCase();
}

function normalizeEmpCandidate(value: string) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function normalizeEmpDigits(value: string) {
  return String(value ?? "").replace(/\D/g, "");
}

function normalizeEmployeeName(value: string) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function buildEmployeeCodeCandidates(input: string) {
  const normalized = normalizeEmpCandidate(input);
  const candidates = new Set<string>();
  if (!normalized) return candidates;

  candidates.add(normalized);

  const digits = normalizeEmpDigits(normalized);
  if (digits) {
    const last6 = digits.slice(-6);
    const padded6 = last6.padStart(6, "0");
    candidates.add(last6);
    candidates.add(padded6);
    candidates.add(`EMP-${last6}`);
    candidates.add(`EMP-${padded6}`);
  }

  if (normalized.startsWith("EMP-")) {
    const tail = normalized.slice(4);
    if (tail) candidates.add(tail);
    const tailDigits = normalizeEmpDigits(tail);
    if (tailDigits) {
      const last6 = tailDigits.slice(-6);
      const padded6 = last6.padStart(6, "0");
      candidates.add(last6);
      candidates.add(padded6);
      candidates.add(`EMP-${last6}`);
      candidates.add(`EMP-${padded6}`);
    }
  }

  return candidates;
}

export function roleToPermissions(role: BranchRole): string[] {
  if (role === "owner") {
    return [
      "pos.sales.access",
      "pos.device.override_in_use",
      "pos.shift.open",
      "pos.sales.refund",
      "pos.sales.discount",
      "pos.sales.void",
      "pos.reports.view"
    ];
  }
  if (role === "manager") {
    return ["pos.sales.access", "pos.device.override_in_use", "pos.shift.open", "pos.sales.refund", "pos.sales.discount", "pos.sales.void", "pos.reports.view"];
  }
  if (role === "accountant") {
    return ["pos.sales.access", "pos.reports.view"];
  }
  return ["pos.sales.access", "pos.shift.open"];
}

export function hasPermission(permissions: string[], permissionKey: string) {
  return permissions.includes(permissionKey);
}

function isMissingRelationError(error: { code?: string | null; message?: string | null } | null | undefined, relationName: string) {
  if (!error) return false;
  const code = String(error.code ?? "");
  const message = String(error.message ?? "").toLowerCase();
  return code === "42P01" || message.includes("does not exist") || message.includes(relationName.toLowerCase());
}

async function loadEmployeeCodes(tenantId: string, userIds: string[]) {
  const supabase = getSupabaseServiceClient();
  const codesByUser = new Map<string, string>();
  if (!userIds.length) return codesByUser;

  const { data, error } = await supabase
    .from("pos_user_profiles")
    .select("user_id,employee_code")
    .eq("tenant_id", tenantId)
    .in("user_id", userIds);

  if (error) {
    if (isMissingRelationError(error, "pos_user_profiles")) return codesByUser;
    throw new Error(error.message);
  }

  for (const row of (data ?? []) as Array<{ user_id: string; employee_code: string | null }>) {
    if (row.employee_code) codesByUser.set(row.user_id, normalizeEmpCandidate(row.employee_code));
  }
  return codesByUser;
}

async function resolveEmployeeByProfileCode(input: {
  tenantId: string;
  branchId: string;
  codeCandidates: Set<string>;
}): Promise<EmployeeIdentity | null | "relation_missing"> {
  const supabase = getSupabaseServiceClient();
  const candidates = Array.from(input.codeCandidates);
  if (!candidates.length) return null;

  const { data, error } = await supabase
    .from("pos_user_profiles")
    .select("user_id,employee_code,users_profiles!inner(id,email,full_name,is_active)")
    .eq("tenant_id", input.tenantId)
    .in("employee_code", candidates)
    .limit(10)
    .returns<
      Array<{
      user_id: string;
      employee_code: string | null;
      users_profiles:
        | { id: string; email: string; full_name: string; is_active: boolean }
        | Array<{ id: string; email: string; full_name: string; is_active: boolean }>;
      }>
    >();

  if (error) {
    if (isMissingRelationError(error, "pos_user_profiles")) return "relation_missing";
    throw new Error(error.message);
  }

  for (const row of data ?? []) {
    const profile = Array.isArray(row.users_profiles) ? row.users_profiles[0] : row.users_profiles;
    if (!profile?.is_active) continue;

    const roleResult = await supabase
      .from("user_branch_roles")
      .select("role")
      .eq("tenant_id", input.tenantId)
      .eq("branch_id", input.branchId)
      .eq("user_id", row.user_id)
      .maybeSingle<{ role: BranchRole }>();

    if (roleResult.error) {
      throw new Error(roleResult.error.message);
    }
    if (!roleResult.data) continue;

    const role = roleResult.data.role;
    return {
      userId: profile.id,
      fullName: profile.full_name,
      role,
      employeeCode: normalizeEmpCandidate(row.employee_code ?? candidates[0]),
      permissions: roleToPermissions(role)
    };
  }

  return null;
}

export async function resolveEmployeeByCode(input: {
  tenantId: string;
  branchId: string;
  employeeCode: string;
}): Promise<EmployeeIdentity | null> {
  const supabase = getSupabaseServiceClient();
  const normalizedCode = normalizeEmpCandidate(input.employeeCode);
  if (!normalizedCode) return null;
  const codeCandidates = buildEmployeeCodeCandidates(normalizedCode);

  const indexedMatch = await resolveEmployeeByProfileCode({
    tenantId: input.tenantId,
    branchId: input.branchId,
    codeCandidates
  });
  if (indexedMatch !== "relation_missing") return indexedMatch;

  const { data, error } = await supabase
    .from("user_branch_roles")
    .select("user_id,role,users_profiles!inner(id,email,full_name,is_active)")
    .eq("tenant_id", input.tenantId)
    .eq("branch_id", input.branchId);

  if (error) {
    throw new Error(error.message);
  }

  const rows = (data ?? []) as Array<{
    user_id: string;
    role: BranchRole;
    users_profiles: { id: string; email: string; full_name: string; is_active: boolean } | Array<{ id: string; email: string; full_name: string; is_active: boolean }>;
  }>;

  const codeByUser = await loadEmployeeCodes(input.tenantId, rows.map((row) => row.user_id));
  const employeeRows: EmployeeRow[] = rows
    .map((row) => {
      const profile = Array.isArray(row.users_profiles) ? row.users_profiles[0] : row.users_profiles;
      if (!profile) return null;
      return {
        id: profile.id,
        email: profile.email,
        full_name: profile.full_name,
        is_active: profile.is_active,
        role: row.role,
        employee_code: codeByUser.get(profile.id) ?? deriveDemoEmployeeCode({ userId: profile.id, email: profile.email, role: row.role })
      } satisfies EmployeeRow;
    })
    .filter((row): row is EmployeeRow => Boolean(row && row.is_active));

  const matched = employeeRows.find((row) => {
    const derived = deriveEmployeeCode(row.id);
    const customCode = normalizeEmpCandidate(row.employee_code ?? "");
    const derivedDigits = normalizeEmpDigits(derived).slice(-6);
    const customDigits = normalizeEmpDigits(customCode).slice(-6);
    const email = normalizeEmpCandidate(row.email);
    const emailLocalPart = email.includes("@") ? email.split("@")[0] : "";
    const userId = normalizeEmpCandidate(row.id);

    if (isDemoOwnerEmployeeCode({ email: row.email, role: row.role, codeCandidates })) return true;
    if (customCode && codeCandidates.has(customCode)) return true;
    if (customDigits && codeCandidates.has(customDigits)) return true;
    if (codeCandidates.has(derived)) return true;
    if (derivedDigits && codeCandidates.has(derivedDigits)) return true;
    if (userId && codeCandidates.has(userId)) return true;
    if (email && codeCandidates.has(email)) return true;
    if (emailLocalPart && codeCandidates.has(emailLocalPart)) return true;
    return false;
  });

  if (!matched) return null;
  const permissions = roleToPermissions(matched.role);
  return {
    userId: matched.id,
    fullName: matched.full_name,
    role: matched.role,
    employeeCode: matched.employee_code || deriveEmployeeCode(matched.id),
    permissions
  };
}

export async function resolveEmployeeByUserId(input: {
  tenantId: string;
  branchId: string;
  userId: string;
}): Promise<EmployeeIdentity | null> {
  const normalizedUserId = String(input.userId ?? "").trim();
  if (!normalizedUserId) return null;

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("user_branch_roles")
    .select("user_id,role,users_profiles!inner(id,email,full_name,is_active)")
    .eq("tenant_id", input.tenantId)
    .eq("branch_id", input.branchId)
    .eq("user_id", normalizedUserId)
    .maybeSingle<{
      user_id: string;
      role: BranchRole;
      users_profiles: { id: string; email: string; full_name: string; is_active: boolean } | Array<{ id: string; email: string; full_name: string; is_active: boolean }>;
    }>();

  if (error) {
    throw new Error(error.message);
  }
  if (!data) return null;

  const profile = Array.isArray(data.users_profiles) ? data.users_profiles[0] : data.users_profiles;
  if (!profile || profile.is_active === false) return null;

  const codeByUser = await loadEmployeeCodes(input.tenantId, [profile.id]);
  return {
    userId: profile.id,
    fullName: profile.full_name,
    role: data.role,
    employeeCode: codeByUser.get(profile.id) || deriveEmployeeCode(profile.id),
    permissions: roleToPermissions(data.role)
  };
}

export async function resolveEmployeeByName(input: {
  tenantId: string;
  branchId: string;
  employeeName: string;
}): Promise<{ employee: EmployeeIdentity | null; ambiguous: boolean }> {
  const normalizedName = normalizeEmployeeName(input.employeeName);
  if (!normalizedName) return { employee: null, ambiguous: false };

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("user_branch_roles")
    .select("user_id,role,users_profiles!inner(id,email,full_name,is_active)")
    .eq("tenant_id", input.tenantId)
    .eq("branch_id", input.branchId);

  if (error) {
    throw new Error(error.message);
  }

  const rows = (data ?? []) as Array<{
    user_id: string;
    role: BranchRole;
    users_profiles: { id: string; email: string; full_name: string; is_active: boolean } | Array<{ id: string; email: string; full_name: string; is_active: boolean }>;
  }>;

  const codeByUser = await loadEmployeeCodes(input.tenantId, rows.map((row) => row.user_id));
  const employeeRows: EmployeeRow[] = rows
    .map((row) => {
      const profile = Array.isArray(row.users_profiles) ? row.users_profiles[0] : row.users_profiles;
      if (!profile) return null;
      return {
        id: profile.id,
        email: profile.email,
        full_name: profile.full_name,
        is_active: profile.is_active,
        role: row.role,
        employee_code: codeByUser.get(profile.id) ?? null
      } satisfies EmployeeRow;
    })
    .filter((row): row is EmployeeRow => Boolean(row && row.is_active));

  const matches = employeeRows.filter((row) => normalizeEmployeeName(row.full_name) === normalizedName);
  if (matches.length === 0) return { employee: null, ambiguous: false };
  if (matches.length > 1) return { employee: null, ambiguous: true };

  const matched = matches[0];
  return {
    ambiguous: false,
    employee: {
      userId: matched.id,
      fullName: matched.full_name,
      role: matched.role,
      employeeCode: matched.employee_code || deriveEmployeeCode(matched.id),
      permissions: roleToPermissions(matched.role)
    }
  };
}

export function mapDeviceStatus(device: DeviceCandidate, activeSession: DeviceSessionOccupancy | null): DevicePublicStatus {
  if (device.status === "inactive") return "disabled";
  if (device.status === "maintenance") return "offline";
  if (activeSession) return "in_use";
  return "ready";
}
