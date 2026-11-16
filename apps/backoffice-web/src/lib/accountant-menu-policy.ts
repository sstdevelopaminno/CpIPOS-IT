/** Static accountant navigation allowlist, mirrored from CpIPOS Finance.
 * IT may disable links, but never grant extra role permissions by enabling a switch.
 */
export const ACCOUNTANT_MORE_MENU_KEYS = [
  "more.sales_summary", "more.receipts", "more.tax_invoices",
  "more.stock", "more.product_sales"
] as const;
export const ACCOUNTANT_SETTINGS_MENU_KEYS = [
  "settings.branding", "settings.store", "settings.branches", "settings.devices",
  "settings.printers", "settings.activity", "settings.payments", "settings.inet_nops",
  "settings.taxes", "settings.notifications", "settings.support", "settings.push_notifications",
  "settings.language", "settings.currency", "settings.placement", "settings.display",
  "settings.order_kitchen", "settings.table_qr"
] as const;
export const ACCOUNTANT_MAIN_MENU_KEYS = [
  "main.finance", "main.more", "main.settings", "main.package_payment"
] as const;
export const ACCOUNTANT_ALLOWED_MENU_KEYS: readonly string[] = [
  ...ACCOUNTANT_MAIN_MENU_KEYS, ...ACCOUNTANT_MORE_MENU_KEYS, ...ACCOUNTANT_SETTINGS_MENU_KEYS
];
