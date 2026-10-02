import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const layout = src("../../src/app/(it-admin)/layout.tsx");
const shell = src("../../src/components/layout/app-shell.tsx");
const listUi = src("../../src/components/it-admin/cpipos-ai-admin-console.tsx");
const detailUi = src("../../src/components/it-admin/cpipos-ai-tenant-detail.tsx");
const service = src("../../src/lib/services/it-admin/cpipos-ai-admin-service.ts");
const migration = src("../../../../supabase/migrations/20260929224000_pos_ai_usage_quota.sql");
const roomMigration = src("../../../../supabase/migrations/20260930133000_cpipos_ai_chat_rooms_retention.sql");

describe("CpIPOS IT AI control center", () => {
  it("adds CpiPOS AI to IT navigation", () => {
    expect(layout).toContain('cpiposAi: "CpiPOS AI"');
    expect(layout).toContain('href: "/it-admin/cpipos-ai"');
    expect(layout).toContain('icon: "ai"');
    expect(shell).toContain('| "ai"');
  });

  it("lists enabled AI stores and monthly usage cost", () => {
    expect(service).toContain("listCpiposAiStores");
    expect(service).toContain("pos_ai_admin_tenant_usage");
    expect(service).toContain(".filter((row) => row.ai_enabled)");
    expect(listUi).toContain("ร้านค้าที่เปิดใช้งาน CpiPOS AI");
    expect(listUi).toContain("ต้นทุน AI เดือนนี้");
  });

  it("includes approved monthly AI Add-ons in IT effective quota views", () => {
    expect(service).toContain('from("pos_ai_tenant_addon_purchases")');
    expect(service).toContain("quotaWithAddons");
    expect(service).toContain("addonTotals");
    expect(listUi).toContain("Add-on เดือนนี้");
  });

  it("supports package/per-store quota and chat retention", () => {
    expect(migration).toContain("pos_ai_package_quotas");
    expect(migration).toContain("pos_ai_tenant_quota_overrides");
    expect(migration).toContain("monthly_request_limit");
    expect(migration).toContain("monthly_token_limit");
    expect(migration).toContain("monthly_cost_limit_usd");
    expect(roomMigration).toContain("history_retention_days");
    expect(listUi).toContain("AI Quota ต่อแพ็กเกจ / ต่อเดือน");
    expect(listUi).toContain("เก็บประวัติแชท (วัน)");
    expect(detailUi).toContain("AI Quota ของร้านนี้");
    expect(detailUi).toContain("เก็บประวัติแชท (วัน)");
  });

  it("cross-checks Subscription Add-on metadata beside authoritative package quotas", () => {
    expect(service).toContain('select("id,code,name,monthly_price,is_active,status,display_order,metadata")');
    expect(listUi).toContain("Add-on จาก Subscription");
    expect(listUi).toContain("ai_addon_monthly_price");
    expect(listUi).toContain("ai_addon_monthly_requests");
    expect(listUi).toContain("ai_addon_monthly_tokens");
  });

  it("shows chat-room IDs, command usage and daily/monthly/yearly summaries", () => {
    expect(detailUi).toContain("ห้องแชทและ OpenAI Conversation ID");
    expect(detailUi).toContain("Room ID");
    expect(detailUi).toContain("คำสั่งที่ผู้ใช้พิมพ์และ Token ต่อคำขอ");
    expect(detailUi).toContain("สรุปรายวัน");
    expect(detailUi).toContain("สรุปรายเดือน");
    expect(detailUi).toContain("สรุปรายปี");
    expect(service).toContain("prompt_text");
    expect(service).toContain("response_id");
  });

  it("renders provider cost values instead of a literal interpolation string", () => {
    expect(listUi).toContain('return "$" + Number(value ?? 0).toFixed(4);');
    expect(detailUi).toContain('return "$" + Number(value ?? 0).toFixed(6);');
    expect(listUi).not.toContain('return "${Number');
    expect(detailUi).not.toContain('return "${Number');
  });

  it("supports room-scoped or whole-store clearing while retaining usage accounting", () => {
    expect(service).toContain("clearCpiposAiHistory");
    expect(service).toContain('from("pos_ai_chat_rooms")');
    expect(service).toContain("history_cleared_at");
    expect(service).toContain("usage_accounting_retained: true");
    expect(service).toContain("provider_cleanup_failed_count");
    expect(service).toContain("pending_provider_conversation_ids");
    expect(service).toContain("provider_cleanup_status");
    expect(detailUi).toContain("ล้างประวัติทั้งร้าน");
    expect(detailUi).toContain("ลบห้องแชท");
    expect(detailUi).toContain("ล้างข้อมูล CpiPOS แล้ว");
    expect(detailUi).toContain("provider_cleanup_failed_count");
  });

  it("keeps the AI control center compact by moving heavy controls into modals", () => {
    expect(listUi).toContain("ตั้งค่า AI Quota");
    expect(listUi).toContain("quotaOpen");
    expect(listUi).toContain("modalBackdrop");
    expect(detailUi).toContain('setDetailModal("overview")');
    expect(detailUi).toContain('setDetailModal("quota")');
    expect(detailUi).toContain('setDetailModal("usage")');
    expect(detailUi).toContain('setDetailModal("series")');
    expect(detailUi).toContain("ภาพรวม AI");
    expect(detailUi).toContain("AI Quota ร้าน");
    expect(detailUi).toContain("Command Log");
    expect(detailUi).toContain("สรุปการใช้งาน");
    expect(detailUi).toContain("ห้องแชทและ OpenAI Conversation ID");
  });

  it("keeps transcript storage in OpenAI and only room pointers locally", () => {
    expect(roomMigration).toContain("pos_ai_chat_rooms");
    expect(roomMigration).not.toContain("message_text");
    expect(listUi).toContain("OpenAI Conversations");
    expect(detailUi).toContain("OpenAI Conversations");
    expect(service).toContain("deleteOpenAiConversation");
  });
});
