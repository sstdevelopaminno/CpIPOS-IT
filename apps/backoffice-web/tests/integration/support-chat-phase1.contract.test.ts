import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("Support Chat Phase 1 - IT Control Plane", () => {
  const layout = src("src/app/(it-admin)/layout.tsx");
  const shell = src("src/components/layout/app-shell.tsx");
  const notifier = src("src/components/it-admin/support-chat-notifier.tsx");
  const consoleUi = src("src/components/it-admin/support-chat-console.tsx");
  const service = src("src/lib/support-chat/support-chat-service.ts");
  const detail = src("src/app/api/it-admin/v1/support-chat/conversations/[conversationId]/route.ts");
  const users = src("src/app/api/it-admin/v1/it-users/route.ts");
  const edge = src("../../supabase-communications/functions/support-chat-api/index.ts");
  const phase2 = src("../../supabase-communications/migrations/20260928203000_support_chat_phase2_realtime_media.sql");
  const historyPage = src("src/app/(it-admin)/it-admin/support-chat/history/page.tsx");

  it("exposes Support Chat to both IT Admin and IT Support navigation", () => {
    const matches = layout.match(/href: "\/it-admin\/support-chat"/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
    expect(layout).toContain('icon: "chat"');
    expect(shell).toContain('"chat"');
  });

  it("subscribes to realtime heads without polling", () => {
    expect(notifier).toContain('"postgres_changes"');
    expect(notifier).toContain('table: "support_chat_heads"');
    expect(notifier).toContain("new Notification");
    expect(notifier).not.toContain("setInterval(");
    expect(consoleUi).not.toContain("setInterval(");
  });

  it("adds durable chat notebook navigation and closed-history page", () => {
    expect(layout).toContain("สมุดบันทึกแชท");
    expect(layout).toContain("/it-admin/support-chat/history");
    expect(historyPage).toContain("historyOnly");
    expect(consoleUi).toContain("ประวัติที่จบแล้ว");
    expect(consoleUi).toContain("โน้ตภายใน IT");
  });

  it("supports live typing, private image attachments and immediate cleanup on close", () => {
    expect(consoleUi).toContain('event: "typing"');
    expect(consoleUi).toContain("กำลังพิมพ์");
    expect(consoleUi).toContain('accept="image/jpeg,image/png,image/webp"');
    expect(detail).toContain("attachment: body?.attachment");
    expect(edge).toContain("support_attachments");
    expect(edge).toContain("cleanupAttachments");
    expect(edge).toContain("createSignedUrl");
    expect(phase2).toContain("support-chat-images");
    expect(phase2).toContain("2097152");
  });

  it("adds status controls, IT notes and IT Support-only permanent deletion", () => {
    expect(consoleUi).toContain("กำลังดูแล");
    expect(consoleUi).toContain("รอลูกค้า");
    expect(consoleUi).toContain("รอ IT");
    expect(consoleUi).toContain("ลบถาวร");
    expect(detail).toContain('action === "set_status"');
    expect(detail).toContain('action === "update_note"');
    expect(detail).toContain('action === "delete"');
    expect(detail).toContain('platformRole !== "it_support"');
    expect(edge).toContain('actor.role !== "it_support"');
  });

  it("avoids realtime notification loops and refreshes on focus/network recovery", () => {
    expect(edge).toContain('Number(current.data[field] ?? 0) === 0');
    expect(notifier).toContain('window.addEventListener("focus"');
    expect(notifier).toContain('window.addEventListener("online"');
    expect(notifier).toContain('document.addEventListener("visibilitychange"');
  });

  it("keeps live delivery off the slow unread/list request path", () => {
    expect(notifier).toContain("notifyUpdate(next)");
    expect(notifier).toContain("void loadUnreadTotal()");
    expect(consoleUi).toContain("Optimistic local echo");
    expect(consoleUi).toContain("preview:");
    expect(consoleUi).not.toContain("setMessages(json.data.messages);\n      await loadInbox()");
    expect(edge).toContain("head_changed: headChanged");
    expect(edge).toContain("const sent = { ...inserted.data, attachments: sentAttachments }");
    expect(edge).not.toContain("const hydrated = await messagesWithAttachments(db, conversationId)");
  });

  it("auto-claims an unassigned conversation when IT opens it", () => {
    expect(detail).toContain('!data.conversation.assigned_user_id && data.conversation.status !== "closed"');
    expect(detail).toContain('"claim_conversation"');
    expect(detail).toContain('action: "support_chat_claimed"');
  });

  it("uses the signed cross-project bridge function", () => {
    expect(service).toContain("issue_support_chat_bridge_token");
    expect(service).toContain("support-chat-api");
  });

  it("supports IT profile avatars with system-logo fallback", () => {
    expect(users).toContain("avatar_url");
    expect(consoleUi).toContain("/brand/cpipos-symbol-sidebar.png");
  });
});
