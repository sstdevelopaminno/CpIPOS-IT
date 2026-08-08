import type { PackageCatalogItem, PackageFeatureCatalogItem } from "@pos/pos-domain";

const YEARLY_FREE_MONTHS = 1;
const MONTHLY_PROMO_PERCENT = 10;
const MONTHLY_PROMO_MONTHS = 3;

function yearly(monthly: number) {
  return monthly * (12 - YEARLY_FREE_MONTHS);
}

export const DEFAULT_PACKAGE_FEATURE_CATALOG: PackageFeatureCatalogItem[] = [
  {
    code: "core_pos_sales",
    name: "Core POS Sales",
    description: "Core sales screen, order creation, checkout, and receipt workflow.",
    defaultMonthlyPrice: 0,
    defaultYearlyPrice: 0,
    defaultPerpetualPrice: 0,
    includedByDefault: false,
    pricedPerBranch: false,
    isActive: true
  },
  {
    code: "stock_management",
    name: "Stock Management",
    description: "Product catalog, menu scan, recipes, ingredients, and stock adjustments.",
    defaultMonthlyPrice: 290,
    defaultYearlyPrice: yearly(290),
    defaultPerpetualPrice: 5900,
    includedByDefault: false,
    pricedPerBranch: true,
    isActive: true
  },
  {
    code: "table_management",
    name: "Table Management",
    description: "Open tables, move bills, manage floor zones, and track dine-in bill status.",
    defaultMonthlyPrice: 490,
    defaultYearlyPrice: yearly(490),
    defaultPerpetualPrice: 8900,
    includedByDefault: false,
    pricedPerBranch: true,
    isActive: true
  },
  {
    code: "qr_table_ordering",
    name: "QR Table Ordering",
    description: "Customer table QR ordering that sends items into the active POS table bill.",
    defaultMonthlyPrice: 690,
    defaultYearlyPrice: yearly(690),
    defaultPerpetualPrice: 14900,
    includedByDefault: false,
    pricedPerBranch: true,
    isActive: true
  },
  {
    code: "delivery_ordering",
    name: "Delivery Ordering",
    description: "Delivery app order mode, held delivery bills, and channel-specific pricing.",
    defaultMonthlyPrice: 390,
    defaultYearlyPrice: yearly(390),
    defaultPerpetualPrice: 6900,
    includedByDefault: false,
    pricedPerBranch: true,
    isActive: true
  },
  {
    code: "customer_facing_display",
    name: "Customer Display",
    description: "Customer-facing realtime item and total display.",
    defaultMonthlyPrice: 250,
    defaultYearlyPrice: yearly(250),
    defaultPerpetualPrice: 4900,
    includedByDefault: false,
    pricedPerBranch: false,
    isActive: true
  },
  {
    code: "transfer_slip_verification",
    name: "Transfer Slip Verification",
    description: "Upload and verify transfer slips before closing a bill.",
    defaultMonthlyPrice: 390,
    defaultYearlyPrice: yearly(390),
    defaultPerpetualPrice: 6900,
    includedByDefault: false,
    pricedPerBranch: true,
    isActive: true
  },
  {
    code: "staff_qr_clockin",
    name: "Staff QR Clock-in",
    description: "QR-based staff clock-in flow.",
    defaultMonthlyPrice: 190,
    defaultYearlyPrice: yearly(190),
    defaultPerpetualPrice: 3900,
    includedByDefault: false,
    pricedPerBranch: true,
    isActive: true
  },
  {
    code: "advanced_sales_reports",
    name: "Advanced Sales Reports",
    description: "Detailed sales summaries, filters, and multi-branch reporting.",
    defaultMonthlyPrice: 790,
    defaultYearlyPrice: yearly(790),
    defaultPerpetualPrice: 16900,
    includedByDefault: false,
    pricedPerBranch: false,
    isActive: true
  },
  {
    code: "receipt_reprint_history",
    name: "Receipt Reprint History",
    description: "Search historical receipts and reprint with approval/audit support.",
    defaultMonthlyPrice: 290,
    defaultYearlyPrice: yearly(290),
    defaultPerpetualPrice: 5900,
    includedByDefault: false,
    pricedPerBranch: true,
    isActive: true
  },
  {
    code: "multi_terminal_sync",
    name: "Multi Terminal Sync",
    description: "Synchronize sales state across multiple terminals in a branch.",
    defaultMonthlyPrice: 590,
    defaultYearlyPrice: yearly(590),
    defaultPerpetualPrice: 12900,
    includedByDefault: false,
    pricedPerBranch: true,
    isActive: true
  },
  {
    code: "offline_queue_resilience",
    name: "Offline Queue Resilience",
    description: "Offline queue and automatic retry when connectivity returns.",
    defaultMonthlyPrice: 350,
    defaultYearlyPrice: yearly(350),
    defaultPerpetualPrice: 6900,
    includedByDefault: false,
    pricedPerBranch: true,
    isActive: true
  },
  {
    code: "desktop_app_runtime",
    name: "Desktop App Runtime",
    description: "Installed desktop runtime for online/offline hybrid operations.",
    defaultMonthlyPrice: 450,
    defaultYearlyPrice: yearly(450),
    defaultPerpetualPrice: 10900,
    includedByDefault: false,
    pricedPerBranch: false,
    isActive: true
  },
  {
    code: "barcode_scanner_mode",
    name: "Barcode Scanner Mode",
    description: "Barcode scanner optimized checkout mode.",
    defaultMonthlyPrice: 290,
    defaultYearlyPrice: yearly(290),
    defaultPerpetualPrice: 5900,
    includedByDefault: false,
    pricedPerBranch: true,
    isActive: true
  },
  {
    code: "kitchen_printing",
    name: "Kitchen Printing",
    description: "Send kitchen tickets to configured printer stations.",
    defaultMonthlyPrice: 350,
    defaultYearlyPrice: yearly(350),
    defaultPerpetualPrice: 6900,
    includedByDefault: false,
    pricedPerBranch: true,
    isActive: true
  },
  {
    code: "inet_nops_qr",
    name: "INET NOPS QR Payment",
    description: "Dynamic QR payment with INET server-to-server confirmation.",
    defaultMonthlyPrice: 490,
    defaultYearlyPrice: yearly(490),
    defaultPerpetualPrice: 8900,
    includedByDefault: false,
    pricedPerBranch: true,
    isActive: true
  },
  {
    code: "qr_login",
    name: "QR Login",
    description: "QR login verification for POS session handoff.",
    defaultMonthlyPrice: 0,
    defaultYearlyPrice: 0,
    defaultPerpetualPrice: 0,
    includedByDefault: false,
    pricedPerBranch: true,
    isActive: true
  },
  {
    code: "pin_login",
    name: "PIN Login",
    description: "PIN-based POS login verification.",
    defaultMonthlyPrice: 0,
    defaultYearlyPrice: 0,
    defaultPerpetualPrice: 0,
    includedByDefault: false,
    pricedPerBranch: true,
    isActive: true
  },
  {
    code: "staff_card_login",
    name: "Staff Card Login",
    description: "Staff-card based POS login verification.",
    defaultMonthlyPrice: 0,
    defaultYearlyPrice: 0,
    defaultPerpetualPrice: 0,
    includedByDefault: false,
    pricedPerBranch: true,
    isActive: true
  },
  {
    code: "attendance_tracking",
    name: "Attendance Tracking",
    description: "Attendance status, check-in, check-out, and manual status APIs.",
    defaultMonthlyPrice: 0,
    defaultYearlyPrice: 0,
    defaultPerpetualPrice: 0,
    includedByDefault: false,
    pricedPerBranch: true,
    isActive: true
  },
  {
    code: "device_management",
    name: "Device Management",
    description: "Device management and POS register controls.",
    defaultMonthlyPrice: 0,
    defaultYearlyPrice: 0,
    defaultPerpetualPrice: 0,
    includedByDefault: false,
    pricedPerBranch: true,
    isActive: true
  },
  {
    code: "branch_management",
    name: "Branch Management",
    description: "Branch management workflows and branch-scoped controls.",
    defaultMonthlyPrice: 0,
    defaultYearlyPrice: 0,
    defaultPerpetualPrice: 0,
    includedByDefault: false,
    pricedPerBranch: true,
    isActive: true
  },
  {
    code: "user_management",
    name: "User Management",
    description: "User role assignment and staff management workflows.",
    defaultMonthlyPrice: 0,
    defaultYearlyPrice: 0,
    defaultPerpetualPrice: 0,
    includedByDefault: false,
    pricedPerBranch: false,
    isActive: true
  },
  {
    code: "mobile_qr_login",
    name: "Mobile QR Login",
    description: "Mobile-based QR login workflows with enrollment controls.",
    defaultMonthlyPrice: 0,
    defaultYearlyPrice: 0,
    defaultPerpetualPrice: 0,
    includedByDefault: false,
    pricedPerBranch: true,
    isActive: true
  },
  {
    code: "mobile_device_enrollment",
    name: "Mobile Device Enrollment",
    description: "Activation token and mobile device enrollment workflows.",
    defaultMonthlyPrice: 0,
    defaultYearlyPrice: 0,
    defaultPerpetualPrice: 0,
    includedByDefault: false,
    pricedPerBranch: true,
    isActive: true
  }
];

const PACKAGE_PROMO = {
  monthlyNewCustomerDiscountPercent: MONTHLY_PROMO_PERCENT,
  monthlyNewCustomerDiscountMonths: MONTHLY_PROMO_MONTHS,
  yearlyFreeMonths: YEARLY_FREE_MONTHS
} satisfies Partial<PackageCatalogItem>;

export const DEFAULT_PACKAGE_CATALOG: PackageCatalogItem[] = [
  {
    code: "solo",
    name: "Solo Register",
    baseMonthlyPrice: 350,
    baseYearlyPrice: 3850,
    basePerpetualPrice: 15900,
    maxBranchesIncluded: 1,
    maxUsersIncluded: 3,
    extraBranchMonthlyPrice: 0,
    extraBranchYearlyPrice: 0,
    extraBranchPerpetualPrice: 0,
    maxTerminalsPerBranchIncluded: 1,
    extraTerminalMonthlyPrice: 0,
    extraTerminalYearlyPrice: 0,
    extraTerminalPerpetualPrice: 0,
    includedFeatureCodes: ["core_pos_sales", "advanced_sales_reports", "receipt_reprint_history", "pin_login", "user_management", "device_management"],
    target: "small shop / single register",
    metadata: { login_mode: "single_register", branch_selection: "hidden", max_cashier_devices: 1 },
    ...PACKAGE_PROMO,
    isActive: true
  },
  {
    code: "starter",
    name: "Starter",
    baseMonthlyPrice: 690,
    baseYearlyPrice: 7590,
    basePerpetualPrice: 29900,
    maxBranchesIncluded: 1,
    maxUsersIncluded: 5,
    extraBranchMonthlyPrice: 590,
    extraBranchYearlyPrice: yearly(590),
    extraBranchPerpetualPrice: 15900,
    maxTerminalsPerBranchIncluded: 2,
    extraTerminalMonthlyPrice: 190,
    extraTerminalYearlyPrice: yearly(190),
    extraTerminalPerpetualPrice: 5900,
    includedFeatureCodes: ["core_pos_sales", "stock_management", "delivery_ordering", "advanced_sales_reports", "receipt_reprint_history", "qr_login", "mobile_qr_login", "device_management"],
    target: "affordable starter package",
    ...PACKAGE_PROMO,
    isActive: true
  },
  {
    code: "growth",
    name: "Growth",
    baseMonthlyPrice: 1290,
    baseYearlyPrice: 14190,
    basePerpetualPrice: 44900,
    maxBranchesIncluded: 2,
    maxUsersIncluded: 10,
    extraBranchMonthlyPrice: 690,
    extraBranchYearlyPrice: yearly(690),
    extraBranchPerpetualPrice: 13900,
    maxTerminalsPerBranchIncluded: 2,
    extraTerminalMonthlyPrice: 220,
    extraTerminalYearlyPrice: yearly(220),
    extraTerminalPerpetualPrice: 4900,
    includedFeatureCodes: ["core_pos_sales", "stock_management", "delivery_ordering", "multi_terminal_sync", "offline_queue_resilience", "advanced_sales_reports", "receipt_reprint_history", "branch_management", "user_management"],
    target: "multi-terminal / multi-branch growth",
    ...PACKAGE_PROMO,
    isActive: true
  },
  {
    code: "enterprise",
    name: "Enterprise",
    baseMonthlyPrice: 2490,
    baseYearlyPrice: 27390,
    basePerpetualPrice: 89900,
    maxBranchesIncluded: 5,
    maxUsersIncluded: 30,
    extraBranchMonthlyPrice: 590,
    extraBranchYearlyPrice: yearly(590),
    extraBranchPerpetualPrice: 12900,
    maxTerminalsPerBranchIncluded: 4,
    extraTerminalMonthlyPrice: 170,
    extraTerminalYearlyPrice: yearly(170),
    extraTerminalPerpetualPrice: 3900,
    includedFeatureCodes: [
      "core_pos_sales",
      "stock_management",
      "delivery_ordering",
      "advanced_sales_reports",
      "receipt_reprint_history",
      "table_management",
      "qr_table_ordering",
      "kitchen_printing",
      "customer_facing_display",
      "inet_nops_qr",
      "staff_card_login",
      "mobile_device_enrollment"
    ],
    target: "full restaurant/store expansion package",
    ...PACKAGE_PROMO,
    isActive: true
  }
];
