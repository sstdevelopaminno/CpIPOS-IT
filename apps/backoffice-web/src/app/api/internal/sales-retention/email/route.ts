import { NextResponse } from "next/server";
import { buildSalesRetentionExportEmail, deliverCustomerEmail } from "@/lib/services/it-admin/customer-email-service";
import { getPrimarySupabaseServiceClient } from "@/lib/supabase-admin";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BUCKET = "sales-retention-exports";
const SIGNED_URL_SECONDS = 14 * 24 * 60 * 60;

type Body = {
  batch_id?: string;
  token?: string;
};

type Batch = {
  id: string;
  tenant_id: string;
  package_code: string | null;
  retention_months: number;
  range_start_at: string | null;
  range_end_at: string | null;
  order_count: number;
  item_count: number;
  payment_count: number;
  gross_total: number;
  paid_total: number;
  orders_object_path: string | null;
  items_object_path: string | null;
  payments_object_path: string | null;
  manifest_object_path: string | null;
  status: string;
  exported_at: string | null;
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

function thaiDateTime(value: Date) {
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok"
  }).format(value);
}

export async function POST(request: Request) {
  const db = getPrimarySupabaseServiceClient();

  try {
    const body = await request.json().catch(() => null) as Body | null;
    const batchId = String(body?.batch_id ?? "").trim();
    const token = String(body?.token ?? "").trim();

    if (!UUID.test(batchId) || token.length < 32) {
      return response(false, 401, { error: "unauthorized" });
    }

    const consumed = await db.rpc("consume_sales_retention_email_token", {
      p_batch_id: batchId,
      p_token: token
    });
    if (consumed.error || consumed.data !== true) {
      return response(false, 401, { error: "unauthorized" });
    }

    const batchResult = await db
      .from("sales_retention_batches")
      .select("id,tenant_id,package_code,retention_months,range_start_at,range_end_at,order_count,item_count,payment_count,gross_total,paid_total,orders_object_path,items_object_path,payments_object_path,manifest_object_path,status,exported_at")
      .eq("id", batchId)
      .maybeSingle<Batch>();
    if (batchResult.error || !batchResult.data) {
      return response(false, 404, { error: "retention_batch_not_found" });
    }
    const batch = batchResult.data;
    if (!batch.exported_at || !["email_pending","exported","email_failed","email_blocked"].includes(batch.status)) {
      return response(false, 409, { error: "retention_batch_not_ready" });
    }
    if (!batch.orders_object_path || !batch.items_object_path || !batch.payments_object_path || !batch.manifest_object_path) {
      return response(false, 409, { error: "retention_archive_paths_missing" });
    }

    const [tenantResult, ownerResult, packageResult] = await Promise.all([
      db.from("tenants")
        .select("id,name,display_name,owner_name,primary_owner_user_id,package_id")
        .eq("id", batch.tenant_id)
        .maybeSingle<{
          id: string;
          name: string;
          display_name: string | null;
          owner_name: string | null;
          primary_owner_user_id: string | null;
          package_id: string | null;
        }>(),
      db.from("tenants")
        .select("primary_owner_user_id")
        .eq("id", batch.tenant_id)
        .maybeSingle<{ primary_owner_user_id: string | null }>(),
      batch.package_code
        ? db.from("subscription_packages")
            .select("name")
            .eq("code", batch.package_code)
            .maybeSingle<{ name: string | null }>()
        : Promise.resolve({ data: null, error: null })
    ]);

    if (tenantResult.error || !tenantResult.data) {
      return response(false, 404, { error: "tenant_not_found" });
    }

    const tenant = tenantResult.data;
    const ownerUserId = ownerResult.data?.primary_owner_user_id ?? tenant.primary_owner_user_id;
    let ownerEmail = "";
    let ownerName = tenant.owner_name || tenant.display_name || tenant.name;

    if (ownerUserId) {
      const profile = await db.from("users_profiles")
        .select("email,full_name")
        .eq("id", ownerUserId)
        .maybeSingle<{ email: string | null; full_name: string | null }>();
      if (!profile.error && profile.data) {
        ownerEmail = profile.data.email?.trim() || "";
        ownerName = profile.data.full_name?.trim() || ownerName;
      }
    }

    if (!ownerEmail) {
      await db.from("sales_retention_batches").update({
        status: "email_blocked",
        recipient_email: null,
        last_error: "current_owner_email_missing",
        updated_at: new Date().toISOString()
      }).eq("id", batch.id);
      return response(false, 422, { error: "current_owner_email_missing" });
    }

    const signed = await Promise.all([
      db.storage.from(BUCKET).createSignedUrl(batch.orders_object_path, SIGNED_URL_SECONDS),
      db.storage.from(BUCKET).createSignedUrl(batch.items_object_path, SIGNED_URL_SECONDS),
      db.storage.from(BUCKET).createSignedUrl(batch.payments_object_path, SIGNED_URL_SECONDS)
    ]);
    const signedError = signed.find((entry) => entry.error)?.error;
    if (signedError) {
      await db.from("sales_retention_batches").update({
        status: "email_failed",
        last_error: `signed_url_failed:${signedError.message}`,
        updated_at: new Date().toISOString()
      }).eq("id", batch.id);
      return response(false, 500, { error: "signed_url_failed" });
    }

    const expiresAt = new Date(Date.now() + SIGNED_URL_SECONDS * 1000);
    const message = buildSalesRetentionExportEmail({
      storeName: tenant.display_name || tenant.name,
      ownerName,
      packageName: packageResult.data?.name ?? batch.package_code,
      retentionMonths: batch.retention_months,
      rangeStartAt: batch.range_start_at,
      rangeEndAt: batch.range_end_at,
      orderCount: batch.order_count,
      itemCount: batch.item_count,
      paymentCount: batch.payment_count,
      grossTotal: Number(batch.gross_total || 0),
      paidTotal: Number(batch.paid_total || 0),
      ordersUrl: signed[0].data?.signedUrl ?? "",
      itemsUrl: signed[1].data?.signedUrl ?? "",
      paymentsUrl: signed[2].data?.signedUrl ?? "",
      expiresAtLabel: thaiDateTime(expiresAt)
    });

    const delivery = await deliverCustomerEmail({
      db,
      eventType: "sales_retention_export",
      sourceId: batch.id,
      tenantId: batch.tenant_id,
      to: ownerEmail,
      message,
      triggerMode: "automatic",
      actorUserId: null
    });

    if (delivery.status === "sent" || delivery.status === "already_sent") {
      const sentAt = new Date();
      const purgeAfter = new Date(sentAt.getTime() + 7 * 24 * 60 * 60 * 1000);
      await db.from("sales_retention_batches").update({
        status: "purge_ready",
        recipient_email: ownerEmail.toLowerCase(),
        email_sent_at: sentAt.toISOString(),
        purge_after: purgeAfter.toISOString(),
        last_error: null,
        updated_at: sentAt.toISOString()
      }).eq("id", batch.id);

      return response(true, 200, {
        status: delivery.status,
        delivery_id: delivery.delivery_id ?? null,
        purge_after: purgeAfter.toISOString()
      });
    }

    const blocked = delivery.status === "blocked" || delivery.status === "automatic_disabled";
    await db.from("sales_retention_batches").update({
      status: blocked ? "email_blocked" : "email_failed",
      recipient_email: ownerEmail.toLowerCase(),
      last_error: delivery.message || delivery.status,
      updated_at: new Date().toISOString()
    }).eq("id", batch.id);

    return response(false, blocked ? 422 : 502, {
      error: delivery.message || delivery.status,
      delivery_status: delivery.status
    });
  } catch (error) {
    return response(false, 500, {
      error: error instanceof Error ? error.message : "sales_retention_email_failed"
    });
  }
}
