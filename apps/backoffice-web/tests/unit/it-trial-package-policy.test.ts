import { describe, expect, it } from "vitest";
import { decideTrialPackageRevision, type TrialPackageRevisionState } from "../../src/lib/it-trial-package-policy";

const valid: TrialPackageRevisionState = {
  contractStatus: "trial",
  currentPackageId: "starter",
  requestedPackageId: "growth",
  adminReason: "ปรับแพ็กเกจให้ร้านทดลอง",
  hasOpenPaymentRequest: false,
  prepaidActivationPending: false,
  hasSettledTrialPayment: false,
  hasContractConflict: false
};

describe("IT trial package correction is allowed repeatedly, without paid activation", () => {
  it("allows an authorized trial plan revision", () => {
    expect(decideTrialPackageRevision(valid)).toEqual({ allowed: true });
  });
  it.each(["active", "expired", "suspended", "cancelled", null])(
    "never bypasses settlement for contract status %s", status => {
      expect(decideTrialPackageRevision({ ...valid, contractStatus: status }).allowed).toBe(false);
    }
  );
  it("protects prepaid trial, payment requests, paid evidence and overlap", () => {
    for (const field of ["prepaidActivationPending", "hasOpenPaymentRequest", "hasSettledTrialPayment", "hasContractConflict"] as const) {
      expect(decideTrialPackageRevision({ ...valid, [field]: true }).allowed).toBe(false);
    }
  });
  it("requires changed package and explicit audit reason", () => {
    expect(decideTrialPackageRevision({ ...valid, requestedPackageId: "starter" }).allowed).toBe(false);
    expect(decideTrialPackageRevision({ ...valid, adminReason: "x" }).allowed).toBe(false);
  });
});
