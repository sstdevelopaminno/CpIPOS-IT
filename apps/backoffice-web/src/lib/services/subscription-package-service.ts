import type {
  PackageBillingInterval,
  PackageContractType,
  PackageDeploymentMode,
  PosFeatureCode
} from "@pos/shared-types";
import {
  buildPackageQuote,
  type PackageCatalogItem,
  type PackageFeatureCatalogItem,
  type PackageQuoteResult
} from "@pos/pos-domain";
import { DEFAULT_PACKAGE_CATALOG, DEFAULT_PACKAGE_FEATURE_CATALOG } from "@/lib/subscription-catalog";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

type DbPackageRow = {
  id: string;
  code: string;
  name: string;
  monthly_price: number;
  yearly_price?: number | null;
  max_branches: number;
  max_devices?: number | null;
  max_users?: number | null;
  metadata?: Record<string, unknown> | null;
  is_active: boolean;
};

type DbFeatureRow = {
  code: string;
  name: string;
  description: string | null;
  default_monthly_price: number | null;
  default_yearly_price: number | null;
  default_perpetual_price: number | null;
  included_by_default: boolean | null;
  priced_per_branch: boolean | null;
  is_active: boolean | null;
};

type DbPackageFeatureRow = {
  package_id: string;
  feature_code: string;
  included: boolean | null;
};

type QuoteInput = {
  packageId?: string;
  packageCode?: string;
  selectedFeatureCodes: PosFeatureCode[];
  contractType: PackageContractType;
  billingInterval: PackageBillingInterval;
  deploymentMode: PackageDeploymentMode;
  branchCount: number;
  terminalCountPerBranch: number;
};

function isSchemaMissingError(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes("does not exist") || normalized.includes("pgrst") || normalized.includes("undefined column");
}

function deriveDefaultYearly(monthly: number): number {
  return Number((monthly * 12).toFixed(2));
}

function deriveDefaultPerpetual(monthly: number): number {
  return Number((monthly * 24).toFixed(2));
}

function derivePackageFromDb(row: DbPackageRow): PackageCatalogItem {
  const baseMonthlyPrice = Number(row.monthly_price ?? 0);
  const matchedDefault = DEFAULT_PACKAGE_CATALOG.find((entry) => entry.code === row.code);
  const baseYearlyPrice = Number(row.yearly_price ?? matchedDefault?.baseYearlyPrice ?? deriveDefaultYearly(baseMonthlyPrice));
  const metadata = { ...(matchedDefault?.metadata ?? {}), ...(row.metadata ?? {}) };
  if (matchedDefault) {
    return {
      ...matchedDefault,
      id: row.id,
      name: row.name,
      baseMonthlyPrice,
      baseYearlyPrice,
      basePerpetualPrice: deriveDefaultPerpetual(baseMonthlyPrice),
      maxBranchesIncluded: Math.max(1, Number(row.max_branches ?? matchedDefault.maxBranchesIncluded)),
      maxTerminalsPerBranchIncluded: Math.max(1, Number(row.max_devices ?? matchedDefault.maxTerminalsPerBranchIncluded)),
      maxUsersIncluded: Math.max(1, Number(row.max_users ?? matchedDefault.maxUsersIncluded ?? 1)),
      metadata,
      isActive: Boolean(row.is_active)
    };
  }

  return {
    id: row.id,
    code: row.code,
    name: row.name,
    baseMonthlyPrice,
    baseYearlyPrice,
    basePerpetualPrice: deriveDefaultPerpetual(baseMonthlyPrice),
    maxBranchesIncluded: Math.max(1, Number(row.max_branches ?? 1)),
    extraBranchMonthlyPrice: Math.max(0, Number((baseMonthlyPrice * 0.45).toFixed(2))),
    extraBranchYearlyPrice: Math.max(0, Number((baseMonthlyPrice * 0.45 * 12).toFixed(2))),
    extraBranchPerpetualPrice: Math.max(0, Number((baseMonthlyPrice * 8).toFixed(2))),
    maxTerminalsPerBranchIncluded: 1,
    extraTerminalMonthlyPrice: Math.max(0, Number((baseMonthlyPrice * 0.15).toFixed(2))),
    extraTerminalYearlyPrice: Math.max(0, Number((baseMonthlyPrice * 0.15 * 12).toFixed(2))),
    extraTerminalPerpetualPrice: Math.max(0, Number((baseMonthlyPrice * 3.2).toFixed(2))),
    includedFeatureCodes: ["core_pos_sales"],
    maxUsersIncluded: Math.max(1, Number(row.max_users ?? 1)),
    metadata: row.metadata ?? {},
    isActive: Boolean(row.is_active)
  };
}

function parseFeatureCode(raw: string): PosFeatureCode | null {
  const allCodes = new Set<PosFeatureCode>(DEFAULT_PACKAGE_FEATURE_CATALOG.map((item) => item.code));
  return allCodes.has(raw as PosFeatureCode) ? (raw as PosFeatureCode) : null;
}

function sanitizeSelectedFeatureCodes(codes: string[]): PosFeatureCode[] {
  const unique = new Set<PosFeatureCode>();
  for (const code of codes) {
    const normalized = parseFeatureCode(String(code));
    if (normalized) unique.add(normalized);
  }
  return Array.from(unique);
}

export async function getPackageCatalogWithFeatures(): Promise<{
  packages: PackageCatalogItem[];
  features: PackageFeatureCatalogItem[];
}> {
  const supabase = getSupabaseServiceClient();
  const packageResult = await supabase
    .from("subscription_packages")
    .select("id,code,name,monthly_price,yearly_price,max_branches,max_devices,max_users,metadata,is_active")
    .order("monthly_price", { ascending: true });
  let packageRows = packageResult.data as DbPackageRow[] | null;
  let packageError = packageResult.error;

  if (packageError) {
    if (isSchemaMissingError(packageError.message)) {
      const fallback = await supabase
        .from("subscription_packages")
        .select("id,code,name,monthly_price,max_branches,is_active")
        .order("monthly_price", { ascending: true });
      packageRows = fallback.data as DbPackageRow[] | null;
      packageError = fallback.error;
      if (packageError && isSchemaMissingError(packageError.message)) {
        return { packages: [...DEFAULT_PACKAGE_CATALOG], features: [...DEFAULT_PACKAGE_FEATURE_CATALOG] };
      }
      if (packageError) {
        throw new Error(`subscription_packages_query_failed:${packageError.message}`);
      }
    } else {
      throw new Error(`subscription_packages_query_failed:${packageError.message}`);
    }
  }

  const basePackages = (packageRows as DbPackageRow[] | null)?.map(derivePackageFromDb) ?? [];
  if (basePackages.length === 0) {
    return { packages: [...DEFAULT_PACKAGE_CATALOG], features: [...DEFAULT_PACKAGE_FEATURE_CATALOG] };
  }

  const { data: featureRows, error: featureError } = await supabase
    .from("package_feature_catalog")
    .select("code,name,description,default_monthly_price,default_yearly_price,default_perpetual_price,included_by_default,priced_per_branch,is_active")
    .order("code", { ascending: true });

  let features = [...DEFAULT_PACKAGE_FEATURE_CATALOG];
  if (!featureError && Array.isArray(featureRows) && featureRows.length > 0) {
    const mapped: PackageFeatureCatalogItem[] = (featureRows as DbFeatureRow[])
      .map((row) => {
        const fallback = DEFAULT_PACKAGE_FEATURE_CATALOG.find((entry) => entry.code === row.code);
        const code = parseFeatureCode(row.code);
        if (!code) return null;
        return {
          code,
          name: row.name || fallback?.name || row.code,
          description: row.description || fallback?.description || row.code,
          defaultMonthlyPrice: Number(row.default_monthly_price ?? fallback?.defaultMonthlyPrice ?? 0),
          defaultYearlyPrice: Number(row.default_yearly_price ?? fallback?.defaultYearlyPrice ?? 0),
          defaultPerpetualPrice: Number(row.default_perpetual_price ?? fallback?.defaultPerpetualPrice ?? 0),
          includedByDefault: Boolean(row.included_by_default ?? fallback?.includedByDefault ?? false),
          pricedPerBranch: Boolean(row.priced_per_branch ?? fallback?.pricedPerBranch ?? false),
          isActive: Boolean(row.is_active ?? fallback?.isActive ?? true)
        } satisfies PackageFeatureCatalogItem;
      })
      .filter((row): row is PackageFeatureCatalogItem => Boolean(row));
    if (mapped.length > 0) {
      features = mapped;
    }
  } else if (featureError && !isSchemaMissingError(featureError.message)) {
    throw new Error(`package_feature_catalog_query_failed:${featureError.message}`);
  }

  const { data: packageFeatureRows, error: packageFeatureError } = await supabase
    .from("subscription_package_features")
    .select("package_id,feature_code,included");

  if (packageFeatureError && !isSchemaMissingError(packageFeatureError.message)) {
    throw new Error(`subscription_package_features_query_failed:${packageFeatureError.message}`);
  }

  if (Array.isArray(packageFeatureRows) && packageFeatureRows.length > 0) {
    const packageMap = new Map(basePackages.map((pkg) => [pkg.id ?? pkg.code, pkg]));
    for (const row of packageFeatureRows as DbPackageFeatureRow[]) {
      if (!row.included) continue;
      const code = parseFeatureCode(row.feature_code);
      if (!code) continue;
      const target = packageMap.get(row.package_id);
      if (!target) continue;
      if (!target.includedFeatureCodes.includes(code)) {
        target.includedFeatureCodes = [...target.includedFeatureCodes, code];
      }
    }
  }

  return { packages: basePackages, features };
}

export async function buildSubscriptionQuote(input: QuoteInput): Promise<{
  quote: PackageQuoteResult;
  packageDef: PackageCatalogItem;
  features: PackageFeatureCatalogItem[];
}> {
  const catalog = await getPackageCatalogWithFeatures();
  const packageDef =
    catalog.packages.find((pkg) => input.packageId && pkg.id === input.packageId) ??
    catalog.packages.find((pkg) => input.packageCode && pkg.code === input.packageCode);

  if (!packageDef) {
    throw new Error("package_not_found");
  }

  const quote = buildPackageQuote({
    packageDef,
    featureCatalog: catalog.features,
    selectedFeatureCodes: sanitizeSelectedFeatureCodes(input.selectedFeatureCodes),
    contractType: input.contractType,
    billingInterval: input.billingInterval,
    deploymentMode: input.deploymentMode,
    branchCount: input.branchCount,
    terminalCountPerBranch: input.terminalCountPerBranch,
    annualPrepayDiscountPercent: 0
  });

  return {
    quote,
    packageDef,
    features: catalog.features
  };
}
