import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("Development Control Center Phase 1", () => {
  const layout = src("src/app/(it-admin)/layout.tsx");
  const page = src("src/app/(it-admin)/it-admin/development/page.tsx");
  const consoleUi = src("src/components/it-admin/development-center-console.tsx");
  const control = src("src/lib/development-control.ts");
  const pinGate = src("src/lib/it-support-pin.ts");
  const sourceApi = src("src/app/api/it-admin/v1/development/source/route.ts");
  const prApi = src("src/app/api/it-admin/v1/development/pull-requests/route.ts");
  const deployApi = src("src/app/api/it-admin/v1/development/deployments/route.ts");

  it("exposes the Development menu only in the IT Support navigation branch", () => {
    expect(layout).toContain('href: "/it-admin/development"');
    expect(layout).toContain('group: text.groups.development');
    expect(page).toContain('auth.platformRole !== "it_support"');
  });

  it("requires the logged-in IT Support user's own PIN for every mutation", () => {
    expect(pinGate).toContain('.eq("id", context.auth.userId)');
    expect(pinGate).toContain('.eq("platform_role", "it_support")');
    expect(pinGate).toContain("bcrypt.compare");
    expect(sourceApi).toContain('requireItSupportPin(context, body.pin, "source_write")');
    expect(prApi).toContain('requireItSupportPin(context, body.pin, "pull_request_create")');
    expect(prApi).toContain('requireItSupportPin(context, body.pin, "pull_request_merge")');
    expect(deployApi).toContain("requireItSupportPin(context, body.pin");
  });

  it("never writes directly to main and blocks secret-like files", () => {
    expect(control).toContain('const DEV_BRANCH_PREFIX = "it-support/"');
    expect(control).toContain("development_branch_write_blocked");
    expect(control).toContain("development_path_blocked");
    expect(control).toContain("BLOCKED_PATH");
  });

  it("rate-limits source writes and Vercel deploy actions", () => {
    expect(sourceApi).toContain('namespace: "it-development-source-write"');
    expect(sourceApi).toContain("max: 12");
    expect(deployApi).toContain('namespace: "it-development-deploy"');
    expect(deployApi).toContain('namespace: "it-development-production-deploy"');
  });

  it("has no automatic polling loop in the development workspace", () => {
    expect(consoleUi).not.toContain("setInterval(");
    expect(consoleUi).not.toContain("setTimeout(");
    expect(consoleUi).toContain("loadWorkspaceRuns");
  });

  it("audits source, PR, PIN and deployment actions", () => {
    expect(pinGate).toContain("development_pin_approved");
    expect(sourceApi).toContain("development_source_file_updated");
    expect(prApi).toContain("development_pull_request_created");
    expect(deployApi).toContain("development_vercel_preview_deploy");
    expect(deployApi).toContain("development_vercel_production_deploy");
  });
});
