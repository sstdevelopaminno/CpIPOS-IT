import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src=(p:string)=>readFileSync(resolve(process.cwd(),p),"utf8");

describe("IT dashboard communications database plane",()=>{
  const service=src("src/lib/services/it-admin/dashboard-overview-service.ts");
  const dashboard=src("src/components/it-admin/it-admin-dashboard.tsx");

  it("keeps the communications database plane active regardless of legacy deployment flags",()=>{
    expect(service).toContain('DEFAULT_COMMUNICATIONS_URL = "https://wznixoeezgyhtwurcswb.supabase.co"');
    expect(service).toContain("const operationalPlaneEnabled = true");
    expect(service).toContain("DEFAULT_COMMUNICATIONS_PUBLISHABLE_KEY");
    expect(service).not.toContain("IT_DASHBOARD_OPERATIONAL_PLANE_ENABLED");
  });

  it("keeps POS devices and incidents authoritative in CpiPOS-001",()=>{
    expect(service).toContain("const devicePayload = primaryPayload?.devices");
    expect(service).toContain("const operationPayload = primaryPayload?.operations");
  });

  it("renders CpiPOS-Communications as the second active database instead of reserved capacity",()=>{
    expect(dashboard).toContain('operationalDb: "CpiPOS-Communications"');
    expect(dashboard).toContain('operationalPlane: "CpiPOS-Communications API"');
    expect(dashboard).toContain("${text.businessDb} · ${text.operationalDb}");
  });
});
