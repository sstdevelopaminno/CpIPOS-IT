import { describe, expect, it } from "vitest";
import { resolvePackageChangeDraft } from "../../src/lib/package-change-draft";

const packages = ["starter-id", "growth-id", "business-id"];
describe("IT package change draft", () => {
  it("keeps Business selected after saving unrelated contract dates", () => {
    expect(resolvePackageChangeDraft({
      availablePackageIds: packages,
      currentPackageId: "growth-id",
      previousSelectedId: "business-id",
      preservePrevious: true
    })).toBe("business-id");
  });
  it("resets to actual package when a payment request is submitted or tenant reloads", () => {
    expect(resolvePackageChangeDraft({
      availablePackageIds: packages,
      currentPackageId: "growth-id",
      previousSelectedId: "business-id",
      preservePrevious: false
    })).toBe("growth-id");
  });
  it("rejects a previous selection that is no longer available", () => {
    expect(resolvePackageChangeDraft({
      availablePackageIds: ["starter-id", "growth-id"],
      currentPackageId: "growth-id",
      previousSelectedId: "business-id",
      preservePrevious: true
    })).toBe("growth-id");
  });
  it("handles the empty catalog", () => {
    expect(resolvePackageChangeDraft({
      availablePackageIds: [],
      currentPackageId: null,
      previousSelectedId: "",
      preservePrevious: false
    })).toBe("");
  });
});
