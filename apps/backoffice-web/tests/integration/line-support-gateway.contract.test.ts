import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("LINE Support Gateway", () => {
  const auth = src("src/lib/support-chat/line-support-auth.ts");
  const chat = src("src/lib/support-chat/line-support-chat-service.ts");
  const authRoute = src("src/app/api/support/line/auth/route.ts");
  const chatRoute = src("src/app/api/support/line/chat/route.ts");
  const client = src("src/components/support/line-support-client.tsx");
  const migration = src("../../supabase/migrations/20261004133000_line_support_gateway_identity.sql");
  const communications = src("../../supabase-communications/functions/support-chat-api/index.ts");
  const notifier = src("src/components/it-admin/support-chat-notifier.tsx");

  it("verifies LINE ID tokens server-side against the configured channel", () => {
    expect(auth).toContain("https://api.line.me/oauth2/v2.1/verify");
    expect(auth).toContain('DEFAULT_LINE_LOGIN_CHANNEL_ID = "2011852850"');
    expect(auth).toContain("id_token: token");
    expect(auth).toContain("client_id: clientId");
  });

  it("never treats the six-digit store code as sufficient authentication", () => {
    expect(authRoute).toContain("verifyLineIdToken");
    expect(authRoute).toContain("findActiveLineSupportBinding");
    expect(authRoute).toContain("requestLineSupportOtp");
    expect(authRoute).toContain("verifyLineSupportOtp");
    expect(auth).toContain("primary_owner_user_id");
  });

  it("stores only hashed OTP challenges and keeps identity tables server-only", () => {
    expect(migration).toContain("otp_hash text not null");
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("revoke all on public.line_support_bindings from public, anon, authenticated");
    expect(migration).toContain("revoke all on public.line_support_verification_challenges from public, anon, authenticated");
    expect(auth).toContain('createHmac("sha256"');
  });

  it("uses an HttpOnly short-lived support session and re-checks the active binding", () => {
    expect(auth).toContain('cpipos:line-support-session:v1');
    expect(auth).toContain("httpOnly: true");
    expect(auth).toContain("SESSION_TTL_SECONDS = 30 * 60");
    expect(auth).toContain('.eq("is_active", true)');
    expect(auth).toContain("line_support_binding_revoked");
  });

  it("reuses the canonical Support Chat bridge and realtime head mirror", () => {
    expect(chat).toContain("issue_support_chat_bridge_token");
    expect(chat).toContain('p_actor_type: "store"');
    expect(chat).toContain("mirrorSupportChatHead");
    expect(chat).toContain('publishOptimisticSupportChatHead(conversationId, "store", message)');
  });

  it("rate limits first-time verification and customer message sends", () => {
    expect(authRoute).toContain('namespace: "line-support-otp-request"');
    expect(authRoute).toContain('namespace: "line-support-otp-verify"');
    expect(chatRoute).toContain('namespace: "line-support-chat-message"');
    expect(chatRoute).toContain("failClosedOnBackendError: true");
  });

  it("opens the canonical chat in the same auth response and shows an immediate transition screen", () => {
    expect(authRoute).toContain("openLineSupportConversation");
    expect(authRoute).toContain("chat");
    expect(client).toContain('"connecting"');
    expect(client).toContain("กำลังเปิดแชท Support");
    expect(client).toContain("applyChat(result.chat)");
  });

  it("keeps close operations idempotent across network retries", () => {
    expect(communications).toContain("already_closed: true");
    expect(communications).toContain('if (nextStatus === "closed")');
  });

  it("preserves an open chat when the LINE webview is closed accidentally", () => {
    expect(client).not.toContain('addEventListener("pagehide"');
    expect(client).toContain("3_000");
    expect(client).toContain("ต้องการจบการสนทนานี้จริงหรือไม่");
  });

  it("adds an IT inbox polling fallback when realtime stalls", () => {
    expect(notifier).toContain("fallbackPoll");
    expect(notifier).toContain("2500");
    expect(notifier).toContain("refreshSnapshot(true)");
  });

  it("updates LINE sends optimistically without a second history request", () => {
    expect(client).toContain('"line-local:" + Date.now()');
    expect(client).toContain("setMessages((current) => [...current, optimistic])");
    expect(client).toContain("sent.message");
  });

  it("uses LIFF only as the entry identity surface and keeps chat on CpIPOS APIs", () => {
    expect(client).toContain("https://static.line-scdn.net/liff/edge/2/sdk.js");
    expect(client).toContain('DEFAULT_LIFF_ID = "2011852850-5tjQo09l"');
    expect(client).toContain("getIDToken()");
    expect(client).toContain('"/api/support/line/chat"');
    expect(client).not.toContain("api.line.me/v2/bot/message");
  });
});
