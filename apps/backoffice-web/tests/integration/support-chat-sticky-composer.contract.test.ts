import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("Support Chat sticky composer layout", () => {
  const itConsole = src("src/components/it-admin/support-chat-console.tsx");
  const lineClient = src("src/components/support/line-support-client.tsx");

  it("keeps the IT composer docked while only the transcript scrolls", () => {
    expect(itConsole).toContain("relative flex min-h-0 flex-col overflow-hidden");
    expect(itConsole).toContain("overflow-y-auto overscroll-contain");
    expect(itConsole).toContain("sticky bottom-0 z-20 shrink-0");
    expect(itConsole).toContain("โน้ตภายใน IT (ลูกค้าไม่เห็น)");
    expect(itConsole).toContain("พิมพ์ข้อความถึงร้านค้า...");
  });

  it("keeps the LINE composer docked while only the transcript scrolls", () => {
    expect(lineClient).toContain("overflow-y-auto overscroll-contain");
    expect(lineClient).toContain("sticky bottom-0 z-20 shrink-0");
    expect(lineClient).toContain("pb-[env(safe-area-inset-bottom)]");
    expect(lineClient).toContain("พิมพ์ข้อความถึงทีม IT…");
  });
});
