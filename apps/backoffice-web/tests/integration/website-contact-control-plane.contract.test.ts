import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
const src=(p:string)=>readFileSync(resolve(process.cwd(),p),"utf8");
describe("website contact communications control plane",()=>{
  const layout=src("src/app/(it-admin)/layout.tsx");
  const route=src("src/app/api/it-admin/v1/other-contacts/route.ts");
  const service=src("src/lib/services/it-admin/website-contact-service.ts");
  const ui=src("src/components/it-admin/other-contacts-console.tsx");
  const fn=src("../../supabase-communications/functions/website-contact-api/index.ts");
  it("adds Other Contacts as a first-class IT menu",()=>{
    expect(layout).toContain('otherContacts: "การติดต่ออื่นๆ"');
    expect(layout).toContain('href: "/it-admin/other-contacts"');
  });
  it("keeps website enquiries in CpiPOS-Communications rather than CpiPOS-001",()=>{
    expect(service).toContain("wznixoeezgyhtwurcswb.supabase.co");
    expect(service).toContain("website-contact-api");
    expect(route).toContain("getVerifiedSupabaseAccessToken");
    expect(fn).toContain('from("website_contact_requests")');
  });
  it("allows IT to edit notes contact data statuses and delete records",()=>{
    expect(ui).toContain("เปิด / แก้ไข");
    expect(ui).toContain("หมายเหตุภายใน IT");
    expect(ui).toContain("บันทึกการแก้ไข");
    expect(fn).toContain('action === "update"');
    expect(fn).toContain('action === "delete"');
  });
});