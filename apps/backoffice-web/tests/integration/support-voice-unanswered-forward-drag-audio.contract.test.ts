import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const code = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const edge = code("../../supabase-communications/functions/support-chat-api/index.ts");
const provider = code("src/components/it-admin/it-support-voice-provider.tsx");
const overlay = code("src/components/support/support-voice-call-overlay.tsx");
const voice = code("src/components/support/use-support-voice-call.ts");

describe("IT unanswered voice forwarding and movable call panel", () => {
  it("offers a real transfer picker before accepting a customer call", () => {
    expect(provider).toContain('call?.status === "requested"');
    expect(provider).toContain('call.direction === "store_to_it"');
    expect(provider).toContain('call?.transfer_status !== "requested"');
    expect(provider).toContain('control("voice_transfer", conversation.id, call.id');
    expect(provider).toContain("if (wasUnanswered)");
    expect(provider).toContain("setCall(null)");
    expect(overlay).toContain('label="ส่งต่อสาย"');
    expect(overlay).toContain("onClick={onOpenTransfer}");
    expect(overlay).toContain("โอนไปพนักงานรายบุคคล");
  });

  it("routes the waiting request only to an authorized target without opening WebRTC", () => {
    const route = edge.slice(
      edge.indexOf('if (action === "request_voice_transfer")'),
      edge.indexOf('if (action === "cancel_voice_transfer")')
    );
    expect(route).toContain('selected.data.direction === "store_to_it"');
    expect(route).toContain('selected.data.status === "requested"');
    expect(route).toContain('!selected.data.assigned_it_user_id');
    expect(route).toContain('transfer_target_user_id: targetUserId');
    expect(route).toContain('transfer_target_role: targetRole');
    expect(route).toContain('.is("assigned_it_user_id", null)');
    expect(route).not.toContain('signaling_key: newSignalingKey()');
    expect(edge).toContain('code: "call_forwarded"');
    expect(edge).toContain("transferOfferForActor(selected.data, actor)");
  });

  it("does not offer rerouted calls to an arbitrary IT agent and recovers forgotten handoffs", () => {
    const finder = edge.slice(
      edge.indexOf('if (action === "get_it_voice_call")'),
      edge.indexOf('if (action === "get_messages")')
    );
    expect(finder).toContain('transfer_target_user_id", actor.uid');
    expect(finder).toContain('transfer_target_role", actor.role');
    expect(finder).toContain('.neq("transfer_requested_by_user_id", actor.uid)');
    expect(finder).toContain('.or("transfer_status.is.null,transfer_status.neq.requested")');
    expect(finder).toContain("expireUnansweredForwardedCalls(db)");
    expect(edge).toContain("Date.now() - 90_000");
    expect(edge).toContain('transfer_status: "cancelled"');
    expect(edge).toContain('.in("status", ["requested", "accepted", "connecting", "connected"])');
  });

  it("renders the transfer picker while a connected call is minimized", () => {
    expect(overlay).toContain("const transferDialog = transferPickerOpen ? (");
    expect(overlay).toContain("{transferDialog}");
    const occurrences = overlay.split("{transferDialog}").length - 1;
    expect(occurrences).toBe(2);
    expect(overlay).toContain("onClick={transferPending ? onCancelTransfer : onOpenTransfer}");
  });

  it("drags the floating IT call controls by the header without blocking other menus", () => {
    expect(overlay).toContain("setPointerCapture(event.pointerId)");
    expect(overlay).toContain("releasePointerCapture(event.pointerId)");
    expect(overlay).toContain("onPointerMove={handleDragMove}");
    expect(overlay).toContain("onPointerCancel={handleDragEnd}");
    expect(overlay).toContain("bubble.offsetWidth");
    expect(overlay).toContain("bubble.offsetHeight");
    expect(overlay).toContain('right: "auto", bottom: "auto"');
    expect(overlay).toContain('label="รับสาย"');
    expect(overlay).toContain("เริ่มคุยด้วยเสียง");
  });

  it("unlocks customer hold music while the user is tapping to start a call", () => {
    const start = voice.slice(voice.indexOf("  const start = useCallback("), voice.indexOf("  const endLocal = useCallback("));
    expect(start).toContain('if (side === "store") void startHoldMusic(false)');
    expect(start.indexOf('void startHoldMusic(false)')).toBeLessThan(start.indexOf("await cleanup(false)"));
    expect(voice).toContain("holdAudioRef.current = { context, source, gain }");
    expect(voice).toContain("gain.gain.value = audible ? 0.85 : 0");
    expect(voice).toContain("muteHoldMusic()");
    expect(voice).toContain("source.loop = true");
    expect(voice).toContain("utterance.lang = \"th-TH\"");
    expect(voice).toContain("utterance.onstart =");
    expect(voice).toContain("stopHoldMusic()");
  });
});
