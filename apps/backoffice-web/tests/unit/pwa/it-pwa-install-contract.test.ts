import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const manifest = source("../../../src/app/manifest.ts");
const rootLayout = source("../../../src/app/layout.tsx");
const oldEntry = source("../../../src/app/login/store/page.tsx");
const offlinePage = source("../../../public/offline-it.html");

describe("IT Admin PWA install and launch contract", () => {
  it("launches the authenticated IT portal instead of a nonexistent POS store login", () => {
    expect(manifest).toContain('id: "/it-admin"');
    expect(manifest).toContain('start_url: "/it-admin"');
    expect(manifest).toContain('scope: "/"');
    expect(manifest).toContain('display: "standalone"');
    expect(manifest).not.toContain('start_url: "/login/store"');
    expect(manifest).not.toContain('orientation: "portrait"');
  });

  it("recovers already-installed shortcuts with the old POS start path", () => {
    expect(oldEntry).toContain('redirect("/it-admin")');
  });

  it("uses the IT product identity in browser and installed app", () => {
    expect(manifest).toContain('name: "CpiPOS IT Control Plane"');
    expect(rootLayout).toContain('title: "CpiPOS IT Control Plane"');
  });

  it("uses an IT-specific offline page without customer POS data", () => {
    expect(offlinePage).toContain("CpiPOS IT");
    expect(offlinePage).toContain('href="/it-admin"');
    expect(offlinePage).not.toContain("localStorage");
  });
});
