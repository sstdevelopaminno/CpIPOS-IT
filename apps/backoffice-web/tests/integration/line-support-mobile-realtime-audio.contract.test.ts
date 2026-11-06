import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const line = src("src/components/support/line-support-client.tsx");
const itConsole = src("src/components/it-admin/support-chat-console.tsx");
const waiting = src("src/components/support/use-support-voice-waiting-media.ts");
const hook = src("src/components/support/use-support-voice-call.ts");
const overlay = src("src/components/support/support-voice-call-overlay.tsx");
const lineRoute = src("src/app/api/support/line/chat/route.ts");

describe("LINE customer support full-screen mobile, immediate replies and waiting audio", () => {
  it("fills the LINE WebView viewport without a floating mobile-width card", () => {
    expect(line).toContain('h-[100dvh] min-h-0 w-full overflow-hidden');
    expect(line).toContain('max-w-none flex-col overflow-hidden border-0 bg-white shadow-none');
    expect(line).toContain('md:max-w-xl md:rounded-[28px]');
    expect(line).toContain('sticky bottom-0 z-20 shrink-0');
    expect(line).toContain('pb-[env(safe-area-inset-bottom)]');
    expect(line).not.toContain('h-[calc(100dvh-2.5rem)]');
  });

  it("accepts IT message previews and voice updates immediately with a fallback poll", () => {
    expect(line).toContain('event: "message_preview"');
    expect(line).toContain('event: "message_retract"');
    expect(line).toContain('event: "voice_update"');
    expect(line).toContain('event.actor !== "it"');
    expect(line).toContain('broadcast:it:');
    expect(line).toContain("scheduleRealtimeRefresh(650)");
    expect(line).toContain("scheduleRealtimeRefresh(200)");
    expect(line).toContain("6_000");
    expect(itConsole).toContain('event: "voice_update"');
  });

  it("keeps customer outgoing messages visible, and does not apply stale server refreshes", () => {
    expect(line).toContain("detailEpochRef.current");
    expect(line).toContain("activeConversationIdRef.current");
    expect(line).toContain('item.id.startsWith("line-local:")');
    expect(line).toContain('item.id.startsWith("broadcast:it:")');
    expect(line).toContain('payload: { actor: "store", client_id: clientId, message,');
    expect(line).toContain('event: "message_retract"');
    expect(line).toContain("if (stopped || activeConversationIdRef.current !== conversationId) return");
    expect(line).toContain('role="status" aria-live="polite"');
  });

  it("avoids repeatedly smooth-scrolling away from older customer messages", () => {
    expect(line).toContain("shouldAutoScrollRef.current");
    expect(line).toContain('behavior: "auto"');
    expect(line).toContain("element.scrollHeight - element.scrollTop - element.clientHeight < 130");
  });

  it("announces the initial customer waiting call and improves music audibility", () => {
    expect(line).toContain("startWaitingMedia(null)");
    expect(waiting).toContain("ยินดีต้อนรับสู่ CpiPOS Support");
    expect(waiting).toContain("กรุณารอสักครู่");
    expect(waiting).toContain("envelope * 0.11");
    expect(waiting).toContain("utterance.volume = 1");
    expect(waiting).toContain("utterance.onstart");
    expect(waiting).toContain("utterance.onend");
    expect(waiting).toContain("SpeechSynthesisUtterance");
  });

  it("notifies IT devices of saved LINE replies and customer voice requests without slowing the API response", () => {
    expect(lineRoute).toContain('import { after } from "next/server"');
    expect(lineRoute).toContain("await sendLineSupportMessage(session, conversationId, message)");
    expect(lineRoute).toContain('audience: "it"');
    expect(lineRoute).toContain('kind: "chat"');
    expect(lineRoute).toContain('title: "📞 ลูกค้าขอคุยด้วยเสียง"');
    expect(lineRoute).toContain("after(async () =>");
    expect(lineRoute).toContain('return ok(sent)');
  });

  it("restores audio on LINE webviews that suppress auto-play, including during transfer hold", () => {
    expect(hook).toContain("heldAnnouncedRef.current");
    expect(hook).toContain("replayHoldAudio");
    expect(hook).toContain('side === "store"');
    expect(hook).toContain('context.state === "suspended"');
    expect(overlay).toContain("เปิดเสียงและฟังข้อความรอสาย");
    expect(overlay).toContain("เปิดเสียงและฟังข้อความพักสาย");
    expect(line).toContain("onReplayWaitingAudio");
    expect(line).toContain("onReplayHoldAudio");
  });
});
