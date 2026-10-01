import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("IT Admin password recovery", () => {
  const loginPage = src("src/app/it-admin/login/page.tsx");
  const loginApi = src("src/app/api/it-admin/auth/login/route.ts");
  const forgotApi = src("src/app/api/it-admin/auth/forgot-password/route.ts");
  const changeApi = src("src/app/api/it-admin/auth/change-password/route.ts");
  const passwordPage = src("src/app/(it-admin)/it-admin/settings/password/page.tsx");
  const layout = src("src/app/(it-admin)/layout.tsx");
  const service = src("src/lib/services/it-admin/it-password-recovery-service.ts");

  it("adds forgot-password UX and routes temporary-password users to password settings", () => {
    expect(loginPage).toContain("ลืมรหัสผ่าน?");
    expect(loginPage).toContain("/api/it-admin/auth/forgot-password");
    expect(loginPage).toContain('"/it-admin/settings/password"');
    expect(loginApi).toContain("password_change_required");
    expect(loginApi).toContain("temporary_password_expired");
  });

  it("rate limits reset requests and limits recovery to active IT accounts", () => {
    expect(forgotApi).toContain("it_forgot_password_ip");
    expect(forgotApi).toContain("it_forgot_password_account");
    expect(forgotApi).toContain('["it_admin", "it_support"]');
    expect(forgotApi).toContain("updateUserById");
    expect(forgotApi).not.toContain("temporaryPassword,");
  });

  it("sends a short-lived temporary password without logging it", () => {
    expect(service).toContain("generateItTemporaryPassword");
    expect(service).toContain("CPIPOS_MAIL_BRIDGE_URL");
    expect(service).toContain("รหัสผ่านชั่วคราว");
    expect(forgotApi).toContain("30 * 60 * 1000");
    expect(forgotApi).not.toContain("console.log");
  });

  it("provides an authenticated settings flow for choosing a new password", () => {
    expect(layout).toContain('href: "/it-admin/settings/password"');
    expect(passwordPage).toContain("/api/it-admin/auth/change-password");
    expect(changeApi).toContain("current_password");
    expect(changeApi).toContain("strongEnough");
    expect(changeApi).toContain("password_change_required: false");
  });
});
