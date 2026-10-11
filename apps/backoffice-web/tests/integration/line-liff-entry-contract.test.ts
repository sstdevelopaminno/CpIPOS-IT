import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("LINE OA Support / Payment LIFF entry contract", () => {
  const support = read("src/components/support/line-support-client.tsx");
  const payment = read("src/components/support/line-payment-client.tsx");
  const auth = read("src/lib/support-chat/line-support-auth.ts");
  const guide = read("../../docs/LINE-OA-SUPPORT-PAYMENT-PRODUCTION-2026-10-11.md");

  it("keeps the chat LIFF and LINE token verification on the same production channel", () => {
    expect(support).toContain('DEFAULT_LIFF_ID = "2011852850-5tjQo09l"');
    expect(auth).toContain('DEFAULT_LINE_LOGIN_CHANNEL_ID = "2011852850"');
    expect(auth).toContain("verifyLineIdToken");
    expect(support).toContain('window.liff.init({ liffId })');
  });

  it("can navigate to Payment via /payment under a shared LIFF entry", () => {
    expect(support).toContain('process.env.NEXT_PUBLIC_LINE_PAYMENT_LIFF_ID');
    expect(support).toContain('`https://liff.line.me/${liffId}/payment`');
    expect(support).toContain("href={paymentLiffUrl}");
    expect(payment).toContain("process.env.NEXT_PUBLIC_LINE_LIFF_ID || DEFAULT_LIFF_ID");
    expect(payment).toContain('window.liff.init({ liffId })');
    expect(guide).toContain("https://liff.line.me/2011852850-5tjQo09l/payment");
    expect(guide).toContain("https://cp-ipos-it-web.vercel.app/support/line/payment");
  });

  it("supports distinct Payment LIFF apps without changing existing shared-channel behavior", () => {
    expect(payment).toContain("process.env.NEXT_PUBLIC_LINE_PAYMENT_LIFF_ID || process.env.NEXT_PUBLIC_LINE_LIFF_ID || DEFAULT_LIFF_ID");
    expect(support).toContain('process.env.NEXT_PUBLIC_LINE_PAYMENT_LIFF_ID');
    expect(guide).toContain("NEXT_PUBLIC_LINE_PAYMENT_LIFF_ID");
  });

  it("documents that LINE 400 Developing must be fixed in the LINE console rather than bypassed", () => {
    expect(guide).toContain("Developing");
    expect(guide).toContain("Published");
    expect(guide).toContain("openid");
  });
});
