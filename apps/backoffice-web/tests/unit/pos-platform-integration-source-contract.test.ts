import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function readRelative(relativeUrl: string) {
  return readFileSync(fileURLToPath(new URL(relativeUrl, import.meta.url)), "utf8");
}

describe("IT Admin POS platform integration source boundaries", () => {
  it("checks fixed server-side targets and never accepts a client-provided fetch URL", () => {
    const service = readRelative("../../src/lib/it-admin-pos-platform-status.ts");

    expect(service).toContain('envName: "CPIPOS_POS_WEB_BASE_URL"');
    expect(service).toContain('envName: "CPIPOS_BACKOFFICE_WEB_BASE_URL"');
    expect(service).toContain("POS_PLATFORM_VERSION_PATH");
    expect(service).toContain('cache: "no-store"');
    expect(service).toContain("AbortController");
    expect(service).not.toContain("searchParams");
    expect(service).not.toContain("request.url");
  });

  it("protects the platform status API with the IT Admin guard", () => {
    const route = readRelative("../../src/app/api/it-admin/v1/platform-status/route.ts");

    expect(route).toContain("await requireItAdmin();");
    expect(route).toContain("getPosPlatformStatusReport");
    expect(route).toContain('Cache-Control", "no-store, max-age=0"');
  });

  it("keeps the connection slice read-only", () => {
    const service = readRelative("../../src/lib/it-admin-pos-platform-status.ts");
    const route = readRelative("../../src/app/api/it-admin/v1/platform-status/route.ts");
    const combined = `${service}\n${route}`;

    expect(combined).not.toContain('method: "POST"');
    expect(combined).not.toContain('method: "PATCH"');
    expect(combined).not.toContain('method: "DELETE"');
    expect(combined).not.toContain("supabase.from(");
  });
});
