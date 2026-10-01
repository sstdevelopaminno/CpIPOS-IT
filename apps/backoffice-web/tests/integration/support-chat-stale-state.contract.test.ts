import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("IT support stale conversation recovery", () => {
  const consoleUi = src("src/components/it-admin/support-chat-console.tsx");
  const vercel = JSON.parse(src("vercel.json"));

  it("removes a deleted conversation from active UI state on 404", () => {
    expect(consoleUi).toContain("response.status === 404");
    expect(consoleUi).toContain("clearGoneConversation(id)");
    expect(consoleUi).toContain("clearGoneConversation(selectedId)");
    expect(consoleUi).toContain('setError("")');
  });

  it("disables automatic Vercel Git deployments", () => {
    expect(vercel.git?.deploymentEnabled?.["*"]).toBe(false);
    expect(vercel.git?.deploymentEnabled?.main).toBe(true);
  });
});
