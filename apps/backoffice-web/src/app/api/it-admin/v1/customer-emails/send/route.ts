import { appendAuditLog } from "@/lib/audit-log";
import { fail, ok } from "@/lib/http";
import { guardItAdminError, ItAdminGuardError, requireItAdmin } from "@/lib/it-admin-guard";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import {
  buildPaymentConfirmationEmail,
  buildStoreActivationEmail,
  deliverCustomerEmail
} from "@/lib/services/it-admin/customer-email-service";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Manual activation emails sent before this cutoff used tenants.code (T-...)
// instead of the canonical six-digit Store Code. Allow exactly one correction.
const LEGACY_INTERNAL_STORE_CODE_EMAIL_CUTOFF = Date.parse("2026-09-30T15:23:00.000Z");

type Body = {
  event_type?: "store_activation" | "payment_confirmation";
  source_id?: string;
};

type Settings = {
  billing_email: string;
  support_email: string;
};

function obj(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

export async function POST(request: Request) {
  try {
    const ctx = await requireItAdmin();
    const rl = await enforceRateLimit({
      namespace: "it_customer_email_send",
      key: ctx.auth.userId,
      max: 10,
      windowMs: 60_000
    });
    if (!rl.ok) return fail("rate_limited", "ส่งอีเมลถี่เกินไป กรุณารอสักครู่แล้วลองใหม่", 429);

    const body = await request.json().catch(() => null) as Body | null;
    if (!body || !["store_activation","payment_confirmation"].includes(body.event_type ?? "") ||
        !body.source_id || !UUID.test(body.source_id)) {
      throw new ItAdminGuardError("invalid_email_event", "รายการอีเมลไม่ถูกต้อง", 422);
    }

    const settingsResult = await ctx.supabase.from("it_communication_settings")
      .select("billing_email,support_email").eq("id", "default").maybeSingle<Settings>();
    if (settingsResult.error) throw new Error("communication_settings_read_failed");
    const settings = settingsResult.data ?? {
      billing_email: "cuttingpointtech@gmail.com",
      support_email: "cuttingpointtech.support@gmail.com"
    };

    if (body.event_type === "store_activation") {
      const registration = await ctx.supabase.from("store_registration_requests")
        .select("id,tenant_id,store_name,owner_name,owner_email,status,activated_at,provision_request_key")
        .eq("id", body.source_id).maybeSingle();
      if (registration.error) throw registration.error;
      if (!registration.data || registration.data.status !== "activated" || !registration.data.tenant_id) {
        return fail("activation_email_not_ready", "ส่งอีเมลเปิดระบบได้เฉพาะร้านที่เปิดใช้งานแล้ว", 409);
      }

      const [tenant, lifecycle, provisioning] = await Promise.all([
        ctx.supabase.from("tenants").select("id,code,name,display_name,primary_owner_user_id")
          .eq("id", registration.data.tenant_id).maybeSingle(),
        ctx.supabase.from("tenant_data_lifecycle").select("trial_expires_at")
          .eq("tenant_id", registration.data.tenant_id).maybeSingle(),
        registration.data.provision_request_key
          ? ctx.supabase.from("it_store_provisioning_requests").select("result")
              .eq("request_key", registration.data.provision_request_key).maybeSingle<{ result: Record<string, unknown> | null }>()
          : Promise.resolve({ data: null, error: null })
      ]);
      if (tenant.error || lifecycle.error || provisioning.error) throw new Error("activation_email_context_failed");
      const store = tenant.data;
      if (!store) return fail("store_not_found", "ไม่พบร้านค้า", 404);

      let ownerCode: string | null = null;
      let ownerEmail = registration.data.owner_email;
      if (store.primary_owner_user_id) {
        const [ownerPos, ownerProfile] = await Promise.all([
          ctx.supabase.from("pos_user_profiles").select("employee_code")
            .eq("tenant_id", registration.data.tenant_id)
            .eq("user_id", store.primary_owner_user_id).maybeSingle<{ employee_code: string }>(),
          ctx.supabase.from("users_profiles").select("email")
            .eq("id", store.primary_owner_user_id).maybeSingle<{ email: string | null }>()
        ]);
        if (!ownerPos.error) ownerCode = ownerPos.data?.employee_code ?? null;
        if (!ownerProfile.error && ownerProfile.data?.email) ownerEmail = ownerProfile.data.email;
      }

      const provisioningResult = obj(provisioning.data?.result);
      const publicStoreCode = String(provisioningResult.store_code ?? "").trim();
      if (!/^\d{6}$/.test(publicStoreCode)) {
        return fail("public_store_code_missing", "ไม่พบ Store Code 6 หลัก กรุณาตรวจข้อมูล Provisioning ก่อนส่งอีเมล", 409);
      }

      const originalDelivery = await ctx.supabase.from("customer_email_deliveries")
        .select("id,status,trigger_mode,sent_at")
        .eq("event_type", "store_activation")
        .eq("source_id", registration.data.id)
        .eq("status", "sent")
        .eq("trigger_mode", "manual")
        .limit(1)
        .maybeSingle<{ id: string; status: string; trigger_mode: string; sent_at: string | null }>();
      if (originalDelivery.error) throw new Error("activation_email_delivery_lookup_failed");
      const originalSentAt = originalDelivery.data?.sent_at ? Date.parse(originalDelivery.data.sent_at) : Number.NaN;
      const isStoreCodeCorrection = Boolean(
        originalDelivery.data && Number.isFinite(originalSentAt) &&
        originalSentAt < LEGACY_INTERNAL_STORE_CODE_EMAIL_CUTOFF
      );

      const baseMessage = buildStoreActivationEmail({
        storeName: store.display_name || store.name || registration.data.store_name,
        storeCode: publicStoreCode,
        ownerName: registration.data.owner_name,
        ownerCode,
        trialExpiresAt: lifecycle.data?.trial_expires_at ?? null,
        supportEmail: settings.support_email
      });
      const message = isStoreCodeCorrection ? {
        ...baseMessage,
        subject: `แก้ไข Store Code | ${baseMessage.subject}`,
        textBody: `แก้ไขข้อมูลจากอีเมลก่อนหน้า: กรุณาใช้ Store Code 6 หลักด้านล่างแทนรหัสเดิม\n\n${baseMessage.textBody}`,
        htmlBody: '<div style="margin-bottom:16px;padding:13px 15px;border-radius:10px;background:#fff8e8;color:#7a5512;font-size:13px;line-height:1.65"><strong>แก้ไขข้อมูล:</strong> กรุณาใช้ Store Code 6 หลักในอีเมลฉบับนี้แทนรหัสจากอีเมลก่อนหน้า</div>' + baseMessage.htmlBody
      } : baseMessage;

      const delivery = await deliverCustomerEmail({
        db: ctx.supabase,
        eventType: "store_activation",
        sourceId: registration.data.id,
        tenantId: registration.data.tenant_id,
        to: ownerEmail,
        message,
        triggerMode: "manual",
        actorUserId: ctx.auth.userId,
        eventKeySuffix: isStoreCodeCorrection ? "store-code-correction-v1" : undefined
      });

      await appendAuditLog({
        tenantId: registration.data.tenant_id,
        actorUserId: ctx.auth.userId,
        actorRole: "it_admin",
        action: "customer_activation_email_manual_send",
        targetTable: "customer_email_deliveries",
        targetId: delivery.delivery_id,
        module: "it_admin",
        metadata: { registration_id: registration.data.id, delivery_status: delivery.status },
        ipAddress: ctx.requestMeta.ipAddress ?? undefined,
        userAgent: ctx.requestMeta.userAgent ?? undefined
      });
      return ok({ delivery });
    }

    const receipt = await ctx.supabase.from("tenant_subscription_receipts")
      .select("id,tenant_id,receipt_number,amount,currency,customer_snapshot,package_snapshot")
      .eq("id", body.source_id).maybeSingle();
    if (receipt.error) throw receipt.error;
    if (!receipt.data) return fail("receipt_not_found", "ไม่พบใบเสร็จ", 404);

    const customer = obj(receipt.data.customer_snapshot);
    const pkg = obj(receipt.data.package_snapshot);
    let to = typeof customer.email === "string" ? customer.email : "";
    const tenant = await ctx.supabase.from("tenants").select("primary_owner_user_id")
      .eq("id", receipt.data.tenant_id).maybeSingle<{ primary_owner_user_id: string | null }>();
    if (!tenant.error && tenant.data?.primary_owner_user_id) {
      const currentOwner = await ctx.supabase.from("users_profiles").select("email")
        .eq("id", tenant.data.primary_owner_user_id).maybeSingle<{ email: string | null }>();
      if (!currentOwner.error && currentOwner.data?.email) to = currentOwner.data.email;
    }
    if (!to) return fail("customer_email_missing", "ไม่พบอีเมล Owner ปัจจุบัน กรุณาแก้ข้อมูล Owner ก่อนส่ง", 422);

    const message = buildPaymentConfirmationEmail({
      storeName: String(customer.store_name || "ร้านค้า"),
      ownerName: typeof customer.owner_name === "string" ? customer.owner_name : null,
      packageName: String(pkg.package_name || "CpIPOS"),
      receiptNumber: receipt.data.receipt_number,
      amount: Number(receipt.data.amount),
      currency: receipt.data.currency,
      periodStart: typeof pkg.period_start === "string" ? pkg.period_start : null,
      periodEnd: typeof pkg.period_end === "string" ? pkg.period_end : null,
      billingEmail: settings.billing_email,
      supportEmail: settings.support_email
    });
    const delivery = await deliverCustomerEmail({
      db: ctx.supabase,
      eventType: "payment_confirmation",
      sourceId: receipt.data.id,
      tenantId: receipt.data.tenant_id,
      to,
      message,
      triggerMode: "manual",
      actorUserId: ctx.auth.userId
    });

    await appendAuditLog({
      tenantId: receipt.data.tenant_id,
      actorUserId: ctx.auth.userId,
      actorRole: "it_admin",
      action: "customer_payment_email_manual_send",
      targetTable: "customer_email_deliveries",
      targetId: delivery.delivery_id,
      module: "it_admin",
      metadata: { receipt_id: receipt.data.id, receipt_number: receipt.data.receipt_number, delivery_status: delivery.status },
      ipAddress: ctx.requestMeta.ipAddress ?? undefined,
      userAgent: ctx.requestMeta.userAgent ?? undefined
    });
    return ok({ delivery });
  } catch (error) {
    return guardItAdminError(error);
  }
}
