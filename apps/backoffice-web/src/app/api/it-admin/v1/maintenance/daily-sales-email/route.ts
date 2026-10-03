import { appendAuditLog } from "@/lib/audit-log";
import { fail, ok } from "@/lib/http";
import { assertItSupportAction, guardItAdminError, requireItAdmin } from "@/lib/it-admin-guard";
import {
  buildDailySalesSummaryEmail,
  customerEmailProblem,
  deliverCustomerEmail
} from "@/lib/services/it-admin/customer-email-service";

export const dynamic = "force-dynamic";

type TenantRow = {
  id: string;
  name: string;
  display_name: string | null;
  primary_owner_user_id: string | null;
  is_active: boolean;
};

type SettingRow = {
  tenant_id: string;
  enabled: boolean;
  updated_at: string;
};

type ProfileRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  is_active: boolean;
  archived_at: string | null;
};

type DeliveryRow = {
  id: string;
  event_key: string;
  tenant_id: string | null;
  recipient_email: string;
  status: "pending" | "sending" | "sent" | "blocked" | "failed";
  attempt_count: number;
  last_attempt_at: string | null;
  sent_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

type TopProduct = {
  rank: number | string;
  name: string;
  quantity: number | string;
  sales_amount: number | string;
};

type CandidateRow = {
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

function amount(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function previousBangkokDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const date = new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day)));
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function businessDateFromEventKey(eventKey: string) {
  const match = eventKey.match(/^daily_sales_summary:[0-9a-f-]{36}:(\d{8})$/i);
  if (!match) return null;
  const compact = match[1];
  const date = `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
  const parsed = new Date(date + "T00:00:00Z");
  return Number.isFinite(parsed.getTime()) ? date : null;
}

async function loadOverview(context: Awaited<ReturnType<typeof requireItAdmin>>) {
  const [tenantsResult, settingsResult, deliveriesResult] = await Promise.all([
    context.supabase
      .from("tenants")
      .select("id,name,display_name,primary_owner_user_id,is_active")
      .order("created_at", { ascending: false })
      .limit(1000)
      .returns<TenantRow[]>(),
    context.supabase
      .from("tenant_daily_sales_email_settings")
      .select("tenant_id,enabled,updated_at")
      .limit(1000)
      .returns<SettingRow[]>(),
    context.supabase
      .from("customer_email_deliveries")
      .select("id,event_key,tenant_id,recipient_email,status,attempt_count,last_attempt_at,sent_at,last_error,created_at,updated_at")
      .eq("event_type", "daily_sales_summary")
      .order("created_at", { ascending: false })
      .limit(1000)
      .returns<DeliveryRow[]>()
  ]);

  if (tenantsResult.error) throw new Error("daily_sales_email_tenants_failed:" + tenantsResult.error.message);
  if (settingsResult.error) throw new Error("daily_sales_email_settings_failed:" + settingsResult.error.message);
  if (deliveriesResult.error) throw new Error("daily_sales_email_deliveries_failed:" + deliveriesResult.error.message);

  const tenants = tenantsResult.data ?? [];
  const settings = new Map((settingsResult.data ?? []).map((row) => [row.tenant_id, row]));
  const latestByTenant = new Map<string, DeliveryRow>();
  for (const row of deliveriesResult.data ?? []) {
    if (row.tenant_id && !latestByTenant.has(row.tenant_id)) latestByTenant.set(row.tenant_id, row);
  }

  const ownerIds = [...new Set(tenants.map((tenant) => tenant.primary_owner_user_id).filter((id): id is string => Boolean(id)))];
  const profiles = new Map<string, ProfileRow>();
  for (let index = 0; index < ownerIds.length; index += 100) {
    const result = await context.supabase
      .from("users_profiles")
      .select("id,email,full_name,is_active,archived_at")
      .in("id", ownerIds.slice(index, index + 100))
      .returns<ProfileRow[]>();
    if (result.error) throw new Error("daily_sales_email_owner_profiles_failed:" + result.error.message);
    for (const profile of result.data ?? []) profiles.set(profile.id, profile);
  }

  const rows = tenants.map((tenant) => {
    const setting = settings.get(tenant.id);
    const delivery = latestByTenant.get(tenant.id) ?? null;
    const owner = tenant.primary_owner_user_id ? profiles.get(tenant.primary_owner_user_id) ?? null : null;
    const email = owner?.email?.trim().toLowerCase() ?? "";
    const emailProblem = email ? customerEmailProblem(email) : "ยังไม่มีอีเมล Owner";
    const ownerReady = Boolean(owner && owner.is_active && !owner.archived_at && email && !emailProblem);
    const businessDate = delivery ? businessDateFromEventKey(delivery.event_key) : null;

    return {
      tenant_id: tenant.id,
      tenant_name: tenant.display_name || tenant.name,
      tenant_active: tenant.is_active,
      enabled: Boolean(setting?.enabled),
      setting_updated_at: setting?.updated_at ?? null,
      owner: {
        user_id: tenant.primary_owner_user_id,
        name: owner?.full_name?.trim() || "—",
        email: email || null,
        ready: ownerReady,
        problem: ownerReady ? null : emailProblem
      },
      latest_delivery: delivery ? {
        id: delivery.id,
        business_date: businessDate,
        recipient_email: delivery.recipient_email,
        status: delivery.status,
        attempt_count: delivery.attempt_count,
        last_attempt_at: delivery.last_attempt_at,
        sent_at: delivery.sent_at,
        last_error: delivery.last_error,
        created_at: delivery.created_at,
        updated_at: delivery.updated_at,
        retryable: Boolean(setting?.enabled && tenant.is_active && ownerReady && ["failed", "blocked"].includes(delivery.status))
      } : null
    };
  });

  const previousDate = previousBangkokDate();
  const stats = {
    total_stores: rows.length,
    active_stores: rows.filter((row) => row.tenant_active).length,
    enabled: rows.filter((row) => row.enabled).length,
    disabled: rows.filter((row) => !row.enabled).length,
    owner_not_ready: rows.filter((row) => row.enabled && !row.owner.ready).length,
    sent_latest: rows.filter((row) => row.latest_delivery?.status === "sent").length,
    failed_latest: rows.filter((row) => row.latest_delivery?.status === "failed").length,
    blocked_latest: rows.filter((row) => row.latest_delivery?.status === "blocked").length,
    retryable: rows.filter((row) => row.latest_delivery?.retryable).length
  };

  return {
    timezone: "Asia/Bangkok",
    cutoff: "00:00",
    send_at: "00:15",
    target_business_date: previousDate,
    stats,
    stores: rows
  };
}

export async function GET() {
  try {
    const context = await requireItAdmin();
    const data = await loadOverview(context);
    const response = ok(data);
    response.headers.set("cache-control", "private, no-store");
    return response;
  } catch (error) {
    return guardItAdminError(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireItAdmin();
    assertItSupportAction(context, "การ Retry อีเมลสรุปยอดขายอนุญาตเฉพาะ IT Support");

    const body = await request.json().catch(() => null) as {
      action?: unknown;
      delivery_id?: unknown;
      confirmation?: unknown;
    } | null;
    const action = String(body?.action ?? "").trim();
    const deliveryId = String(body?.delivery_id ?? "").trim();
    const confirmation = String(body?.confirmation ?? "").trim();

    if (action !== "retry_failed_daily_sales_email") {
      return fail("daily_sales_email_action_invalid", "Action ไม่ถูกต้อง", 422);
    }
    if (confirmation !== "RETRY_DAILY_SALES_EMAIL") {
      return fail("daily_sales_email_retry_confirmation_required", "กรุณายืนยัน RETRY_DAILY_SALES_EMAIL", 422);
    }
    if (!/^[0-9a-f-]{36}$/i.test(deliveryId)) {
      return fail("daily_sales_email_delivery_invalid", "Delivery ID ไม่ถูกต้อง", 422);
    }

    const deliveryResult = await context.supabase
      .from("customer_email_deliveries")
      .select("id,event_key,tenant_id,recipient_email,status,attempt_count,last_attempt_at,sent_at,last_error,created_at,updated_at")
      .eq("id", deliveryId)
      .eq("event_type", "daily_sales_summary")
      .maybeSingle<DeliveryRow>();

    if (deliveryResult.error) throw new Error("daily_sales_email_retry_delivery_failed:" + deliveryResult.error.message);
    const delivery = deliveryResult.data;
    if (!delivery || !delivery.tenant_id) return fail("daily_sales_email_delivery_not_found", "ไม่พบรายการส่งอีเมล", 404);
    if (!["failed", "blocked"].includes(delivery.status)) {
      return fail(
        "daily_sales_email_not_retryable",
        delivery.status === "sent" ? "รายการนี้ส่งสำเร็จแล้ว ระบบป้องกันการส่งซ้ำ" : "รายการนี้ยังไม่อยู่ในสถานะที่ Retry ได้",
        409
      );
    }

    const businessDate = businessDateFromEventKey(delivery.event_key);
    if (!businessDate) return fail("daily_sales_email_business_date_invalid", "ไม่สามารถระบุวันที่ของอีเมลเดิมได้", 409);

    const settingResult = await context.supabase
      .from("tenant_daily_sales_email_settings")
      .select("tenant_id,enabled")
      .eq("tenant_id", delivery.tenant_id)
      .maybeSingle<{ tenant_id: string; enabled: boolean }>();
    if (settingResult.error) throw new Error("daily_sales_email_retry_setting_failed:" + settingResult.error.message);
    if (!settingResult.data?.enabled) {
      return fail("daily_sales_email_disabled", "ร้านนี้ปิดการแจ้งสรุปยอดขายอยู่ จึงไม่ Retry", 409);
    }

    const candidateResult = await context.supabase.rpc("daily_sales_summary_candidates", {
      p_business_date: businessDate
    });
    if (candidateResult.error) throw new Error("daily_sales_email_retry_candidate_failed:" + candidateResult.error.message);

    const candidate = ((candidateResult.data ?? []) as CandidateRow[])
      .find((row) => row.tenant_id === delivery.tenant_id);
    if (!candidate) {
      return fail("daily_sales_email_retry_candidate_missing", "ไม่พบยอดขายสำเร็จของร้านในวันที่ต้องการ Retry หรือร้านไม่พร้อมส่ง", 409);
    }

    const recipient = String(candidate.owner_email ?? "").trim().toLowerCase();
    const recipientProblem = recipient ? customerEmailProblem(recipient) : "ยังไม่มีอีเมล Owner";
    if (recipientProblem) return fail("daily_sales_email_owner_invalid", recipientProblem, 422);

    const message = buildDailySalesSummaryEmail({
      storeName: candidate.store_name,
      ownerName: candidate.owner_name,
      businessDate: candidate.business_date,
      grossTotal: amount(candidate.gross_total),
      completedCount: amount(candidate.completed_count),
      netTotal: amount(candidate.net_total),
      cancelledCount: amount(candidate.cancelled_count),
      cashTotal: amount(candidate.cash_total),
      bankTransferTotal: amount(candidate.bank_transfer_total),
      topProducts: (candidate.top_products ?? []).slice(0, 3).map((product) => ({
        rank: amount(product.rank),
        name: String(product.name ?? ""),
        quantity: amount(product.quantity),
        sales_amount: amount(product.sales_amount)
      }))
    });

    const retry = await deliverCustomerEmail({
      db: context.supabase,
      eventType: "daily_sales_summary",
      sourceId: delivery.tenant_id,
      tenantId: delivery.tenant_id,
      to: recipient,
      message,
      triggerMode: "manual",
      actorUserId: context.auth.userId,
      eventKeySuffix: businessDate.replaceAll("-", "")
    });

    await appendAuditLog({
      tenantId: delivery.tenant_id,
      actorUserId: context.auth.userId,
      actorRole: context.auth.platformRole,
      action: "daily_sales_summary_email_retry",
      targetTable: "customer_email_deliveries",
      targetId: delivery.id,
      module: "it_admin",
      beforeData: {
        status: delivery.status,
        recipient_email: delivery.recipient_email,
        business_date: businessDate,
        attempt_count: delivery.attempt_count
      },
      afterData: {
        status: retry.status,
        recipient_email: recipient,
        business_date: businessDate
      },
      metadata: {
        reason: "manual_retry_from_maintenance",
        current_owner_email_used: true
      },
      ipAddress: context.requestMeta.ipAddress ?? undefined,
      userAgent: context.requestMeta.userAgent ?? undefined
    });

    if (!["sent", "already_sent"].includes(retry.status)) {
      return fail("daily_sales_email_retry_failed", retry.message || "Retry ไม่สำเร็จ", 502);
    }

    return ok({
      delivery_id: retry.delivery_id ?? delivery.id,
      status: retry.status,
      business_date: businessDate,
      recipient_email: recipient
    });
  } catch (error) {
    return guardItAdminError(error);
  }
}
