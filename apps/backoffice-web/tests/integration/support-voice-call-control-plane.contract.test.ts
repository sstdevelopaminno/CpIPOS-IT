import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("Support voice-call Phase 1 control plane", () => {
  const migration = src("../../supabase-communications/migrations/20261004162000_support_voice_call_control_plane.sql");
  const edge = src("../../supabase-communications/functions/support-chat-api/index.ts");
  const lineRoute = src("src/app/api/support/line/chat/route.ts");
  const itRoute = src("src/app/api/it-admin/v1/support-chat/conversations/[conversationId]/route.ts");
  const lineClient = src("src/components/support/line-support-client.tsx");
  const itConsole = src("src/components/it-admin/support-chat-console.tsx");
  const notifier = src("src/components/it-admin/support-chat-notifier.tsx");

  it("stores call control state only and keeps media out of Supabase", () => {
    expect(migration).toContain("create table if not exists public.support_call_sessions");
    expect(migration).toContain("no audio/media is persisted");
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("revoke all on public.support_call_sessions from public, anon, authenticated");
    expect(migration).not.toContain("recording_url");
    expect(migration).not.toContain("audio_blob");
    expect(migration).not.toContain("media_payload");
  });

  it("prevents duplicate active calls per conversation and active calls per IT account", () => {
    expect(migration).toContain("support_call_sessions_one_active_per_conversation_idx");
    expect(migration).toContain("support_call_sessions_one_active_per_it_idx");
    expect(migration).toContain("where status in ('requested','accepted','connecting','connected')");
  });

  it("supports customer requests, IT invitations, atomic accept, cancel, decline and end", () => {
    for (const action of [
      "request_voice_call",
      "invite_voice_call",
      "accept_voice_call",
      "cancel_voice_call",
      "decline_voice_call",
      "end_voice_call"
    ]) {
      expect(edge).toContain(`action === "${action}"`);
    }
    expect(edge).toContain('eq("status", "requested").is("assigned_it_user_id", null)');
    expect(edge).toContain("call_already_claimed");
    expect(edge).toContain("it_already_in_call");
  });

  it("returns the active call with canonical chat history", () => {
    expect(edge).toContain("active_call: callForActor(activeCall, actor)");
    expect(lineClient).toContain("active_call: VoiceCall | null");
    expect(itConsole).toContain("active_call: VoiceCall | null");
  });

  it("exposes voice control actions through both LINE and IT APIs", () => {
    expect(lineRoute).toContain('"voice_request"');
    expect(lineRoute).toContain('"voice_accept"');
    expect(lineRoute).toContain('"voice_cancel"');
    expect(lineRoute).toContain('"voice_decline"');
    expect(itRoute).toContain('"voice_invite"');
    expect(itRoute).toContain('"voice_accept"');
    expect(itRoute).toContain('"voice_cancel"');
    expect(itRoute).toContain('"voice_end"');
  });

  it("shows call queue controls on both customer and IT surfaces", () => {
    expect(lineClient).toContain("ขอคุยด้วยเสียงกับ Support");
    expect(lineClient).toContain("กำลังรอทีม Support รับคำขอ");
    expect(lineClient).toContain("ฝ่าย Support ขอคุยกับคุณด้วยเสียง");
    expect(itConsole).toContain("เชิญลูกค้าคุยด้วยเสียง");
    expect(itConsole).toContain("ลูกค้าขอคุยด้วยเสียง");
    expect(itConsole).toContain("เจ้าหน้าที่คนแรกที่กดรับ");
  });

  it("alerts IT when a voice request enters the existing realtime inbox", () => {
    expect(notifier).toContain("voiceRequest");
    expect(notifier).toContain("📞 ขอคุยด้วยเสียง");
  });

  it("does not enable microphone or WebRTC media during Phase 1", () => {
    expect(lineClient).not.toContain("getUserMedia");
    expect(lineClient).not.toContain("RTCPeerConnection");
    expect(itConsole).not.toContain("getUserMedia");
    expect(itConsole).not.toContain("RTCPeerConnection");
  });
});
