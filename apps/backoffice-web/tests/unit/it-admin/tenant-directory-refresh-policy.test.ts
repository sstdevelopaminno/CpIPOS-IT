import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../../../src/components/it-admin/tenant-directory-console.tsx", import.meta.url),
  "utf8"
);

describe("Tenant directory refresh policy", () => {
  it("uses a slower automatic refresh cadence", () => {
    expect(source).toContain("const TENANT_AUTO_REFRESH_MS = 180_000");
    expect(source).not.toContain("setInterval(() => void load(true), 60_000)");
  });

  it("does not auto-refresh while the Store Control Center is open", () => {
    expect(source).toContain("if (selected) return;");
  });

  it("does not fetch while the browser tab is hidden", () => {
    expect(source).toContain('document.visibilityState === "visible"');
    expect(source).toContain('document.addEventListener("visibilitychange", handleVisibilityChange)');
  });
});
