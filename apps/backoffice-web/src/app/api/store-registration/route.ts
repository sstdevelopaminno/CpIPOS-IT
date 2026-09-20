import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { getPrimarySupabaseServiceClient } from "@/lib/supabase-admin";
import { enforceRateLimit, getClientIpAddress } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";
const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "cache-control": "no-store" } });
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const str = (v: unknown, max: number) => typeof v === "string" ? v.trim().slice(0, max) : "";
const isPackageUuid = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(v);
type Application = {
  submission_key?: unknown; store_name?: unknown; business_type?: unknown;
  owner_name?: unknown; owner_email?: unknown; owner_phone?: unknown;
  package_id?: unknown; sales_modes?: unknown; started_at?: unknown;
  website?: unknown; consent?: unknown;
};

export async function GET() {
  try {
    const { data, error } = await getPrimarySupabaseServiceClient()
      .from("subscription_packages").select("id,code,name,monthly_price,max_branches,max_devices")
      .eq("is_active", true).eq("status", "active").eq("quota_mode", "standard")
      .gt("monthly_price", 0).order("monthly_price").limit(30);
    if (error) throw error;
    return json({ packages: data ?? [] });
  } catch (error) {
    console.error("[public-store-registration] catalog failed", error);
    return json({ error: "รายการแพ็กเกจไม่พร้อมใช้งาน" }, 503);
  }
}

export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== new URL(req.url).host) {
    return json({ error: "Cross-origin submission is not allowed" }, 403);
  }
  const limit = await enforceRateLimit({
    namespace: "public_store_registration", key: getClientIpAddress(req), max: 3,
    windowMs: 10 * 60_000, failClosedOnBackendError: true
  });
  if (!limit.ok) return json({ error: "ส่งคำขอถี่เกินไป กรุณาลองใหม่ภายหลัง" }, 429);
  const body = await req.json().catch(() => null) as Application | null;
  if (!body || typeof body !== "object") return json({ error: "ข้อมูลไม่ถูกต้อง" }, 422);
  if (body.website || !Number.isFinite(Number(body.started_at)) ||
      Date.now() - Number(body.started_at) < 2000 || Date.now() - Number(body.started_at) > 86_400_000 ||
      body.consent !== true) return json({ error: "ตรวจสอบการยินยอมและส่งคำขออีกครั้ง" }, 422);

  const storeName = str(body.store_name, 180), businessType = str(body.business_type, 100);
  const ownerName = str(body.owner_name, 180), ownerPhone = str(body.owner_phone, 40);
  const ownerEmail = str(body.owner_email, 254).toLowerCase();
  const rawModes = body.sales_modes && typeof body.sales_modes === "object" && !Array.isArray(body.sales_modes)
    ? body.sales_modes as Record<string, unknown> : {};
  const keys = ["takeaway", "dine_in", "general_sale"] as const;
  const modes = {
    takeaway: rawModes.takeaway === true, dine_in: rawModes.dine_in === true,
    general_sale: rawModes.general_sale === true,
    buffet_table: false, delivery: false
  };
  // Package IDs include stable seeded UUIDs such as 10000000-0000-0000-0000-000000000001.
  if (!uuid(body.submission_key) || !isPackageUuid(body.package_id) || storeName.length < 2 || businessType.length < 2 ||
      ownerName.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail) ||
      !/^[+0-9 ()-]{8,40}$/.test(ownerPhone) || !keys.some((key) => modes[key])) {
    return json({ error: "กรุณากรอกชื่อร้าน ประเภทร้าน เจ้าของร้าน อีเมล เบอร์โทร แพ็กเกจ และโหมดขายให้ครบ" }, 422);
  }
  try {
    const db = getPrimarySupabaseServiceClient();
    const { data: previous, error: existingError } = await db.from("store_registration_requests")
      .select("id,status").eq("submission_key", body.submission_key).maybeSingle();
    if (existingError) throw existingError;
    if (previous) return json({ id: previous.id, status: previous.status, message: "ระบบได้รับคำขอนี้แล้ว" }, 200);
    const cutoff = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
    const { data: duplicate, error: duplicateError } = await db.from("store_registration_requests")
      .select("id").eq("owner_phone", ownerPhone).gte("created_at", cutoff)
      .in("status", ["pending", "processing", "failed", "activated"]).limit(1);
    if (duplicateError) throw duplicateError;
    if (duplicate?.length) return json({ error: "เบอร์นี้ส่งคำขอไว้แล้ว กรุณารอทีมงานตรวจสอบ" }, 409);
    const { data: pkg, error: packageError } = await db.from("subscription_packages")
      .select("id").eq("id", body.package_id).eq("is_active", true)
      .eq("status", "active").eq("quota_mode", "standard").gt("monthly_price", 0).maybeSingle();
    if (packageError) throw packageError;
    if (!pkg) return json({ error: "แพ็กเกจนี้ยังไม่เปิดให้สมัคร" }, 422);
    const { data, error } = await db.from("store_registration_requests").insert({
      submission_key: body.submission_key, store_name: storeName, business_type: businessType,
      owner_name: ownerName, owner_email: ownerEmail, owner_phone: ownerPhone,
      package_id: pkg.id, sales_modes: modes, trial_days: 7, consent_at: new Date().toISOString(),
      source: "cpipos_website", status: "pending"
    }).select("id,status").single();
    if (error?.code === "23505") return json({ message: "ระบบได้รับคำขอนี้แล้ว" });
    if (error || !data) throw error ?? new Error("Insert result empty");
    return json({ id: data.id, status: data.status, message: "ส่งคำขอสำเร็จ กรุณารอ IT อนุมัติ" }, 201);
  } catch (error) {
    console.error("[public-store-registration] save failed", { error: error instanceof Error ? error.message : String(error), trace: crypto.randomUUID() });
    return json({ error: "ระบบไม่สามารถบันทึกคำขอได้ กรุณาลองอีกครั้ง" }, 503);
  }
}
