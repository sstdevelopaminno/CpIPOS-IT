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
const documentMigration = src("../../../../supabase/migrations/20260930161000_cpipos_ai_document_vault.sql");
const documentUi = src("../../src/components/it-admin/cpipos-ai-documents-admin.tsx");

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

  it("adds AI document storage to IT navigation and package/store policy", () => {
    expect(layout).toContain('aiDocuments: "ไฟล์เอกสาร AI"');
    expect(layout).toContain('href: "/it-admin/ai-documents"');
    expect(documentMigration).toContain("document_storage_mb");
    expect(documentMigration).toContain("document_retention_days");
    expect(documentMigration).toContain("document_max_file_mb");
    expect(documentMigration).toContain("pos_ai_admin_document_usage");
    expect(service).toContain("listCpiposAiDocumentStores");
    expect(service).toContain("document_storage_mb");
    expect(listUi).toContain("พื้นที่เอกสาร AI (MB)");
    expect(detailUi).toContain("เก็บเอกสาร (วัน)");
    expect(documentUi).toContain("ไฟล์เอกสาร CpiPOS AI");
    expect(documentUi).toContain("Private Storage");
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
    expect(detailUi).toContain("ล้างประวัติทั้งร้าน");
    expect(detailUi).toContain("ลบห้องแชท");
  });

  it("keeps transcript storage in OpenAI and only room pointers locally", () => {
    expect(roomMigration).toContain("pos_ai_chat_rooms");
    expect(roomMigration).not.toContain("message_text");
    expect(listUi).toContain("OpenAI Conversations");
    expect(detailUi).toContain("OpenAI Conversations");
    expect(service).toContain("deleteOpenAiConversation");
  });
});
