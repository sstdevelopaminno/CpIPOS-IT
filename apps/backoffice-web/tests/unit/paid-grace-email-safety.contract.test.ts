import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root=(path:string)=>readFileSync(resolve(process.cwd(),path),"utf8");
const migration=root("../../supabase/migrations/20261114080000_paid_grace_month_and_recovery_mail_policy.sql");
const updatedPolicy=root("../../supabase/migrations/20261114092000_paid_two_unpaid_months_grace_and_thirty_day_retention.sql");
const mail=root("src/lib/services/it-admin/customer-email-service.ts");
const reminderWorker=root("src/app/api/internal/subscription-reminders/run/route.ts");
const bridge=root("../../tools/customer-mail-bridge/Code.gs");
const review=root("src/components/it-admin/tenant-deletion-review-console.tsx");

describe("paid subscription grace and email safety",()=>{
  it("keeps trial unchanged and adds one calendar month grace plus 30 more days retention",()=>{
    expect(migration).toContain("subscription_expires_at+interval '1 month'");
    expect(migration).toContain("subscription_expires_at+interval '1 month'+interval '30 days'");
    expect(migration).toContain("l.subscription_expires_at + interval '1 month' + interval '30 days'");
    expect(migration).toContain("trial_expires_at + interval '8 days'");
    expect(migration).toContain("requires_it_confirmation");
    expect(migration).not.toContain("paid_access_grace_days',3");
  });
  it("permits a still-unpaid single cycle during the month without overriding verified payment facts",()=>{
    expect(migration).toContain("v_now < v_expiry + interval '1 month'");
    expect(migration).toContain("bc.period_start::timestamp at time zone 'Asia/Bangkok'");
    expect(migration).toContain("paid_grace_day_");
    expect(migration).toContain("paid_suspended_notice");
  });
  it("supersedes one-month grace with two unpaid months, preserving another 30 days for IT review",()=>{
    expect(updatedPolicy).toContain("subscription_expires_at+interval '2 months'");
    expect(updatedPolicy).toContain("subscription_expires_at+interval '2 months'+interval '30 days'");
    expect(updatedPolicy).toContain("subscription_expires_at + interval '2 months'");
    expect(updatedPolicy).toContain("paid_access_grace_months',2");
    expect(updatedPolicy).toContain("trial_expires_at + interval '8 days'");
    expect(updatedPolicy).toContain("requires_it_confirmation");
    expect(updatedPolicy).toContain("v_now < v_expiry + interval '2 months'");
  });
  it("opens a second unpaid invoice only in month two using approved discount triggers",()=>{
    expect(updatedPolicy).toContain("grace_second_unpaid_cycle");
    expect(updatedPolicy).toContain("v_now >= v_due + interval '1 month'");
    expect(updatedPolicy).toContain("v_now < v_due + interval '2 months'");
    expect(updatedPolicy).toContain("on conflict (tenant_id,package_id,period_start,period_end)");
    expect(updatedPolicy).toContain("where status <> 'cancelled'");
    expect(updatedPolicy).toContain("'automatic_contract_cycle'");
  });
  it("bounds all automated email and spaces billing notices",()=>{
    expect(mail).toContain("AUTO_EMAIL_24H_CAP = 50");
    expect(mail).toContain("BILLING_REMINDER_COOLDOWN_HOURS = 72");
    expect(mail).toContain('input.triggerMode === "automatic"');
    expect(mail).toContain("automaticEmailBudgetProblem");
    expect(mail).toContain("suspensionNotice");
    expect(reminderWorker).toContain('row.milestone==="paid_suspended_notice"');
    expect(bridge).toContain("MailApp.getRemainingDailyQuota()");
    expect(bridge).toContain("CPIPOS_MAIL_MIN_REMAINING_QUOTA");
  });
  it("reflects the new policy on the IT screen",()=>{
    expect(review).toContain("ใช้งานต่อ 2 เดือน");
    expect(review).toContain("30 additional days");
  });
});
