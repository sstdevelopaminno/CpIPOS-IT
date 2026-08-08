import { getAuthContext } from "@/lib/auth-context";
import { appendAuditLog } from "@/lib/audit-log";
import { fail, ok } from "@/lib/http";
import { normalizeDisplayChannel } from "@/lib/customer-display-pairing";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

type PairingDeviceRow = {
  id: string;
  tenant_id: string;
  branch_id: string;
  channel: string;
  device_name: string | null;
  is_active: boolean;
  pair_code_expires_at: string;
  pair_code_used_at: string | null;
  device_token_expires_at: string | null;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
};

type RevokeDeviceBody = {
  pairing_id?: string;
  reason?: string;
};

type TenantRow = {
  id: string;
  code: string;
  name: string;
};

type BranchRow = {
  id: string;
  tenant_id: string;
  code: string;
  name: string;
};

function boolParam(raw: string | null, fallback: boolean): boolean {
  if (raw == null) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes") return true;
  if (normalized === "0" || normalized === "false" || normalized === "no") return false;
  return fallback;
}

export async function GET(req: Request) {
  try {
    const auth = await getAuthContext({ requireBranchScope: false });
    if (auth.platformRole !== "it_admin") {
      return fail("forbidden", "Only IT admin can view paired customer display devices.", 403);
    }

    const supabase = getSupabaseServiceClient();
    const url = new URL(req.url);
    const tenantId = url.searchParams.get("tenant_id")?.trim() || null;
    const branchId = url.searchParams.get("branch_id")?.trim() || null;
    const channelParam = url.searchParams.get("channel");
    const channel = channelParam ? normalizeDisplayChannel(channelParam) : null;
    const activeOnly = boolParam(url.searchParams.get("active_only"), false);
    const includePending = boolParam(url.searchParams.get("include_pending"), false);
    const limitRaw = Number(url.searchParams.get("limit") ?? 200);
    const limit = Number.isFinite(limitRaw) ? Math.min(500, Math.max(1, Math.trunc(limitRaw))) : 200;

    let query = supabase
      .from("pos_customer_display_pairings")
      .select("id,tenant_id,branch_id,channel,device_name,is_active,pair_code_expires_at,pair_code_used_at,device_token_expires_at,last_seen_at,created_at,updated_at")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (tenantId) query = query.eq("tenant_id", tenantId);
    if (branchId) query = query.eq("branch_id", branchId);
    if (channel) query = query.eq("channel", channel);
    if (activeOnly) query = query.eq("is_active", true);
    if (!includePending) query = query.not("device_token_expires_at", "is", null);

    const { data, error } = await query.returns<PairingDeviceRow[]>();
    if (error) {
      return fail("it_admin_customer_display_devices_fetch_failed", error.message, 500);
    }

    const devices = data ?? [];
    const tenantIds = Array.from(new Set(devices.map((item) => item.tenant_id)));
    const branchIds = Array.from(new Set(devices.map((item) => item.branch_id)));
    const tenantsById = new Map<string, TenantRow>();
    const branchesById = new Map<string, BranchRow>();

    if (tenantIds.length > 0) {
      const { data: tenants, error: tenantsError } = await supabase
        .from("tenants")
        .select("id,code,name")
        .in("id", tenantIds)
        .returns<TenantRow[]>();
      if (tenantsError) {
        return fail("it_admin_customer_display_tenants_fetch_failed", tenantsError.message, 500);
      }
      for (const tenant of tenants ?? []) {
        tenantsById.set(tenant.id, tenant);
      }
    }

    if (branchIds.length > 0) {
      const { data: branches, error: branchesError } = await supabase
        .from("branches")
        .select("id,tenant_id,code,name")
        .in("id", branchIds)
        .returns<BranchRow[]>();
      if (branchesError) {
        return fail("it_admin_customer_display_branches_fetch_failed", branchesError.message, 500);
      }
      for (const branch of branches ?? []) {
        branchesById.set(branch.id, branch);
      }
    }

    const nowMs = Date.now();
    const normalized = devices.map((item) => {
      const tokenExpired = item.device_token_expires_at ? new Date(item.device_token_expires_at).getTime() <= nowMs : true;
      const tenant = tenantsById.get(item.tenant_id);
      const branch = branchesById.get(item.branch_id);
      return {
        id: item.id,
        tenant_id: item.tenant_id,
        tenant_code: tenant?.code ?? null,
        tenant_name: tenant?.name ?? null,
        branch_id: item.branch_id,
        branch_code: branch?.code ?? null,
        branch_name: branch?.name ?? null,
        channel: item.channel,
        device_name: item.device_name,
        is_active: item.is_active,
        token_expired: tokenExpired,
        pair_code_expires_at: item.pair_code_expires_at,
        pair_code_used_at: item.pair_code_used_at,
        device_token_expires_at: item.device_token_expires_at,
        last_seen_at: item.last_seen_at,
        created_at: item.created_at,
        updated_at: item.updated_at
      };
    });

    return ok({
      generated_at: new Date().toISOString(),
      filters: {
        tenant_id: tenantId,
        branch_id: branchId,
        channel,
        active_only: activeOnly,
        include_pending: includePending,
        limit
      },
      summary: {
        total: normalized.length,
        active: normalized.filter((item) => item.is_active).length,
        inactive: normalized.filter((item) => !item.is_active).length,
        expired: normalized.filter((item) => item.token_expired).length
      },
      devices: normalized
    });
  } catch (error) {
    return fail(
      "it_admin_customer_display_devices_fetch_failed",
      error instanceof Error ? error.message : "Unknown error",
      500
    );
  }
}

export async function PATCH(req: Request) {
  try {
    const auth = await getAuthContext({ requireBranchScope: false });
    if (auth.platformRole !== "it_admin") {
      return fail("forbidden", "Only IT admin can revoke paired customer display devices.", 403);
    }

    const body = (await req.json().catch(() => ({}))) as RevokeDeviceBody;
    const pairingId = typeof body.pairing_id === "string" ? body.pairing_id.trim() : "";
    if (!pairingId) {
      return fail("missing_pairing_id", "pairing_id is required.", 422);
    }

    const supabase = getSupabaseServiceClient();
    const { data: current, error: currentError } = await supabase
      .from("pos_customer_display_pairings")
      .select("id,tenant_id,branch_id,channel,is_active")
      .eq("id", pairingId)
      .maybeSingle<{
        id: string;
        tenant_id: string;
        branch_id: string;
        channel: string;
        is_active: boolean;
      }>();

    if (currentError) {
      return fail("it_admin_customer_display_device_fetch_failed", currentError.message, 500);
    }
    if (!current) {
      return fail("pairing_not_found", "Pairing device not found.", 404);
    }

    const { error: updateError } = await supabase
      .from("pos_customer_display_pairings")
      .update({
        is_active: false,
        device_token_hash: null,
        device_token_expires_at: null,
        updated_at: new Date().toISOString()
      })
      .eq("id", pairingId);

    if (updateError) {
      return fail("it_admin_customer_display_device_revoke_failed", updateError.message, 500);
    }

    await appendAuditLog({
      actorUserId: auth.userId,
      actorRole: "it_admin",
      action: "customer_display_device_revoked",
      targetTable: "pos_customer_display_pairings",
      targetId: current.id,
      tenantId: current.tenant_id,
      branchId: current.branch_id,
      metadata: {
        pairing_id: current.id,
        channel: current.channel,
        previous_active: current.is_active,
        reason: typeof body.reason === "string" ? body.reason : null
      }
    });

    return ok({
      pairing_id: current.id,
      revoked: true,
      revoked_at: new Date().toISOString()
    });
  } catch (error) {
    return fail(
      "it_admin_customer_display_device_revoke_failed",
      error instanceof Error ? error.message : "Unknown error",
      500
    );
  }
}
