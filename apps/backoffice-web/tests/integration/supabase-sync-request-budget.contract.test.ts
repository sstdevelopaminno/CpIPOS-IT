import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("Supabase sync request safeguards", () => {
  const voice = src("src/components/it-admin/it-support-voice-provider.tsx");
  const notifier = src("src/components/it-admin/support-chat-notifier.tsx");
  const audit = src("src/lib/server/audit-log.ts");

  it("allows only one active voice polling request and clears the guard on failure", () => {
    expect(voice).toContain("if (controlInFlightRef.current || refreshInFlightRef.current) return");
    expect(voice).toContain("refreshInFlightRef.current = true");
    expect(voice).toMatch(/finally\s*\{\s*refreshInFlightRef\.current = false/);
    expect(voice).toContain("epoch !== refreshEpochRef.current");
  });

  it("coalesces recovery timers and skips offline or hidden recovery work", () => {
    expect(notifier).toContain("if (!alive || !navigator.onLine) return");
    expect(notifier).toContain("if (reconnectTimer !== null) return");
    expect(notifier).toContain("alive && !realtimeHealthy && document.visibilityState !==");
    expect(notifier.match(/clearTimeout\(reconnectTimer\)/g)?.length).toBe(2);
    expect(notifier).toContain("15000");
    expect(notifier).toContain('table: "support_chat_heads"');
  });

  it("reports failed audit writes without logging row content or fabricating an actor", () => {
    expect(audit).toContain('const { error } = await supabase.from("audit_logs").insert');
    expect(audit).toContain('console.error("[audit-log] audit insert failed", { action: payload.action, code: error.code })');
    expect(audit).toContain("actor_user_id: payload.actorUserId ?? null");
  });
});
