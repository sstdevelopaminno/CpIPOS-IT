import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("Support voice warm transfer and resilience", () => {
  const migration = src("../../supabase-communications/migrations/20261022203000_support_voice_warm_transfer.sql");
  const edge = src("../../supabase-communications/functions/support-chat-api/index.ts");
  const itRoute = src("src/app/api/it-admin/v1/support-chat/conversations/[conversationId]/route.ts");
  const targetsRoute = src("src/app/api/it-admin/v1/support-chat/transfer-targets/route.ts");
  const provider = src("src/components/it-admin/it-support-voice-provider.tsx");
  const overlay = src("src/components/support/support-voice-call-overlay.tsx");
  const lineClient = src("src/components/support/line-support-client.tsx");
  const hook = src("src/components/support/use-support-voice-call.ts");
  const supabaseBrowser = src("src/lib/supabase-browser.ts");

  it("stores warm-transfer routing state without media", () => {
    expect(migration).toContain("transfer_status text");
    expect(migration).toContain("transfer_target_user_id uuid");
    expect(migration).toContain("transfer_target_role text");
    expect(migration).toContain("previous_it_user_id uuid");
    expect(migration).toContain("No audio or media is stored");
    expect(migration).not.toContain("audio_blob");
    expect(migration).not.toContain("recording_url");
  });

  it("supports request, accept, decline and cancel transfer actions", () => {
    for (const action of [
      "request_voice_transfer",
      "accept_voice_transfer",
      "decline_voice_transfer",
      "cancel_voice_transfer"
    ]) {
      expect(edge).toContain(`action === "${action}"`);
    }
    expect(edge).toContain("transferOfferForActor");
    expect(edge).toContain("signaling_key: newSignalingKey()");
    expect(itRoute).toContain('"voice_transfer"');
    expect(itRoute).toContain('"voice_transfer_accept"');
    expect(itRoute).toContain('"voice_transfer_decline"');
    expect(itRoute).toContain('"voice_transfer_cancel"');
  });

  it("reuses authoritative active IT users as transfer targets", () => {
    expect(targetsRoute).toContain('from("users_profiles")');
    expect(targetsRoute).toContain('requireItAdmin()');
    expect(targetsRoute).toContain('.eq("is_active", true)');
    expect(targetsRoute).toContain('.is("archived_at", null)');
    expect(targetsRoute).toContain('"it_admin"');
    expect(targetsRoute).toContain('"it_support"');
  });

  it("shows transfer controls and a distinct incoming transfer", () => {
    expect(overlay).toContain("โอนสาย");
    expect(overlay).toContain("ยกเลิกการโอนและกลับมาคุยต่อ");
    expect(provider).toContain('incomingLabel={transferOffer ? "สายโอนเข้า"');
    expect(provider).toContain("transfer_offer_for_me");
  });

  it("holds the customer locally with generated hold music", () => {
    expect(lineClient).toContain("held: voiceHeld");
    expect(lineClient).toContain("holdLabel=");
    expect(hook).toContain("createBuffer");
    expect(hook).toContain("source.loop = true");
    expect(hook).toContain("track.enabled = !held");
    expect(overlay).toContain("🎵 กำลังพักสาย");
  });

  it("recovers long calls with ICE restart and fresh ICE credentials", () => {
    expect(hook).toContain("iceRestart");
    expect(hook).toContain('"webrtc_restart_request"');
    expect(hook).toContain("loadIceServers()");
    expect(hook).toContain("pc.setConfiguration");
    expect(hook).toContain("recoveryAttemptsRef");
    expect(hook).not.toContain('addEventListener("pagehide"');
  });

  it("keeps Supabase Realtime heartbeats resilient in background tabs", () => {
    expect(supabaseBrowser).toContain("heartbeatCallback");
    expect(supabaseBrowser).toContain("worker: true");
    expect(supabaseBrowser).toContain("client.realtime.connect()");
    expect(supabaseBrowser).toContain("browserClient");
  });
});
