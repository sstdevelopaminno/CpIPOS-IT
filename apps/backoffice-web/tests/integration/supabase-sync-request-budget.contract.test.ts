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
  it("keeps human actor attribution mandatory and restricts system events to privileged server writers", () => {
    const migration = src("../../supabase/migrations/20261125063155_audit_system_actor_integrity.sql");
    expect(migration).toContain("CHECK (actor_user_id IS NOT NULL OR actor_role = 'system')");
    expect(migration).toContain("AS RESTRICTIVE");
    expect(migration).toContain("FOR INSERT");
    expect(migration).toContain("TO PUBLIC");
    expect(migration).toContain("WITH CHECK (actor_user_id IS NOT NULL)");
    expect(migration).not.toMatch(/DISABLE ROW LEVEL SECURITY/i);
    expect(audit).toContain('(!payload.actorUserId && payload.actorRole !== "system")');
  });

  it("preserves text device codes without putting them in the UUID target column", () => {
    const auth = src("src/lib/server/auth-flow.ts");
    expect(auth).not.toContain("targetId: validated.deviceCode");
    expect(auth).toContain('targetType: "device"');
    expect(auth).toContain("deviceCode: validated.deviceCode");
    expect(audit).toContain('login attempt insert failed');
  });

});
