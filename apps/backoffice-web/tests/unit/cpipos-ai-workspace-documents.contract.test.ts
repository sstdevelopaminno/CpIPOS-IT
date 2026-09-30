import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("IT CpiPOS AI document storage control", () => {
  const navigation = src("src/app/(it-admin)/layout.tsx");
  const policy = src("src/lib/pos-menu-policy.ts");
  const effective = src("src/lib/pos-menu-effective-state.ts");
  const legacy = src("src/lib/pos-menu-visibility.ts");
  const service = src("src/lib/services/it-admin/cpipos-ai-document-admin-service.ts");
  const consoleUi = src("src/components/it-admin/cpipos-ai-document-admin-console.tsx");
  const migration = src("../../supabase/migrations/20260930143000_cpipos_ai_document_vault.sql");

  it("exposes document storage controls to IT and POS menu policy", () => {
    expect(navigation).toContain('href: "/it-admin/cpipos-ai/documents"');
    expect(policy).toContain('"more.ai_documents"');
    expect(effective).toContain('"more.ai_documents": "cpipos_ai"');
    expect(legacy).toContain('key: "ai_documents"');
    expect(legacy).toContain('label: "CpiPOS AI"');
  });

  it("lets IT set package storage/retention and clear tenant objects with audit", () => {
    expect(consoleUi).toContain("พื้นที่และอายุไฟล์ตามแพ็กเกจ");
    expect(consoleUi).toContain("เก็บไฟล์ (วัน)");
    expect(consoleUi).toContain("พื้นที่ (MB)");
    expect(consoleUi).toContain("จำนวนไฟล์สูงสุด");
    expect(service).toContain("updateCpiposAiDocumentPackagePolicy");
    expect(service).toContain("clearCpiposAiDocumentsForTenant");
    expect(service).toContain("it_ai_document_package_policy_changed");
    expect(service).toContain("it_ai_documents_cleared");
    expect(service).toContain(".storage.from(BUCKET).remove");
  });

  it("keeps document content outside PostgreSQL and provides bounded usage aggregation", () => {
    expect(migration).toContain("Metadata only");
    expect(migration).not.toContain("content text");
    expect(migration).toContain("pos_ai_document_admin_usage");
    expect(migration).toContain("grant execute on function public.pos_ai_document_admin_usage() to service_role");
    expect(migration).toContain("file_size_limit");
  });
});
