import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
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

  it("retains mailbox verification but supports OAuth-constrained Web App execution only after editor attestation", () => {
    expect(bridge).toContain('authorizedSupportExecutor_(mailbox)');
    expect(bridge).toContain('Session.getEffectiveUser().getEmail()');
    expect(bridge).toContain('props.setProperty("CPIPOS_VERIFIED_SUPPORT_MAILBOX", effective)');
    expect(bridge).toContain('props.setProperty("CPIPOS_VERIFIED_SUPPORT_MAILBOX_AT", new Date().toISOString())');
    expect(bridge).toContain('throw new Error("support_mailbox_authorization_required")');
    expect(bridge).toContain('age < 90 * 24 * 60 * 60 * 1000');
    expect(bridge).toContain('if (runtimeEmail) return runtimeEmail');
    expect(bridge).toContain('if (!mailbox || !effective || mailbox !== effective)');
    expect(bridge.indexOf('var expected = PropertiesService.getScriptProperties().getProperty("CPIPOS_MAIL_BRIDGE_SECRET")'))
      .toBeLessThan(bridge.indexOf('var effective = authorizedSupportExecutor_(mailbox)'));
  });

  it("accepts only recent editor-attested Support mailbox when Web App Session OAuth fails", () => {
    const props = new Map<string, string>([
      ["CPIPOS_SUPPORT_MAILBOX", "cuttingpointtech.support@gmail.com"]
    ]);
    let sessionError = false;
    let account = "cuttingpointtech.support@gmail.com";
    const context = {
      PropertiesService: { getScriptProperties: () => ({
        getProperty: (key: string) => props.get(key) ?? null,
        setProperty: (key: string, value: string) => { props.set(key, value); }
      }) },
      Session: { getEffectiveUser: () => {
        if (sessionError) throw new Error("You do not have permission to call Session.getEffectiveUser");
        return { getEmail: () => account };
      } },
      GmailApp: { getAliases: () => [] },
      MailApp: { getRemainingDailyQuota: () => 50 },
      Logger: { log: () => undefined }
    };
    const api = runInNewContext(bridge + "; ({authorizeSupportMailBridge, authorizedSupportExecutor_})", context) as {
      authorizeSupportMailBridge: () => {mailbox: string};
      authorizedSupportExecutor_: (mailbox: string) => string;
    };
    const expected = "cuttingpointtech.support@gmail.com";
    sessionError = true;
    expect(() => api.authorizedSupportExecutor_(expected)).toThrow("support_mailbox_authorization_required");
    sessionError = false;
    expect(api.authorizeSupportMailBridge().mailbox).toBe(expected);
    sessionError = true;
    expect(api.authorizedSupportExecutor_(expected)).toBe(expected);
    props.set("CPIPOS_VERIFIED_SUPPORT_MAILBOX_AT", "2000-01-01T00:00:00.000Z");
    expect(() => api.authorizedSupportExecutor_(expected)).toThrow("support_mailbox_authorization_required");
    sessionError = false;
    account = "cuttingpointtech@gmail.com";
    expect(() => api.authorizeSupportMailBridge()).toThrow("wrong_mailbox");
    expect(api.authorizedSupportExecutor_(expected)).toBe(account);
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
    expect(bridge).toContain("2026-11-20.1");
    expect(bridge).toContain("capabilities");
    expect(bridge).toContain("getMessagesForThreads");
    expect(bridge).toContain("GmailApp.sendEmail(to, subject, textBody");
    expect(bridge).not.toContain("MailApp.sendEmail({");
    expect(bridge).toContain('folder === "sent"');
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
    expect(consoleUi).toContain('setSyncStatus("error")');
    expect(consoleUi).toContain("รีเฟรชไม่สำเร็จ");
    expect(service).toContain("Gmail Support ทำรายการนี้ไม่สำเร็จชั่วคราว");
    expect(bridge).toContain('folder === "sent"');
    expect(bridge).toContain("threadSummary_(thread, messages");
    expect(bridge).toContain("getPlainBody()");
    expect(consoleUi).not.toContain("dangerouslySetInnerHTML");
  });
});
