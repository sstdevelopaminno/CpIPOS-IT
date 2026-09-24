/** Canonical menu-policy keys shared by the IT and POS deployments.
 * A visibility flag never changes role permissions, subscription entitlements,
 * or background safety/receipt/shift operations. Absence means visible. */
export const POS_MENU_GROUPS = [
  { key: "sales", label: "หน้าขาย", href: "/preview/pos", children: [] },
  { key: "sales_list", label: "รายการขาย", href: "/preview/pos/sales-list", children: [] },
  { key: "kitchen", label: "ครัว", href: "/preview/pos/kitchen", children: [] },
  { key: "shift", label: "เปิด/ปิดกะ", href: "/preview/pos/shift", children: [] },
  { key: "more", label: "เพิ่มเติม", href: "/preview/pos/more", children: [
    { key: "sales_summary", label: "สรุปยอดขาย", href: "/preview/pos/sales-summary" },
    { key: "receipts", label: "ใบเสร็จย้อนหลัง", href: "/preview/pos/receipts" },
    { key: "tables", label: "จัดการโต๊ะ", href: "/preview/pos/tables" },
    { key: "kitchen_manage", label: "จัดการครัว", href: "/preview/pos/kitchen/manage" },
    { key: "stock", label: "จัดการสินค้า", href: "/preview/pos/stock" },
    { key: "buffet_pricing", label: "ตั้งค่าราคาบุฟเฟ่", href: "/preview/pos/buffet-pricing" },
    { key: "members", label: "สมาชิก", href: "/preview/pos/members" },
    { key: "tax_invoices", label: "ออกใบกำกับภาษี", href: "/preview/pos/tax-invoices" },
    { key: "product_sales", label: "รายการขายสินค้า", href: "/preview/pos/product-sales" }
  ] },
  { key: "payments", label: "ชำระเงิน", href: "/preview/pos/payments", children: [] },
  { key: "settings", label: "ตั้งค่า", href: "/preview/pos/settings", children: [
    { key: "store", label: "ข้อมูลร้านค้า/บริษัท", href: "/preview/pos/settings" },
    { key: "branches", label: "เพิ่มสาขา", href: "/preview/pos/settings" },
    { key: "devices", label: "เพิ่มเครื่องแคชเชียร์", href: "/preview/pos/settings" },
    { key: "printers", label: "ตั้งค่าเครื่องพิมพ์", href: "/preview/pos/settings" },
    { key: "activity", label: "ตรวจสอบพฤติกรรมการใช้งาน", href: "/preview/pos/settings" },
    { key: "settings_payments", label: "ตั้งค่าชำระเงิน", href: "/preview/pos/settings" },
    { key: "inet_nops", label: "INET QR", href: "/preview/pos/settings" },
    { key: "taxes", label: "ตั้งค่าภาษี", href: "/preview/pos/settings" },
    { key: "notifications", label: "ตั้งค่าการแจ้งเตือน", href: "/preview/pos/settings" },
    { key: "users", label: "ผู้ใช้งาน", href: "/preview/pos/settings" },
    { key: "language", label: "เปลี่ยนภาษา", href: "/preview/pos/settings" },
    { key: "menu_placement", label: "สลับแถบเมนูหลัก", href: "/preview/pos/settings" },
    { key: "display", label: "จอลูกค้า", href: "/preview/pos/customer-display" },
    { key: "receipt_alerts", label: "การแจ้งเตือนออเดอร์และครัว", href: "/preview/pos/settings" },
    { key: "table_qr", label: "ตั้งค่า QR โต๊ะ", href: "/preview/pos/settings/table-qr" }
  ] }
] as const;

export type PosMenuKey = (typeof POS_MENU_GROUPS)[number]["key"] |
  (typeof POS_MENU_GROUPS)[number]["children"][number]["key"];

export type PosMenuVisibility = Record<string, boolean>;

export const POS_MENU_POLICY_KEYS: readonly string[] = POS_MENU_GROUPS.flatMap(group => [
  group.key, ...group.children.map(child => child.key)
]);

export function normalizePosMenuVisibility(input: unknown): PosMenuVisibility {
  const data = input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown> : {};
  return Object.fromEntries(POS_MENU_POLICY_KEYS.map(key => [key, data[key] !== false]));
}

export function isPosMenuVisible(policy: PosMenuVisibility | null | undefined, key: string): boolean {
  const parent = POS_MENU_GROUPS.find(group => group.children.some(child => child.key === key));
  return policy?.[key] !== false && (!parent || policy?.[parent.key] !== false);
}

export function posMenuKeyForRoute(path: string): string | null {
  const normalized = path.endsWith("/") ? path.slice(0, -1) : path || "/preview/pos";
  const children: Array<{ key: string; label: string; href: string }> = [];
  for (const group of POS_MENU_GROUPS) {
    for (const child of group.children) children.push(child);
  }
  children.sort((a, b) => b.href.length - a.href.length);
  const routeChildren = children.filter(child => child.href !== "/preview/pos/settings");
  const child = routeChildren.find(item => normalized === item.href ||
    normalized.startsWith(item.href + "/"));
  if (child) return child.key;
  if (normalized.startsWith("/preview/pos/settings")) return "settings";
  const main = POS_MENU_GROUPS.filter(group => group.key !== "sales")
    .sort((a, b) => b.href.length - a.href.length)
    .find(item => normalized === item.href || normalized.startsWith(item.href + "/"));
  return main?.key ?? (normalized === "/preview/pos" ? "sales" : null);
}
