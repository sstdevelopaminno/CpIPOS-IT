import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const consoleUi = src("src/components/it-admin/support-chat-console.tsx");
const notifier = src("src/components/it-admin/support-chat-notifier.tsx");
const pushControl = src("src/components/it-admin/support-push-control.tsx");
const voiceProvider = src("src/components/it-admin/it-support-voice-provider.tsx");
const detailRoute = src("src/app/api/it-admin/v1/support-chat/conversations/[conversationId]/route.ts");

describe("Support Chat mobile avatar, notification reliability and reply latency", () => {
  it("keeps a real CPI brand emblem visible when a staff photo URL fails", () => {
    expect(consoleUi).toContain('bg-[#0f1d2e]');
    expect(consoleUi).toContain('src="/brand/cpipos-symbol-sidebar.png"');
    expect(consoleUi).toContain("safePhotoUrl");
    expect(consoleUi).toContain("absolute inset-0 bg-cover bg-center");
  });

  it("does not re-fetch the inbox solely because a staff member opens another conversation", () => {
    expect(consoleUi).toContain("selectedIdRef.current");
    expect(consoleUi).toContain("}, [historyOnly, clearGoneConversation]);");
    expect(consoleUi).toContain("requestId !== detailRequestRef.current");
    expect(consoleUi).toContain("detailRefreshTimerRef.current");
    expect(consoleUi).toContain("180");
    expect(consoleUi).toContain('["optimistic:it:", "broadcast:", "preview:"]');
  });

  it("acknowledges a durable message without waiting for remote push dispatch", () => {
    expect(detailRoute).toContain('import { after } from "next/server"');
    expect(detailRoute).toContain("await Promise.all([");
    expect(detailRoute).toContain("mirrorSupportChatHead(data.head)");
    expect(detailRoute).toContain("after(async () =>");
    expect(detailRoute).toContain("post-response push dispatch failed");
    expect(detailRoute).toContain('action: "support_chat_message_sent"');
  });

  it("keeps unread state through API failures and avoids simultaneous list refreshes", () => {
    expect(notifier).toContain('throw new Error("support_inbox_snapshot_unavailable")');
    expect(notifier).toContain("if (snapshotInFlight) return");
    expect(notifier).toContain("snapshotInFlight = false");
    expect(notifier).toContain("void ctx.close().catch");
    expect(notifier).toContain("realtimeHealthy");
  });

  it("uses actual subscribed Web Push status instead of only browser notification permission", () => {
    expect(pushControl).toContain("pushManager.subscribe");
    expect(pushControl).toContain('setState("ready")');
    expect(pushControl).toContain('setState("error")');
    expect(pushControl).toContain("errorMessage || label");
    expect(consoleUi).not.toContain("Notification.requestPermission");
  });

  it("does not refresh a voice call for every chat reply or overwrite new call state from stale polling", () => {
    expect(voiceProvider).toContain('if (head?.latest_sender_type !== "system") return');
    expect(voiceProvider).toContain('preview.startsWith("📞")');
    expect(voiceProvider).toContain("refreshEpochRef.current");
    expect(voiceProvider).toContain("controlInFlightRef.current");
  });
});
