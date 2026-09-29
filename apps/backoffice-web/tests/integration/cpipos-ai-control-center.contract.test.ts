import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const layout = src("../../src/app/(it-admin)/layout.tsx");
const shell = src("../../src/components/layout/app-shell.tsx");
const listUi = src("../../src/components/it-admin/cpipos-ai-admin-console.tsx");
const detailUi = src("../../src/components/it-admin/cpipos-ai-tenant-detail.tsx");
const service = src("../../src/lib/services/it-admin/cpipos-ai-admin-service.ts");
const migration = src("../../../../supabase/migrations/20260929224000_pos_ai_usage_quota.sql");

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

  it("supports package and per-store quota", () => {
    expect(migration).toContain("pos_ai_package_quotas");
    expect(migration).toContain("pos_ai_tenant_quota_overrides");
    expect(migration).toContain("monthly_request_limit");
    expect(migration).toContain("monthly_token_limit");
    expect(migration).toContain("monthly_cost_limit_usd");
    expect(listUi).toContain("AI Quota ต่อแพ็กเกจ / ต่อเดือน");
    expect(detailUi).toContain("AI Quota ของร้านนี้");
  });

  it("shows IDs, command usage and daily/monthly/yearly summaries", () => {
    expect(detailUi).toContain("OpenAI Conversation ID");
    expect(detailUi).toContain("User ID");
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

  it("supports scoped history clearing while retaining usage accounting", () => {
    expect(service).toContain("clearCpiposAiHistory");
    expect(service).toContain("history_cleared_at");
    expect(service).toContain("usage_accounting_retained: true");
    expect(detailUi).toContain("ล้างประวัติทั้งร้าน");
  });
});
