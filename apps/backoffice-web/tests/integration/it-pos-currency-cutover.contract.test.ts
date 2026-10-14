import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");
const route = source("../../src/app/api/it-admin/v1/tenants/[tenantId]/pos-currency/route.ts");
const ui = source("../../src/components/it-admin/tenant-currency-control.tsx");
const menu = source("../../src/components/it-admin/tenant-pos-menu-policies.tsx");

describe("IT-controlled CUSTOM sales currency cutover", () => {
 it("requires active CUSTOM, explicit IT menu policy and verified IT account", () => {
  expect(route).toContain('flags["settings.currency"]===true');
  expect(route).toContain('flags["main.settings"]===true');
  expect(route).toContain('toLowerCase()==="custom"');
  expect(route).toContain('admin.profile.platform_role!=="it_admin" && admin.profile.platform_role!=="it_support"');
 });
 it("blocks live sales or unsettled payments before switching currency", () => {
  expect(route).toContain('"draft","queued","preparing"');
  expect(route).toContain('db.from("shifts")');
  expect(route).toContain('db.from("pos_sessions")');
  expect(route).toContain('db.from("pos_payment_intents")');
  expect(route).toContain('if(!x.can_change||!x.contract)');
 });
 it("requires explicit acknowledgment and never edits old order amounts", () => {
  expect(route).toContain('body?.acknowledge_history!==true');
  expect(route).toContain('body?.confirmation');
  expect(route).toContain('"it_pos_currency_cutover_approved"');
  expect(route).toContain('pos_currency_cutover_previous');
  expect(route).not.toContain('.from("orders").update(');
 });
 it("shows actionable blockers and allows explicit menu activation without bypassing financial guards", () => {
  expect(route).toContain('settings_menu_enabled:settingsMenuEnabled');
  expect(route).toContain('currency_menu_enabled:currencyMenuEnabled');
  expect(route).toContain('approver_role:admin.profile.platform_role');
  expect(ui).toContain('"main.settings"');
  expect(ui).toContain('"settings.currency"');
  expect(ui).toContain('menuEndpoint');
  expect(ui).toContain('เปิดสิทธิ์เมนูตั้งค่าสกุลเงิน (CUSTOM)');
  expect(ui).toContain('state.unresolved_orders');
  expect(ui).toContain('state.active_sessions');
  expect(ui).toContain('IT Support — อนุมัติได้เมื่อเงื่อนไขครบ');
  expect(ui).toContain('CHANGE ${next}');
  expect(route).toContain('if(!x.can_change||!x.contract)');
 });
 it("keeps the approval-check button clickable and shows the exact blocker beside it", () => {
  expect(ui).toContain('disabled={saving||enabling||loading}');
  expect(ui).not.toContain('disabled={saving||enabling||loading||next===state.currency_code}');
  expect(ui).toContain('data-testid="currency-approval-feedback"');
  expect(ui).toContain('ร้านนี้ใช้สกุลเงิน ${state.currency_code} อยู่แล้ว');
  expect(ui).toContain('ยังอนุมัติไม่ได้ เนื่องจาก: ');
  expect(ui).toContain('กรุณาติ๊กยืนยันและพิมพ์ CHANGE ${next}');
  expect(ui).toContain('aria-live="assertive"');
  expect(route).toContain('if(!x.can_change||!x.contract)');
 });
 it("has a discoverable per-tenant IT control entry", () => {
  expect(menu).toContain('/tenants/${encodeURIComponent(tenantId)}/currency');
  expect(ui).toContain("อนุมัติเปลี่ยนสกุลเงิน");
  expect(ui).toContain("pending_payment_intents");
 });
});
