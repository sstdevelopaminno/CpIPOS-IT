import { describe, expect, it } from "vitest";
import {
  POS_PLATFORM_VERSION_PATH,
  normalizePosPlatformBaseUrl,
  parsePosPlatformVersionEnvelope
} from "../../src/lib/pos-platform-contract";

describe("POS platform integration contract", () => {
  it("uses the verified read-only version endpoint", () => {
    expect(POS_PLATFORM_VERSION_PATH).toBe("/api/system/version");
  });

  it("accepts HTTPS deployment roots and strips the trailing slash", () => {
    expect(normalizePosPlatformBaseUrl("https://cp-ipos-web.vercel.app/")).toBe("https://cp-ipos-web.vercel.app");
  });

  it("rejects unsafe or ambiguous remote base URLs", () => {
    expect(() => normalizePosPlatformBaseUrl("http://example.com")).toThrow(/HTTPS/);
    expect(() => normalizePosPlatformBaseUrl("https://user:pass@example.com")).toThrow(/credentials/);
    expect(() => normalizePosPlatformBaseUrl("https://example.com/admin")).toThrow(/application path/);
    expect(() => normalizePosPlatformBaseUrl("https://example.com/?target=x")).toThrow(/query or hash/);
  });

  it("allows localhost HTTP for controlled development", () => {
    expect(normalizePosPlatformBaseUrl("http://localhost:3000")).toBe("http://localhost:3000");
    expect(normalizePosPlatformBaseUrl("http://127.0.0.1:3000/")).toBe("http://127.0.0.1:3000");
  });

  it("parses the CpIPOS version envelope without accepting malformed payloads", () => {
    expect(
      parsePosPlatformVersionEnvelope({
        data: {
          web: { commit_sha: "abc123", commit_ref: "main", environment: "production" },
          source_versions: { android_pos: "1.0.22", windows_runtime: "0.1.8" },
          generated_at: "2026-08-27T16:08:33.335Z"
        },
        error: null
      })
    ).toEqual({
      web: { commit_sha: "abc123", commit_ref: "main", environment: "production" },
      source_versions: { android_pos: "1.0.22", windows_runtime: "0.1.8" },
      generated_at: "2026-08-27T16:08:33.335Z"
    });

    expect(parsePosPlatformVersionEnvelope({ data: { source_versions: {} }, error: null })).toBeNull();
    expect(parsePosPlatformVersionEnvelope({ data: null, error: { code: "x" } })).toBeNull();
  });
});
