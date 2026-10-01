import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("IT Support Mail integration", () => {
  const bridge = read("../../tools/customer-mail-bridge/Code.gs");
  const service = read("src/lib/services/it-admin/support-mail-service.ts");
  const api = read("src/app/api/it-admin/v1/support-mail/route.ts");
  const consoleUi = read("src/components/it-admin/support-mail-console.tsx");

  it("pins the operational mailbox to the Support account and keeps secrets server-side", () => {
    expect(service).toContain("cuttingpointtech.support@gmail.com");
    expect(service).toContain("CPIPOS_MAIL_BRIDGE_SECRET");
    expect(service).not.toContain("NEXT_PUBLIC_CPIPOS_MAIL_BRIDGE");
    expect(bridge).toContain("CPIPOS_SUPPORT_MAILBOX");
    expect(bridge).toContain("wrong_mailbox");
  });

  it("supports inbox, thread read, reply, send, mark-read and archive", () => {
    for (const action of ["list_threads", "get_thread", "send_new", "reply", "mark_read", "archive"]) {
      expect(bridge).toContain(action);
    }
    expect(api).toContain("listSupportMailThreads");
    expect(api).toContain("getSupportMailThread");
    expect(api).toContain("replySupportMail");
    expect(api).toContain("sendSupportMail");
    expect(consoleUi).toContain("อีเมล Support");
  });

  it("requires an authenticated IT role and rate limits read/write operations", () => {
    expect(api).toContain("requireItAdmin()");
    expect(api).toContain("it_support_mail_read");
    expect(api).toContain("it_support_mail_write");
    expect(api).toContain("enforceRateLimit");
  });

  it("never renders Gmail HTML bodies directly in the browser", () => {
    expect(bridge).toContain("getPlainBody()");
    expect(consoleUi).not.toContain("dangerouslySetInnerHTML");
  });
});
