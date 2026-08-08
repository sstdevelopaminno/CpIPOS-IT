import { getAuthContext } from "@/lib/auth-context";
import { appendAuditLog } from "@/lib/audit-log";
import { normalizeDisplayChannel } from "@/lib/customer-display-pairing";
import { fail, ok } from "@/lib/http";
import {
  getCustomerDisplayPolicy,
  invalidateCustomerDisplayPolicyCache
} from "@/lib/services/customer-display-policy-service";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

type PolicyRow = {
  id: string;
  tenant_id: string;
  branch_id: string;
  channel: string;
  max_active_devices: number;
  inactive_expire_hours: number;
  is_active: boolean;
  updated_at: string;
};

type UpsertPolicyBody = {
  tenant_id?: string;
  branch_id?: string;
  channel?: string;
  max_active_devices?: number;
  inactive_expire_hours?: number;
  is_active?: boolean;
};

function clampInt(raw: unknown, min: number, max: number, fallback: number): number {
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return fallback;
  const normalized = Math.trunc(numeric);
  if (normalized < min) return min;
  if (normalized > max) return max;
  return normalized;
}

export async function GET(req: Request) {
  try {
    const auth = await getAuthContext({ requireBranchScope: false });
    if (auth.platformRole !== "it_admin") {
      return fail("forbidden", "Only IT admin can view customer display policies.", 403);
    }

    const supabase = getSupabaseServiceClient();
    const url = new URL(req.url);
    const tenantId = String(url.searchParams.get("tenant_id") ?? "").trim();
    const branchId = String(url.searchParams.get("branch_id") ?? "").trim();
    const channelParam = String(url.searchParams.get("channel") ?? "").trim();

    if (!tenantId || !branchId) {
      return fail("missing_scope", "tenant_id and branch_id are required.", 422);
    }

    const channel = normalizeDisplayChannel(channelParam || "main");
    const effectivePolicy = await getCustomerDisplayPolicy(supabase, {
      tenantId,
      branchId,
      channel
    });

    const { data: rows, error } = await supabase
      .from("pos_customer_display_policies")
      .select("id,tenant_id,branch_id,channel,max_active_devices,inactive_expire_hours,is_active,updated_at")
      .eq("tenant_id", tenantId)
      .eq("branch_id", branchId)
      .order("channel", { ascending: true })
      .returns<PolicyRow[]>();

    if (error) {
      return fail("it_admin_customer_display_policy_fetch_failed", error.message, 500);
    }

    return ok({
      generated_at: new Date().toISOString(),
      scope: { tenant_id: tenantId, branch_id: branchId, channel },
      effective_policy: effectivePolicy,
      policies: rows ?? []
    });
  } catch (error) {
    return fail(
      "it_admin_customer_display_policy_fetch_failed",
      error instanceof Error ? error.message : "Unknown error",
      500
    );
  }
}

export async function PUT(req: Request) {
  try {
    const auth = await getAuthContext({ requireBranchScope: false });
    if (auth.platformRole !== "it_admin") {
      return fail("forbidden", "Only IT admin can update customer display policies.", 403);
    }

    const body = (await req.json().catch(() => ({}))) as UpsertPolicyBody;
    const tenantId = typeof body.tenant_id === "string" ? body.tenant_id.trim() : "";
    const branchId = typeof body.branch_id === "string" ? body.branch_id.trim() : "";
    if (!tenantId || !branchId) {
      return fail("missing_scope", "tenant_id and branch_id are required.", 422);
    }

    const channel = normalizeDisplayChannel(typeof body.channel === "string" ? body.channel : "main");
    const maxActiveDevices = clampInt(body.max_active_devices, 1, 64, 4);
    const inactiveExpireHours = clampInt(body.inactive_expire_hours, 1, 2160, 72);
    const isActive = typeof body.is_active === "boolean" ? body.is_active : true;
    const nowIso = new Date().toISOString();

    const supabase = getSupabaseServiceClient();
    const { error } = await supabase.from("pos_customer_display_policies").upsert(
      {
        tenant_id: tenantId,
        branch_id: branchId,
        channel,
        max_active_devices: maxActiveDevices,
        inactive_expire_hours: inactiveExpireHours,
        is_active: isActive,
        created_by: auth.userId,
        updated_at: nowIso
      },
      { onConflict: "tenant_id,branch_id,channel" }
    );

    if (error) {
      return fail("it_admin_customer_display_policy_upsert_failed", error.message, 500);
    }

    invalidateCustomerDisplayPolicyCache({
      tenantId,
      branchId,
      channel
    });

    await appendAuditLog({
      actorUserId: auth.userId,
      actorRole: "it_admin",
      action: "customer_display_policy_upserted",
      targetTable: "pos_customer_display_policies",
      tenantId,
      branchId,
      metadata: {
        channel,
        max_active_devices: maxActiveDevices,
        inactive_expire_hours: inactiveExpireHours,
        is_active: isActive
      }
    });

    return ok({
      updated: true,
      updated_at: nowIso,
      policy: {
        tenant_id: tenantId,
        branch_id: branchId,
        channel,
        max_active_devices: maxActiveDevices,
        inactive_expire_hours: inactiveExpireHours,
        is_active: isActive
      }
    });
  } catch (error) {
    return fail(
      "it_admin_customer_display_policy_upsert_failed",
      error instanceof Error ? error.message : "Unknown error",
      500
    );
  }
}
