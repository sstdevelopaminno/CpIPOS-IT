import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const itUi = read("src/components/it-admin/support-chat-console.tsx");
const lineUi = read("src/components/support/line-support-client.tsx");
const itRoute = read("src/app/api/it-admin/v1/support-chat/conversations/[conversationId]/route.ts");
const lineService = read("src/lib/support-chat/line-support-chat-service.ts");

describe("Support Chat bidirectional low-latency path", () => {
  it("begins LINE bridge authentication and optimistic head publication in parallel", () => {
    expect(lineService).toContain("await Promise.allSettled([");
    expect(lineService).toContain('publishOptimisticSupportChatHead(conversationId, "store", preview)');
    expect(lineService).toContain("issueLineSupportBridge(session)");
    expect(lineService).toContain('bridgeResult.status === "rejected"');
    expect(lineService).toContain("rollbackOptimisticSupportChatHead(optimistic)");
    expect(lineService).toContain("await mirrorSupportChatHead(data.head)");
  });

  it("does not serially await IT audit and head mirror, and keeps Web Push after response", () => {
    expect(itRoute).toContain("await Promise.all([");
    expect(itRoute).toContain("mirrorSupportChatHead(data.head)");
    expect(itRoute).toContain("appendAuditLog({");
    expect(itRoute).toContain('action: "support_chat_message_sent"');
    expect(itRoute).toContain("after(async () =>");
    expect(itRoute).toContain("dispatchSupportPush");
    expect(itRoute).toContain("const bridgePromise = issueItSupportChatBridge(auth)");
  });

  it("shows IT and LINE optimistic messages without waiting for the server", () => {
    expect(itUi).toContain("setMessages((current) => [...current, optimisticMessage])");
    expect(lineUi).toContain("setMessages((current) => [...current, optimistic])");
    expect(itUi).toContain('event: "message_preview"');
    expect(lineUi).toContain('event: "message_preview"');
  });

  it("sends the durable-message confirmation both ways", () => {
    expect(itUi).toContain('event: "message_confirmed"');
    expect(itUi).toContain('actor: "it", client_id: optimisticId, server_id: json.data.message.id');
    expect(itUi).toContain('event.actor !== "store"');
    expect(lineUi).toContain('actor: "store", client_id: clientId, server_id: sent.message.id');
    expect(lineUi).toContain('event.actor !== "it"');
    expect(lineUi).toContain("scheduleRealtimeRefresh(80)");
  });

  it("never discards unconfirmed incoming previews when the history API responds early", () => {
    expect(itUi).toContain('["optimistic:it:", "broadcast:", "preview:"]');
    expect(itUi).toContain("const confirmed = json.data!.messages;");
    expect(itUi).toContain("Math.abs(Date.parse(serverMessage.created_at) - Date.parse(item.created_at)) < 15_000");
    expect(itUi).toContain("detailLoadedIdRef.current");
    expect(itUi).toContain("incomingPreviewTimerRef.current");
    expect(itUi).toContain("1_200");
    expect(itUi).not.toContain('...current.filter((item) => item.id.startsWith("optimistic:it:")');
  });

  it("keeps IT composer usable while a background history refresh is running", () => {
    expect(itUi).toContain("const initialLoad = detailLoadedIdRef.current !== id");
    expect(itUi).toContain('if (initialLoad) {\n      setBusy("conversation");');
    expect(itUi).toContain("if (initialLoad && requestId === detailRequestRef.current");
  });

  it("scrolls to fresh chat replies only when at the latest message", () => {
    expect(itUi).toContain("chatScrollRef");
    expect(itUi).toContain("stickToLatestRef.current");
    expect(itUi).toContain("scroller.scrollTop = scroller.scrollHeight");
    expect(itUi).toContain("element.scrollHeight - element.scrollTop - element.clientHeight < 130");
    expect(lineUi).toContain("shouldAutoScrollRef.current");
  });
});
