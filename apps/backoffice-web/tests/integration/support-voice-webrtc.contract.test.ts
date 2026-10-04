import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("Support voice WebRTC Phase 2", () => {
  const migration = src("../../supabase-communications/migrations/20261004171000_support_webrtc_signaling_key.sql");
  const edge = src("../../supabase-communications/functions/support-chat-api/index.ts");
  const hook = src("src/components/support/use-support-voice-call.ts");
  const lineRoute = src("src/app/api/support/line/chat/route.ts");
  const itRoute = src("src/app/api/it-admin/v1/support-chat/conversations/[conversationId]/route.ts");
  const lineClient = src("src/components/support/line-support-client.tsx");
  const itConsole = src("src/components/it-admin/support-chat-console.tsx");

  it("stores only a high-entropy signaling room key and no media payload", () => {
    expect(migration).toContain("signaling_key text");
    expect(migration).toContain("char_length(signaling_key) >= 48");
    expect(migration).toContain("support_call_sessions_signaling_key_idx");
    expect(migration).not.toContain("sdp_offer");
    expect(migration).not.toContain("ice_candidate");
    expect(migration).not.toContain("recording_url");
    expect(migration).not.toContain("audio_blob");
  });

  it("creates the signaling key only when a call is accepted", () => {
    expect(edge).toContain("function newSignalingKey()");
    expect(edge).toContain("signaling_key: newSignalingKey()");
    expect(edge).toContain("delete safe.signaling_key");
    expect(edge).toContain('row.assigned_it_user_id === actor.uid');
  });

  it("provides STUN and optional TURN credentials without exposing the shared secret", () => {
    expect(edge).toContain("stun:stun.cloudflare.com:3478");
    expect(edge).toContain("stun:stun.l.google.com:19302");
    expect(edge).toContain('Deno.env.get("SUPPORT_TURN_SHARED_SECRET")');
    expect(edge).toContain('action === "get_voice_ice_config"');
    expect(edge).toContain("turnCredential");
  });

  it("uses peer-to-peer WebRTC audio and ephemeral Realtime Broadcast signaling", () => {
    expect(hook).toContain("navigator.mediaDevices.getUserMedia");
    expect(hook).toContain("new RTCPeerConnection");
    expect(hook).toContain('"webrtc_offer"');
    expect(hook).toContain('"webrtc_answer"');
    expect(hook).toContain('"webrtc_ice"');
    expect(hook).toContain('"voice_hangup"');
    expect(hook).toContain("support-voice:");
    expect(hook).not.toContain("MediaRecorder");
    expect(hook).not.toContain("recording");
  });

  it("requires a local user action before opening the microphone on both surfaces", () => {
    expect(lineClient).toContain("เริ่มคุยด้วยเสียง");
    expect(lineClient).toContain("voice.start()");
    expect(itConsole).toContain("เริ่มเสียง");
    expect(itConsole).toContain("voice.start()");
  });

  it("supports mute, speaker mute, duration and hangup controls", () => {
    expect(lineClient).toContain("voice.toggleMic");
    expect(lineClient).toContain("voice.toggleSpeaker");
    expect(lineClient).toContain("formatVoiceDuration");
    expect(itConsole).toContain("voice.toggleMic");
    expect(itConsole).toContain("voice.toggleSpeaker");
    expect(itConsole).toContain("endVoiceCall()");
  });

  it("exposes ICE and media-state endpoints to both LINE and IT", () => {
    expect(lineRoute).toContain('action === "voice_ice"');
    expect(lineRoute).toContain('action === "voice_state"');
    expect(itRoute).toContain('action === "voice_ice"');
    expect(itRoute).toContain('action === "voice_state"');
    expect(edge).toContain('action === "update_voice_call_state"');
  });
});
