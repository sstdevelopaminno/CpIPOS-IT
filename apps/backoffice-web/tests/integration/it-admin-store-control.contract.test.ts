import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const directory = source("../../src/components/it-admin/tenant-directory-console.tsx");
const controlCenter = source("../../src/components/it-admin/tenant-control-center.tsx");
const actionConfirm = source("../../src/components/it-admin/tenant-action-confirm.tsx");
const actionConfirmStyles = source("../../src/components/it-admin/tenant-action-confirm.module.css");
const ownerCard = source("../../src/components/it-admin/tenant-primary-owner-card.tsx");
const cashierConsole = source("../../src/components/it-admin/tenant-cashier-devices.tsx");
const cashierRoute = source("../../src/app/api/it-admin/v1/tenants/[tenantId]/cashier-devices/route.ts");
const menuPanel = source("../../src/components/it-admin/tenant-pos-menu-policies.tsx");
const menuRoute = source("../../src/app/api/it-admin/v1/tenants/[tenantId]/pos-menu-policies/route.ts");
const menuCatalog = source("../../src/lib/pos-menu-policy.ts");
const menuMigration = source("../../../../supabase/migrations/20260924220000_tenant_pos_menu_policies.sql");
const route = source("../../src/app/api/it-admin/v1/tenants/[tenantId]/control/route.ts");
const service = source("../../src/lib/services/it-admin/tenant-control-service.ts");
const prepaidMigration = source("../../../../supabase/migrations/20260924203500_prepaid_trial_handoff.sql");

describe("IT Admin Store Control Center contract", () => {
  it("opens an editable Store Control Center instead of the old read-only tenant detail", () => {
    expect(directory).toContain("TenantControlCenter");
    expect(directory).toContain("จัดการ");
    expect(directory).not.toContain("TENANT DETAIL · READ ONLY");
    expect(controlCenter).toContain("STORE CONTROL CENTER · CPIPOS-001");
    expect(controlCenter).toContain("ข้อมูลร้าน");
    expect(controlCenter).toContain("สาขา");
    expect(controlCenter).toContain("แพ็กเกจและสิทธิ์");
    expect(controlCenter).toContain("พื้นที่อันตราย");
  });

  it("keeps tenant mutations behind the authenticated IT Admin server boundary", () => {
    expect(route).toContain("requireItAdmin()");
    expect(route).toContain("parseTenantParam");
    expect(route).toContain('namespace: "it_admin_tenant_control"');
    expect(route).toContain("applyTenantControlAction");
    expect(service).toContain('context.supabase.from("tenants")');
    expect(service).toContain('from("branches")');
    expect(service).toContain('from("subscription_packages")');
    expect(service).toContain('from("tenant_subscription_contracts")');
    expect(service).not.toContain("itSupabase");
    expect(service).not.toContain("CpiPOS-002");
  });

  it("shows confirmation popups above nested Store Control modals before saves", () => {
    expect(actionConfirm).toContain('createPortal(');
    expect(actionConfirm).toContain('document.body');
    expect(actionConfirm).toContain('data-tenant-action-confirm');
    expect(actionConfirmStyles).toContain('z-index:1800');
    expect(actionConfirmStyles).toContain('isolation:isolate');
    expect(controlCenter).toContain('confirmBeforeSave = true');
    expect(actionConfirm).toContain('update_profile');
    expect(actionConfirm).toContain('create_branch');
    expect(actionConfirm).toContain('update_branch');
    expect(ownerCard).toContain('confirmAction("update_owner_profile"');
    expect(ownerCard).toContain('confirmAction("update_owner_pin"');
  });
  it("supports profile, branch, package, suspend, resume, cancellation and store lifecycle controls", () => {
    for (const action of [
      "update_profile",
      "create_branch",
      "update_branch",
      "change_package",
      "suspend_package",
      "resume_package",
      "cancel_subscription",
      "deactivate_store",
      "reactivate_store",
      "delete_store"
    ]) {
      expect(service).toContain(`"${action}"`);
    }
    expect(controlCenter).toContain("ชื่อร้านที่แสดง");
    expect(controlCenter).toContain("ที่อยู่ร้าน");
    expect(controlCenter).toContain("โลโก้ร้าน (URL)");
    expect(controlCenter).toContain("เปิดสาขาใหม่");
    expect(controlCenter).toContain("ยืนยันเปลี่ยนแพ็กเกจ");
    expect(controlCenter).toContain("หยุดแพ็กเกจชั่วคราว");
    expect(controlCenter).toContain("เปิดใช้งานต่อ");
    expect(controlCenter).toContain("ยกเลิกแพ็กเกจ");
  });

  it("strictly separates customer-visible POS copy from internal IT reasons", () => {
    expect(service).toContain("customer_title");
    expect(service).toContain("customer_message");
    expect(service).toContain("admin_reason");
    expect(controlCenter).toContain("ข้อความที่ลูกค้าเห็นบน POS");
    expect(controlCenter).toContain("เหตุผลภายใน IT (ลูกค้าไม่เห็น)");
    expect(controlCenter).toContain("POS POPUP PREVIEW");
    expect(controlCenter).toContain("ข้อมูลภายใน IT หลุดไปยังหน้าขาย POS");
  });

  it("guards permanent tenant deletion because tenant foreign keys cascade business data", () => {
    expect(service).toContain("tenant_delete_confirmation_failed");
    expect(service).toContain("tenant_must_be_inactive");
    expect(service).toContain('rpc("it_delete_tenant_cascade"');
    expect(service).not.toContain("Cancel or expire the subscription before permanent deletion.");
    expect(service).toContain("tenant_devices_still_online");
    expect(service).toContain("shared_users_preserved");
    expect(service).toContain("storage_cleanup_pending");
    expect(controlCenter).toContain("ลบร้านค้าและข้อมูลทั้งหมด");
    expect(controlCenter).toContain("Store Code เพื่อยืนยัน");
    expect(controlCenter).toContain("ย้อนกลับไม่ได้");
  });
  it("preserves prepaid seven-day trials and converts them before the subscription lock", () => {
    expect(prepaidMigration).toContain("CREATE OR REPLACE FUNCTION app.refresh_subscription_locks()");
    expect(prepaidMigration).toContain("app.approve_paid_subscription");
    expect(prepaidMigration).toContain("pending_trial_completion");
    expect(prepaidMigration).toContain("FOR UPDATE OF l SKIP LOCKED");
    expect(prepaidMigration).toContain("prepaid_payment_reference");
    expect(prepaidMigration).toContain("prepaid_amount_thb");
    expect(prepaidMigration).toContain("prepaid_activation_state");
    expect(prepaidMigration).toContain("NOT EXISTS");
    expect(service).toContain("lifecycle?.trial_expires_at ?? contract.ended_at");
    expect(controlCenter).toContain("isPrepaidPendingTrial");
    expect(controlCenter).toContain("ยืนยันรับชำระเงินล่วงหน้า");
    expect(controlCenter).toContain("disabled={busy || isPrepaidPendingTrial");
    expect(controlCenter).not.toContain("093186");
  });

  it("adds Cashier Terminals after Branches in the Store Control popup", () => {
    expect(controlCenter).toContain('setTab("cashiers")');
    expect(controlCenter).toContain("<TenantCashierDevices");
    const branches = controlCenter.indexOf('setTab("branches")');
    const cashiers = controlCenter.indexOf('setTab("cashiers")');
    const packages = controlCenter.indexOf('setTab("package")');
    expect(branches).toBeLessThan(cashiers);
    expect(cashiers).toBeLessThan(packages);
    expect(controlCenter).toContain("data.usage.cashier_active");
    expect(service).toContain('cashier_active: cashierResult.count ?? 0');
  });

  it("uses primary branch_devices and the POS package quota for real cashier CRUD", () => {
    expect(cashierRoute).toContain("requireItAdmin()");
    expect(cashierRoute).toContain("getTenantLimits(tenantId)");
    expect(cashierRoute).toContain('enforceQuota(tenantId, "devices", branchId)');
    expect(cashierRoute).toContain("enforceCashierActivation(admin, tenantId, current.branch_id)");
    expect(cashierRoute).toContain("syncCashierLoginCapacity");
    expect(cashierRoute).toContain('from("branch_login_policies")');
    expect(cashierRoute).toContain('from("branch_devices")');
    expect(cashierRoute).toContain('device_type: "pos_terminal"');
    expect(cashierRoute).toContain('from("pos_sessions")');
    expect(cashierRoute).toContain('from("shifts")');
    expect(cashierRoute).toContain('it_cashier_archived_at');
    expect(cashierConsole).toContain('method: "DELETE"');
    expect(cashierConsole).toContain('method: "PATCH"');
    expect(cashierConsole).toContain('"POST"');
    expect(actionConfirm).toContain("delete_cashier");
    expect(actionConfirm).toContain("disable_cashier");
  });

  it("adds the tenant main-menu card after cashier terminals and before package", () => {
    expect(controlCenter).toContain('setTab("menuPolicies")');
    expect(controlCenter).toContain("<TenantPosMenuPolicies");
    const cashier = controlCenter.indexOf('setTab("cashiers")');
    const menu = controlCenter.indexOf('setTab("menuPolicies")');
    const packages = controlCenter.indexOf('setTab("package")');
    expect(cashier).toBeLessThan(menu);
    expect(menu).toBeLessThan(packages);
    expect(menuPanel).toContain("isPosMenuEnabled");
    expect(menuPanel).toContain("group === \"main\"");
  });

  it("persists audited tenant-scoped switches via service-role-only data", () => {
    expect(menuRoute).toContain("requireItAdmin()");
    expect(menuRoute).toContain("parseTenantParam");
    expect(menuRoute).toContain("isValidPosMenuKey");
    expect(menuRoute).toContain('from("tenant_pos_menu_policies")');
    expect(menuRoute).toContain("appendAuditLog");
    expect(menuCatalog).toContain('"main.more"');
    expect(menuCatalog).toContain('"settings.table_qr"');
    expect(menuMigration).toContain("references public.tenants(id) on delete cascade");
    expect(menuMigration).toContain("revoke all on public.tenant_pos_menu_policies");
    expect(menuMigration).toContain("to service_role");
  });

});
