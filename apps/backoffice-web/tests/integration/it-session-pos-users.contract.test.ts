import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("IT auth session and POS-user separation", () => {
  const layout = src("src/app/(it-admin)/layout.tsx");
  const shell = src("src/components/layout/app-shell.tsx");
  const logout = src("src/app/api/it-admin/auth/logout/route.ts");
  const posApi = src("src/app/api/it-admin/v1/platform-users/route.ts");
  const posUi = src("src/components/it-admin/platform-users-console.tsx");
  const posPage = src("src/app/(it-admin)/it-admin/pos-users/page.tsx");

  it("adds a main logout action backed by Supabase signOut", () => {
    expect(shell).toContain('/api/it-admin/auth/logout');
    expect(shell).toContain('ออกจากระบบ');
    expect(shell).toContain('window.location.assign("/it-admin/login")');
    expect(logout).toContain("supabase.auth.signOut()");
  });

  it("shows POS users and permissions to IT Admin and IT Support", () => {
    expect(layout).toContain('/it-admin/pos-users');
    expect(layout).toContain('users: "ผู้ใช้งาน / สิทธิ์ POS"');
    expect(posPage).toContain("PlatformUsersConsole");
  });

  it("keeps the POS user endpoint tenant-user only", () => {
    expect(posApi).toContain('.eq("platform_role", "tenant_user")');
    expect(posApi).toContain('const platformRole: PlatformRole = "tenant_user"');
    expect(posUi).toContain('platform_role: "tenant_user"');
    expect(posUi).toContain("ไม่แสดงบัญชี IT Admin หรือ IT Support");
  });

  it("lets IT Admin add/edit POS users but reserves deletion for IT Support", () => {
    expect(posApi).toContain("assertItSupportAction");
    expect(posApi).toContain("IT Admin แก้ไขและเพิ่มผู้ใช้งาน POS ได้");
    expect(posUi).toContain("canDelete");
    expect(posUi).toContain("เพิ่มผู้ใช้ POS");
  });

  it("hard-deletes only users without business history and safely archives referenced users", () => {
    expect(posApi).toContain("countUserHistory");
    expect(posApi).toContain("platform_user_archived");
    expect(posApi).toContain("platform_user_hard_deleted");
    expect(posApi).toContain("history.total > 0");
    expect(posApi).not.toContain('action: "platform_user_deleted"');
    expect(posUi).toContain('"active"');
    expect(posUi).toContain("เก็บผู้ใช้ถาวรแล้ว");
  });
});
