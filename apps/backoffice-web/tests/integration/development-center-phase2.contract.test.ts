import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("Development Control Center Phase 2", () => {
  const consoleUi = src("src/components/it-admin/development-center-console.tsx");
  const editorPage = src("src/app/it-admin/development-editor/page.tsx");
  const editorUi = src("src/components/it-admin/development-editor-window.tsx");
  const workspaceApi = src("src/app/api/it-admin/v1/development/workspace/route.ts");
  const control = src("src/lib/development-control.ts");
  const workflow = src("../../.github/workflows/development-workspace.yml");

  it("moves status and quota details behind popups and keeps the main header compact", () => {
    expect(consoleUi).toContain('setStatusOpen(true)');
    expect(consoleUi).toContain('setQuotaOpen(true)');
    expect(consoleUi).toContain('title="สถานะระบบ"');
    expect(consoleUi).toContain('title="Quota / API Guard"');
    expect(consoleUi).not.toContain("DEVELOPMENT CONTROL CENTER · PHASE 1");
    expect(consoleUi).not.toContain("อ่านและแก้ไข Source Code จาก GitHub ผ่าน Server เท่านั้น");
  });

  it("supports a detached editor window for easier source editing", () => {
    expect(consoleUi).toContain('window.open(');
    expect(consoleUi).toContain('/it-admin/development-editor?');
    expect(editorPage).toContain('auth.platformRole !== "it_support"');
    expect(editorUi).toContain('/api/it-admin/v1/development/source');
    expect(editorUi).toContain('Security PIN');
    expect(editorUi).toContain('window.opener?.postMessage');
  });

  it("dispatches isolated workspace jobs only after IT Support PIN approval", () => {
    expect(workspaceApi).toContain('requireItSupportPin(context, body.pin, "isolated_workspace_run")');
    expect(workspaceApi).toContain('namespace: "it-development-workspace-run"');
    expect(workspaceApi).toContain("max: 4");
    expect(workspaceApi).toContain("15 * 60_000");
    expect(workspaceApi).toContain("development_workspace_dispatched");
  });

  it("uses a fixed workflow task allowlist instead of arbitrary shell commands", () => {
    expect(control).toContain('type DevelopmentWorkspaceTask = "verify" | "build" | "test"');
    expect(control).toContain("safeWorkspaceTask");
    expect(workflow).toContain("- verify");
    expect(workflow).toContain("- build");
    expect(workflow).toContain("- test");
    expect(workflow).not.toContain("command:");
  });

  it("runs builds in an ephemeral runner with limited permissions and no production secrets", () => {
    expect(workflow).toContain("runs-on: ubuntu-latest");
    expect(workflow).toContain("timeout-minutes: 25");
    expect(workflow).toContain("permissions:\n  contents: read");
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).toContain("Production/Vercel secrets: not injected");
  });

  it("does not add polling to the workspace UI", () => {
    expect(consoleUi).not.toContain("setInterval(");
    expect(consoleUi).not.toContain("setTimeout(");
    expect(consoleUi).toContain("loadWorkspaceRuns");
  });
});
