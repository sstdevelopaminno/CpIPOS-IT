import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("LINE Support OTP sender and authorization hardening", () => {
  const auth = source("src/lib/support-chat/line-support-auth.ts");
  const route = source("src/app/api/support/line/auth/route.ts");
  const mail = source("src/lib/services/it-admin/support-mail-service.ts");
  const script = source("../../tools/customer-mail-bridge/Code.gs");
  const manifest = JSON.parse(source("../../tools/customer-mail-bridge/appsscript.json"));

  it("sends OTP only to the current primary owner and never returns the plaintext code to LINE", () => {
    expect(auth).toContain("primary_owner_user_id");
    expect(auth).toContain("to: store.ownerEmail");
    expect(auth).toContain("otpDigest(challengeId, otp)");
    expect(auth).toContain("maskedEmail: maskEmail(store.ownerEmail)");
    expect(auth).not.toContain("return { otp");
    expect(route).toContain("masked_email: challenge.maskedEmail");
  });

  it("fails closed if Support Mail fails to acknowledge the actual send", () => {
    expect(mail).toContain('action: "send_new"');
    expect(mail).toContain("receipt.sent !== true");
    expect(mail).toContain("normalizeMailbox(receipt.mailbox) !== SUPPORT_MAILBOX");
    expect(mail).toContain('"support_mail_send_unconfirmed"');
    expect(script).toContain("sent: true");
    expect(auth).toContain('console.error("[line-support-otp-email]"');
    expect(auth).toContain('.delete().eq("id", challengeId)');
  });

  it("explicitly authorizes the Support Google account before Web App deployment", () => {
    expect(manifest.oauthScopes).toContain("https://www.googleapis.com/auth/userinfo.email");
    expect(manifest.oauthScopes).toContain("https://mail.google.com/");
    expect(manifest.oauthScopes).toContain("https://www.googleapis.com/auth/script.send_mail");
    expect(script).toContain("authorizeSupportMailBridge");
    expect(script).toContain("GmailApp.getAliases()");
    expect(script).toContain("!mailbox || !effective || mailbox !== effective");
  });

  it("rejects an existing LINE binding after primary owner changes", () => {
    expect(auth).toContain("verified_owner_user_id");
    expect(auth).toContain("result.data.verified_owner_user_id !== store.ownerUserId");
    expect(auth).toContain("binding.data.verified_owner_user_id !== tenant.data.primary_owner_user_id");
    expect(auth).toContain("!tenant.data?.is_active");
    expect(auth).toContain("line_support_binding_revoked");
  });

  it("requires a one-time atomic consume before issuing a chat binding", () => {
    const consumed = auth.indexOf('const consumed = await db.from("line_support_verification_challenges")');
    const binding = auth.indexOf('const binding = await db.from("line_support_bindings").upsert({');
    expect(consumed).toBeGreaterThan(0);
    expect(binding).toBeGreaterThan(consumed);
    expect(auth).toContain('.eq("attempt_count", Number(challenge.attempt_count ?? 0))');
    expect(auth).toContain('.is("consumed_at", null)');
    expect(auth).toContain('.gt("expires_at", now)');
    expect(auth).toContain(".select(\"id\")");
    expect(auth).toContain('if (consumed.error || !consumed.data)');
    expect(auth).toContain("otpDigest(challengeId, otp)");
  });

  it("keeps expiry, attempt counts, independent LINE token verification and fail-closed rate limits", () => {
    expect(auth).toContain("OTP_TTL_MINUTES = 10");
    expect(auth).toContain("MAX_OTP_ATTEMPTS = 5");
    expect(auth).toContain('method: "POST"');
    expect(auth).toContain("https://api.line.me/oauth2/v2.1/verify");
    expect(route).toContain('namespace: "line-support-otp-request"');
    expect(route).toContain('namespace: "line-support-otp-verify"');
    expect(route).toContain("failClosedOnBackendError: true");
  });
});
