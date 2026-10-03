import { NextResponse } from "next/server";
import { buildDailySalesSummaryEmail, deliverCustomerEmail } from "@/lib/services/it-admin/customer-email-service";
import { getPrimarySupabaseServiceClient } from "@/lib/supabase-admin";

type Body = { token?: string };

type TopProduct = {
  rank: number | string;
  name: string;
  quantity: number | string;
  sales_amount: number | string;
};

type Candidate = {
  tenant_id: string;
  store_name: string;
  owner_user_id: string | null;
  owner_name: string | null;
  owner_email: string | null;
  business_date: string;
  completed_count: number | string;
  cancelled_count: number | string;
  gross_total: number | string;
  net_total: number | string;
  cash_total: number | string;
  bank_transfer_total: number | string;
  top_products: TopProduct[] | null;
};

function response(ok: boolean, status: number, payload: Record<string, unknown>) {
  return NextResponse.json({ ok, ...payload }, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

function previousBangkokDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const todayUtc = new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day)));
  todayUtc.setUTCDate(todayUtc.getUTCDate() - 1);
  return todayUtc.toISOString().slice(0, 10);
}

function number(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function POST(request: Request) {
  const db = getPrimarySupabaseServiceClient();

  try {
    const body = await request.json().catch(() => null) as Body | null;
    const token = String(body?.token ?? "").trim();
    if (token.length < 32) return response(false, 401, { error: "unauthorized" });

    const consumed = await db.rpc("consume_daily_sales_summary_worker_token", { p_token: token });
    if (consumed.error || consumed.data !== true) {
      return response(false, 401, { error: "unauthorized" });
    }

    const businessDate = previousBangkokDate();
    const candidates = await db.rpc("daily_sales_summary_candidates", {
      p_business_date: businessDate
    });

    if (candidates.error) {
      return response(false, 500, {
        error: "daily_sales_summary_candidates_failed",
        detail: candidates.error.message
      });
    }

    const rows = (candidates.data ?? []) as Candidate[];
    const results: Array<Record<string, unknown>> = [];
    let sent = 0;
    let alreadySent = 0;
    let blocked = 0;
    let failed = 0;

    for (const row of rows) {
      const message = buildDailySalesSummaryEmail({
        storeName: row.store_name,
        ownerName: row.owner_name,
        businessDate: row.business_date,
        grossTotal: number(row.gross_total),
        completedCount: number(row.completed_count),
        netTotal: number(row.net_total),
        cancelledCount: number(row.cancelled_count),
        cashTotal: number(row.cash_total),
        bankTransferTotal: number(row.bank_transfer_total),
        topProducts: (row.top_products ?? []).slice(0, 3).map((product) => ({
          rank: number(product.rank),
          name: String(product.name ?? ""),
          quantity: number(product.quantity),
          sales_amount: number(product.sales_amount)
        }))
      });

      const delivery = await deliverCustomerEmail({
        db,
        eventType: "daily_sales_summary",
        sourceId: row.tenant_id,
        tenantId: row.tenant_id,
        to: String(row.owner_email ?? ""),
        message,
        triggerMode: "automatic",
        actorUserId: null,
        eventKeySuffix: businessDate.replaceAll("-", "")
      });

      if (delivery.status === "sent") sent += 1;
      else if (delivery.status === "already_sent") alreadySent += 1;
      else if (delivery.status === "blocked" || delivery.status === "automatic_disabled") blocked += 1;
      else if (delivery.status === "failed") failed += 1;

      results.push({
        tenant_id: row.tenant_id,
        business_date: businessDate,
        completed_bills: number(row.completed_count),
        recipient: String(row.owner_email ?? "").toLowerCase() || null,
        status: delivery.status,
        delivery_id: delivery.delivery_id ?? null,
        message: delivery.message ?? null
      });
    }

    return response(true, 200, {
      business_date: businessDate,
      timezone: "Asia/Bangkok",
      candidate_count: rows.length,
      sent,
      already_sent: alreadySent,
      blocked,
      failed,
      results
    });
  } catch (error) {
    return response(false, 500, {
      error: error instanceof Error ? error.message : "daily_sales_summary_worker_failed"
    });
  }
}
