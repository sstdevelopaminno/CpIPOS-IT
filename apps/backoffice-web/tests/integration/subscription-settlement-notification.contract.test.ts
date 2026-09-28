import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe,expect,it } from "vitest";

const route=readFileSync(resolve(process.cwd(),"src/app/api/it-admin/v1/subscription-payments/settle/[requestId]/route.ts"),"utf8");

describe("subscription settlement notification ordering",()=>{
  it("notifies the store before email delivery can add latency",()=>{
    const push=route.indexOf("await dispatchSupportPush");
    const email=route.indexOf("await deliverCustomerEmail");
    expect(push).toBeGreaterThan(-1);
    expect(email).toBeGreaterThan(push);
    expect(route).toContain("Customer runtime is already unlocked atomically");
  });
});
