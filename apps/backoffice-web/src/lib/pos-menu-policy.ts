/** Shared contract between CpIPOS POS and the separate CpIPOS-IT repository.
 * Every menu is enabled by default until IT writes a tenant-scoped override.
 * Menu policy never expands role permissions or package entitlements.
 */
export type PosMenuGroup = "main" | "more" | "settings";
export type PosMenuDefinition = {
  key: string; label: string; group: PosMenuGroup; parent?: string;
  route?: string; protected?: boolean;
};
export const POS_MENU_CATALOG: readonly PosMenuDefinition[] = [
  { key: "main.sales", label: "หน้าขาย", group: "main", route: "/preview/pos" },
  { key: "main.sales_list", label: "รายการขาย", group: "main", route: "/preview/pos/sales-list" },
  { key: "main.kitchen", label: "ครัว", group: "main", route: "/preview/pos/kitchen" },
  { key: "main.shift", label: "เปิด/ปิดกะ", group: "main", route: "/preview/pos/shift" },
  { key: "main.more", label: "เพิ่มเติม", group: "main", route: "/preview/pos/more" },
  { key: "main.payments", label: "ชำระเงิน", group: "main", route: "/preview/pos/payments" },
  { key: "main.settings", label: "ตั้งค่า", group: "main", route: "/preview/pos/settings" },
  { key: "more.sales_summary", label: "สรุปยอดขาย", group: "more", parent: "main.more", route: "/preview/pos/sales-summary" },
  { key: "more.receipts", label: "ใบเสร็จย้อนหลัง", group: "more", parent: "main.more", route: "/preview/pos/receipts" },
  { key: "more.tables", label: "จัดการโต๊ะ", group: "more", parent: "main.more", route: "/preview/pos/tables" },
  { key: "more.kitchen_manage", label: "จัดการครัว", group: "more", parent: "main.more", route: "/preview/pos/kitchen/manage" },
  { key: "more.stock", label: "จัดการสินค้า", group: "more", parent: "main.more", route: "/preview/pos/stock" },
  { key: "more.buffet", label: "ตั้งค่าราคาบุฟเฟ่", group: "more", parent: "main.more", route: "/preview/pos/buffet-pricing" },
  { key: "more.members", label: "สมาชิก", group: "more", parent: "main.more", route: "/preview/pos/members" },
  { key: "more.tax_invoices", label: "ออกใบกำกับภาษี", group: "more", parent: "main.more", route: "/preview/pos/tax-invoices" },
  { key: "more.product_sales", label: "รายการขายสินค้า", group: "more", parent: "main.more", route: "/preview/pos/product-sales" },
  { key: "settings.store", label: "ข้อมูลร้านค้า/บริษัท", group: "settings", parent: "main.settings" },
  { key: "settings.branches", label: "เพิ่มสาขา", group: "settings", parent: "main.settings" },
  { key: "settings.devices", label: "เพิ่มเครื่องแคชเชียร์", group: "settings", parent: "main.settings" },
  { key: "settings.printers", label: "ตั้งค่าเครื่องพิมพ์", group: "settings", parent: "main.settings" },
  { key: "settings.activity", label: "ตรวจสอบพฤติกรรมการใช้งาน", group: "settings", parent: "main.settings" },
  { key: "settings.payments", label: "ตั้งค่าชำระเงิน", group: "settings", parent: "main.settings" },
  { key: "settings.inet_nops", label: "INET QR", group: "settings", parent: "main.settings" },
  { key: "settings.taxes", label: "ตั้งค่าภาษี", group: "settings", parent: "main.settings" },
  { key: "settings.notifications", label: "ตั้งค่าการแจ้งเตือน", group: "settings", parent: "main.settings" },
  { key: "settings.users", label: "ผู้ใช้งาน", group: "settings", parent: "main.settings" },
  { key: "settings.language", label: "เปลี่ยนภาษา", group: "settings", parent: "main.settings" },
  { key: "settings.placement", label: "สลับแถบเมนูหลัก", group: "settings", parent: "main.settings" },
  { key: "settings.display", label: "จอลูกค้า", group: "settings", parent: "main.settings" },
  { key: "settings.order_kitchen", label: "การแจ้งเตือนออเดอร์และครัว", group: "settings", parent: "main.settings", route: "/preview/pos/settings/order-kitchen" },
  { key: "settings.table_qr", label: "ตั้งค่า QR โต๊ะ", group: "settings", parent: "main.settings", route: "/preview/pos/settings/table-qr" }
] as const;
const catalog = new Map(POS_MENU_CATALOG.map(item => [item.key, item]));
export function isValidPosMenuKey(key: string): boolean { return catalog.has(key); }
export function isPosMenuEnabled(key: string, overrides: Record<string, boolean>): boolean {
  const item = catalog.get(key);
  if (!item) return true; // Unknown routes are not silently reclassified.
  if (overrides[key] === false) return false;
  return !item.parent || isPosMenuEnabled(item.parent, overrides);
}
/** Longest path wins; /preview/pos is an exact-match root, not a wildcard. */
export function posMenuKeyForRoute(pathname: string): string | null {
  const path = pathname.split("?")[0].replace(/\/$/, "") || "/";
  const matches = POS_MENU_CATALOG.filter(item => item.route &&
    (path === item.route || (item.route !== "/preview/pos" && path.startsWith(item.route + "/"))));
  matches.sort((a, b) => (b.route?.length ?? 0) - (a.route?.length ?? 0));
  return matches[0]?.key ?? null;
}
