import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CPIPOS_DESKTOP_PUBLIC_KEY_FINGERPRINT,
  CPIPOS_DESKTOP_PUBLIC_KEY_SPKI_BASE64,
  CPIPOS_LICENSE_ISSUER,
  CPIPOS_LICENSE_PRODUCT
} from "@/lib/offline-license-issuer";

describe("CpIPOS Desktop v0.3.0 offline license key contract", () => {
  it("keeps the expected product and issuer identifiers", () => {
    expect(CPIPOS_LICENSE_PRODUCT).toBe("CPIPOS-DESKTOP");
    expect(CPIPOS_LICENSE_ISSUER).toBe("CUTTING-POINT-TECH-IT");
  });

  it("keeps the public key fingerprint synchronized with the desktop verifier", () => {
    const der = Buffer.from(CPIPOS_DESKTOP_PUBLIC_KEY_SPKI_BASE64, "base64");
    const fingerprint = createHash("sha256")
      .update(der)
      .digest("hex")
      .toUpperCase()
      .match(/.{1,4}/g)
      ?.join(":");

    expect(fingerprint).toBe(CPIPOS_DESKTOP_PUBLIC_KEY_FINGERPRINT);
    expect(CPIPOS_DESKTOP_PUBLIC_KEY_FINGERPRINT).toBe(
      "4DF3:AB73:4E41:1F54:4E17:A082:851A:597F:BA08:331D:A7AF:7EAD:1D51:7970:635D:5295"
    );
  });
});
