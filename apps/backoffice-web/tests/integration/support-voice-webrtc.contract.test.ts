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
  const itVoiceProvider = src("src/components/it-admin/it-support-voice-provider.tsx");
  const voiceOverlay = src("src/components/support/support-voice-call-overlay.tsx");
  const itLayout = src("src/app/(it-admin)/layout.tsx");
  const activeCallRoute = src("src/app/api/it-admin/v1/support-chat/active-call/route.ts");
  const nextConfig = src("next.config.ts");


  it("allows same-origin microphone access in the browser security policy", () => {
    expect(nextConfig).toContain('microphone=(self)');
    expect(nextConfig).not.toContain('microphone=()');
  });

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
    expect(edge).toContain("ensureCallSignalingKey");
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
    expect(itVoiceProvider).toContain("onStart={() => void voice.start()}");
    expect(voiceOverlay).toContain("เปิดไมค์");
  });

  it("supports mute, speaker mute, duration and hangup controls", () => {
    expect(lineClient).toContain("voice.toggleMic");
    expect(lineClient).toContain("voice.toggleSpeaker");
    expect(lineClient).toContain("formatVoiceDuration");
    expect(itVoiceProvider).toContain("voice.toggleMic");
    expect(itVoiceProvider).toContain("voice.toggleSpeaker");
    expect(itVoiceProvider).toContain("voice.endLocal()");
  });

  it("keeps the IT voice session mounted across backoffice navigation and allows minimization", () => {
    expect(itLayout).toContain("<ItSupportVoiceProvider>");
    expect(activeCallRoute).toContain('"get_it_voice_call"');
    expect(edge).toContain('action === "get_it_voice_call"');
    expect(itVoiceProvider).toContain('window.setInterval');
    expect(itVoiceProvider).toContain('allowMinimize={mode === "active"}');
    expect(voiceOverlay).toContain("ย่อหน้าสาย");
    expect(voiceOverlay).toContain("สายยังเชื่อมต่ออยู่ สามารถเปิดเมนูอื่นในระบบ IT ได้");
    expect(itConsole).toContain("สามารถย่อหน้าสายแล้วเปิดเมนูอื่นเพื่อตรวจสอบระบบได้");
  });

  it("exposes ICE and media-state endpoints to both LINE and IT", () => {
    expect(lineRoute).toContain('action === "voice_ice"');
    expect(lineRoute).toContain('action === "voice_state"');
    expect(itRoute).toContain('action === "voice_ice"');
    expect(itRoute).toContain('action === "voice_state"');
    expect(edge).toContain('action === "update_voice_call_state"');
  });
});
