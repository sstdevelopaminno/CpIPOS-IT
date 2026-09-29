import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe,expect,it } from "vitest";
const src=(p:string)=>readFileSync(resolve(process.cwd(),p),"utf8");

describe("IT operations workspace cleanup",()=>{
  const layout=src("src/app/(it-admin)/layout.tsx");
  const shell=src("src/components/layout/app-shell.tsx");
  const dashboard=src("src/lib/services/it-admin/dashboard-overview-service.ts");
  const incidents=src("src/app/api/it-admin/v1/incidents/route.ts");
  const monitoring=src("src/components/it-admin/it-admin-monitoring-console.tsx");
  const audit=src("src/components/it-admin/it-admin-audit-console.tsx");
  const modules=src("src/lib/services/it-admin/control-plane-module-service.ts");

  it("removes the duplicate customer requests navigation and moves its badge to payments",()=>{
    expect(layout).not.toContain('href: "/it-admin/requests"');
    expect(shell).toContain('targetHref === "/it-admin/subscription-payments"');
  });

  it("pins the second dashboard database to CpiPOS-Communications",()=>{
    expect(dashboard).toContain("const operationalUrl = DEFAULT_COMMUNICATIONS_URL");
    expect(dashboard).not.toContain('readEnv("IT_SUPABASE_URL")');
  });

  it("keeps incidents on the primary authority and provides managed CRUD",()=>{
    expect(modules).toContain("const OPERATIONAL_MODULES = new Set<ItAdminModule>();");
    expect(incidents).toContain('from("it_manual_incidents")');
    expect(incidents).toContain('from("pos_device_incidents")');
    expect(incidents).toContain("export async function DELETE");
  });

  it("provides localized operational search and immutable audit review",()=>{
    expect(monitoring).toContain("ค้นหาร้านหรือสาขา");
    expect(audit).toContain("ไม่อนุญาตให้แก้ไขหรือลบย้อนหลัง");
  });
});
