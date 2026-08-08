import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase-admin";

export type StoreCodeKind = "access_code" | "legacy";

export type ResolvedTenantStore = {
  tenantId: string;
  internalCode: string;
  publicCode: string;
  name: string;
  isActive: boolean;
  codeKind: StoreCodeKind;
};

type TenantRow = {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
};

type AccessCodeRow = {
  tenant_id: string;
  access_code: string;
  is_active: boolean;
};

export function normalizeStoreCodeLookup(value: string | null | undefined): {
  value: string;
  kind: StoreCodeKind;
} {
  const raw = String(value ?? "").trim().toUpperCase();
  if (!raw) return { value: "", kind: "legacy" };

  // Numeric human-facing codes may be typed as 123456, 123-456, or 123 456.
  // Legacy alpha-numeric codes remain accepted during the compatibility window.
  if (/^[0-9\s-]+$/.test(raw)) {
    const compact = raw.replace(/[\s-]+/g, "");
    if (/^[0-9]{6}$/.test(compact)) {
      return { value: compact, kind: "access_code" };
    }
  }

  return { value: raw, kind: "legacy" };
}

async function findActiveAccessCodeForTenant(tenantId: string): Promise<string | null> {
  const supabase = getSupabaseServiceClient();
  const { data } = await supabase
    .from("tenant_access_codes")
    .select("access_code")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .maybeSingle<{ access_code: string }>();
  return data?.access_code ?? null;
}

export async function resolveTenantByStoreCode(value: string | null | undefined): Promise<ResolvedTenantStore | null> {
  const normalized = normalizeStoreCodeLookup(value);
  if (!normalized.value) return null;

  const supabase = getSupabaseServiceClient();

  if (normalized.kind === "access_code") {
    const { data: accessRow, error: accessError } = await supabase
      .from("tenant_access_codes")
      .select("tenant_id,access_code,is_active")
      .eq("access_code", normalized.value)
      .eq("is_active", true)
      .maybeSingle<AccessCodeRow>();

    if (accessError) throw new Error(`store_access_code_lookup_failed:${accessError.message}`);
    if (!accessRow) return null;

    const { data: tenant, error: tenantError } = await supabase
      .from("tenants")
      .select("id,code,name,is_active")
      .eq("id", accessRow.tenant_id)
      .maybeSingle<TenantRow>();

    if (tenantError) throw new Error(`store_tenant_lookup_failed:${tenantError.message}`);
    if (!tenant) return null;

    return {
      tenantId: tenant.id,
      internalCode: tenant.code,
      publicCode: accessRow.access_code,
      name: tenant.name,
      isActive: tenant.is_active,
      codeKind: "access_code"
    };
  }

  const { data: tenant, error: tenantError } = await supabase
    .from("tenants")
    .select("id,code,name,is_active")
    .eq("code", normalized.value)
    .maybeSingle<TenantRow>();

  if (tenantError) throw new Error(`store_tenant_lookup_failed:${tenantError.message}`);
  if (!tenant) return null;

  const publicCode = (await findActiveAccessCodeForTenant(tenant.id)) ?? tenant.code;
  return {
    tenantId: tenant.id,
    internalCode: tenant.code,
    publicCode,
    name: tenant.name,
    isActive: tenant.is_active,
    codeKind: "legacy"
  };
}

export function createCustomerStoreCodeCandidate(): string {
  // Customer codes intentionally avoid the 8xxxxx internal-test and 9xxxxx demo ranges.
  // Store codes are identifiers, not authentication secrets.
  const range = 700_000;
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  const value = 100_000 + (bytes[0] % range);
  return String(value).padStart(6, "0");
}

export async function ensureCustomerStoreCode(tenantId: string): Promise<string> {
  const supabase = getSupabaseServiceClient();
  const existing = await findActiveAccessCodeForTenant(tenantId);
  if (existing) return existing;

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const candidate = createCustomerStoreCodeCandidate();
    const { data, error } = await supabase
      .from("tenant_access_codes")
      .insert({ tenant_id: tenantId, access_code: candidate, purpose: "customer", is_active: true })
      .select("access_code")
      .single<{ access_code: string }>();

    if (!error && data) return data.access_code;
    if (error?.code === "23505") continue;
    throw new Error(`store_access_code_assign_failed:${error?.message ?? "unknown"}`);
  }

  throw new Error("store_access_code_assign_failed:collision_retry_exhausted");
}
