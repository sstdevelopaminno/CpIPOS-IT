import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("IT menus long-content display", () => {
  const modal = source("src/components/it-admin/it-overflow-text.tsx");
  const css = source("src/app/(it-admin)/it-admin-scroll.css");
  const shell = source("src/components/layout/app-shell.tsx");

  it("adds a shared readable header and non-invasive content overflow policy to IT menus", () => {
    expect(shell).toContain("data-it-content");
    expect(css).toContain("main[data-it-content]");
    expect(css).toContain("overflow-wrap: anywhere");
    expect(css).toContain('main[data-it-content] :is([role="dialog"])');
  });

  it("shows full text only after opening a read-only dialog with a heading above a scrollable body", () => {
    expect(modal).toContain('role="dialog"');
    expect(modal).toContain('aria-modal="true"');
    expect(modal).toContain("<h2 id={headingId}>{title}</h2>");
    expect(modal).toContain("createPortal(");
    expect(modal).toContain("if (event.key === \"Escape\")");
    expect(modal).toContain("event.stopPropagation()");
    expect(modal).not.toContain("dangerouslySetInnerHTML");
    expect(modal).not.toContain("fetch(");
  });

  it("keeps existing data/admin actions while previewing verbose list content", () => {
    for (const path of [
      "src/components/it-admin/it-admin-module-console.tsx",
      "src/components/it-admin/tenant-directory-console.tsx",
      "src/components/it-admin/platform-news-console.tsx",
      "src/components/it-admin/other-contacts-console.tsx",
      "src/components/it-admin/subscription-payments-console.tsx",
      "src/components/it-admin/it-admin-devices-console.tsx",
      "src/components/it-admin/it-admin-monitoring-console.tsx",
      "src/components/it-admin/it-system-users-console.tsx",
      "src/components/it-admin/package-catalog-manager.tsx"
    ]) {
      expect(source(path), path).toContain("ItOverflowText");
    }
    expect(source("src/components/it-admin/tenant-directory-console.tsx"))
      .toContain("setSelected(row)");
    expect(source("src/components/it-admin/it-admin-devices-console.tsx"))
      .toContain("queueDeviceCommand");
    expect(source("src/components/it-admin/subscription-payments-console.tsx"))
      .toContain("openEmailDraft(row)");
  });
});
