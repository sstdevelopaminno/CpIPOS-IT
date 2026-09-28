import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("Support Chat Phase 1 - IT Control Plane", () => {
  const layout = src("src/app/(it-admin)/layout.tsx");
  const shell = src("src/components/layout/app-shell.tsx");
  const notifier = src("src/components/it-admin/support-chat-notifier.tsx");
  const consoleUi = src("src/components/it-admin/support-chat-console.tsx");
  const service = src("src/lib/support-chat/support-chat-service.ts");
  const detail = src("src/app/api/it-admin/v1/support-chat/conversations/[conversationId]/route.ts");
  const users = src("src/app/api/it-admin/v1/it-users/route.ts");

  it("exposes Support Chat to both IT Admin and IT Support navigation", () => {
    const matches = layout.match(/href: "\/it-admin\/support-chat"/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
    expect(layout).toContain('icon: "chat"');
    expect(shell).toContain('"chat"');
  });

  it("subscribes to realtime heads without polling", () => {
    expect(notifier).toContain('"postgres_changes"');
    expect(notifier).toContain('table: "support_chat_heads"');
    expect(notifier).toContain("new Notification");
    expect(notifier).not.toContain("setInterval(");
    expect(consoleUi).not.toContain("setInterval(");
  });

  it("auto-claims an unassigned conversation when IT opens it", () => {
    expect(detail).toContain('if (!data.conversation.assigned_user_id)');
    expect(detail).toContain('"claim_conversation"');
    expect(detail).toContain('action: "support_chat_claimed"');
  });

  it("uses the signed cross-project bridge function", () => {
    expect(service).toContain("issue_support_chat_bridge_token");
    expect(service).toContain("support-chat-api");
  });

  it("supports IT profile avatars with system-logo fallback", () => {
    expect(users).toContain("avatar_url");
    expect(consoleUi).toContain("/brand/cpipos-symbol-sidebar.png");
  });
});
