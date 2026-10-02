import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
const src=(p:string)=>readFileSync(resolve(process.cwd(),p),"utf8");

describe("IT CpiPOS AI add-on commerce",()=>{
  const packageUi=src("src/components/it-admin/package-catalog-manager.tsx");
  const paymentsApi=src("src/app/api/it-admin/v1/subscription-payments/route.ts");
  const paymentsUi=src("src/components/it-admin/subscription-payments-console.tsx");
  const settle=src("src/app/api/it-admin/v1/subscription-payments/settle/[requestId]/route.ts");

  it("lets IT configure AI add-on price requests and tokens",()=>{
    expect(packageUi).toContain("เปิดขาย AI Add-on");
    expect(packageUi).toContain("ai_addon_monthly_price");
    expect(packageUi).toContain("ai_addon_monthly_requests");
    expect(packageUi).toContain("ai_addon_monthly_tokens");
  });

  it("shows AI add-on payment requests distinctly",()=>{
    expect(paymentsApi).toContain('"ai_addon_payment"');
    expect(paymentsUi).toContain("CpiPOS AI Add-on");
  });

  it("settles AI top-ups without invoking subscription settlement",()=>{
    expect(settle).toContain('metadata?.kind === "ai_addon_payment"');
    expect(settle).toContain('rpc("settle_ai_addon_payment"');
    expect(settle).toContain('targetTable: "pos_ai_tenant_addon_purchases"');
    expect(settle).toContain("CpiPOS AI Add-on พร้อมใช้งานแล้ว");
  });
});
