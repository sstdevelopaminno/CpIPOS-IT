import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("Support voice burst queue", () => {
  const edge = src("../../supabase-communications/functions/support-chat-api/index.ts");
  const provider = src("src/components/it-admin/it-support-voice-provider.tsx");
  const lineClient = src("src/components/support/line-support-client.tsx");
  const lineRoute = src("src/app/api/support/line/chat/route.ts");
  const lineService = src("src/lib/support-chat/line-support-chat-service.ts");
  const waitingMedia = src("src/components/support/use-support-voice-waiting-media.ts");
  const overlay = src("src/components/support/support-voice-call-overlay.tsx");

  it("keeps waiting callers out of media signaling until an agent accepts", () => {
    expect(edge).toContain('status: "requested"');
    expect(edge).toContain('"get_voice_queue_status"');
    expect(edge).toContain("voiceQueueSnapshot");
    expect(edge).toContain("CONNECTED_CALL_STATUSES");
    const requestBlock = edge.slice(
      edge.indexOf('action === "request_voice_call"'),
      edge.indexOf('action === "invite_voice_call"')
    );
    expect(requestBlock).not.toContain("signaling_key: newSignalingKey()");
    expect(edge).toContain('action === "accept_voice_call"');
  });

  it("uses a renewable waiting-call lease to remove ghost callers", () => {
    expect(edge).toContain("WAITING_CALL_LEASE_MS");
    expect(edge).toContain("expireStaleWaitingCalls");
    expect(edge).toContain('end_reason: "waiting_client_timeout"');
    expect(edge).toContain('.lt("updated_at", waitingCallCutoffIso())');
    expect(edge).toContain('activeCall.status === "requested"');
    const requestBlock = edge.slice(
      edge.indexOf('action === "request_voice_call"'),
      edge.indexOf('action === "get_voice_queue_status"')
    );
    expect(requestBlock).toContain("await expireStaleWaitingCalls(db)");
    expect(requestBlock.indexOf("await expireStaleWaitingCalls(db)")).toBeLessThan(
      requestBlock.indexOf("activeCallForConversation")
    );
  });

  it("returns FIFO queue position without counting stale waiting calls", () => {
    expect(edge).toContain('.order("requested_at", { ascending: true })');
    expect(edge).toContain('.lte("requested_at", requestedAt)');
    expect(edge).toContain('.gte("updated_at", freshSince)');
    expect(edge).toContain("ahead_count");
    expect(edge).toContain("waiting_count");
    expect(edge).toContain("active_calls");
    expect(edge).toContain("queue: await voiceQueueSnapshot(db, row)");
  });

  it("shows queue backlog to the agent receiving the oldest call", () => {
    expect(provider).toContain("VoiceQueueSnapshot");
    expect(provider).toContain("คิวรอทั้งหมด");
    expect(provider).toContain("queue?.waiting_count");
  });

  it("gives LINE callers the same lightweight spoken queue without full-history polling", () => {
    expect(lineRoute).toContain('"voice_queue"');
    expect(lineRoute).toContain("getLineSupportVoiceQueueStatus");
    expect(lineService).toContain('"get_voice_queue_status"');
    expect(lineService).toContain("voice_queue");
    expect(lineClient).toContain("isStoreVoiceWaiting(activeCall)");
    expect(lineClient).toContain('"voice_queue"');
    expect(lineClient).toContain("12_000 + Math.floor(Math.random() * 8_000)");
    expect(lineClient).toContain("2 ** Math.min(failures, 2)");
    expect(lineClient).toContain("startWaitingMedia(null)");
    expect(waitingMedia).toContain("SpeechSynthesisUtterance");
    expect(waitingMedia).toContain("source.loop = true");
    expect(overlay).toContain("กำลังรอคิว Support");
  });

  it("recovers an IT accept race by fetching the next queued caller immediately", () => {
    expect(provider).toContain('action === "voice_accept" || action === "voice_transfer_accept"');
    expect(provider).toContain("window.setTimeout(() => void refresh(), 150)");
  });

  it("jitters idle IT polling to avoid a synchronized thundering herd", () => {
    expect(provider).toContain("Math.random()");
    expect(provider).toContain("9_000");
    expect(provider).toContain("4_500");
    expect(provider).toContain("window.setTimeout");
    expect(provider).not.toContain("fastTransferRefresh ? 2_500 : 30_000");
  });
});
