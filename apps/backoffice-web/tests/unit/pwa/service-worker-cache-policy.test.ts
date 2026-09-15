import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const serviceWorker = readFileSync(new URL("../../../public/sw.js", import.meta.url), "utf8");

describe("PWA service worker cache policy", () => {
  it("does not precache authenticated documents or the dynamic manifest route", () => {
    expect(serviceWorker).toContain("const ASSETS_TO_CACHE = [");
    expect(serviceWorker).not.toContain('"/",');
    expect(serviceWorker).not.toContain('"/manifest.webmanifest"');
  });

  it("bypasses API, Next internals, and App Router RSC requests", () => {
    expect(serviceWorker).toContain('url.pathname.startsWith("/api/")');
    expect(serviceWorker).toContain('url.pathname.startsWith("/_next/")');
    expect(serviceWorker).toContain('url.searchParams.has("_rsc")');
    expect(serviceWorker).toContain('request.headers.get("rsc") === "1"');
    expect(serviceWorker).toContain('request.headers.has("next-router-state-tree")');
  });

  it("only runtime-caches static brand assets needed for offline POS", () => {
    expect(serviceWorker).toContain("function shouldCacheRuntimeRequest");
    expect(serviceWorker).toContain('request.destination === "image"');
    expect(serviceWorker).toContain('request.destination === "font"');
    expect(serviceWorker).toContain('url.pathname === OFFLINE_POS_URL');
  });
});