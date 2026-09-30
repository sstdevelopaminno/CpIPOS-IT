import "server-only";

import { readRequiredEnv } from "@/lib/env";
import type { ItAdminContext } from "@/lib/it-admin-guard";
import { appendAuditLog } from "@/lib/audit-log";
import { invalidateTenantFeatureGateCache } from "@/lib/feature-gate";

type QuotaLimits = {
  requests: number | null;
  tokens: number | null;
  cost_usd: number | null;
};

type PackageQuota = {
  package_id: string;
  is_enabled: boolean;
  monthly_request_limit: number | null;
  monthly_token_limit: number | null;
  monthly_cost_limit_usd: number | string | null;
  history_retention_days: number | null;
  document_storage_mb: number | null;
  document_retention_days: number | null;
  document_max_file_mb: number | null;
};

type TenantOverride = {
  tenant_id: string;
  quota_mode: "inherit" | "custom" | "unlimited";
  is_enabled_override: boolean | null;
  monthly_request_limit: number | null;
  monthly_token_limit: number | null;
  monthly_cost_limit_usd: number | string | null;
  history_retention_days: number | null;
  document_storage_mb: number | null;
  document_retention_days: number | null;
  document_max_file_mb: number | null;
};

type DocumentUsageAgg = {
  tenant_id: string;
  document_count: number | string | null;
  total_bytes: number | string | null;
  last_document_at: string | null;
};

type UsageAgg = {
  tenant_id: string;
  request_count: number | string | null;
  user_count: number | string | null;
  input_tokens: number | string | null;
  output_tokens: number | string | null;
  total_tokens: number | string | null;
  total_cost_usd: number | string | null;
};

function numberValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullablePositive(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function monthBoundsBangkok(at = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit"
  }).formatToParts(at);
  const year = Number(parts.find((part) => part.type === "year")?.value ?? at.getUTCFullYear());
  const month = Number(parts.find((part) => part.type === "month")?.value ?? at.getUTCMonth() + 1);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return {
    month_key: `${year}-${String(month).padStart(2, "0")}`,
    start: new Date(`${year}-${String(month).padStart(2, "0")}-01T00:00:00+07:00`).toISOString(),
    end: new Date(`${nextYear}-${String(nextMonth).padStart(2, "0")}-01T00:00:00+07:00`).toISOString()
  };
}

function effectiveQuota(packageQuota: PackageQuota | null, override: TenantOverride | null) {
  const mode = override?.quota_mode ?? "inherit";
  const enabled = override?.is_enabled_override ?? packageQuota?.is_enabled ?? true;
  const limits: QuotaLimits = mode === "unlimited"
    ? { requests: null, tokens: null, cost_usd: null }
    : mode === "custom"
      ? {
          requests: nullablePositive(override?.monthly_request_limit),
          tokens: nullablePositive(override?.monthly_token_limit),
          cost_usd: nullablePositive(override?.monthly_cost_limit_usd)
        }
      : {
          requests: nullablePositive(packageQuota?.monthly_request_limit),
          tokens: nullablePositive(packageQuota?.monthly_token_limit),
          cost_usd: nullablePositive(packageQuota?.monthly_cost_limit_usd)
        };
  return {
    enabled,
    mode,
    source: mode === "inherit" ? "package" : mode === "custom" ? "tenant_custom" : "tenant_unlimited",
    limits,
    history_retention_days:
      nullablePositive(override?.history_retention_days) ??
      nullablePositive(packageQuota?.history_retention_days),
    documents: {
      storage_limit_mb:
        nullablePositive(override?.document_storage_mb) ??
        nullablePositive(packageQuota?.document_storage_mb),
      retention_days:
        nullablePositive(override?.document_retention_days) ??
        nullablePositive(packageQuota?.document_retention_days),
      max_file_mb:
        nullablePositive(override?.document_max_file_mb) ??
        nullablePositive(packageQuota?.document_max_file_mb)
    }
  };
}

function usageShape(row?: Partial<UsageAgg> | null) {
  return {
    requests: Math.max(0, Math.trunc(numberValue(row?.request_count))),
    users: Math.max(0, Math.trunc(numberValue(row?.user_count))),
    input_tokens: Math.max(0, Math.trunc(numberValue(row?.input_tokens))),
    output_tokens: Math.max(0, Math.trunc(numberValue(row?.output_tokens))),
    total_tokens: Math.max(0, Math.trunc(numberValue(row?.total_tokens))),
    cost_usd: Number(numberValue(row?.total_cost_usd).toFixed(8))
  };
}

async function syncPackageAiFeature(context: ItAdminContext, packageId: string, enabled: boolean) {
  const result = await context.supabase.from("subscription_package_features")
    .upsert({
      package_id: packageId,
      feature_code: "cpipos_ai",
      included: enabled
    }, { onConflict: "package_id,feature_code" });
  if (result.error) throw new Error(result.error.message);
  invalidateTenantFeatureGateCache();
}

async function syncTenantAiFeatureOverride(
  context: ItAdminContext,
  tenantId: string,
  mode: "inherit" | "custom" | "unlimited",
  enabledOverride: boolean | null
) {
  const deleteExisting = await context.supabase.from("tenant_feature_subscriptions")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("feature_code", "cpipos_ai")
    .is("branch_id", null);
  if (deleteExisting.error) throw new Error(deleteExisting.error.message);

  if (mode !== "inherit" || enabledOverride !== null) {
    const insert = await context.supabase.from("tenant_feature_subscriptions")
      .insert({
        tenant_id: tenantId,
        branch_id: null,
        feature_code: "cpipos_ai",
        is_enabled: enabledOverride !== false,
        source: "ai_quota_override"
      });
    if (insert.error) throw new Error(insert.error.message);
  }
  invalidateTenantFeatureGateCache();
}

export async function listCpiposAiStores(context: ItAdminContext) {
  const db = context.supabase;
  const bounds = monthBoundsBangkok();
  const [tenants, contracts, packages, policies, packageQuotas, tenantOverrides, usage, documentUsage, links] = await Promise.all([
    db.from("tenants").select("id,code,name,display_name,is_active,package_id").order("name"),
    db.from("tenant_subscription_contracts")
      .select("tenant_id,package_id,status,created_at")
      .in("status", ["active", "trial"])
      .order("created_at", { ascending: false }),
    db.from("subscription_packages").select("id,code,name,is_active,status"),
    db.from("tenant_pos_menu_policies")
      .select("tenant_id,menu_key,is_enabled")
      .in("menu_key", ["main.ai_assistant", "more.ai_assistant"]),
    db.from("pos_ai_package_quotas")
      .select("package_id,is_enabled,monthly_request_limit,monthly_token_limit,monthly_cost_limit_usd,history_retention_days,document_storage_mb,document_retention_days,document_max_file_mb"),
    db.from("pos_ai_tenant_quota_overrides")
      .select("tenant_id,quota_mode,is_enabled_override,monthly_request_limit,monthly_token_limit,monthly_cost_limit_usd,history_retention_days,document_storage_mb,document_retention_days,document_max_file_mb"),
    db.rpc("pos_ai_admin_tenant_usage", { p_started_at: bounds.start, p_ended_at: bounds.end }),
    db.rpc("pos_ai_admin_document_usage"),
    db.from("pos_ai_chat_rooms").select("id,tenant_id,user_id,branch_id,title,openai_conversation_id,updated_at,last_message_at")
  ]);
  for (const result of [tenants, contracts, packages, policies, packageQuotas, tenantOverrides, usage, documentUsage, links]) {
    if (result.error) throw new Error(result.error.message);
  }

  const latestContract = new Map<string, { package_id: string; status: string }>();
  for (const row of contracts.data ?? []) {
    if (!latestContract.has(row.tenant_id)) latestContract.set(row.tenant_id, row);
  }
  const packageMap = new Map((packages.data ?? []).map((row) => [row.id, row]));
  const packageQuotaMap = new Map((packageQuotas.data ?? []).map((row) => [row.package_id, row as PackageQuota]));
  const overrideMap = new Map((tenantOverrides.data ?? []).map((row) => [row.tenant_id, row as TenantOverride]));
  const usageMap = new Map(((usage.data ?? []) as UsageAgg[]).map((row) => [row.tenant_id, row]));
  const documentUsageMap = new Map(((documentUsage.data ?? []) as DocumentUsageAgg[]).map((row) => [row.tenant_id, row]));
  const linksByTenant = new Map<string, Array<Record<string, unknown>>>();
  for (const row of links.data ?? []) {
    const current = linksByTenant.get(row.tenant_id) ?? [];
    current.push(row as Record<string, unknown>);
    linksByTenant.set(row.tenant_id, current);
  }
  const policyMap = new Map<string, Map<string, boolean>>();
  for (const row of policies.data ?? []) {
    const current = policyMap.get(row.tenant_id) ?? new Map<string, boolean>();
    current.set(row.menu_key, row.is_enabled);
    policyMap.set(row.tenant_id, current);
  }

  const rows = (tenants.data ?? []).map((tenant) => {
    const contract = latestContract.get(tenant.id) ?? null;
    const packageId = contract?.package_id ?? tenant.package_id ?? null;
    const pkg = packageId ? packageMap.get(packageId) ?? null : null;
    const quota = effectiveQuota(packageId ? packageQuotaMap.get(packageId) ?? null : null, overrideMap.get(tenant.id) ?? null);
    const tenantPolicy = policyMap.get(tenant.id);
    const menuEnabled = tenantPolicy?.has("main.ai_assistant")
      ? tenantPolicy.get("main.ai_assistant") !== false
      : tenantPolicy?.get("more.ai_assistant") !== false;
    const effectiveEnabled = Boolean(tenant.is_active && menuEnabled && quota.enabled);
    const monthUsage = usageShape(usageMap.get(tenant.id));
    const tenantLinks = linksByTenant.get(tenant.id) ?? [];
    const docs = documentUsageMap.get(tenant.id);
    return {
      tenant_id: tenant.id,
      store_code: tenant.code,
      name: tenant.display_name || tenant.name,
      active: tenant.is_active,
      menu_enabled: menuEnabled,
      ai_enabled: effectiveEnabled,
      package_id: packageId,
      package_code: pkg?.code ?? null,
      package_name: pkg?.name ?? null,
      contract_status: contract?.status ?? null,
      conversation_count: tenantLinks.length,
      ai_user_count: new Set(tenantLinks.map((row) => String(row.user_id))).size,
      last_conversation_at: tenantLinks.map((row) => String(row.updated_at ?? "")).filter(Boolean).sort().at(-1) ?? null,
      quota,
      usage: monthUsage,
      document_usage: {
        count: Math.max(0, Math.trunc(numberValue(docs?.document_count))),
        bytes: Math.max(0, Math.trunc(numberValue(docs?.total_bytes))),
        last_document_at: docs?.last_document_at ?? null
      }
    };
  }).filter((row) => row.ai_enabled);

  return {
    generated_at: new Date().toISOString(),
    month: bounds.month_key,
    summary: {
      stores: rows.length,
      ai_users: rows.reduce((sum, row) => sum + row.ai_user_count, 0),
      requests: rows.reduce((sum, row) => sum + row.usage.requests, 0),
      total_tokens: rows.reduce((sum, row) => sum + row.usage.total_tokens, 0),
      total_cost_usd: Number(rows.reduce((sum, row) => sum + row.usage.cost_usd, 0).toFixed(8))
    },
    rows
  };
}

export async function listCpiposAiDocumentStores(context: ItAdminContext) {
  const db = context.supabase;
  const [tenants, contracts, packages, packageQuotas, tenantOverrides, documentUsage] = await Promise.all([
    db.from("tenants").select("id,code,name,display_name,is_active,package_id").order("name"),
    db.from("tenant_subscription_contracts")
      .select("tenant_id,package_id,status,created_at")
      .in("status", ["active","trial"])
      .order("created_at", { ascending: false }),
    db.from("subscription_packages").select("id,code,name"),
    db.from("pos_ai_package_quotas")
      .select("package_id,is_enabled,monthly_request_limit,monthly_token_limit,monthly_cost_limit_usd,history_retention_days,document_storage_mb,document_retention_days,document_max_file_mb"),
    db.from("pos_ai_tenant_quota_overrides")
      .select("tenant_id,quota_mode,is_enabled_override,monthly_request_limit,monthly_token_limit,monthly_cost_limit_usd,history_retention_days,document_storage_mb,document_retention_days,document_max_file_mb"),
    db.rpc("pos_ai_admin_document_usage")
  ]);
  for (const result of [tenants,contracts,packages,packageQuotas,tenantOverrides,documentUsage]) {
    if (result.error) throw new Error(result.error.message);
  }

  const latestContract = new Map<string,{ package_id: string; status: string }>();
  for (const row of contracts.data ?? []) {
    if (!latestContract.has(row.tenant_id)) latestContract.set(row.tenant_id,row);
  }
  const packageMap = new Map((packages.data ?? []).map((row) => [row.id,row]));
  const packageQuotaMap = new Map((packageQuotas.data ?? []).map((row) => [row.package_id,row as PackageQuota]));
  const overrideMap = new Map((tenantOverrides.data ?? []).map((row) => [row.tenant_id,row as TenantOverride]));
  const usageMap = new Map(((documentUsage.data ?? []) as DocumentUsageAgg[]).map((row) => [row.tenant_id,row]));

  return {
    generated_at: new Date().toISOString(),
    rows: (tenants.data ?? []).map((tenant) => {
      const contract = latestContract.get(tenant.id) ?? null;
      const packageId = contract?.package_id ?? tenant.package_id ?? null;
      const pkg = packageId ? packageMap.get(packageId) ?? null : null;
      const quota = effectiveQuota(packageId ? packageQuotaMap.get(packageId) ?? null : null, overrideMap.get(tenant.id) ?? null);
      const usage = usageMap.get(tenant.id);
      return {
        tenant_id: tenant.id,
        store_code: tenant.code,
        name: tenant.display_name || tenant.name,
        active: Boolean(tenant.is_active),
        package_code: pkg?.code ?? null,
        package_name: pkg?.name ?? null,
        contract_status: contract?.status ?? null,
        policy: quota.documents,
        usage: {
          count: Math.max(0,Math.trunc(numberValue(usage?.document_count))),
          bytes: Math.max(0,Math.trunc(numberValue(usage?.total_bytes))),
          last_document_at: usage?.last_document_at ?? null
        }
      };
    })
  };
}

export async function listCpiposAiPackageQuotas(context: ItAdminContext) {
  const db = context.supabase;
  const [packages, quotas] = await Promise.all([
    db.from("subscription_packages")
      .select("id,code,name,monthly_price,is_active,status,display_order")
      .eq("is_active", true)
      .order("display_order", { ascending: true, nullsFirst: false }),
    db.from("pos_ai_package_quotas")
      .select("package_id,is_enabled,monthly_request_limit,monthly_token_limit,monthly_cost_limit_usd,history_retention_days,document_storage_mb,document_retention_days,document_max_file_mb,updated_at")
  ]);
  if (packages.error) throw new Error(packages.error.message);
  if (quotas.error) throw new Error(quotas.error.message);
  const quotaMap = new Map((quotas.data ?? []).map((row) => [row.package_id, row]));
  return (packages.data ?? []).map((pkg) => ({
    ...pkg,
    quota: quotaMap.get(pkg.id) ?? {
      package_id: pkg.id,
      is_enabled: true,
      monthly_request_limit: null,
      monthly_token_limit: null,
      monthly_cost_limit_usd: null,
      history_retention_days: null,
      document_storage_mb: null,
      document_retention_days: null,
      document_max_file_mb: null,
      updated_at: null
    }
  }));
}

export async function updateCpiposAiPackageQuota(context: ItAdminContext, packageId: string, input: Record<string, unknown>) {
  const payload = {
    package_id: packageId,
    is_enabled: typeof input.is_enabled === "boolean" ? input.is_enabled : true,
    monthly_request_limit: nullablePositive(input.monthly_request_limit),
    monthly_token_limit: nullablePositive(input.monthly_token_limit),
    monthly_cost_limit_usd: nullablePositive(input.monthly_cost_limit_usd),
    history_retention_days: nullablePositive(input.history_retention_days),
    document_storage_mb: nullablePositive(input.document_storage_mb),
    document_retention_days: nullablePositive(input.document_retention_days),
    document_max_file_mb: nullablePositive(input.document_max_file_mb),
    updated_by: context.auth.userId,
    updated_at: new Date().toISOString()
  };
  const before = await context.supabase.from("pos_ai_package_quotas").select("*").eq("package_id", packageId).maybeSingle();
  if (before.error) throw new Error(before.error.message);
  const saved = await context.supabase.from("pos_ai_package_quotas")
    .upsert(payload, { onConflict: "package_id" })
    .select("*").single();
  if (saved.error) throw new Error(saved.error.message);
  await syncPackageAiFeature(context, packageId, Boolean(saved.data.is_enabled));
  await appendAuditLog({
    actorUserId: context.auth.userId,
    actorRole: context.auth.platformRole,
    action: "it_ai_package_quota_changed",
    targetTable: "pos_ai_package_quotas",
    targetId: packageId,
    beforeData: (before.data ?? null) as never,
    afterData: saved.data as never,
    ipAddress: context.requestMeta.ipAddress ?? undefined,
    userAgent: context.requestMeta.userAgent ?? undefined
  });
  return saved.data;
}

export async function getCpiposAiTenantDetail(context: ItAdminContext, tenantId: string) {
  const db = context.supabase;
  const now = new Date();
  const month = monthBoundsBangkok(now);
  const dayStart = new Date(now.getTime() - 31 * 86400000).toISOString();
  const yearStart = new Date(Date.UTC(now.getUTCFullYear() - 4, 0, 1)).toISOString();
  const monthSeriesStart = new Date(Date.UTC(now.getUTCFullYear() - 1, now.getUTCMonth(), 1)).toISOString();

  const [tenant, contract, policy, override, links, events, daily, monthly, yearly, monthUsage, documentUsage] = await Promise.all([
    db.from("tenants").select("id,code,name,display_name,is_active,package_id").eq("id", tenantId).maybeSingle(),
    db.from("tenant_subscription_contracts")
      .select("package_id,status,created_at")
      .eq("tenant_id", tenantId).in("status", ["active", "trial"])
      .order("created_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("tenant_pos_menu_policies")
      .select("menu_key,is_enabled").eq("tenant_id", tenantId)
      .in("menu_key", ["main.ai_assistant", "more.ai_assistant"]),
    db.from("pos_ai_tenant_quota_overrides")
      .select("tenant_id,quota_mode,is_enabled_override,monthly_request_limit,monthly_token_limit,monthly_cost_limit_usd,history_retention_days,document_storage_mb,document_retention_days,document_max_file_mb,updated_at")
      .eq("tenant_id", tenantId).maybeSingle(),
    db.from("pos_ai_chat_rooms")
      .select("id,title,tenant_id,branch_id,user_id,openai_conversation_id,created_at,updated_at,last_message_at")
      .eq("tenant_id", tenantId).order("last_message_at", { ascending: false }),
    db.from("pos_ai_usage_events")
      .select("id,branch_id,user_id,openai_conversation_id,response_id,model,prompt_text,input_tokens,cached_input_tokens,cache_write_tokens,output_tokens,reasoning_tokens,total_tokens,total_cost_usd,pricing_source,service_tier,status,requested_at,history_cleared_at")
      .eq("tenant_id", tenantId).order("requested_at", { ascending: false }).limit(250),
    db.rpc("pos_ai_admin_usage_series", { p_tenant_id: tenantId, p_started_at: dayStart, p_ended_at: now.toISOString(), p_grain: "day" }),
    db.rpc("pos_ai_admin_usage_series", { p_tenant_id: tenantId, p_started_at: monthSeriesStart, p_ended_at: now.toISOString(), p_grain: "month" }),
    db.rpc("pos_ai_admin_usage_series", { p_tenant_id: tenantId, p_started_at: yearStart, p_ended_at: now.toISOString(), p_grain: "year" }),
    db.rpc("pos_ai_usage_summary", { p_tenant_id: tenantId, p_started_at: month.start, p_ended_at: month.end }),
    db.rpc("pos_ai_document_usage", { p_tenant_id: tenantId })
  ]);
  for (const result of [tenant, contract, policy, override, links, events, daily, monthly, yearly, monthUsage, documentUsage]) {
    if (result.error) throw new Error(result.error.message);
  }
  if (!tenant.data) return null;

  const packageId = contract.data?.package_id ?? tenant.data.package_id ?? null;
  const [pkg, packageQuota, profiles, branches, roles] = await Promise.all([
    packageId ? db.from("subscription_packages").select("id,code,name").eq("id", packageId).maybeSingle() : Promise.resolve({ data: null, error: null }),
    packageId ? db.from("pos_ai_package_quotas").select("package_id,is_enabled,monthly_request_limit,monthly_token_limit,monthly_cost_limit_usd,history_retention_days,document_storage_mb,document_retention_days,document_max_file_mb").eq("package_id", packageId).maybeSingle() : Promise.resolve({ data: null, error: null }),
    db.from("users_profiles").select("id,email,full_name,is_active"),
    db.from("branches").select("id,code,name,is_active").eq("tenant_id", tenantId),
    db.from("user_branch_roles").select("user_id,branch_id,role,is_default").eq("tenant_id", tenantId).in("role", ["owner","manager"])
  ]);
  for (const result of [pkg, packageQuota, profiles, branches, roles]) {
    if (result.error) throw new Error(result.error.message);
  }

  const profileMap = new Map((profiles.data ?? []).map((row) => [row.id, row]));
  const branchMap = new Map((branches.data ?? []).map((row) => [row.id, row]));
  const roleMap = new Map((roles.data ?? []).map((row) => [`${row.user_id}:${row.branch_id}`, row.role]));
  const quota = effectiveQuota((packageQuota.data ?? null) as PackageQuota | null, (override.data ?? null) as TenantOverride | null);
  const monthUsageShape = usageShape(((monthUsage.data ?? []) as UsageAgg[])[0] ?? null);
  const menuPolicy = new Map((policy.data ?? []).map((row) => [row.menu_key, row.is_enabled]));
  const menuEnabled = menuPolicy.has("main.ai_assistant")
    ? menuPolicy.get("main.ai_assistant") !== false
    : menuPolicy.get("more.ai_assistant") !== false;

  const rooms = (links.data ?? []).map((link) => {
    const profile = profileMap.get(link.user_id);
    const branch = branchMap.get(link.branch_id);
    return {
      room_id: link.id,
      room_title: link.title,
      user_id: link.user_id,
      full_name: profile?.full_name ?? "—",
      email: profile?.email ?? "—",
      role: roleMap.get(`${link.user_id}:${link.branch_id}`) ?? "owner/manager",
      branch_id: link.branch_id,
      branch_name: branch?.name ?? branch?.code ?? "—",
      conversation_id: link.openai_conversation_id,
      conversation_created_at: link.created_at,
      conversation_updated_at: link.updated_at,
      last_message_at: link.last_message_at
    };
  });

  const users = Array.from(
    new Map(
      rooms.map((room) => [
        `${room.user_id}:${room.branch_id}`,
        {
          user_id: room.user_id,
          full_name: room.full_name,
          email: room.email,
          role: room.role,
          branch_id: room.branch_id,
          branch_name: room.branch_name,
          room_count: rooms.filter((item) => item.user_id === room.user_id && item.branch_id === room.branch_id).length
        }
      ])
    ).values()
  );

  return {
    generated_at: new Date().toISOString(),
    tenant: {
      id: tenant.data.id,
      code: tenant.data.code,
      name: tenant.data.display_name || tenant.data.name,
      active: tenant.data.is_active
    },
    menu_enabled: menuEnabled,
    package: pkg.data ?? null,
    contract_status: contract.data?.status ?? null,
    quota: {
      ...quota,
      override: override.data ?? null,
      package_default: packageQuota.data ?? null,
      month: month.month_key,
      usage: monthUsageShape
    },
    users,
    rooms,
    document_usage: {
      count: Math.max(0, Math.trunc(numberValue(((documentUsage.data ?? []) as Array<{document_count?: number | string}>)[0]?.document_count))),
      bytes: Math.max(0, Math.trunc(numberValue(((documentUsage.data ?? []) as Array<{total_bytes?: number | string}>)[0]?.total_bytes)))
    },
    events: events.data ?? [],
    series: {
      daily: daily.data ?? [],
      monthly: monthly.data ?? [],
      yearly: yearly.data ?? []
    }
  };
}

export async function updateCpiposAiTenantQuota(context: ItAdminContext, tenantId: string, input: Record<string, unknown>) {
  const mode = input.quota_mode === "custom" ? "custom" : input.quota_mode === "unlimited" ? "unlimited" : "inherit";
  const payload = {
    tenant_id: tenantId,
    quota_mode: mode,
    is_enabled_override: typeof input.is_enabled_override === "boolean" ? input.is_enabled_override : null,
    monthly_request_limit: mode === "custom" ? nullablePositive(input.monthly_request_limit) : null,
    monthly_token_limit: mode === "custom" ? nullablePositive(input.monthly_token_limit) : null,
    monthly_cost_limit_usd: mode === "custom" ? nullablePositive(input.monthly_cost_limit_usd) : null,
    history_retention_days: nullablePositive(input.history_retention_days),
    document_storage_mb: nullablePositive(input.document_storage_mb),
    document_retention_days: nullablePositive(input.document_retention_days),
    document_max_file_mb: nullablePositive(input.document_max_file_mb),
    updated_by: context.auth.userId,
    updated_at: new Date().toISOString()
  };
  const before = await context.supabase.from("pos_ai_tenant_quota_overrides").select("*").eq("tenant_id", tenantId).maybeSingle();
  if (before.error) throw new Error(before.error.message);
  const saved = await context.supabase.from("pos_ai_tenant_quota_overrides")
    .upsert(payload, { onConflict: "tenant_id" }).select("*").single();
  if (saved.error) throw new Error(saved.error.message);
  await syncTenantAiFeatureOverride(context, tenantId, mode, payload.is_enabled_override);
  await appendAuditLog({
    tenantId,
    actorUserId: context.auth.userId,
    actorRole: context.auth.platformRole,
    action: "it_ai_tenant_quota_changed",
    targetTable: "pos_ai_tenant_quota_overrides",
    targetId: tenantId,
    beforeData: (before.data ?? null) as never,
    afterData: saved.data as never,
    ipAddress: context.requestMeta.ipAddress ?? undefined,
    userAgent: context.requestMeta.userAgent ?? undefined
  });
  return saved.data;
}

async function openAiFetch(path: string, init?: RequestInit) {
  const key = readRequiredEnv("OPENAI_API_KEY", "CpIPOS-IT requires OPENAI_API_KEY to clear OpenAI conversation history.");
  const response = await fetch(`https://api.openai.com/v1${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });
  if (response.status === 404) return null;
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload && typeof payload === "object" && "error" in payload
      ? String((payload as { error?: { message?: string } }).error?.message ?? "OpenAI request failed")
      : "OpenAI request failed";
    throw new Error(`openai_history_delete_failed:${message}`);
  }
  return payload;
}

async function deleteOpenAiConversation(conversationId: string) {
  for (let page = 0; page < 100; page += 1) {
    const result = await openAiFetch(`/conversations/${encodeURIComponent(conversationId)}/items?order=desc&limit=100`) as {
      data?: Array<{ id?: string }>;
      has_more?: boolean;
    } | null;
    if (!result) break;
    const ids = (result.data ?? []).map((item) => String(item.id ?? "")).filter(Boolean);
    if (!ids.length) break;
    for (const id of ids) {
      await openAiFetch(`/conversations/${encodeURIComponent(conversationId)}/items/${encodeURIComponent(id)}`, { method: "DELETE" });
    }
    if (!result.has_more) break;
  }
  await openAiFetch(`/conversations/${encodeURIComponent(conversationId)}`, { method: "DELETE" });
}

export async function clearCpiposAiHistory(
  context: ItAdminContext,
  tenantId: string,
  userId?: string | null,
  branchId?: string | null,
  roomId?: string | null
) {
  let query = context.supabase.from("pos_ai_chat_rooms")
    .select("id,tenant_id,branch_id,user_id,openai_conversation_id,title")
    .eq("tenant_id", tenantId);
  if (userId) query = query.eq("user_id", userId);
  if (branchId) query = query.eq("branch_id", branchId);
  if (roomId) query = query.eq("id", roomId);
  const rooms = await query;
  if (rooms.error) throw new Error(rooms.error.message);

  for (const room of rooms.data ?? []) {
    await deleteOpenAiConversation(room.openai_conversation_id);
  }

  const conversationIds = (rooms.data ?? []).map((room) => room.openai_conversation_id);
  if (conversationIds.length) {
    const deleted = await context.supabase.from("pos_ai_chat_rooms")
      .delete()
      .in("id", (rooms.data ?? []).map((room) => room.id));
    if (deleted.error) throw new Error(deleted.error.message);

    const redacted = await context.supabase.from("pos_ai_usage_events")
      .update({ prompt_text: null, history_cleared_at: new Date().toISOString() })
      .eq("tenant_id", tenantId)
      .in("openai_conversation_id", conversationIds);
    if (redacted.error) throw new Error(redacted.error.message);
  }

  await appendAuditLog({
    tenantId,
    actorUserId: context.auth.userId,
    actorRole: context.auth.platformRole,
    action: "it_ai_history_cleared",
    targetTable: "pos_ai_chat_rooms",
    targetId: roomId ?? tenantId,
    metadata: {
      cleared_conversations: (rooms.data ?? []).length,
      scoped_room_id: roomId ?? null,
      scoped_user_id: userId ?? null,
      scoped_branch_id: branchId ?? null,
      usage_accounting_retained: true,
      transcript_storage: "openai_conversations"
    },
    ipAddress: context.requestMeta.ipAddress ?? undefined,
    userAgent: context.requestMeta.userAgent ?? undefined
  });

  return { cleared_conversations: (rooms.data ?? []).length, usage_accounting_retained: true };
}
