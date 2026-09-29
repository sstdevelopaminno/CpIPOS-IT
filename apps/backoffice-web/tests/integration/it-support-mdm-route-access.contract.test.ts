import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("IT Support MDM route access", () => {
  const devices = src("src/app/(it-admin)/tenants/[tenantId]/devices/page.tsx");
  const health = src("src/app/(it-admin)/tenants/[tenantId]/devices/[deviceId]/health/page.tsx");
  const device = src("src/app/(it-admin)/tenants/[tenantId]/devices/[deviceId]/page.tsx");
  const guard = src("src/lib/it-admin-guard.ts");

  it("allows IT Admin and IT Support to open device and MDM pages", () => {
    expect(devices).toContain('["it_admin", "it_support"].includes(auth.platformRole)');
    expect(health).toContain('["it_admin", "it_support"].includes(auth.platformRole)');
    expect(guard).toContain('auth.platformRole !== "it_admin" && auth.platformRole !== "it_support"');
  });

  it("keeps non-IT users blocked", () => {
    expect(devices).toContain("ไม่มีสิทธิ์เข้าถึง");
    expect(health).toContain("ไม่มีสิทธิ์เข้าถึง");
  });

  it("redirects device detail to the real health route", () => {
    expect(device).toContain("/tenants/");
    expect(device).not.toContain("/it-admin/tenants/");
  });
});
