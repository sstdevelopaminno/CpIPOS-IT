import bcrypt from "bcryptjs";
import type { ApprovalAction } from "@pos/shared-types";
import { readEnv } from "@/lib/env";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

export type PinApprovalResult = {
  approved: boolean;
  approverUserId?: string;
  approverRole?: "staff" | "manager" | "owner" | "it_admin";
};

type PinScope = {
  tenantId: string;
  branchId: string;
};

type PinCandidate = {
  role: "manager" | "owner";
  user_id: string;
  users_profiles:
    | {
        pin_hash: string | null;
        is_active: boolean;
      }
    | Array<{
        pin_hash: string | null;
        is_active: boolean;
      }>
    | null;
};

type PinProfile = {
  pin_hash: string | null;
  is_active: boolean;
};

type StaffApprovalPermission = {
  user_id: string;
  pin_hash: string | null;
};

function normalizeProfile(profile: PinCandidate["users_profiles"]): PinProfile | null {
  if (!profile) {
    return null;
  }

  if (Array.isArray(profile)) {
    return profile[0] ?? null;
  }

  return profile;
}

type PinCandidateNormalized = {
  role: "manager" | "owner";
  user_id: string;
  profile: PinProfile | null;
};

type ItAdminCandidate = {
  id: string;
  platform_role: "it_admin";
  pin_hash: string | null;
  is_active: boolean;
};

function normalizeCandidate(row: PinCandidate): PinCandidateNormalized {
  return {
    role: row.role,
    user_id: row.user_id,
    profile: normalizeProfile(row.users_profiles)
  };
}

function tryDevOfflinePinFallback(pin: string): PinApprovalResult | null {
  if (process.env.NODE_ENV === "production") {
    return null;
  }

  if (!readEnv("DEV_AUTH_USER_ID")) {
    return null;
  }

  if (pin === "182536") {
    return {
      approved: true,
      approverUserId: "00000000-0000-0000-0000-000000000102",
      approverRole: "manager"
    };
  }

  if (pin === "2468") {
    return {
      approved: true,
      approverUserId: "00000000-0000-0000-0000-000000000102",
      approverRole: "manager"
    };
  }

  if (pin === "1357") {
    return {
      approved: true,
      approverUserId: "00000000-0000-0000-0000-000000000101",
      approverRole: "owner"
    };
  }

  return null;
}

export async function validateManagerPin(action: ApprovalAction, pin: string, scope: PinScope): Promise<PinApprovalResult> {
  if (!pin || pin.length < 4) {
    return { approved: false };
  }

  const devFallback = tryDevOfflinePinFallback(pin);
  if (devFallback) {
    return devFallback;
  }

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("user_branch_roles")
    .select("role,user_id,users_profiles!inner(pin_hash,is_active)")
    .eq("tenant_id", scope.tenantId)
    .eq("branch_id", scope.branchId)
    .in("role", ["manager", "owner"])
    .order("role", { ascending: false });

  if (error) {
    return { approved: false };
  }

  const rows = ((data ?? []) as unknown as PinCandidate[]).map(normalizeCandidate);

  for (const candidate of rows) {
    if (!candidate.profile?.is_active || !candidate.profile.pin_hash) {
      continue;
    }

    const isMatch = await bcrypt.compare(pin, candidate.profile.pin_hash);
    if (isMatch) {
      return {
        approved: true,
        approverUserId: candidate.user_id,
        approverRole: candidate.role
      };
    }
  }

  const { data: itAdmins, error: itAdminError } = await supabase
    .from("users_profiles")
    .select("id,platform_role,pin_hash,is_active")
    .eq("platform_role", "it_admin")
    .eq("is_active", true);

  if (!itAdminError && itAdmins?.length) {
    for (const admin of itAdmins as ItAdminCandidate[]) {
      if (!admin.pin_hash) continue;
      const isMatch = await bcrypt.compare(pin, admin.pin_hash);
      if (isMatch) {
        return {
          approved: true,
          approverUserId: admin.id,
          approverRole: "it_admin"
        };
      }
    }
  }

  if (action === "cancel_bill") {
    const { data: staffPermissions, error: staffPermissionError } = await supabase
      .from("pos_user_approval_permissions")
      .select("user_id,pin_hash")
      .eq("tenant_id", scope.tenantId)
      .eq("branch_id", scope.branchId)
      .eq("action", "cancel_bill")
      .eq("is_enabled", true);

    if (!staffPermissionError && staffPermissions?.length) {
      const staffPinByUserId = new Map(
        (staffPermissions as StaffApprovalPermission[])
          .map((row) => [String(row.user_id), row.pin_hash] as const)
          .filter((entry): entry is readonly [string, string] => Boolean(entry[0] && entry[1]))
      );
      const staffUserIds = [...staffPinByUserId.keys()];
      const { data: staffRows, error: staffRowsError } = await supabase
        .from("user_branch_roles")
        .select("role,user_id,users_profiles!inner(is_active)")
        .eq("tenant_id", scope.tenantId)
        .eq("branch_id", scope.branchId)
        .eq("role", "staff")
        .in("user_id", staffUserIds);

      if (!staffRowsError) {
        for (const candidate of (staffRows ?? []) as unknown as PinCandidate[]) {
          const profile = normalizeProfile(candidate.users_profiles);
          const staffApprovalPinHash = staffPinByUserId.get(candidate.user_id);
          if (!profile?.is_active || !staffApprovalPinHash) continue;
          if (!(await bcrypt.compare(pin, staffApprovalPinHash))) continue;
          return {
            approved: true,
            approverUserId: candidate.user_id,
            approverRole: "staff"
          };
        }
      }
    }
  }

  return { approved: false };
}

