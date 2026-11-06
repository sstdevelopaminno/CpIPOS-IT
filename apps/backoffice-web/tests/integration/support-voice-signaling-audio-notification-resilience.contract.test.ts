import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const voice = source("src/components/support/use-support-voice-call.ts");
const provider = source("src/components/it-admin/it-support-voice-provider.tsx");
const notifier = source("src/components/it-admin/support-chat-notifier.tsx");
const line = source("src/components/support/line-support-client.tsx");

describe("Support voice/audio and two-way alert resilience", () => {
  it("acknowledges only a new remote instance to prevent a ready ping-pong storm", () => {
    const handler = voice.slice(
      voice.indexOf('.on("broadcast", { event: "voice_ready" }'),
      voice.indexOf('.on("broadcast", { event: "webrtc_offer" }')
    );
    expect(handler).toContain("const isNewRemote = remoteInstanceRef.current !== event.instance_id");
    expect(handler).toContain("if (isNewRemote) sendReady()");
    expect(handler).not.toContain("\n          sendReady();");
    expect(handler).toContain("if (isInitiator) void createOffer()");
  });

  it("keeps remote audio element and jitter buffer instead of tearing them down on ontrack", () => {
    const attach = voice.slice(voice.indexOf("const attachRemoteStream = useCallback"), voice.indexOf("const flushQueuedIce"));
    expect(attach).toContain("if (!audioElementRef.current)");
    expect(attach).toContain("const created = new Audio()");
    expect(attach).toContain("if (audioElementRef.current.srcObject !== stream) audioElementRef.current.srcObject = stream");
    expect(attach).toContain("if (audio.paused)");
    expect(attach).not.toContain("audioElementRef.current?.pause()");
  });

  it("debounces transient mobile packet loss and avoids competing ICE restarts", () => {
    expect(voice).toContain("recoveryInFlightRef");
    expect(voice).toContain("recoveryInFlightRef.current) return;");
    expect(voice).toContain("recoveryInFlightRef.current = false");
    expect(voice).toContain('} else if (state === "disconnected")');
    expect(voice).toContain("}, 2_500)");
    expect(voice).toContain('} else if (state === "failed")');
    expect(voice).toContain('peerRef.current?.connectionState !== "connected"');
    expect(voice).toContain('if (peerRef.current?.connectionState !== "connected") {\n              void Promise.resolve(onState("connecting"))');
  });

  it("refreshes IT incoming call popup on foreground/network return/push", () => {
    expect(provider).toContain('window.addEventListener("online", onFocus)');
    expect(provider).toContain('window.addEventListener("cpipos-it-push-notification", onPush)');
    expect(provider).toContain('payload?.title?.includes("📞")');
    expect(provider).toContain("waitingOffer ? 3_500");
    expect(provider).toContain("call ? 30_000 : 6_000");
    expect(provider).toContain('window.removeEventListener("cpipos-it-push-notification", onPush)');
  });

  it("does not replace newer realtime unread heads with old HTTP snapshots", () => {
    expect(notifier).toContain("const requestStartedAt = Date.now()");
    expect(notifier).toContain("liveAt > fetchedAt");
    expect(notifier).toContain("liveAt >= requestStartedAt");
    expect(notifier).toContain("snapshotHeads.current = fresh");
    expect(notifier).toContain("Array.from(fresh.values()).reduce");
    expect(notifier).toContain("for (const head of fresh.values()) handleHead");
  });

  it("reuses a gesture-unlocked notification sound for IT chat while keeping visual fallback", () => {
    expect(notifier).toContain("notificationAudioRef");
    expect(notifier).toContain('window.addEventListener("pointerdown", unlockNotificationSound, true)');
    expect(notifier).toContain('window.addEventListener("keydown", unlockNotificationSound, true)');
    expect(notifier).toContain("if (!ctx || ctx.state !== \"running\") return");
    expect(notifier).toContain("playMessageAlert()");
    expect(notifier).toContain('new Notification(title,');
    expect(notifier).toContain('window.removeEventListener("pointerdown", unlockNotificationSound, true)');
  });

  it("shows a customer reply alert after HTTP recovery without falsely re-alerting old replies", () => {
    expect(line).toContain("seenItReplyRef");
    expect(line).toContain('previousSeen.conversationId === conversationId');
    expect(line).toContain("newestReply > previousSeen.lastTimestamp");
    expect(line).toContain('setIncomingNotice("ทีม IT ตอบกลับแล้ว")');
    expect(line).toContain('conversationId: detail.conversation.id');
    expect(line).toContain("lastTimestamp: detail.messages");
    expect(line).toContain('seenItReplyRef.current = { conversationId: "", lastTimestamp: 0 }');
  });
});
