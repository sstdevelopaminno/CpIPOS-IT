import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const itConsole = readFileSync(resolve(process.cwd(), "src/components/it-admin/support-chat-console.tsx"), "utf8");

describe("IT Support Chat responsive mobile PWA", () => {
  it("uses one pane at a time below xl and preserves desktop split view", () => {
    expect(itConsole).toContain('useState<"inbox" | "conversation">("inbox")');
    expect(itConsole).toContain('mobilePane === "inbox" ? "flex" : "hidden xl:flex"');
    expect(itConsole).toContain('mobilePane === "conversation" ? "flex" : "hidden xl:flex"');
    expect(itConsole).toContain("xl:grid-cols-[minmax(280px,360px)_minmax(0,1fr)]");
    expect(itConsole).not.toContain('min-h-[560px]');
    expect(itConsole).toContain("100dvh-7.25rem-env(safe-area-inset-bottom)");
  });

  it("opens a conversation only after tapping on mobile and always offers a return path", () => {
    expect(itConsole).toContain('window.matchMedia("(min-width: 1280px)").matches');
    expect(itConsole).toContain('setMobilePane("conversation")');
    expect(itConsole).toContain('aria-label="กลับรายการแชท"');
    expect(itConsole).toContain('onClick={() => setMobilePane("inbox")}');
    expect(itConsole).toContain("← กลับรายการแชท");
  });

  it("keeps essential controls in viewport with scrollable messages and collapsible internal notes", () => {
    expect(itConsole).toContain("overflow-y-auto overscroll-contain");
    expect(itConsole).toContain("sticky bottom-0 z-20 shrink-0");
    expect(itConsole).toContain("pb-[env(safe-area-inset-bottom)]");
    expect(itConsole).toContain('aria-controls="support-chat-internal-note"');
    expect(itConsole).toContain('aria-expanded={mobileNotesOpen}');
    expect(itConsole).toContain('setMobileNotesOpen((current) => !current)');
    expect(itConsole).toContain('placeholder="พิมพ์ข้อความถึงร้านค้า..."');
    expect(itConsole).toContain('onClick={() => void sendMessage()}');
  });
});
