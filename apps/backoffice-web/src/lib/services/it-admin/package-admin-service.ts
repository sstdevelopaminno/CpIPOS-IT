import "server-only";

import { appendAuditLog } from "@/lib/audit-log";
import { invalidateTenantFeatureGateCache } from "@/lib/feature-gate";
import type { ItAdminContext } from "@/lib/it-admin-guard";
import { getPackageCatalogWithFeatures } from "@/lib/services/subscription-package-service";

export type PackageMutationInput = {
  code?: string;
  name?: string;
  monthly_price?: number;
  yearly_price?: number | null;
  max_branches?: number;
  max_devices?: number | null;
  max_users?: number | null;
  is_active?: boolean;
  status?: "active" | "inactive";
  metadata?: Record<string, unknown> | null;
  store_mode?: "single_register" | "branch_register" | null;
  no_branch_mode?: boolean | null;
  single_device_mode?: boolean | null;
  branch_selection?: "hidden" | "visible" | null;
  max_cashier_devices?: number | null;
  features?: Record<string, boolean> | string[];
  reason?: string | null;
};

type PackageRow = {
  id: string;
  code: string;
  name: string;
  monthly_price: number;
  yearly_price: number | null;
  max_branches: number;
  max_devices: number | null;
  max_users: number | null;
  is_active: boolean;
  status: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

function normalizeCode(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeText(value: unknown, maxLength = 160) {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, maxLength) : "";
}

function toPositiveInteger(value: unknown, fallback: number | null) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.trunc(parsed));
}

function toMoney(value: unknown, fallback: number | null) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Number(parsed.toFixed(2)));
}

function normalizeFeatureMap(features: PackageMutationInput["features"]): Map<string, boolean> | null {
  if (!features) return null;
  if (Array.isArray(features)) {
    const entries: Array<[string, boolean]> = features
      .map((code): [string, boolean] => [String(code).trim(), true])
      .filter(([code]) => Boolean(code));
    return new Map(entries);
  }
  return new Map(
    Object.entries(features)
      .map(([code, included]) => [String(code).trim(), Boolean(included)] as const)
      .filter(([code]) => Boolean(code))
  );
}

function normalizePackageMetadata(input: PackageMutationInput, current?: Record<string, unknown> | null) {
  const metadata = { ...(current ?? {}), ...(input.metadata ?? {}) };
  const singleRegister =
    input.store_mode === "single_register" ||
    input.no_branch_mode === true ||
    input.single_device_mode === true ||
    input.branch_selection === "hidden";

  if (singleRegister) {
    metadata.login_mode = "single_register";
    metadata.branch_selection = "hidden";
    metadata.max_cashier_devices = 1;
    metadata.no_branch_mode = true;
    metadata.single_device_mode = true;
    return metadata;
  }

  if (input.store_mode === "branch_register" || input.no_branch_mode === false || input.single_device_mode === false || input.branch_selection === "visible") {
    metadata.login_mode = "branch_register";
    metadata.branch_selection = "visible";
    metadata.no_branch_mode = false;
    metadata.single_device_mode = false;
  }

  if (typeof input.max_cashier_devices === "number") {
    metadata.max_cashier_devices = toPositiveInteger(input.max_cashier_devices, 1);
  }

  return metadata;
}

function hasPackageModeInput(input: PackageMutationInput) {
  return Boolean(
    input.store_mode ||
      typeof input.no_branch_mode === "boolean" ||
      typeof input.single_device_mode === "boolean" ||
      input.branch_selection ||
      typeof input.max_cashier_devices === "number"
  );
}
async function syncPackageFeatures(context: ItAdminContext, packageId: string, features: PackageMutationInput["features"]) {
  const featureMap = normalizeFeatureMap(features);
  if (!featureMap) return [];

  const featureCodes: string[] = Array.from(featureMap.keys());
  if (!featureCodes.length) return [];

  const { data: catalog, error: catalogError } = await context.supabase
    .from("package_feature_catalog")
    .select("code")
    .in("code", featureCodes)
    .returns<Array<{ code: string }>>();
  if (catalogError) throw new Error(catalogError.message);

  const validCodes = new Set((catalog ?? []).map((item) => item.code));
  const rows = featureCodes
    .filter((code) => validCodes.has(code))
    .map((code) => ({
      package_id: packageId,
      feature_code: code,
      included: Boolean(featureMap.get(code))
    }));

  if (!rows.length) return [];

  const { data, error } = await context.supabase
    .from("subscription_package_features")
    .upsert(rows, { onConflict: "package_id,feature_code" })
    .select("package_id,feature_code,included")
    .returns<Array<{ package_id: string; feature_code: string; included: boolean }>>();
  if (error) throw new Error(error.message);

  invalidateTenantFeatureGateCache();
  return data ?? [];
}

export async function listPackagesForAdmin() {
  const catalog = await getPackageCatalogWithFeatures();
  return {
    generated_at: new Date().toISOString(),
    contract_types: ["saas", "perpetual"],
    billing_intervals: ["monthly", "yearly"],
    deployment_modes: ["cloud", "desktop_online", "desktop_offline", "hybrid"],
    packages: catalog.packages,
    features: catalog.features
  };
}

export async function createPackage(context: ItAdminContext, input: PackageMutationInput) {
  const { auth, supabase, requestMeta } = context;
  const code = normalizeCode(input.code);
  const name = normalizeText(input.name);
  const monthlyPrice = toMoney(input.monthly_price, null);
  const maxBranches = toPositiveInteger(input.max_branches, null);
  const singleRegisterPackage =
    input.store_mode === "single_register" ||
    input.no_branch_mode === true ||
    input.single_device_mode === true ||
    input.branch_selection === "hidden";

  if (!code || !name || monthlyPrice == null || maxBranches == null) {
    throw new Error("invalid_package_payload: code, name, monthly_price and max_branches are required.");
  }

  const insertPayload = {
    code,
    name,
    monthly_price: monthlyPrice,
    yearly_price: toMoney(input.yearly_price, Number((monthlyPrice * 12).toFixed(2))),
    max_branches: singleRegisterPackage ? 1 : maxBranches,
    max_devices: singleRegisterPackage ? 1 : toPositiveInteger(input.max_devices, 1),
    max_users: toPositiveInteger(input.max_users, 1),
    is_active: input.is_active ?? true,
    status: input.status ?? "active",
    metadata: normalizePackageMetadata(input)
  };

  const { data: created, error } = await supabase
    .from("subscription_packages")
    .insert(insertPayload)
    .select("id,code,name,monthly_price,yearly_price,max_branches,max_devices,max_users,is_active,status,metadata,created_at")
    .single<PackageRow>();
  if (error) {
    if (error.code === "23505") throw new Error("package_code_duplicate: Package code already exists.");
    throw new Error(error.message);
  }

  const features = await syncPackageFeatures(context, created.id, input.features);

  await appendAuditLog({
    actorUserId: auth.userId,
    actorRole: "it_admin",
    action: "package_created",
    targetTable: "subscription_packages",
    targetId: created.id,
    afterData: { package: created, features } as never,
    ipAddress: requestMeta.ipAddress ?? undefined,
    userAgent: requestMeta.userAgent ?? undefined
  });

  return { package: created, features };
}

export async function updatePackage(context: ItAdminContext, packageId: string, input: PackageMutationInput) {
  const { auth, supabase, requestMeta } = context;
  const { data: current, error: currentError } = await supabase
    .from("subscription_packages")
    .select("id,code,name,monthly_price,yearly_price,max_branches,max_devices,max_users,is_active,status,metadata,created_at")
    .eq("id", packageId)
    .maybeSingle<PackageRow>();
  if (currentError) throw new Error(currentError.message);
  if (!current) return null;

  const patch: Record<string, unknown> = {};
  const singleRegisterPackage =
    input.store_mode === "single_register" ||
    input.no_branch_mode === true ||
    input.single_device_mode === true ||
    input.branch_selection === "hidden";
  if (typeof input.code === "string" && input.code.trim()) patch.code = normalizeCode(input.code);
  if (typeof input.name === "string" && input.name.trim()) patch.name = normalizeText(input.name);
  if (typeof input.monthly_price === "number") patch.monthly_price = toMoney(input.monthly_price, current.monthly_price);
  if (typeof input.yearly_price === "number" || input.yearly_price === null) patch.yearly_price = input.yearly_price === null ? null : toMoney(input.yearly_price, current.yearly_price);
  if (typeof input.max_branches === "number") patch.max_branches = toPositiveInteger(input.max_branches, current.max_branches);
  if (typeof input.max_devices === "number" || input.max_devices === null) patch.max_devices = input.max_devices === null ? null : toPositiveInteger(input.max_devices, current.max_devices);
  if (typeof input.max_users === "number" || input.max_users === null) patch.max_users = input.max_users === null ? null : toPositiveInteger(input.max_users, current.max_users);
  if (typeof input.is_active === "boolean") patch.is_active = input.is_active;
  if (input.status === "active" || input.status === "inactive") patch.status = input.status;
  if (singleRegisterPackage) {
    patch.max_branches = 1;
    patch.max_devices = 1;
  }
  if ((input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata)) || hasPackageModeInput(input)) {
    patch.metadata = normalizePackageMetadata(input, current.metadata);
  }

  let updated = current;
  if (Object.keys(patch).length > 0) {
    const { data, error } = await supabase
      .from("subscription_packages")
      .update(patch)
      .eq("id", packageId)
      .select("id,code,name,monthly_price,yearly_price,max_branches,max_devices,max_users,is_active,status,metadata,created_at")
      .single<PackageRow>();
    if (error) throw new Error(error.message);
    updated = data;
  }

  const features = await syncPackageFeatures(context, packageId, input.features);
  invalidateTenantFeatureGateCache();

  await appendAuditLog({
    actorUserId: auth.userId,
    actorRole: "it_admin",
    action: "package_updated",
    targetTable: "subscription_packages",
    targetId: packageId,
    beforeData: current as never,
    afterData: { package: updated, features } as never,
    metadata: {
      reason: input.reason ?? null,
      changed_fields: Object.keys(patch),
      features_changed: features.length
    },
    ipAddress: requestMeta.ipAddress ?? undefined,
    userAgent: requestMeta.userAgent ?? undefined
  });

  return { package: updated, features };
}

export async function deactivatePackage(context: ItAdminContext, packageId: string, reason?: string | null) {
  return updatePackage(context, packageId, {
    is_active: false,
    status: "inactive",
    reason
  });
}
