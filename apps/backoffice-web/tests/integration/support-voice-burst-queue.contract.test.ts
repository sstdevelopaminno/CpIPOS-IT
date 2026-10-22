import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("Support voice burst queue", () => {
  const edge = src("../../supabase-communications/functions/support-chat-api/index.ts");
  const provider = src("src/components/it-admin/it-support-voice-provider.tsx");

  it("keeps waiting callers out of media signaling until an agent accepts", () => {
    expect(edge).toContain('status: "requested"');
    expect(edge).toContain('"get_voice_queue_status"');
    expect(edge).toContain("voiceQueueSnapshot");
    expect(edge).toContain("CONNECTED_CALL_STATUSES");
    expect(edge.indexOf("signaling_key: newSignalingKey()")).toBeGreaterThan(edge.indexOf('action === "accept_voice_call"'));
  });

  it("uses a renewable waiting-call lease to remove ghost callers", () => {
    expect(edge).toContain("WAITING_CALL_LEASE_MS");
    expect(edge).toContain("expireStaleWaitingCalls");
    expect(edge).toContain('end_reason: "waiting_client_timeout"');
    expect(edge).toContain('.lt("updated_at", waitingCallCutoffIso())');
    expect(edge).toContain('activeCall.status === "requested"');
  });

  it("returns FIFO queue position without counting stale waiting calls", () => {
    expect(edge).toContain('.order("requested_at", { ascending: true })');
    expect(edge).toContain('.lte("requested_at", requestedAt)');
    expect(edge).toContain('.gte("updated_at", freshSince)');
    expect(edge).toContain("ahead_count");
    expect(edge).toContain("waiting_count");
    expect(edge).toContain("active_calls");
  });

  it("jitters idle IT polling to avoid a synchronized thundering herd", () => {
    expect(provider).toContain("Math.random()");
    expect(provider).toContain("9_000");
    expect(provider).toContain("4_500");
    expect(provider).toContain("window.setTimeout");
    expect(provider).not.toContain("fastTransferRefresh ? 2_500 : 30_000");
  });
});
