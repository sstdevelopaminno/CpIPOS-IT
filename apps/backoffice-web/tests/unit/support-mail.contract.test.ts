import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("IT Support Mail integration", () => {
  const bridge = read("../../tools/customer-mail-bridge/Code.gs");
  const service = read("src/lib/services/it-admin/support-mail-service.ts");
  const storeContext = read("src/lib/services/it-admin/support-mail-store-context.ts");
  const api = read("src/app/api/it-admin/v1/support-mail/route.ts");
  const consoleUi = read("src/components/it-admin/support-mail-console.tsx");

  it("pins the operational mailbox to the Support account and keeps secrets server-side", () => {
    expect(service).toContain("cuttingpointtech.support@gmail.com");
    expect(service).toContain("CPIPOS_MAIL_BRIDGE_SECRET");
    expect(service).not.toContain("NEXT_PUBLIC_CPIPOS_MAIL_BRIDGE");
    expect(bridge).toContain("CPIPOS_SUPPORT_MAILBOX");
    expect(bridge).toContain("wrong_mailbox");
  });

  it("supports Gmail-style folders, thread read, reply, send, mark-read and archive", () => {
    for (const action of ["list_threads", "get_thread", "send_new", "reply", "mark_read", "archive", "trash", "trash_many"]) {
      expect(bridge).toContain(action);
    }
    for (const folder of ["all", "inbox", "starred", "sent", "archive"]) {
      expect(bridge).toContain(folder);
      expect(api).toContain(folder);
    }
    expect(bridge).toContain("SUPPORT_MAIL_BRIDGE_VERSION");
    expect(bridge).toContain("2026-10-01.4");
    expect(bridge).toContain("capabilities");
    expect(bridge).toContain("getMessagesForThreads");
    expect(api).toContain("listSupportMailThreads");
    expect(api).toContain("getSupportMailThread");
    expect(api).toContain("replySupportMail");
    expect(api).toContain("sendSupportMail");
    expect(consoleUi).toContain("อีเมล Support");
    expect(consoleUi).toContain("กล่องจดหมาย");
    expect(consoleUi).toContain("ข้อความใหม่");
    expect(consoleUi).toContain("ตอบกลับอีเมล");
    expect(consoleUi).toContain("ลบทั้งหมดในหน้า");
    expect(consoleUi).toContain("ย้ายไปถังขยะ");
    expect(consoleUi).toContain("ร้านที่เกี่ยวข้อง");
    expect(consoleUi).toContain("สร้างเคส IT");
    expect(consoleUi).toContain('code: "SUPPORT_MAIL"');
    expect(api).toContain("resolveSupportMailStoreContext");
    expect(storeContext).toContain("store_registration_requests");
    expect(storeContext).toContain("pos_login_contexts");
    expect(storeContext).toContain("user_branch_roles");
    expect(storeContext).toContain("it_manual_incidents");
    expect(consoleUi).toContain("navCollapsed");
    expect(consoleUi).toContain('label: "ทั้งหมด"');
    expect(consoleUi).toContain("inboxRequestIdRef");
    expect(consoleUi).toContain("bridgeCapabilities");
    expect(consoleUi).toContain("folderSupported");
    expect(consoleUi).toContain("canTrash");
    expect(api).toContain("trashManySupportMail");
    expect(api).toContain("support_mail_bulk_trashed");
  });

  it("requires an authenticated IT role and rate limits read/write operations", () => {
    expect(api).toContain("requireItAdmin()");
    expect(api).toContain("it_support_mail_read");
    expect(api).toContain("it_support_mail_write");
    expect(api).toContain("enforceRateLimit");
  });

  it("keeps background sync resilient and never renders Gmail HTML directly", () => {
    expect(service).toContain("AbortSignal.timeout(25000)");
    expect(service).toContain("support_mail_bridge_timeout");
    expect(consoleUi).toContain("รีเฟรชไม่สำเร็จ");
    expect(consoleUi).toContain("60_000");
    expect(consoleUi).toContain("syncStatus");
    expect(consoleUi).toContain("Do not show a global red banner");
    expect(service).toContain("Gmail Support ทำรายการนี้ไม่สำเร็จชั่วคราว");
    expect(bridge).toContain('folder === "sent"');
    expect(bridge).toContain("threadSummary_(thread, messages");
    expect(bridge).toContain("getPlainBody()");
    expect(consoleUi).not.toContain("dangerouslySetInnerHTML");
  });
});
