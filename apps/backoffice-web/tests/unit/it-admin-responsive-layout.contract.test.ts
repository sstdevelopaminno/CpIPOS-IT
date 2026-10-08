import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const appShell = source("../../src/components/layout/app-shell.tsx");
const shellCss = source("../../src/components/layout/app-shell.module.css");
const loginPage = source("../../src/app/it-admin/login/page.tsx");
const loginCss = source("../../src/app/it-admin/login/login.module.css");

describe("IT Admin desktop, tablet, and phone layout contract", () => {
  it("retains a full workspace and collapsible sidebar on desktop", () => {
    expect(shellCss).toContain("grid-template-columns: 282px minmax(0, 1fr)");
    expect(shellCss).toContain(".shellCollapsed");
    expect(shellCss).toContain("@media (max-width: 1180px)");
  });

  it("uses a drawer, backdrop, and accessible control for tablets and phones", () => {
    expect(shellCss).toContain("@media (max-width: 980px)");
    expect(shellCss).toContain("transform: translateX(-102%)");
    expect(shellCss).toContain(".sidebarOpen");
    expect(appShell).toContain('aria-controls="it-app-sidebar"');
    expect(appShell).toContain('id="it-app-sidebar"');
    expect(appShell).toContain("setMobileOpen(false)");
  });

  it("fits narrow phone top bars, tappable login, and safe-area scrolling", () => {
    expect(shellCss).toContain("@media (max-width: 720px)");
    expect(shellCss).toContain("@media (max-width: 420px)");
    expect(shellCss).toContain("safe-area-inset-bottom");
    expect(loginPage).toContain("styles.page");
    expect(loginPage).toContain("styles.brandHeading");
    expect(loginCss).toContain("overflow-y: auto");
    expect(loginCss).toContain("align-content: safe center");
    expect(loginCss).toContain("min-height: 48px");
  });
});
