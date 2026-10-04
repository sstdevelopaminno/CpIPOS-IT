import "server-only";

import { createHash } from "node:crypto";
import { readEnv } from "@/lib/env";

export type SubscriptionSlipParsed = {
  payer_name: string | null;
  payee_name: string | null;
  payee_account: string | null;
  amount: number | null;
  transfer_datetime: string | null;
  transaction_id: string | null;
  reference_no: string | null;
  confidence: number | null;
};

export type SubscriptionSlipChecks = {
  amount_match: boolean | null;
  payee_match: boolean;
  datetime_present: boolean;
  confidence_pass: boolean;
  passed: boolean;
  issues: string[];
};

export type SubscriptionSlipScanResult = {
  status: "verified" | "needs_review" | "error";
  parsed: SubscriptionSlipParsed;
  checks: SubscriptionSlipChecks;
  model: string;
  error_message: string | null;
};

function emptyResult(message: string): SubscriptionSlipScanResult {
  return {
    status: "error",
    parsed: {
      payer_name: null,
      payee_name: null,
      payee_account: null,
      amount: null,
      transfer_datetime: null,
      transaction_id: null,
      reference_no: null,
      confidence: null
    },
    checks: {
      amount_match: null,
      payee_match: false,
      datetime_present: false,
      confidence_pass: false,
      passed: false,
      issues: [message]
    },
    model: "primary-cpipos-slip-scanner",
    error_message: message
  };
}

function bridgeToken() {
  const serviceRole = String(readEnv("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
  if (!serviceRole) return "";
  return createHash("sha256")
    .update("cpipos:internal-subscription-slip-scan:v1|")
    .update(serviceRole)
    .digest("hex");
}

export async function scanSubscriptionSlipFromPrimary(args: {
  tenantId: string;
  requestId: string;
  storagePath: string;
  expectedAmount: number;
  expectedPayeeName: string;
  expectedAccountNumber: string;
  expectedPromptPayId: string;
}): Promise<SubscriptionSlipScanResult> {
  const baseUrl = String(readEnv("CPIPOS_PRODUCTION_URL") ?? "").trim().replace(/\/$/, "");
  const token = bridgeToken();
  if (!baseUrl || !token) {
    return emptyResult("ระบบสแกนสลิปกลางยังไม่ได้ตั้งค่าครบ");
  }

  try {
    const response = await fetch(baseUrl + "/api/internal/subscription-slip-scan", {
      method: "POST",
      headers: {
        authorization: "Bearer " + token,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        tenant_id: args.tenantId,
        request_id: args.requestId,
        storage_path: args.storagePath,
        expected_amount: args.expectedAmount,
        expected_payee_name: args.expectedPayeeName,
        expected_account_number: args.expectedAccountNumber,
        expected_promptpay_id: args.expectedPromptPayId
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(35_000)
    });

    const payload = await response.json().catch(() => null) as {
      data?: { scan?: SubscriptionSlipScanResult };
      error?: { message?: string };
    } | null;

    if (!response.ok || !payload?.data?.scan) {
      return emptyResult(payload?.error?.message || "ระบบสแกนสลิปกลางไม่ตอบกลับ");
    }

    return payload.data.scan;
  } catch (error) {
    return emptyResult(error instanceof Error ? error.message : "เชื่อมต่อระบบสแกนสลิปกลางไม่สำเร็จ");
  }
}
