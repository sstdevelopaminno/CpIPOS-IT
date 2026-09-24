import { POS_MENU_CATALOG } from "@/lib/pos-menu-policy";

/**
 * Mirrors the feature gates on the CUSTOMER POS navigation surfaces.
 * Keep menu controls separate from subscription/role permissions: a green switch
 * means IT permits the entry and its POS package gate permits every active branch.
 * Roles and store-specific UI profile filters are evaluated separately at POS login.\n * Null means the POS navigation has no package-feature lock for that entry.
 */
export const POS_MENU_NAV_FEATURES: Readonly<Record<string, string | null>> = {
  "main.sales": "core_pos_sales",
  "main.sales_list": "advanced_sales_reports",
  "main.kitchen": null, // POS staff sidebar does not package-gate this link.
  "main.shift": "attendance_tracking",
  "main.more": null,
  "main.payments": null,
  "main.settings": "core_pos_sales",
  "more.sales_summary": "advanced_sales_reports",
  "more.receipts": "receipt_reprint_history",
  "more.tables": "table_management",
  "more.kitchen_manage": "kitchen_printing",
  "more.stock": "stock_management",
  "more.buffet": "table_management",
  "more.members": "core_pos_sales",
  "more.tax_invoices": "core_pos_sales",
  "more.product_sales": "advanced_sales_reports",
  "settings.store": "core_pos_sales",
  "settings.branches": "branch_management",
  "settings.devices": null, // POS explicitly exempts devices from isSettingLocked.
  "settings.printers": "core_pos_sales",
  "settings.activity": "core_pos_sales",
  "settings.payments": "core_pos_sales",
  "settings.inet_nops": "inet_nops_qr",
  "settings.taxes": "core_pos_sales",
  "settings.notifications": "qr_table_ordering",
  "settings.users": "user_management",
  "settings.language": null,
  "settings.placement": null,
  "settings.display": "customer_facing_display",
  "settings.order_kitchen": null, // Only IT menu policy is checked in injected POS card.
  "settings.table_qr": null
};

export type MenuAvailability = {
  feature_code: string | null;
  feature_allowed: boolean;
  available_branches: number;
  total_branches: number;
  reason: "available" | "it_locked" | "package" | "contract_inactive" | "partial_branches" | "no_active_branch";
};

export type FeatureFlag = { feature_code: string; is_enabled: boolean; branch_id?: string | null };
export type PlanFlag = { feature_code: string; included: boolean | null };
export type ContractStatus = { status: string; ended_at: string | null } | null;

/** Mirrors POS hasBranchFeature: package, then tenant override, then branch override,
 * while inactive/expired contracts always deny gated features. Never writes data. */
export function resolvePosMenuAvailability(args: {
  overrides: Record<string, boolean>;
  contract: ContractStatus;
  plan: PlanFlag[];
  feature_overrides: FeatureFlag[];
  active_branch_ids: string[];
  now?: number;
}): Record<string, MenuAvailability> {
  const { overrides, contract, plan, feature_overrides, active_branch_ids } = args;
  const now = args.now ?? Date.now();
  const contractActive = Boolean(contract && (contract.status === "active" || contract.status === "trial") &&
    (!contract.ended_at || new Date(contract.ended_at).getTime() > now));
  const planMap = new Map(plan.map(flag => [flag.feature_code, Boolean(flag.included)]));
  const tenantMap = new Map(feature_overrides.filter(flag => !flag.branch_id).map(flag => [flag.feature_code, flag.is_enabled]));
  const branchMap = new Map(feature_overrides.filter(flag => Boolean(flag.branch_id))
    .map(flag => [flag.branch_id + ":" + flag.feature_code, flag.is_enabled]));
  const total = active_branch_ids.length;

  return Object.fromEntries(POS_MENU_CATALOG.map(menu => {
    const feature = POS_MENU_NAV_FEATURES[menu.key] ?? null;
    let available = 0;
    if (contractActive) {
      for (const branch of active_branch_ids) {
        let enabled = feature ? (planMap.get(feature) ?? false) : true;
        if (feature && tenantMap.has(feature)) enabled = tenantMap.get(feature)!;
        if (feature && branchMap.has(branch + ":" + feature)) enabled = branchMap.get(branch + ":" + feature)!;
        if (enabled) available += 1;
      }
    }
    const featureAllowed = contractActive && total > 0 && available === total;
    const itEnabled = overrides[menu.key] !== false;
    const reason: MenuAvailability["reason"] = !itEnabled ? "it_locked"
      : !contractActive ? "contract_inactive"
      : total === 0 ? "no_active_branch"
      : available === total ? "available"
      : available > 0 ? "partial_branches"
      : "package";
    return [menu.key, {
      feature_code: feature, feature_allowed: featureAllowed,
      available_branches: available, total_branches: total, reason
    }];
  }));
}
