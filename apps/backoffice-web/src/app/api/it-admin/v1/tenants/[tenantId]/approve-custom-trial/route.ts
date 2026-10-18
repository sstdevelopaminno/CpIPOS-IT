import { fail, ok } from "@/lib/http";
import { requireItAdmin, parseTenantParam, ItAdminGuardError, guardItAdminError } from "@/lib/it-admin-guard";
import { readBoundedJson } from "@/lib/server/limited-json";
import { appendAuditLog } from "@/lib/audit-log";

export const dynamic = "force-dynamic";

// Incident-scoped emergency approval. Do not expose generic cross-tenant quota writes.
const IMDC_TENANT_ID = "29d295e3-6707-4476-8ca5-c8a4fdf0a3b0";
const TARGET = { max_branches: 2, max_devices: 2, max_users: 8 } as const;
const YEARLY_PRICE = 5000;
type Context = Awaited<ReturnType<typeof requireItAdmin>>;
type RouteContext = { params: Promise<{ tenantId: string }> };
type Contract = {
  id: string; package_id: string; status: string; billing_interval: string;
  amount_per_cycle: number | string; currency: string; max_branches: number;
  max_devices: number; max_users: number; updated_at: string;
  metadata: Record<string, unknown> | null;
};
type Terms = {
  tenant_id: string; package_id: string; status: string; version: number;
  monthly_price: number | string; yearly_price: number | string;
  monthly_discount_percent: number | string; yearly_discount_percent: number | string;
  max_branches: number; max_devices: number; max_users: number;
  approved_at: string | null;
};
type Stats = { active_branches: number; active_devices: number; assigned_users: number; open_payment_requests: number; settled_payments: number };

function checkTarget(raw: string) {
  const id = parseTenantParam(raw);
  if (id !== IMDC_TENANT_ID) throw new ItAdminGuardError("custom_trial_scope_forbidden", "This approval is scoped to IMDC OPTICAL only.", 403);
  return id;
}

async function loadState(admin: Context, tenantId: string) {
  const db = admin.supabase;
  const [tenantResult, contractResult, termsResult, branches, devices, roles, requests, settlements] = await Promise.all([
    db.from("tenants").select("id,name,is_active").eq("id", tenantId).maybeSingle(),
    db.from("tenant_subscription_contracts")
      .select("id,package_id,status,billing_interval,amount_per_cycle,currency,max_branches,max_devices,max_users,updated_at,metadata")
      .eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(1).maybeSingle<Contract>(),
    db.from("tenant_custom_package_terms")
      .select("tenant_id,package_id,status,version,monthly_price,yearly_price,monthly_discount_percent,yearly_discount_percent,max_branches,max_devices,max_users,approved_at")
      .eq("tenant_id", tenantId).maybeSingle<Terms>(),
    db.from("branches").select("id", { head: true, count: "exact" }).eq("tenant_id", tenantId).eq("is_active", true),
    db.from("branch_devices").select("id", { head: true, count: "exact" }).eq("tenant_id", tenantId).eq("is_active", true).eq("status", "active"),
    db.from("user_branch_roles").select("user_id").eq("tenant_id", tenantId),
    db.from("tenant_subscription_payment_requests").select("id", { head: true, count: "exact" })
      .eq("tenant_id", tenantId).in("status", ["pending", "under_review"]),
    db.from("tenant_subscription_settlements").select("id", { head: true, count: "exact" }).eq("tenant_id", tenantId)
  ]);
  for (const r of [tenantResult,contractResult,termsResult,branches,devices,roles,requests,settlements]) {
    if (r.error) throw new Error("custom_trial_preflight_failed:" + r.error.message);
  }
  if (!tenantResult.data || !contractResult.data || !termsResult.data) {
    throw new ItAdminGuardError("custom_trial_missing", "IMDC tenant, contract or terms not found.", 404);
  }
  const p = await db.from("subscription_packages").select("code").eq("id", contractResult.data.package_id).maybeSingle();
  if (p.error) throw p.error;
  const stats: Stats = {
    active_branches: branches.count ?? 0,
    active_devices: devices.count ?? 0,
    assigned_users: new Set((roles.data ?? []).map(r => r.user_id)).size,
    open_payment_requests: requests.count ?? 0,
    settled_payments: settlements.count ?? 0
  };
  return { tenant: tenantResult.data, contract: contractResult.data, terms: termsResult.data, package_code: p.data?.code ?? null, stats };
}

function isApplied(s: Awaited<ReturnType<typeof loadState>>) {
  const { contract: c, terms: t } = s;
  return t.status === "approved" && c.max_branches === 2 && c.max_devices === 2 && c.max_users === 8
    && String(c.metadata?.custom_terms_version ?? "") === String(t.version);
}

function assertSafe(s: Awaited<ReturnType<typeof loadState>>) {
  const { contract: c, terms: t, stats } = s;
  const modes = c.metadata?.sales_modes as Record<string, unknown> | undefined;
  const validTerms = Number(t.monthly_price) === 0 && Number(t.yearly_price) === YEARLY_PRICE
    && Number(t.monthly_discount_percent) === 0 && Number(t.yearly_discount_percent) === 0;
  if (s.package_code !== "custom" || c.status !== "trial" || c.billing_interval !== "yearly"
      || c.currency !== "THB" || Number(c.amount_per_cycle) !== YEARLY_PRICE || modes?.optical_retail !== true) {
    throw new ItAdminGuardError("trial_contract_changed", "CUSTOM Optical trial or agreed 5,000 THB yearly contract has changed.", 409);
  }
  if (!validTerms || t.package_id !== c.package_id || t.max_branches !== TARGET.max_branches
      || t.max_devices !== TARGET.max_devices || t.max_users !== TARGET.max_users) {
    throw new ItAdminGuardError("draft_mismatch", "Draft no longer matches the approved 2/2/8 and 5,000 THB/year terms.", 409);
  }
  if (stats.active_branches > TARGET.max_branches || stats.active_devices > TARGET.max_devices
      || stats.assigned_users > TARGET.max_users || stats.open_payment_requests > 0 || stats.settled_payments > 0) {
    throw new ItAdminGuardError("quota_usage_or_payment_conflict", "Cannot apply trial quotas while usage or payments conflict.", 409);
  }
  if (t.status !== "draft" && !isApplied(s) && t.status !== "approved") {
    throw new ItAdminGuardError("draft_status_invalid", "CUSTOM terms cannot be approved from this state.", 409);
  }
}

export async function GET(_req: Request, context: RouteContext) {
  try {
    const admin = await requireItAdmin();
    const tenantId = checkTarget((await context.params).tenantId);
    const state = await loadState(admin, tenantId);
    assertSafe(state);
    const { tenant, contract, terms, stats } = state;
    return ok({ tenant_name: tenant.name, contract: {
      status: contract.status, billing_interval: contract.billing_interval,
      amount_per_cycle: Number(contract.amount_per_cycle), currency: contract.currency,
      max_branches: contract.max_branches, max_devices: contract.max_devices, max_users: contract.max_users
    }, terms: {
      status: terms.status, version: terms.version, max_branches: terms.max_branches,
      max_devices: terms.max_devices, max_users: terms.max_users,
      yearly_price: Number(terms.yearly_price)
    }, stats, applied: isApplied(state) });
  } catch (error) { return guardItAdminError(error); }
}

export async function POST(req: Request, context: RouteContext) {
  try {
    const admin = await requireItAdmin();
    const tenantId = checkTarget((await context.params).tenantId);
    const payload = await readBoundedJson<{ version?: number; confirm?: string } | null>(req, 2048);
    if (payload?.confirm !== "APPROVE_IMDC_CUSTOM_2_2_8" || !Number.isSafeInteger(payload?.version)) {
      return fail("approval_confirmation_required", "Explicit approval and terms version required.", 422);
    }
    const current = await loadState(admin, tenantId);
    assertSafe(current);
    if (current.terms.version !== payload.version) {
      return fail("terms_version_changed", "CUSTOM draft changed; refresh before approval.", 409);
    }
    if (isApplied(current)) return ok({ applied: true, already_applied: true });
    const now = new Date().toISOString();
    let approvedVersion = current.terms.version;
    if (current.terms.status === "draft") {
      const updated = await admin.supabase.from("tenant_custom_package_terms")
        .update({ status: "approved", approved_by: admin.auth.userId, approved_at: now, updated_at: now })
        .eq("tenant_id", tenantId).eq("package_id", current.contract.package_id)
        .eq("status", "draft").eq("version", current.terms.version)
        .select("version").maybeSingle<{ version: number }>();
      if (updated.error) throw updated.error;
      if (!updated.data) return fail("terms_version_conflict", "CUSTOM draft changed; retry after refresh.", 409);
      approvedVersion = updated.data.version;
    }
    // The database contract trigger only applies CUSTOM limits when terms are APPROVED or ACTIVE.
    // No billing dates, currency, price, payment, receipt or settlement field is modified.
    const old = current.contract;
    const changed = await admin.supabase.from("tenant_subscription_contracts")
      .update({
        max_branches: TARGET.max_branches, branch_limit: TARGET.max_branches,
        max_devices: TARGET.max_devices, terminal_limit_per_branch: TARGET.max_devices,
        max_users: TARGET.max_users,
        metadata: { ...(old.metadata ?? {}), custom_terms_version: approvedVersion }
      })
      .eq("id", old.id).eq("tenant_id", tenantId).eq("status", "trial")
      .eq("billing_interval", "yearly").eq("amount_per_cycle", YEARLY_PRICE)
      .eq("updated_at", old.updated_at)
      .select("id,max_branches,max_devices,max_users,billing_interval,amount_per_cycle,currency,metadata")
      .maybeSingle();
    if (changed.error) throw changed.error;
    if (!changed.data) return fail("contract_changed", "Contract changed concurrently. Review and retry.", 409);
    if (changed.data.max_branches !== 2 || changed.data.max_devices !== 2 || changed.data.max_users !== 8
       || changed.data.billing_interval !== "yearly" || Number(changed.data.amount_per_cycle) !== YEARLY_PRICE
       || changed.data.currency !== "THB") {
      throw new Error("custom_trial_contract_verification_failed");
    }
    await appendAuditLog({
      tenantId, actorUserId: admin.auth.userId, actorRole: admin.auth.platformRole,
      action: "it_custom_trial_quotas_approved", targetTable: "tenant_subscription_contracts",
      targetId: old.id, module: "it_admin",
      beforeData: { max_branches: old.max_branches, max_devices: old.max_devices, max_users: old.max_users },
      afterData: { ...TARGET, custom_terms_version: approvedVersion },
      metadata: { trial_only: true, commercial_terms_unchanged: true, annual_price_thb: YEARLY_PRICE, payment_untouched: true },
      ipAddress: admin.requestMeta.ipAddress ?? undefined, userAgent: admin.requestMeta.userAgent ?? undefined
    });
    const sync = await admin.supabase.from("branch_login_policies")
      .update({ max_devices: TARGET.max_devices, updated_at: now }).eq("tenant_id", tenantId);
    if (sync.error) throw sync.error;
    const confirmed = await loadState(admin, tenantId);
    if (!isApplied(confirmed)) throw new Error("custom_trial_post_apply_verification_failed");
    return ok({ applied: true, already_applied: false, contract: {
      max_branches: confirmed.contract.max_branches, max_devices: confirmed.contract.max_devices,
      max_users: confirmed.contract.max_users, yearly_price: Number(confirmed.contract.amount_per_cycle)
    } });
  } catch (error) { return guardItAdminError(error); }
}
