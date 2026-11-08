import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("website store application → IT notification contract", () => {
  const publicRoute = source("src/app/api/store-registration/route.ts");
  const summary = source("src/app/api/it-admin/v1/store-registrations/alert-summary/route.ts");
  const service = source("src/lib/services/it-admin/store-registration-support-alerts.ts");
  const notifier = source("src/components/it-admin/store-registration-notifier.tsx");
  const layout = source("src/app/(it-admin)/layout.tsx");
  const shell = source("src/components/layout/app-shell.tsx");
  const paymentNotifier = source("src/components/it-admin/support-request-notifier.tsx");
  const migration = source("../../supabase/migrations/20261108074500_store_registration_support_alerts.sql");

  it("keeps the public submission saved even if the email or push delivery fails", () => {
    expect(publicRoute).toContain("after(async () =>");
    expect(publicRoute).toContain("deliverStoreRegistrationSupportEmail(data.id)");
    expect(publicRoute).toContain("pushStoreRegistrationAlert(data.id, storeName)");
    expect(publicRoute).toContain("Promise.allSettled");
    expect(publicRoute).toContain('code: "registration_saved"');
    expect(publicRoute).toContain('.eq("submission_key", body.submission_key)');
    expect(publicRoute).not.toContain("sendSupportMail(");
  });

  it("counts only unprocessed applications and cannot expose its list publicly", () => {
    expect(summary).toContain("await requireItAdmin()");
    expect(summary).toContain('"store_registration_requests"');
    expect(summary).toContain('.in("status", ["pending", "failed"])');
    expect(summary).toContain('count: "exact"');
    expect(summary).toContain('"private, no-store"');
    expect(summary).not.toContain("owner_email");
    expect(summary).not.toContain("owner_phone");
    expect(summary).toContain("retryStoreRegistrationSupportEmails(4)");
  });

  it("shows dedicated badge, popup, browser notification and a correct target", () => {
    expect(layout).toContain("<StoreRegistrationNotifier />");
    expect(shell).toContain('targetHref === "/it-admin/store-registrations"');
    expect(shell).toContain("registrationUnread");
    expect(notifier).toContain('"cpipos-store-registration-unread"');
    expect(notifier).toContain('"cpipos-it-push-notification"');
    expect(notifier).toContain('new Notification(');
    expect(notifier).toContain('window.setInterval(() => {');
    expect(notifier).toContain('15_000');
    expect(notifier).toContain('window.sessionStorage');
    expect(notifier).toContain('href={LIST_PATH}');
    expect(paymentNotifier).toContain('payload.url?.startsWith("/it-admin/store-registrations")');
  });

  it("routes each new request to both management email and existing support inbox", () => {
    expect(service).toContain('"cuttingpointtech@gmail.com"');
    expect(service).toContain('supportMailboxAddress()');
    expect(service).toContain('sendSupportMail({ to: recipientList()');
    expect(service).toContain('"[IT Support] คำขอเปิดร้านใหม่');
    expect(service).toContain('kind: "request"');
    expect(service).toContain('url: "/it-admin/store-registrations"');
    expect(service).toContain('result.sent !== true');
    expect(service).toContain('if (row.status === "sent") return "already_sent"');
  });

  it("queues one delivery per registration without changing historical applications", () => {
    expect(migration).toContain("registration_id uuid primary key");
    expect(migration).toContain("after insert on public.store_registration_requests");
    expect(migration).toContain("on conflict (registration_id) do nothing");
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("revoke all on public.store_registration_alert_deliveries from public, anon, authenticated");
    expect(migration).not.toContain("insert into public.store_registration_alert_deliveries select");
    expect(service).toContain('.eq("attempt_count", row.attempt_count)');
    expect(service).toContain('STALE_CLAIM_MS');
    expect(service).toContain('RETRY_COOLDOWN_MS');
    expect(service).toContain('status: "failed"');
  });
});
