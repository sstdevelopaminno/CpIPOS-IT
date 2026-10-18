/** CRM-only tenant navigation policy. Keys use a distinct crm_ namespace in the existing
 * tenant_pos_menu_policies table; POS switches and existing tenants are untouched.
 * Absence means enabled (backward compatible); only explicit IT false hides a menu.
 * Navigation is NOT an API or package entitlement, and role rules still apply.
 */
export type CrmMenuDefinition={key:string;label:string;group:"main"|"more"|"settings"|"optical"|"optical_api";parent?:string};
export const CRM_MENU_CATALOG:readonly CrmMenuDefinition[] = [
  {key:"main.crm_overview",label:"ภาพรวม",group:"main"},
  {key:"main.crm_sales",label:"ยอดขาย",group:"main"},
  {key:"main.crm_products",label:"สินค้า",group:"main"},
  {key:"main.crm_stock",label:"สต๊อก",group:"main"},
  {key:"main.crm_staff",label:"พนักงาน",group:"main"},
  {key:"main.crm_package",label:"แพ็กเกจ",group:"main"},
  {key:"main.crm_more",label:"เพิ่มเติม",group:"main"},
  {key:"main.crm_optical",label:"ร้านแว่นตา",group:"main"},
  {key:"main.crm_settings",label:"ตั้งค่า",group:"main"},
  {key:"more.crm_receipts",label:"ใบเสร็จย้อนหลัง",group:"more",parent:"main.crm_more"},
  {key:"more.crm_tax_invoices",label:"ออกใบกำกับภาษี",group:"more",parent:"main.crm_more"},
  {key:"more.crm_product_sales",label:"รายการขายสินค้า",group:"more",parent:"main.crm_more"},
  {key:"more.crm_tables",label:"จัดการโต๊ะ",group:"more",parent:"main.crm_more"},
  {key:"more.crm_kitchen_manage",label:"จัดการครัว",group:"more",parent:"main.crm_more"},
  {key:"more.crm_buffet",label:"ราคาบุฟเฟ่",group:"more",parent:"main.crm_more"},
  {key:"more.crm_members",label:"สมาชิก",group:"more",parent:"main.crm_more"},
  {key:"settings.crm_branding",label:"ธีมสี / โลโก้ / ชื่อระบบ CUSTOM",group:"settings",parent:"main.crm_settings"},
  {key:"settings.crm_store",label:"ข้อมูลร้านค้า",group:"settings",parent:"main.crm_settings"},
  {key:"settings.crm_branches",label:"สาขา",group:"settings",parent:"main.crm_settings"},
  {key:"settings.crm_devices",label:"เครื่องแคชเชียร์",group:"settings",parent:"main.crm_settings"},
  {key:"settings.crm_printers",label:"เครื่องพิมพ์",group:"settings",parent:"main.crm_settings"},
  {key:"settings.crm_activity",label:"ประวัติการใช้งาน",group:"settings",parent:"main.crm_settings"},
  {key:"settings.crm_payments",label:"ตั้งค่าชำระเงิน",group:"settings",parent:"main.crm_settings"},
  {key:"settings.crm_inet_nops",label:"INET QR",group:"settings",parent:"main.crm_settings"},
  {key:"settings.crm_taxes",label:"ภาษี",group:"settings",parent:"main.crm_settings"},
  {key:"settings.crm_notifications",label:"การแจ้งเตือน",group:"settings",parent:"main.crm_settings"},
  {key:"settings.crm_language",label:"ภาษา",group:"settings",parent:"main.crm_settings"},
  {key:"settings.crm_currency",label:"สกุลเงิน",group:"settings",parent:"main.crm_settings"},
  {key:"settings.crm_placement",label:"ตำแหน่งเมนู",group:"settings",parent:"main.crm_settings"},
  {key:"settings.crm_display",label:"จอลูกค้า",group:"settings",parent:"main.crm_settings"},
  {key:"settings.crm_order_kitchen",label:"ออเดอร์และครัว",group:"settings",parent:"main.crm_settings"},
  {key:"settings.crm_table_qr",label:"QR โต๊ะ",group:"settings",parent:"main.crm_settings"},
  {key:"main.crm_optical_customers",label:"ประวัติลูกค้าแว่นตา",group:"optical",parent:"main.crm_optical"},
  {key:"main.crm_optical_orders",label:"ใบสั่งงานแว่นตา",group:"optical",parent:"main.crm_optical"},
  {key:"main.crm_optical_stock",label:"สต๊อกแว่นตา",group:"optical",parent:"main.crm_optical"},
  {key:"main.crm_optical_reports",label:"รายงานร้านแว่นตา",group:"optical",parent:"main.crm_optical"},
  // Distinct IT kill switches for POS Optical data APIs. These do not change
  // subscription entitlements; the server ANDs them with CUSTOM Optical grants.
  {key:"settings.crm_optical_api_work_orders",label:"API ใบสั่งงาน Optical (POS)",group:"optical_api"},
  {key:"settings.crm_optical_api_deposits",label:"API รับมัดจำ / ยอดค้าง (POS)",group:"optical_api"},
  {key:"settings.crm_optical_api_inventory",label:"API สต๊อก Optical (POS)",group:"optical_api"},
  {key:"settings.crm_optical_api_customers",label:"API ลูกค้า / ตรวจสายตา (POS)",group:"optical_api"},
  {key:"settings.crm_optical_api_payment_verification",label:"API ยืนยันเงินโอน Optical (POS)",group:"optical_api"},
];
const catalog=new Map(CRM_MENU_CATALOG.map(menu=>[menu.key,menu]));
export function isValidCrmMenuKey(key:string){return catalog.has(key);}
export function isCrmMenuEnabled(key:string,policy:Record<string,boolean>):boolean{
  const item=catalog.get(key);
  return Boolean(item && policy[key]!==false && (!item.parent || isCrmMenuEnabled(item.parent,policy)));
}
