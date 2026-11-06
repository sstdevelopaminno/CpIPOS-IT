import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const ring = src("src/components/support/use-support-incoming-ringtone.ts");
const waiting = src("src/components/support/use-support-voice-waiting-media.ts");
const hold = src("src/components/support/use-support-voice-call.ts");
const overlay = src("src/components/support/support-voice-call-overlay.tsx");
const line = src("src/components/support/line-support-client.tsx");
const edge = src("../../supabase-communications/functions/support-chat-api/index.ts");
const itRoute = src("src/app/api/it-admin/v1/support-chat/conversations/[conversationId]/route.ts");
const chat = src("src/components/it-admin/support-chat-console.tsx");

describe("IT call audio/drag and full conversation hard-delete integrity", () => {
  it("uses a short original gentle ring with a rest, not a continuous harsh tone", () => {
    expect(ring).toContain("frequency: 523.25");
    expect(ring).toContain("frequency: 659.25");
    expect(ring).toContain("frequency: 783.99");
    expect(ring).toContain("exponentialRampToValueAtTime");
    expect(ring).toContain("window.setInterval(pulse, 4_200)");
    expect(ring).toContain("activateRing");
  });

  it("speaks customer waiting prompts on the initiating tap and periodically", () => {
    expect(waiting).toContain("activeSpeechRef.current = utterance");
    expect(waiting).toContain('utterance.lang = "th-TH"');
    expect(waiting).toContain('voice.lang.toLowerCase().startsWith("th")');
    expect(waiting).toContain('window.speechSynthesis.addEventListener("voiceschanged"');
    expect(waiting).toContain("announce(initialQueue === undefined ? queueRef.current : initialQueue)");
    expect(waiting).toContain("25_000");
    expect(waiting).toContain("speechIssue");
    expect(waiting).not.toContain("Math.sin(Math.PI * Math.min(fadeIn, fadeOut))");
  });

  it("provides repeated Thai transfer-hold prompts and an actionable fallback", () => {
    expect(hold).toContain("holdSpeechRef.current = utterance");
    expect(hold).toContain("holdSpeechTimerRef.current = window.setInterval");
    expect(hold).toContain("setHoldSpeechIssue(true)");
    expect(hold).toContain("replayHoldAudio()");
    expect(overlay).toContain("speechIssue && (held || mode ===");
    expect(line).toContain("waitingSpeechIssue");
    expect(line).toContain("speechIssue={voiceHeld ? voice.holdSpeechIssue : waitingSpeechIssue}");
  });

  it("allows Windows mouse/trackpad and touch to drag the call card over IT menus", () => {
    expect(overlay).toContain("จับตรงนี้แล้วลากย้ายหน้าต่างโทร");
    expect(overlay).toContain('window.addEventListener("pointermove", move)');
    expect(overlay).toContain('window.addEventListener("pointerup", finish)');
    expect(overlay).toContain('window.addEventListener("blur", finish)');
    expect(overlay).toContain("onPointerDown={handleDragStart}");
    expect(overlay).toContain("setBubblePosition");
    expect(overlay).toContain("window.innerHeight - bubble.offsetHeight");
    expect(overlay).toContain('closest("button, input, textarea, select, a")');
  });

  it("removes tracked and orphaned media via Storage API before hard delete", () => {
    expect(edge).toContain("async function purgeConversationMedia");
    expect(edge).toContain('db.from("support_attachments")');
    expect(edge).toContain(".order(\"created_at\", { ascending: true })");
    expect(edge).toContain(".range(offset, offset + 499)");
    expect(edge).toContain("canonicalStorage.list(conversationId, { limit: 100, offset: 0 })");
    expect(edge).toContain("canonicalStorage.remove(remaining)");
    expect(edge).toContain("deletedMediaObjects = await purgeConversationMedia(db, conversationId)");
    expect(edge).toContain('eq("status", "closed").select("id").maybeSingle()');
    expect(edge).toContain("support_conversation_purge_verification_failed");
    expect(edge).toContain("related_records_verified: true");
  });

  it("requires a closed conversation and authorized IT role before purging", () => {
    const deleteStart = edge.indexOf('if (action === "delete_conversation")');
    const deletion = edge.slice(deleteStart);
    expect(deletion).toContain('["it_admin", "it_support"]');
    expect(deletion).toContain('current.data.status !== "closed"');
    expect(itRoute).toContain('["it_admin", "it_support"]');
    expect(chat).toContain("canPermanentlyDeleteChat");
    expect(chat).toContain("json.data.storage_deleted");
    expect(chat).toContain("json.data.related_records_verified");
    expect(chat).toContain("ลบแชทถาวร");
  });
});
