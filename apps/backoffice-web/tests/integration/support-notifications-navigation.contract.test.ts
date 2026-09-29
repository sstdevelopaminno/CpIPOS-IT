import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe,expect,it } from "vitest";
const src=(p:string)=>readFileSync(resolve(process.cwd(),p),"utf8");

describe("IT support notifications and customer request navigation",()=>{
  const layout=src("src/app/(it-admin)/layout.tsx");
  const shell=src("src/components/layout/app-shell.tsx");
  const sw=src("public/sw.js");
  const push=src("src/components/it-admin/support-push-control.tsx");
  const chat=src("src/app/api/it-admin/v1/support-chat/conversations/[conversationId]/route.ts");
  const review=src("src/app/api/it-admin/v1/subscription-payments/review/[requestId]/route.ts");

  it("keeps customer payment requests inside Subscription Payments and preserves badges",()=>{
    expect(layout).not.toContain('href: "/it-admin/requests"');
    expect(layout).toContain('href: "/it-admin/subscription-payments"');
    expect(layout).toContain('supportChat: "แชท"');
    expect(shell).toContain('targetHref === "/it-admin/subscription-payments"');
    expect(shell).toContain("requestUnread");
  });
  it("supports true browser push",()=>{
    expect(sw).toContain('addEventListener("push"');
    expect(sw).toContain('addEventListener("notificationclick"');
    expect(push).toContain("pushManager.subscribe");
  });
  it("pushes chat replies and request status to stores",()=>{
    expect(chat).toContain('audience: "store"');
    expect(chat).toContain('kind: "chat"');
    expect(review).toContain('kind:"request"');
  });
});
