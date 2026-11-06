import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const file = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const line = file("src/components/support/line-support-client.tsx");
const route = file("src/app/api/support/line/chat/route.ts");
const service = file("src/lib/support-chat/line-support-chat-service.ts");
const edge = file("../../supabase-communications/functions/support-chat-api/index.ts");
const itConsole = file("src/components/it-admin/support-chat-console.tsx");
const overlay = file("src/components/support/support-voice-call-overlay.tsx");
const provider = file("src/components/it-admin/it-support-voice-provider.tsx");
const ringtone = file("src/components/support/use-support-incoming-ringtone.ts");
const queueAudio = file("src/components/support/use-support-voice-waiting-media.ts");
const holdAudio = file("src/components/support/use-support-voice-call.ts");

describe("LINE Support image attachments and audible IT calls", () => {
  it("offers separate customer gallery and camera choices before sending", () => {
    expect(line).toContain('aria-label="แนบรูปภาพหรือถ่ายภาพ"');
    expect(line).toContain("เลือกรูปภาพ");
    expect(line).toContain("ถ่ายรูป");
    expect(line).toContain('capture="environment"');
    expect(line).toContain('accept="image/jpeg,image/png,image/webp"');
    expect(line).toContain("aria-expanded={photoMenuOpen}");
    expect(line).toContain("ตัวอย่างรูปภาพก่อนส่ง");
    expect(line).toContain("(!draft.trim() && !attachment)");
    expect(line).toContain("attachment: selectedImage ? await lineImagePayload(selectedImage.file) : null");
  });

  it("resizes large camera photos without changing the server's 2 MB security limit", () => {
    expect(line).toContain("MAX_SUPPORT_IMAGE_BYTES = 2 * 1024 * 1024");
    expect(line).toContain("canvas.toBlob(resolve");
    expect(line).toContain('type: "image/jpeg"');
    expect(line).toContain("URL.revokeObjectURL");
    expect(route).toContain('fail("attachment_invalid"');
    expect(service).toContain("attachment.data_base64.length >");
    expect(edge).toContain("MAX_IMAGE_BYTES = 2 * 1024 * 1024");
    expect(edge).toContain('storage_bucket: IMAGE_BUCKET');
  });

  it("forwards signed images from LINE to the existing IT chat pipeline", () => {
    expect(route).toContain("sendLineSupportMessage(session, conversationId, message, attachment)");
    expect(service).toContain('attachment\n    });');
    expect(line).toContain("message.attachments?.map");
    expect(line).toContain("unoptimized");
    expect(line).toContain("selectedImage ? (message ?");
    expect(itConsole).toContain("message.attachments?.map");
    expect(edge).toContain("createSignedUrl");
    expect(route).toContain('audience: "it"');
  });

  it("fixes the formerly silent envelope of original waiting and hold tunes", () => {
    expect(queueAudio).toContain("Math.min(1, fadeIn, fadeOut)");
    expect(holdAudio).toContain("Math.min(1, phaseInNote * 8, (1 - phaseInNote) * 8)");
    const midpoint = 0.5;
    const waiting = Math.min(1, Math.min(1, midpoint * 5), Math.min(1, (1 - midpoint) * 5));
    const hold = Math.min(1, midpoint * 8, (1 - midpoint) * 8);
    expect(waiting).toBe(1);
    expect(hold).toBe(1);
    expect(queueAudio).toContain("context.resume()");
    expect(holdAudio).toContain("startHoldMusic(true)");
  });

  it("adds an IT ringtone with a gesture-unlock fallback", () => {
    expect(ringtone).toContain('window.addEventListener("pointerdown", unlock');
    expect(ringtone).toContain('window.addEventListener("keydown", unlock');
    expect(ringtone).toContain("frequency: 523.25");
    expect(ringtone).toContain("frequency: 783.99");
    expect(ringtone).toContain("window.setInterval(pulse, 4_200)");
    expect(ringtone).toContain("const activateRing = useCallback");
    expect(provider).toContain("useSupportIncomingRingtone");
    expect(provider).toContain('mode === "incoming" && !incomingExpanded');
    expect(overlay).toContain("แตะเพื่อเปิดเสียงเรียกเข้า");
    expect(overlay).toContain("🔔 ทดสอบเสียงเรียกเข้า");
  });

  it("allows dragging the compact incoming call while retaining answer and transfer buttons", () => {
    expect(provider).toContain("minimized={minimized || compactIncoming}");
    expect(overlay).toContain("onPointerMove={handleDragMove}");
    expect(overlay).toContain("setPointerCapture(event.pointerId)");
    expect(overlay).toContain("onClick={onAccept}");
    expect(overlay).toContain("⇄ ส่งต่อสาย");
    expect(overlay).toContain("const transferDialog = transferPickerOpen ? (");
  });
});
