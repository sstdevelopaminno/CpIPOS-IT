import type {
  PackageBillingInterval,
  PackageContractType,
  PackageCurrency,
  PackageDeploymentMode,
  PosFeatureCode
} from "@pos/shared-types";

export type PackageFeatureCatalogItem = {
  code: PosFeatureCode;
  name: string;
  description: string;
  defaultMonthlyPrice: number;
  defaultYearlyPrice: number;
  defaultPerpetualPrice: number;
  includedByDefault: boolean;
  pricedPerBranch: boolean;
  isActive: boolean;
};

export type PackageCatalogItem = {
  id?: string;
  code: string;
  name: string;
  baseMonthlyPrice: number;
  baseYearlyPrice: number;
  basePerpetualPrice: number;
  maxBranchesIncluded: number;
  maxUsersIncluded?: number;
  extraBranchMonthlyPrice: number;
  extraBranchYearlyPrice: number;
  extraBranchPerpetualPrice: number;
  maxTerminalsPerBranchIncluded: number;
  extraTerminalMonthlyPrice: number;
  extraTerminalYearlyPrice: number;
  extraTerminalPerpetualPrice: number;
  includedFeatureCodes: PosFeatureCode[];
  monthlyNewCustomerDiscountPercent?: number;
  monthlyNewCustomerDiscountMonths?: number;
  yearlyFreeMonths?: number;
  target?: string;
  metadata?: Record<string, unknown>;
  isActive: boolean;
};

export type QuoteLine = {
  code: string;
  label: string;
  quantity: number;
  unitPrice: number;
  amount: number;
};

export type PackageQuoteInput = {
  packageDef: PackageCatalogItem;
  featureCatalog: PackageFeatureCatalogItem[];
  selectedFeatureCodes: PosFeatureCode[];
  contractType: PackageContractType;
  billingInterval: PackageBillingInterval;
  deploymentMode: PackageDeploymentMode;
  branchCount: number;
  terminalCountPerBranch: number;
  currency?: PackageCurrency;
  annualPrepayDiscountPercent?: number;
};

export type PackageQuoteResult = {
  currency: PackageCurrency;
  contractType: PackageContractType;
  billingInterval: PackageBillingInterval;
  deploymentMode: PackageDeploymentMode;
  packageCode: string;
  branchCount: number;
  terminalCountPerBranch: number;
  lines: QuoteLine[];
  subtotal: number;
  discountAmount: number;
  total: number;
  effectiveFeatures: PosFeatureCode[];
};

function toMoney(value: number): number {
  return Number((Number.isFinite(value) ? value : 0).toFixed(2));
}

function resolveUnitPriceByContract(args: {
  contractType: PackageContractType;
  billingInterval: PackageBillingInterval;
  monthly: number;
  yearly: number;
  perpetual: number;
}): number {
  if (args.contractType === "perpetual") {
    return toMoney(args.perpetual);
  }
  return args.billingInterval === "yearly" ? toMoney(args.yearly) : toMoney(args.monthly);
}

export function resolveEffectiveFeatures(args: {
  packageDef: Pick<PackageCatalogItem, "includedFeatureCodes">;
  featureCatalog: Pick<PackageFeatureCatalogItem, "code" | "includedByDefault" | "isActive">[];
  selectedFeatureCodes: PosFeatureCode[];
}): PosFeatureCode[] {
  const selected = new Set(args.selectedFeatureCodes);
  const baseIncluded = new Set(args.packageDef.includedFeatureCodes);
  for (const feature of args.featureCatalog) {
    if (!feature.isActive) continue;
    if (feature.includedByDefault) {
      baseIncluded.add(feature.code);
    }
    if (selected.has(feature.code)) {
      baseIncluded.add(feature.code);
    }
  }
  return Array.from(baseIncluded);
}

export function buildPackageQuote(input: PackageQuoteInput): PackageQuoteResult {
  const currency: PackageCurrency = input.currency ?? "THB";
  const branchCount = Math.max(1, Math.floor(input.branchCount || 1));
  const terminalCountPerBranch = Math.max(1, Math.floor(input.terminalCountPerBranch || 1));

  const lines: QuoteLine[] = [];
  const effectiveFeatures = resolveEffectiveFeatures({
    packageDef: input.packageDef,
    featureCatalog: input.featureCatalog,
    selectedFeatureCodes: input.selectedFeatureCodes
  });
  const packageFeatureSet = new Set(input.packageDef.includedFeatureCodes);

  const baseUnitPrice = resolveUnitPriceByContract({
    contractType: input.contractType,
    billingInterval: input.billingInterval,
    monthly: input.packageDef.baseMonthlyPrice,
    yearly: input.packageDef.baseYearlyPrice,
    perpetual: input.packageDef.basePerpetualPrice
  });
  lines.push({
    code: `base:${input.packageDef.code}`,
    label: `Package ${input.packageDef.name}`,
    quantity: 1,
    unitPrice: baseUnitPrice,
    amount: toMoney(baseUnitPrice)
  });

  const extraBranches = Math.max(0, branchCount - Math.max(1, input.packageDef.maxBranchesIncluded));
  if (extraBranches > 0) {
    const extraBranchUnitPrice = resolveUnitPriceByContract({
      contractType: input.contractType,
      billingInterval: input.billingInterval,
      monthly: input.packageDef.extraBranchMonthlyPrice,
      yearly: input.packageDef.extraBranchYearlyPrice,
      perpetual: input.packageDef.extraBranchPerpetualPrice
    });
    lines.push({
      code: "extra_branch",
      label: "Extra branch",
      quantity: extraBranches,
      unitPrice: extraBranchUnitPrice,
      amount: toMoney(extraBranches * extraBranchUnitPrice)
    });
  }

  const extraTerminalsPerBranch = Math.max(0, terminalCountPerBranch - Math.max(1, input.packageDef.maxTerminalsPerBranchIncluded));
  const totalExtraTerminals = extraTerminalsPerBranch * branchCount;
  if (totalExtraTerminals > 0) {
    const extraTerminalUnitPrice = resolveUnitPriceByContract({
      contractType: input.contractType,
      billingInterval: input.billingInterval,
      monthly: input.packageDef.extraTerminalMonthlyPrice,
      yearly: input.packageDef.extraTerminalYearlyPrice,
      perpetual: input.packageDef.extraTerminalPerpetualPrice
    });
    lines.push({
      code: "extra_terminal",
      label: "Extra POS terminal",
      quantity: totalExtraTerminals,
      unitPrice: extraTerminalUnitPrice,
      amount: toMoney(totalExtraTerminals * extraTerminalUnitPrice)
    });
  }

  for (const feature of input.featureCatalog) {
    if (!feature.isActive) continue;
    if (!effectiveFeatures.includes(feature.code)) continue;
    if (packageFeatureSet.has(feature.code)) continue;

    const unitPrice = resolveUnitPriceByContract({
      contractType: input.contractType,
      billingInterval: input.billingInterval,
      monthly: feature.defaultMonthlyPrice,
      yearly: feature.defaultYearlyPrice,
      perpetual: feature.defaultPerpetualPrice
    });

    const quantity = feature.pricedPerBranch ? branchCount : 1;
    if (unitPrice <= 0 || quantity <= 0) continue;

    lines.push({
      code: `feature:${feature.code}`,
      label: `Feature ${feature.name}`,
      quantity,
      unitPrice,
      amount: toMoney(quantity * unitPrice)
    });
  }

  const subtotal = toMoney(lines.reduce((sum, line) => sum + line.amount, 0));
  const eligibleDiscountPercent =
    input.contractType === "saas" && input.billingInterval === "yearly"
      ? Math.max(0, Math.min(100, input.annualPrepayDiscountPercent ?? 10))
      : 0;
  const discountAmount = toMoney((subtotal * eligibleDiscountPercent) / 100);
  const total = toMoney(Math.max(0, subtotal - discountAmount));

  return {
    currency,
    contractType: input.contractType,
    billingInterval: input.billingInterval,
    deploymentMode: input.deploymentMode,
    packageCode: input.packageDef.code,
    branchCount,
    terminalCountPerBranch,
    lines,
    subtotal,
    discountAmount,
    total,
    effectiveFeatures
  };
}
