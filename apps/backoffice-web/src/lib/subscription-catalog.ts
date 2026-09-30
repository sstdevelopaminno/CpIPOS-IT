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
  },
  {
    code: "cpipos_ai",
    name: "CpiPOS AI",
    description: "AI assistant for sales, margin, stock and marketing analysis. Growth can add it for 299 THB/month; Business includes it.",
    defaultMonthlyPrice: 299,
    defaultYearlyPrice: 3229,
    defaultPerpetualPrice: 0,
    includedByDefault: false,
    pricedPerBranch: false,
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
    code: "starter",
    name: "Starter",
    baseMonthlyPrice: 350,
    baseYearlyPrice: 3780,
    basePerpetualPrice: 0,
    maxBranchesIncluded: 1,
    maxUsersIncluded: 4,
    extraBranchMonthlyPrice: 0,
    extraBranchYearlyPrice: 0,
    extraBranchPerpetualPrice: 0,
    maxTerminalsPerBranchIncluded: 1,
    extraTerminalMonthlyPrice: 0,
    extraTerminalYearlyPrice: 0,
    extraTerminalPerpetualPrice: 0,
    includedFeatureCodes: [
      "core_pos_sales",
      "stock_management",
      "advanced_sales_reports",
      "receipt_reprint_history",
      "pin_login",
      "qr_login",
      "device_management"
    ],
    target: "ร้านเริ่มต้น / 1 สาขา / 1 เครื่อง",
    metadata: {
      annual_discount_percent: 10,
      yearly_list_price: 4200,
      max_products: 1000,
      monthly_bill_limit: 3000,
      storage_limit_gb: 3,
      retention_months: 6,
      sales_mode_limit: 1,
      default_sales_modes: ["general_sale"],
      ai_included: false
    },
    ...PACKAGE_PROMO,
    isActive: true
  },
  {
    code: "growth",
    name: "Growth",
    baseMonthlyPrice: 550,
    baseYearlyPrice: 5940,
    basePerpetualPrice: 0,
    maxBranchesIncluded: 1,
    maxUsersIncluded: 9,
    extraBranchMonthlyPrice: 690,
    extraBranchYearlyPrice: yearly(690),
    extraBranchPerpetualPrice: 0,
    maxTerminalsPerBranchIncluded: 2,
    extraTerminalMonthlyPrice: 220,
    extraTerminalYearlyPrice: yearly(220),
    extraTerminalPerpetualPrice: 0,
    includedFeatureCodes: [
      "core_pos_sales",
      "stock_management",
      "delivery_ordering",
      "multi_terminal_sync",
      "offline_queue_resilience",
      "advanced_sales_reports",
      "receipt_reprint_history",
      "branch_management",
      "user_management"
    ],
    target: "ร้านที่กำลังเติบโต / สูงสุด 3 โหมดการขาย",
    metadata: {
      annual_discount_percent: 10,
      yearly_list_price: 6600,
      max_products: 2000,
      monthly_bill_limit: 5000,
      storage_limit_gb: 5,
      retention_months: 12,
      sales_mode_limit: 3,
      default_sales_modes: ["general_sale","takeaway","dine_in"],
      ai_included: false,
      ai_addon_available: true,
      ai_addon_monthly_price: 299,
      ai_addon_monthly_requests: 500
    },
    ...PACKAGE_PROMO,
    isActive: true
  },
  {
    code: "business",
    name: "Business",
    baseMonthlyPrice: 1500,
    baseYearlyPrice: 16200,
    basePerpetualPrice: 0,
    maxBranchesIncluded: 2,
    maxUsersIncluded: 20,
    extraBranchMonthlyPrice: 590,
    extraBranchYearlyPrice: yearly(590),
    extraBranchPerpetualPrice: 0,
    maxTerminalsPerBranchIncluded: 4,
    extraTerminalMonthlyPrice: 170,
    extraTerminalYearlyPrice: yearly(170),
    extraTerminalPerpetualPrice: 0,
    includedFeatureCodes: [
      "core_pos_sales",
      "stock_management",
      "table_management",
      "qr_table_ordering",
      "delivery_ordering",
      "customer_facing_display",
      "transfer_slip_verification",
      "staff_qr_clockin",
      "advanced_sales_reports",
      "receipt_reprint_history",
      "multi_terminal_sync",
      "offline_queue_resilience",
      "desktop_app_runtime",
      "barcode_scanner_mode",
      "kitchen_printing",
      "inet_nops_qr",
      "qr_login",
      "pin_login",
      "staff_card_login",
      "attendance_tracking",
      "device_management",
      "branch_management",
      "user_management",
      "mobile_qr_login",
      "mobile_device_enrollment",
      "cpipos_ai"
    ],
    target: "แพ็กเกจธุรกิจเต็มรูปแบบ พร้อม CpiPOS AI",
    metadata: {
      annual_discount_percent: 10,
      yearly_list_price: 18000,
      max_products: 5000,
      monthly_bill_limit: 10000,
      storage_limit_gb: 10,
      retention_months: 24,
      sales_mode_limit: 5,
      default_sales_modes: ["general_sale","takeaway","dine_in","buffet_table","delivery"],
      ai_included: true,
      ai_monthly_requests: 2000,
      full_feature_bundle: true
    },
    ...PACKAGE_PROMO,
    isActive: true
  },
  {
    code: "custom",
    name: "CUSTOM",
    baseMonthlyPrice: 0,
    baseYearlyPrice: 0,
    basePerpetualPrice: 0,
    maxBranchesIncluded: 999999,
    maxUsersIncluded: 999999,
    extraBranchMonthlyPrice: 0,
    extraBranchYearlyPrice: 0,
    extraBranchPerpetualPrice: 0,
    maxTerminalsPerBranchIncluded: 999999,
    extraTerminalMonthlyPrice: 0,
    extraTerminalYearlyPrice: 0,
    extraTerminalPerpetualPrice: 0,
    includedFeatureCodes: ["core_pos_sales"],
    target: "กำหนดสิทธิ์ ราคา และโควตาตามสัญญา",
    metadata: {
      contact_sales: true,
      custom_contract_required: true,
      ai_included: true,
      ai_quota_source: "tenant_contract"
    },
    ...PACKAGE_PROMO,
    isActive: true
  }
];
