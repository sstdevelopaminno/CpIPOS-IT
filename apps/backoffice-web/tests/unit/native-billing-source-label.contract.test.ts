import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("subscription payments shared POS channel", () => {
  it("labels canonical pos_subscription_center as POS Web / Native without creating a second source", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/components/it-admin/subscription-payments-console.tsx"),
      "utf8"
    );
    expect(source).toContain('row.payment.source === "pos_subscription_center"');
    expect(source).toContain("POS Web / Native → IT");
    expect(source).toContain("CpiPOS-001 · POS Web / Native ↔ IT");
    expect(source).not.toContain("native_pos_subscription_center");
  });
});
