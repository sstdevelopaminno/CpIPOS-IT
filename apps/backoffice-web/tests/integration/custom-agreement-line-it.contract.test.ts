import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {describe,expect,it} from "vitest";
const src=(p:string)=>readFileSync(resolve(process.cwd(),"src",p),"utf8");
const line=src("app/api/support/line/payment/custom-agreement/route.ts");
const lineUi=src("components/support/line-payment-client.tsx");
const consent=src("components/support/custom-agreement-acceptance.tsx");
const itRoute=src("app/api/it-admin/v1/subscription-payments/custom-agreements/[tenantId]/route.ts");
const itUi=src("components/it-admin/custom-agreement-history.tsx");
const settle=src("app/api/it-admin/v1/subscription-payments/settle/[requestId]/route.ts");
const doc=src("lib/printing/custom-agreement-document.ts");
describe("CUSTOM agreement LINE and IT source contract",()=>{
  it("uses verified LINE owner binding and the shared acceptance RPC",()=>{
    expect(line).toContain("requireLineSupportSession()");
    expect(line).toContain('p_tenant_id:session.tenantId');
    expect(line).toContain('p_actor_user_id:binding.data.verified_owner_user_id');
    expect(line).toContain('p_line_binding_id:session.bindingId');
    expect(line).toContain('p_channel:"line"');
    expect(line).toContain("custom_agreement_quote_or_accept");
    expect(line).toContain("CUSTOM_AGREEMENT_APPROVED_VERSION");
    expect(lineUi).toContain("<CustomAgreementAcceptance");
    expect(consent).toContain("snapshot:evidence.snapshot");
  });
  it("keeps IT access scoped and settlement separate from consent",()=>{
    expect(itRoute).toContain("requireItAdmin()");
    expect(itRoute).toContain('.eq("tenant_id",tenantId)');
    expect(itRoute).toContain("tenant_custom_agreement_activations");
    expect(itUi).toContain("row.activation.settlement_id");
    expect(settle).toContain('rpc("settle_subscription_payment"');
    expect(settle).not.toContain("tenant_custom_agreement_activations");
  });
  it("uses immutable signature, receipt reference and private document scope",()=>{
    expect(doc).toContain('createHash("sha256")');
    expect(doc).toContain('s.signature_sha256');
    expect(doc).toContain('.eq("tenant_id",tenantId)');
    expect(doc).toContain("tenant_subscription_receipt_annotations");
    expect(doc).toContain("private, no-store");
  });
});


describe("CUSTOM agreement v2 retention lifecycle",()=>{
  it("matches the existing paid grace and manual IT review policy",()=>{
    expect(line).toContain('CUSTOM-TH-2026-11-v2');
    expect(line).toContain('ระยะผ่อนผัน 2 เดือนปฏิทิน');
    expect(line).toContain('เก็บรักษาข้อมูลเพิ่มเติมอีก 30 วัน');
    expect(line).toContain('ฝ่าย IT ตรวจสอบก่อนดำเนินการ');
    expect(line).toContain('ไม่ถือว่าเป็นการลบข้อมูลอัตโนมัติทันที');
  });
});
