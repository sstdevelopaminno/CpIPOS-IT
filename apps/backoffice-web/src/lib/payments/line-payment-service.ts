import "server-only";

import { getPrimarySupabaseServiceClient } from "@/lib/supabase-admin";
import type { LineSupportSession } from "@/lib/support-chat/line-support-auth";

type PaymentAccountRow = {
  billing_bank_name: string;
  billing_bank_account_name: string;
  billing_bank_account_number: string;
  billing_promptpay_id: string;
};

type ContractRow = {
  id: string;
  package_id: string;
  status: string;
  billing_interval: string;
  amount_per_cycle: number | string;
  currency: string;
  started_at: string;
  ended_at: string | null;
};

type PackageRow = {
  id: string;
  code: string;
  name: string;
  monthly_price: number | string;
  yearly_price: number | string | null;
};

type PaymentRequestRow = {
  id: string;
  status: string;
  submitted_at: string;
  review_note: string | null;
  metadata: Record<string, unknown> | null;
};

export type PublicPaymentAccount = {
  bank_name: string;
  account_name: string;
  account_number: string;
  promptpay_id: string;
  bank_transfer_ready: boolean;
  promptpay_ready: boolean;
};

export type LinePaymentRequestSummary = {
  id: string;
  status: string;
  submitted_at: string;
  review_note: string | null;
  scan_status: string | null;
};

export type LinePackagePaymentSnapshot = {
  store: {
    code: string;
    name: string;
  };
  package: {
    id: string | null;
    code: string | null;
    name: string;
    billing_interval: string | null;
    service_end: string | null;
  };
  due: null | {
    amount_due: number;
    amount_paid: number;
    outstanding_amount: number;
    currency: string;
    due_date: string;
    period_start: string;
    period_end: string;
    source: string;
    status: string;
    kind: string;
    billing_cycle_id: string | null;
    self_service_payment_allowed: boolean;
    support_required: boolean;
  };
  open_request: LinePaymentRequestSummary | null;
  latest_request: LinePaymentRequestSummary | null;
  payment_account: PublicPaymentAccount;
  qr_url: string | null;
  qr_page_url: string | null;
};

function read(value: unknown, max: number) {
  return String(value ?? "").trim().slice(0, max);
}

export function normalizePromptPayId(value: unknown) {
  return read(value, 40).replace(/[^\d]/g, "");
}

function bangkokDate(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addBillingPeriod(dateText: string, interval: string) {
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(dateText)
    ? new Date(dateText + "T00:00:00Z")
    : new Date(dateText);
  if (Number.isNaN(parsed.getTime())) return dateText;
  if (interval === "yearly") parsed.setUTCFullYear(parsed.getUTCFullYear() + 1);
  else parsed.setUTCMonth(parsed.getUTCMonth() + 1);
  return parsed.toISOString().slice(0, 10);
}

function amountText(amount: number) {
  const rounded = Math.round(amount * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

function paymentSummary(row: PaymentRequestRow | null | undefined): LinePaymentRequestSummary | null {
  if (!row) return null;
  const slipAi = row.metadata?.slip_ai;
  const scanStatus = slipAi && typeof slipAi === "object" && !Array.isArray(slipAi)
    ? String((slipAi as Record<string, unknown>).status ?? "") || null
    : null;
  return {
    id: row.id,
    status: row.status,
    submitted_at: row.submitted_at,
    review_note: row.review_note,
    scan_status: scanStatus
  };
}

export function buildPromptPayUrls(promptPayId: string, amount: number) {
  const id = normalizePromptPayId(promptPayId);
  if (!id || !Number.isFinite(amount) || amount <= 0) {
    return { qrUrl: null, pageUrl: null };
  }
  const value = amountText(amount);
  const base = `https://promptpay.io/${id}/${value}`;
  return { qrUrl: base + ".png", pageUrl: base };
}

export async function getPublicPaymentAccount(): Promise<PublicPaymentAccount> {
  const db = getPrimarySupabaseServiceClient();
  const found = await db.from("it_communication_settings")
    .select("billing_bank_name,billing_bank_account_name,billing_bank_account_number,billing_promptpay_id")
    .eq("id", "default")
    .single<PaymentAccountRow>();

  if (found.error || !found.data) throw new Error("payment_account_settings_unavailable");

  const promptpayId = normalizePromptPayId(found.data.billing_promptpay_id);
  const bankName = read(found.data.billing_bank_name, 120);
  const accountName = read(found.data.billing_bank_account_name, 180);
  const accountNumber = read(found.data.billing_bank_account_number, 40);

  return {
    bank_name: bankName,
    account_name: accountName,
    account_number: accountNumber,
    promptpay_id: promptpayId,
    bank_transfer_ready: Boolean(bankName && accountName && accountNumber),
    promptpay_ready: /^(?:\d{10}|\d{13})$/.test(promptpayId)
  };
}

export async function getLinePackagePaymentSnapshot(
  session: LineSupportSession
): Promise<LinePackagePaymentSnapshot> {
  const db = getPrimarySupabaseServiceClient();

  const ensure = await db.rpc("ensure_tenant_subscription_billing_cycle", {
    p_tenant_id: session.tenantId
  });
  if (ensure.error) throw new Error("subscription_billing_cycle_sync_failed");

  const [account, contractResult, requestsResult, dueResult] = await Promise.all([
    getPublicPaymentAccount(),
    db.from("tenant_subscription_contracts")
      .select("id,package_id,status,billing_interval,amount_per_cycle,currency,started_at,ended_at")
      .eq("tenant_id", session.tenantId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<ContractRow>(),
    db.from("tenant_subscription_payment_requests")
      .select("id,status,submitted_at,review_note,metadata")
      .eq("tenant_id", session.tenantId)
      .order("created_at", { ascending: false })
      .limit(10)
      .returns<PaymentRequestRow[]>(),
    db.rpc("subscription_billing_due_state", { p_tenant_id: session.tenantId })
  ]);

  if (contractResult.error) throw new Error("subscription_contract_query_failed");
  if (requestsResult.error) throw new Error("subscription_payment_request_query_failed");
  if (dueResult.error) throw new Error("subscription_billing_due_state_failed");

  const contract = contractResult.data ?? null;
  const packageId = contract?.package_id ?? null;
  let packageRow: PackageRow | null = null;

  if (packageId) {
    const packageResult = await db.from("subscription_packages")
      .select("id,code,name,monthly_price,yearly_price")
      .eq("id", packageId)
      .maybeSingle<PackageRow>();
    if (packageResult.error) throw new Error("subscription_package_query_failed");
    packageRow = packageResult.data ?? null;
  }

  const requests = requestsResult.data ?? [];
  const openRow = requests.find((row) => row.status === "pending" || row.status === "under_review") ?? null;
  const latestRow = requests[0] ?? null;
  const rawDue=(dueResult.data??{}) as Record<string,unknown>;
  const dueAmount=Number(rawDue.amount_due??0);
  const paidAmount=Number(rawDue.amount_paid??0);
  const outstanding=Number(rawDue.outstanding??Math.max(0,dueAmount-paidAmount));
  const periodStart=String(rawDue.next_period_start??"");
  const periodEnd=String(rawDue.next_period_end??"");
  const dueStatus=String(rawDue.status??"");
  const selfService=rawDue.self_service_payment_allowed===true;
  const supportRequired=rawDue.support_required===true;

  let due: LinePackagePaymentSnapshot["due"] = null;
  let qrUrl: string | null = null;
  let qrPageUrl: string | null = null;

  if(packageRow && Number.isFinite(outstanding) && outstanding>0 && periodStart && periodEnd && dueStatus!=="not_payable"){
    due={
      amount_due:Math.round(dueAmount*100)/100,
      amount_paid:Math.round(paidAmount*100)/100,
      outstanding_amount:Math.round(outstanding*100)/100,
      currency:String(rawDue.currency??contract?.currency??"THB"),
      due_date:periodStart,
      period_start:periodStart,
      period_end:periodEnd,
      source:String(rawDue.source??"automatic_billing_cycle"),
      status:dueStatus,
      kind:String(rawDue.kind??"subscription"),
      billing_cycle_id:typeof rawDue.billing_cycle_id==="string"?rawDue.billing_cycle_id:null,
      self_service_payment_allowed:selfService,
      support_required:supportRequired
    };
    if(account.promptpay_ready && !openRow && selfService && !supportRequired){
      const urls=buildPromptPayUrls(account.promptpay_id,due.outstanding_amount);
      qrUrl=urls.qrUrl;
      qrPageUrl=urls.pageUrl;
    }
  }

  return {
    store:{code:session.storeCode,name:session.storeName},
    package:{
      id:packageRow?.id??null,
      code:packageRow?.code??null,
      name:packageRow?.name??"ยังไม่กำหนดแพ็กเกจ",
      billing_interval:contract?.billing_interval??null,
      service_end:contract?.ended_at??null
    },
    due,
    open_request:paymentSummary(openRow),
    latest_request:paymentSummary(latestRow),
    payment_account:account,
    qr_url:qrUrl,
    qr_page_url:qrPageUrl
  };
}
