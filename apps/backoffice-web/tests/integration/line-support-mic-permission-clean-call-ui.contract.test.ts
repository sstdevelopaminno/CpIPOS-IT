import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const voice = src("src/components/support/use-support-voice-call.ts");
const overlay = src("src/components/support/support-voice-call-overlay.tsx");
const client = src("src/components/support/line-support-client.tsx");
const waiting = src("src/components/support/use-support-voice-waiting-media.ts");

describe("LINE voice permission and uncluttered customer screen", () => {
  it("reuses a previously granted microphone within the same open LINE chat", () => {
    expect(voice).toContain("reusableStoreStreamRef");
    expect(voice).toContain('side === "store" && !releaseDevices');
    expect(voice).toContain('track.readyState === "live"');
    expect(voice).toContain("track.enabled = false");
    expect(voice).toContain("const stream = cached?.getAudioTracks().some");
    expect(voice).toContain("reusableStoreStreamRef.current = null");
    expect(voice).toContain("navigator.mediaDevices.getUserMedia");
  });

  it("mutes before network operations and revokes the session mic when leaving", () => {
    const cleanup = voice.slice(voice.indexOf("  const cleanup = useCallback("), voice.indexOf("  const attachRemoteStream = useCallback("));
    expect(cleanup.indexOf("track.enabled = false")).toBeLessThan(cleanup.indexOf("await channel.send"));
    expect(voice).not.toContain('addEventListener("pagehide"');
    expect(voice).toContain("void cleanup(false, true)");
    expect(voice).toContain("void cleanup(false, true)");
    expect(voice).toContain("releaseMicrophone");
    expect(client).toContain("voice.releaseMicrophone()");
    expect(client).toContain("await voice.endLocal().catch(() => null)");
  });

  it("hides queue/hold/speech-warning blocks for customer while keeping essential call actions", () => {
    expect(client).toContain("compactCustomer");
    expect(overlay).toContain('mode === "outgoing" && !compactCustomer');
    expect(overlay).toContain("held && !compactCustomer");
    expect(overlay).toContain("speechIssue && !compactCustomer");
    expect(overlay).toContain("aria-live=\"polite\"");
    expect(overlay).toContain("ระบบกำลังส่งต่อสายให้เจ้าหน้าที่");
    expect(overlay).toContain("onClick={onCancel}");
    expect(overlay).toContain("onClick={onEnd}");
  });

  it("keeps a best-effort Thai waiting announcement without requiring a repeated manual button", () => {
    expect(waiting).toContain("announce(initialQueue === undefined ? queueRef.current : initialQueue)");
    expect(waiting).toContain('utterance.lang = "th-TH"');
    expect(waiting).toContain("activeSpeechRef.current = utterance");
  });
});
