import { describe, expect, it } from "vitest";
import { JsonRequestError, readBoundedJson } from "@/lib/server/limited-json";
import { sanitizeAuditObject } from "@/lib/server/audit-sanitizer";
import { validateMdmCommandRequest } from "@/lib/mdm/commandPolicy";

const adminDevice = {
  tenantId: "tenant", deviceId: "device", platform: "android", appVersion: "1.0.23",
  appFlavor: "web-production", ownershipType: "company_owned",
  enrollmentMode: "android_enterprise_device_owner", isDeviceOwner: true,
  capabilities: ["mdm_core", "remote_lock"]
};

describe("IT Admin API security regressions", () => {
  it("rejects an oversized request with no Content-Length", async () => {
    const req = new Request("https://it.example.test/api", {
      method: "POST", body: JSON.stringify({ note: "x".repeat(5000) })
    });
    await expect(readBoundedJson(req, 1000)).rejects.toMatchObject({
      code: "json_body_too_large", status: 413
    });
  });
  it("rejects an oversized declared Content-Length before parsing", async () => {
    const req = new Request("https://it.example.test/api", {
      method: "POST", headers: { "content-length": "99999" }, body: "{}"
    });
    await expect(readBoundedJson(req, 1000)).rejects.toBeInstanceOf(JsonRequestError);
  });
  it("returns controlled errors for malformed JSON and handles multibyte UTF-8", async () => {
    const bad = new Request("https://it.example.test/api", { method: "POST", body: "{bad" });
    await expect(readBoundedJson(bad)).rejects.toMatchObject({ code: "invalid_json_body", status: 400 });
    const valid = new Request("https://it.example.test/api", { method: "POST", body: JSON.stringify({ name: "ร้านค้า" }) });
    expect(await readBoundedJson(valid)).toEqual({ name: "ร้านค้า" });
  });
  it("redacts nested PINs, credentials and authorization while keeping business fields", () => {
    const result = sanitizeAuditObject({
      menu_key: "main.sales", branch_id: "branch-1",
      owner_pin: "123456", ownerPin: "654321",
      before_data: { authorization: "Bearer abc", pin_hash: "bcrypt", nested: [{ apiKey: "secret" }] }
    });
    expect(result.menu_key).toBe("main.sales");
    expect(result.branch_id).toBe("branch-1");
    expect(result.owner_pin).toBe("[redacted]");
    expect(result.ownerPin).toBe("[redacted]");
    expect(result.before_data).toMatchObject({
      authorization: "[redacted]", pin_hash: "[redacted]", nested: [{ apiKey: "[redacted]" }]
    });
  });
  it("rejects secret-containing MDM explanations and never records their contents", () => {
    const verdict = validateMdmCommandRequest({
      tenantId: "tenant", deviceId: "device", commandType: "lock_device",
      requestedByRole: "it_admin", reason: "Staff pin: 123456 must be revoked"
    }, adminDevice);
    expect(verdict.accepted).toBe(false);
    expect(verdict.reasons).toContain("reason_may_contain_secret");
    expect(verdict.auditEvent.reasonText).not.toContain("123456");
  });
  it("rejects unbounded MDM explanations", () => {
    const verdict = validateMdmCommandRequest({
      tenantId: "tenant", deviceId: "device", commandType: "lock_device",
      requestedByRole: "it_admin", reason: "x".repeat(241)
    }, adminDevice);
    expect(verdict.accepted).toBe(false);
    expect(verdict.reasons).toContain("reason_too_long");
    expect(verdict.auditEvent.reasonText?.length).toBeLessThanOrEqual(240);
  });
});
