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
      "6FE9:A194:5785:B79A:13FB:C27B:316A:A7F2:F963:443B:BD2B:4482:CF31:86CA:EAF3:8018"
    );
  });
});
