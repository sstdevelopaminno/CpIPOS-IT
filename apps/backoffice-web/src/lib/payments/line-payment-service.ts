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

type CycleRow = {
  id: string;
  package_id: string;
  period_start: string;
  period_end: string;
  amount_due: number | string;
  amount_paid: number | string;
  status: string;
  created_at: string;
};

type PackageRow = {
  id: string;
  code: string;
  name: string;
  monthly_price: number | string;
  yearly_price: number | string | null;
};

export type PublicPaymentAccount = {
  bank_name: string;
  account_name: string;
  account_number: string;
  promptpay_id: string;
  bank_transfer_ready: boolean;
  promptpay_ready: boolean;
};

export type LinePackagePaymentSnapshot = {
  store: {
    code: string;
    name: string;
  };
  package: {
    code: string | null;
    name: string;
    billing_interval: string | null;
    service_end: string | null;
  };
  due: null | {
    cycle_id: string;
    amount_due: number;
    amount_paid: number;
    outstanding_amount: number;
    currency: string;
    period_start: string;
    period_end: string;
  };
  payment_account: PublicPaymentAccount;
  qr_url: string | null;
  qr_page_url: string | null;
};

function read(value: unknown, max: number) {
  return String(value ?? "").trim().slice(0, max);
}

export function normalizePromptPayId(value: unknown) {
  return read(value, 40).replace(/[^d]/g, "");
}

function todayBangkok() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function amountText(amount: number) {
  const rounded = Math.round(amount * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
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

  const [account, contractResult, cyclesResult] = await Promise.all([
    getPublicPaymentAccount(),
    db.from("tenant_subscription_contracts")
      .select("id,package_id,status,billing_interval,amount_per_cycle,currency,started_at,ended_at")
      .eq("tenant_id", session.tenantId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<ContractRow>(),
    db.from("tenant_billing_cycles")
      .select("id,package_id,period_start,period_end,amount_due,amount_paid,status,created_at")
      .eq("tenant_id", session.tenantId)
      .order("period_start", { ascending: false })
      .limit(24)
      .returns<CycleRow[]>()
  ]);

  if (contractResult.error) throw new Error("subscription_contract_query_failed");
  if (cyclesResult.error) throw new Error("billing_cycle_query_failed");

  const contract = contractResult.data ?? null;
  const today = todayBangkok();
  const cycles = cyclesResult.data ?? [];

  const dueCycle = cycles.find((cycle) => {
    const amountDue = Number(cycle.amount_due ?? 0);
    const amountPaid = Number(cycle.amount_paid ?? 0);
    const outstanding = Math.max(0, amountDue - amountPaid);
    return cycle.status !== "paid"
      && cycle.period_start <= today
      && Number.isFinite(outstanding)
      && outstanding > 0.009;
  }) ?? null;

  const packageId = dueCycle?.package_id ?? contract?.package_id ?? null;
  let packageRow: PackageRow | null = null;
  if (packageId) {
    const packageResult = await db.from("subscription_packages")
      .select("id,code,name,monthly_price,yearly_price")
      .eq("id", packageId)
      .maybeSingle<PackageRow>();
    if (packageResult.error) throw new Error("subscription_package_query_failed");
    packageRow = packageResult.data ?? null;
  }

  let due: LinePackagePaymentSnapshot["due"] = null;
  let qrUrl: string | null = null;
  let qrPageUrl: string | null = null;

  if (dueCycle) {
    const amountDue = Number(dueCycle.amount_due ?? 0);
    const amountPaid = Number(dueCycle.amount_paid ?? 0);
    const outstanding = Math.round(Math.max(0, amountDue - amountPaid) * 100) / 100;

    due = {
      cycle_id: dueCycle.id,
      amount_due: amountDue,
      amount_paid: amountPaid,
      outstanding_amount: outstanding,
      currency: contract?.currency || "THB",
      period_start: dueCycle.period_start,
      period_end: dueCycle.period_end
    };

    if (account.promptpay_ready) {
      const urls = buildPromptPayUrls(account.promptpay_id, outstanding);
      qrUrl = urls.qrUrl;
      qrPageUrl = urls.pageUrl;
    }
  }

  return {
    store: {
      code: session.storeCode,
      name: session.storeName
    },
    package: {
      code: packageRow?.code ?? null,
      name: packageRow?.name ?? "ยังไม่กำหนดแพ็กเกจ",
      billing_interval: contract?.billing_interval ?? null,
      service_end: contract?.ended_at ?? null
    },
    due,
    payment_account: account,
    qr_url: qrUrl,
    qr_page_url: qrPageUrl
  };
}
