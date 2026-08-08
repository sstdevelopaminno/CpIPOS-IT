import crypto from "node:crypto";
import { appendAuditLog } from "@/lib/audit-log";
import { assertActivationScope, guardActivationAdminError, requireActivationAdmin } from "@/lib/activation-admin-guard";
import { enforceQuota, requireTenantFeatureIfConfigured } from "@/lib/feature-gate";
import { fail, ok } from "@/lib/http";

type ActivationTokenPayload = {
  tenant_id?: string;
  branch_id?: string | null;
  token_type?: "pos_terminal" | "mobile_scanner" | "admin_enrollment";
  purpose?: "device_activation" | "mobile_login_activation" | "admin_bootstrap";
  expires_in_minutes?: number;
  metadata?: Record<string, unknown>;
};

type TenantRow = {
  id: string;
  is_active: boolean;
};

type BranchRow = {
  id: string;
  tenant_id: string;
  is_active: boolean;
};

function hashToken(value: string) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function generateRawToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function resolveExpiry(minutes?: number) {
  const fallback = 10;
  const max = 60;
  const raw = Number(minutes ?? Number(process.env.ACTIVATION_TOKEN_TTL_MINUTES ?? fallback));
  const ttl = Number.isFinite(raw) && raw > 0 && raw <= max ? Math.trunc(raw) : fallback;
  return new Date(Date.now() + ttl * 60 * 1000).toISOString();
}

export async function POST(request: Request) {
  try {
    const { auth, actorRole, supabase, requestMeta } = await requireActivationAdmin();
    const body = (await request.json()) as ActivationTokenPayload;
    const requestedTenantId = String(body.tenant_id ?? "").trim();
    const requestedBranchId = String(body.branch_id ?? "").trim() || null;
    const tokenType = body.token_type ?? "mobile_scanner";
    const purpose = body.purpose ?? "mobile_login_activation";
    const metadata = body.metadata ?? {};

    if (!requestedTenantId) {
      return fail("invalid_payload", "tenant_id is required.", 422);
    }

    const allowTenantWide = auth.platformRole === "it_admin";
    const { tenantId, branchId } = await assertActivationScope({
      auth,
      tenantId: requestedTenantId,
      branchId: requestedBranchId,
      allowTenantWide
    });

    if (auth.platformRole !== "it_admin" && tokenType === "admin_enrollment") {
      return fail("activation_not_allowed", "Only it_admin can create admin_enrollment activation tokens.", 403);
    }

    await requireTenantFeatureIfConfigured(tenantId, "mobile_device_enrollment", branchId);
    await requireTenantFeatureIfConfigured(tenantId, "mobile_qr_login", branchId);

    if (tokenType === "mobile_scanner" || tokenType === "pos_terminal") {
      await enforceQuota(tenantId, "devices", branchId);
    }

    const [{ data: tenant }, { data: branch }] = await Promise.all([
      supabase.from("tenants").select("id,is_active").eq("id", tenantId).maybeSingle<TenantRow>(),
      branchId ? supabase.from("branches").select("id,tenant_id,is_active").eq("id", branchId).maybeSingle<BranchRow>() : Promise.resolve({ data: null })
    ]);

    if (!tenant || tenant.is_active === false) {
      return fail("inactive_tenant", "Tenant is not active.", 403);
    }

    if (branchId) {
      if (!branch || branch.is_active === false || branch.tenant_id !== tenantId) {
        return fail("inactive_branch", "Branch is not active or does not belong to tenant.", 403);
      }
    } else if (tokenType !== "admin_enrollment" && auth.platformRole !== "it_admin") {
      return fail("branch_scope_required", "branch_id is required for this token type.", 422);
    }

    const rawToken = generateRawToken();
    const tokenHash = hashToken(rawToken);
    const expiresAt = resolveExpiry(body.expires_in_minutes);

    const { data: inserted, error: insertError } = await supabase
      .from("activation_tokens")
      .insert({
        tenant_id: tenantId,
        branch_id: branchId,
        token_hash: tokenHash,
        token_type: tokenType,
        purpose,
        status: "active",
        requested_by: auth.userId,
        approved_by: auth.userId,
        expires_at: expiresAt,
        metadata
      })
      .select("id,tenant_id,branch_id,token_type,purpose,status,expires_at,created_at")
      .single();

    if (insertError || !inserted) {
      throw new Error(insertError?.message ?? "Failed to create activation token.");
    }

    await appendAuditLog({
      tenantId,
      branchId: branchId ?? undefined,
      actorUserId: auth.userId,
      actorRole,
      action: "activation_token_created",
      targetTable: "activation_tokens",
      targetId: inserted.id,
      metadata: {
        token_type: tokenType,
        purpose,
        expires_at: expiresAt
      },
      ipAddress: requestMeta.ipAddress ?? undefined,
      userAgent: requestMeta.userAgent ?? undefined
    });

    return ok({
      activation_token: rawToken,
      token_id: inserted.id,
      token_type: inserted.token_type,
      purpose: inserted.purpose,
      status: inserted.status,
      expires_at: inserted.expires_at,
      created_at: inserted.created_at
    });
  } catch (error) {
    return guardActivationAdminError(error);
  }
}
