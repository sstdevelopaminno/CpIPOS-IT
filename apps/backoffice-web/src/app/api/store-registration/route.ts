import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { getPrimarySupabaseServiceClient } from "@/lib/supabase-admin";
import { enforceRateLimit, getClientIpAddress } from "@/lib/server/rate-limit";
import { customerEmailProblem } from "@/lib/services/it-admin/customer-email-service";

export const dynamic = "force-dynamic";

const json = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { "cache-control": "no-store" } });
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const str = (v: unknown, max: number) => typeof v === "string" ? v.trim().slice(0, max) : "";
const isPackageUuid = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(v);

type Application = {
  submission_key?: unknown;
  store_name?: unknown;
  business_type?: unknown;
  owner_name?: unknown;
  owner_email?: unknown;
  owner_phone?: unknown;
  package_id?: unknown;
  sales_modes?: unknown;
  started_at?: unknown;
  custom_requirements?: unknown;
  website?: unknown;
  consent?: unknown;
};

function reject(code: string, error: string, field?: string) {
  console.warn("[public-store-registration] rejected", { code, field: field ?? null });
  return json({ error, code, field: field ?? null }, 422);
}

export async function GET() {
  try {
    const { data, error } = await getPrimarySupabaseServiceClient()
      .from("subscription_packages")
      .select("id,code,name,monthly_price,yearly_price,monthly_discount_percent,yearly_discount_percent,max_branches,max_devices,quota_mode,metadata")
      .eq("is_active", true)
      .eq("status", "active")
      .in("quota_mode", ["standard", "custom"])
      .order("display_order", { ascending: true, nullsFirst: false })
      .limit(30);

    if (error) throw error;

    const packages = (data ?? [])
      .filter((row) => row.quota_mode === "custom" || Number(row.monthly_price ?? 0) > 0)
      .map((row) => {
        const discount = Number(row.monthly_discount_percent ?? 0);
        const effective = Number(
          (Number(row.monthly_price ?? 0) * (1 - Math.max(0, Math.min(100, discount)) / 100)).toFixed(2)
        );
        return {
          ...row,
          effective_monthly_price: row.quota_mode === "custom" ? null : effective,
          contact_sales:
            row.quota_mode === "custom" ||
            row.code === "custom" ||
            row.metadata?.contact_sales === true
        };
      });

    return json({ packages });
  } catch (error) {
    console.error("[public-store-registration] catalog failed", error);
    return json({ error: "รายการแพ็กเกจไม่พร้อมใช้งาน", code: "catalog_unavailable" }, 503);
  }
}

export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== new URL(req.url).host) {
    return json({ error: "Cross-origin submission is not allowed", code: "cross_origin_blocked" }, 403);
  }

  const body = await req.json().catch(() => null) as Application | null;
  if (!body || typeof body !== "object") {
    return reject("invalid_payload", "ข้อมูลคำขอไม่ถูกต้อง");
  }

  if (body.website) {
    return reject("invalid_submission", "ไม่สามารถส่งคำขอนี้ได้ กรุณาลองใหม่");
  }

  if (body.consent !== true) {
    return reject("consent_required", "กรุณายืนยันการยินยอมให้ใช้ข้อมูลเพื่อพิจารณาเปิดร้าน", "consent");
  }

  const startedAt = Number(body.started_at);
  const formAgeMs = Date.now() - startedAt;
  if (!Number.isFinite(startedAt) || formAgeMs < -5 * 60_000 || formAgeMs > 24 * 60 * 60_000) {
    return reject("form_session_expired", "แบบฟอร์มหมดอายุ กรุณารีเฟรชหน้าแล้วกรอกใหม่");
  }

  const storeName = str(body.store_name, 180);
  const businessType = str(body.business_type, 100);
  const ownerName = str(body.owner_name, 180);
  const ownerPhone = str(body.owner_phone, 40);
  const ownerEmail = str(body.owner_email, 254).toLowerCase();
  const customRequirements = str(body.custom_requirements, 1500);
  const rawModes =
    body.sales_modes && typeof body.sales_modes === "object" && !Array.isArray(body.sales_modes)
      ? body.sales_modes as Record<string, unknown>
      : {};
  const keys = ["takeaway", "dine_in", "general_sale"] as const;
  const modes = {
    takeaway: rawModes.takeaway === true,
    dine_in: rawModes.dine_in === true,
    general_sale: rawModes.general_sale === true,
    buffet_table: false,
    delivery: false
  };

  if (!uuid(body.submission_key)) {
    return reject("invalid_submission_key", "เซสชันแบบฟอร์มไม่ถูกต้อง กรุณารีเฟรชหน้าแล้วลองใหม่");
  }
  if (storeName.length < 2) {
    return reject("store_name_required", "กรุณากรอกชื่อร้านอย่างน้อย 2 ตัวอักษร", "store_name");
  }
  if (businessType.length < 2) {
    return reject("business_type_required", "กรุณาเลือกประเภทร้านค้า", "business_type");
  }
  if (ownerName.length < 2) {
    return reject("owner_name_required", "กรุณากรอกชื่อเจ้าของร้านอย่างน้อย 2 ตัวอักษร", "owner_name");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) {
    return reject("owner_email_invalid", "รูปแบบอีเมลเจ้าของร้านไม่ถูกต้อง", "owner_email");
  }
  const emailIssue = customerEmailProblem(ownerEmail);
  if (emailIssue) {
    return reject("owner_email_suspected_typo", emailIssue, "owner_email");
  }
  if (!/^[+0-9 ()-]{8,40}$/.test(ownerPhone)) {
    return reject(
      "owner_phone_invalid",
      "รูปแบบเบอร์ติดต่อไม่ถูกต้อง ใช้ตัวเลข เครื่องหมาย + เว้นวรรค วงเล็บ หรือขีดกลางได้",
      "owner_phone"
    );
  }
  if (!isPackageUuid(body.package_id)) {
    return reject("package_required", "กรุณาเลือกแพ็กเกจที่ต้องการ", "package_id");
  }
  if (!keys.some((key) => modes[key])) {
    return reject("sales_mode_required", "กรุณาเลือกโหมดขายอย่างน้อยหนึ่งรายการ", "sales_modes");
  }

  // Count only submissions that have already passed local form validation so a
  // legitimate customer correcting a typo is not locked out by 422 retries.
  const limit = await enforceRateLimit({
    namespace: "public_store_registration",
    key: getClientIpAddress(req),
    max: 5,
    windowMs: 10 * 60_000,
    failClosedOnBackendError: true
  });
  if (!limit.ok) {
    return json(
      {
        error: "ส่งคำขอถี่เกินไป กรุณารอสักครู่แล้วลองใหม่",
        code: "rate_limited",
        retry_after_seconds: limit.retryAfterSeconds
      },
      429
    );
  }

  try {
    const db = getPrimarySupabaseServiceClient();

    const { data: previous, error: existingError } = await db
      .from("store_registration_requests")
      .select("id,status")
      .eq("submission_key", body.submission_key)
      .maybeSingle();
    if (existingError) throw existingError;
    if (previous) {
      return json(
        { id: previous.id, status: previous.status, message: "ระบบได้รับคำขอนี้แล้ว", code: "already_received" },
        200
      );
    }

    const cutoff = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
    const { data: duplicate, error: duplicateError } = await db
      .from("store_registration_requests")
      .select("id")
      .eq("owner_phone", ownerPhone)
      .gte("created_at", cutoff)
      .in("status", ["pending", "processing", "failed", "activated"])
      .limit(1);
    if (duplicateError) throw duplicateError;
    if (duplicate?.length) {
      return json(
        { error: "เบอร์นี้ส่งคำขอไว้แล้ว กรุณารอทีมงานตรวจสอบ", code: "duplicate_phone_recent" },
        409
      );
    }

    const { data: pkg, error: packageError } = await db
      .from("subscription_packages")
      .select("id,code,quota_mode,monthly_price")
      .eq("id", body.package_id)
      .eq("is_active", true)
      .eq("status", "active")
      .in("quota_mode", ["standard", "custom"])
      .maybeSingle();
    if (packageError) throw packageError;
    if (!pkg || (pkg.quota_mode === "standard" && Number(pkg.monthly_price ?? 0) <= 0)) {
      return reject("package_unavailable", "แพ็กเกจนี้ยังไม่เปิดให้สมัคร", "package_id");
    }

    const isCustom = pkg.quota_mode === "custom" || pkg.code === "custom";
    if (isCustom && customRequirements.length < 10) {
      return reject(
        "custom_requirements_required",
        "กรุณาระบุความต้องการสำหรับแพ็กเกจ CUSTOM อย่างน้อย 10 ตัวอักษร",
        "custom_requirements"
      );
    }

    const { data, error } = await db
      .from("store_registration_requests")
      .insert({
        submission_key: body.submission_key,
        store_name: storeName,
        business_type: businessType,
        owner_name: ownerName,
        owner_email: ownerEmail,
        owner_phone: ownerPhone,
        package_id: pkg.id,
        sales_modes: modes,
        trial_days: 7,
        consent_at: new Date().toISOString(),
        custom_requirements: isCustom ? customRequirements : null,
        source: isCustom ? "cpipos_website_custom" : "cpipos_website",
        status: "pending"
      })
      .select("id,status")
      .single();

    if (error?.code === "23505") {
      return json({ message: "ระบบได้รับคำขอนี้แล้ว", code: "already_received" }, 200);
    }
    if (error || !data) throw error ?? new Error("Insert result empty");

    console.info("[public-store-registration] saved", {
      request_id: data.id,
      status: data.status,
      package_mode: isCustom ? "custom" : "standard"
    });

    return json(
      {
        id: data.id,
        status: data.status,
        message: "ส่งคำขอสำเร็จ กรุณารอ IT อนุมัติ",
        code: "registration_saved"
      },
      201
    );
  } catch (error) {
    console.error("[public-store-registration] save failed", {
      error: error instanceof Error ? error.message : String(error),
      trace: crypto.randomUUID()
    });
    return json(
      {
        error: "ระบบไม่สามารถบันทึกคำขอได้ กรุณาลองอีกครั้ง",
        code: "registration_save_failed"
      },
      503
    );
  }
}
