import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("IT Support Chat mobile room opening and recovery", () => {
  const ui = source("src/components/it-admin/support-chat-console.tsx");
  const shell = source("src/components/layout/app-shell.tsx");
  const shellCss = source("src/components/layout/app-shell.module.css");
  const detailApi = source("src/app/api/it-admin/v1/support-chat/conversations/[conversationId]/route.ts");

  it("uses the actual flex workspace height and limits compact shell styling to chat routes", () => {
    expect(ui).toContain("data-support-chat-console");
    expect(ui).toContain('className="flex h-full min-h-0 min-w-0 w-full flex-col');
    expect(shell).toContain('pathname === "/it-admin/support-chat"');
    expect(shell).toContain('pathname === "/it-admin/support-chat/history"');
    expect(shell).toContain("styles.topbarChatMobile");
    expect(shell).toContain("styles.contentChatMobile");
    expect(shellCss).toContain("@media (max-width: 720px)");
    expect(shellCss).toContain(".topbarChatMobile");
    expect(shellCss).toContain(".contentChatMobile");
    expect(shellCss).toContain("overflow: hidden !important");
    expect(shellCss).toContain(".contentChatMobile > main[data-support-chat-console]");
  });

  it("makes stalled or failed initial loads recoverable without blanking the chat forever", () => {
    expect(ui).toContain("signal: AbortSignal.timeout(20_000)");
    expect(ui).toContain("setDetailLoading(true)");
    expect(ui).toContain("setDetailLoading(false)");
    expect(ui).toContain("setDetailError(");
    expect(ui).toContain('role="alert"');
    expect(ui).toContain('aria-busy={Boolean(selectedId && detailLoading)}');
    expect(ui).toContain("ลองเปิดห้องสนทนาอีกครั้ง");
    expect(ui).toContain("void loadConversation(selectedId)");
    expect(ui).toContain("detailRequestRef.current += 1");
  });

  it("tapping the same row again retries and switching rooms invalidates stale responses", () => {
    expect(ui).toContain("function openSelectedConversation(id: string)");
    expect(ui).toContain("if (selectedId === id) void loadConversation(id)");
    expect(ui).toContain("selectedIdRef.current = id");
    expect(ui).toContain("setMobilePane(\"conversation\")");
    expect(ui).toContain("onClick={() => openSelectedConversation(row.conversation_id)}");
    expect(ui).toContain("requestId !== detailRequestRef.current");
  });

  it("keeps the transcript, voice controls and composer instead of routing errors to a blank panel", () => {
    expect(ui).toContain('placeholder="พิมพ์ข้อความถึงร้านค้า..."');
    expect(ui).toContain("sticky bottom-0 z-20 shrink-0");
    expect(ui).toContain("overflow-y-auto overscroll-contain");
    expect(ui).toContain('aria-label="กลับรายการแชท"');
    expect(ui).toContain('performVoiceAction("voice_invite")');
  });

  it("does not fail the read request solely because notification mirroring or audit logging stalls", () => {
    expect(detailApi).toContain("auto_claim: true");
    expect(detailApi).toContain("mark_read: true");
    expect(detailApi).toContain("after(async () => {");
    expect(detailApi).toContain("Promise.allSettled(jobs)");
    expect(detailApi).not.toContain("await mirrorSupportChatHead(data.head)");
    expect(detailApi).toContain('action: "support_chat_claimed"');
    expect(detailApi).toContain("return ok({ conversation: data.conversation, messages: data.messages");
  });
});
