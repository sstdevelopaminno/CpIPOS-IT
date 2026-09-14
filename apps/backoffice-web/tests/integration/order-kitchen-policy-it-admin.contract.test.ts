import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const route = source("../../src/app/api/it-admin/admin/tenants/[tenantId]/order-kitchen-policy/route.ts");
const consoleUi = source("../../src/components/it-admin/order-kitchen-policy-admin-console.tsx");
const nav = source("../../src/components/it-admin/tenant-admin-nav.tsx");

describe("IT order and kitchen policy controls", () => {
  it("restricts policy reads and writes to IT admin", () => {
    expect(route).toContain('auth.platformRole !== "it_admin"');
    expect(route).toContain("Only IT admin can view this policy");
    expect(route).toContain("Only IT admin can update this policy");
  });

  it("supports inherit, force on and force off for all three controls", () => {
    for (const value of ["inherit", "force_on", "force_off"]) expect(route).toContain(`\"${value}\"`);
    expect(route).toContain("table_qr_popup_override");
    expect(route).toContain("table_qr_kitchen_auto_send_override");
    expect(route).toContain("table_qr_kitchen_auto_print_override");
    expect(consoleUi).toContain("ตามการตั้งค่าของร้าน");
    expect(consoleUi).toContain("บังคับเปิด");
    expect(consoleUi).toContain("บังคับปิด");
  });

  it("shows store values and effective values per branch", () => {
    expect(consoleUi).toContain("ค่าร้าน:");
    expect(consoleUi).toContain("ผลใช้งานจริง:");
    expect(consoleUi).toContain("แจ้งเตือนออเดอร์ QR บนหน้าขาย");
    expect(consoleUi).toContain("ส่งออเดอร์ QR เข้าครัวอัตโนมัติ");
    expect(consoleUi).toContain("พิมพ์ใบรายการครัวอัตโนมัติ");
  });

  it("links the tenant admin navigation to the policy console", () => {
    expect(nav).toContain("order-kitchen");
  });
});
