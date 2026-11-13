import { appendAuditLog } from "@/lib/audit-log";
import { fail, ok } from "@/lib/http";
import { guardItAdminError, parseTenantParam, requireItAdmin } from "@/lib/it-admin-guard";
import { readBoundedJson } from "@/lib/server/limited-json";

export const dynamic = "force-dynamic";

type DiscountRow = {
  id: string; tenant_id: string; package_id: string; title: string;
  percent: number; valid_from: string; valid_until: string;
  duration_unit: "day" | "month" | "year"; duration_value: number;
  reason: string; status: "active" | "cancelled";
  created_by: string | null; cancelled_at: string | null;
  created_at: string;
};

type DiscountInput = {
  title?: unknown; percent?: unknown; valid_from?: unknown; valid_until?: unknown;
  duration_unit?: unknown; duration_value?: unknown; reason?: unknown;
  id?: unknown;
};

const SELECT = "id,tenant_id,package_id,title,percent,valid_from,valid_until,duration_unit,duration_value,reason,status,created_by,cancelled_at,created_at";

function isDate(input: unknown): input is string {
  if (typeof input !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input)) return false;
  const date = new Date(input + "T00:00:00.000Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === input;
}

function todayBangkok() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date());
  const v = (k: string) => parts.find(p => p.type === k)?.value ?? "";
  return v("year") + "-" + v("month") + "-" + v("day");
}

async function readContext(tenantId: string, admin: Awaited<ReturnType<typeof requireItAdmin>>) {
  const [tenant, contracts, discounts] = await Promise.all([
    admin.supabase.from("tenants").select("id,name,is_active").eq("id",tenantId).maybeSingle<{id:string;name:string;is_active:boolean}>(),
    admin.supabase.from("tenant_subscription_contracts")
      .select("id,package_id,amount_per_cycle,billing_interval,status,created_at")
      .eq("tenant_id",tenantId).order("created_at",{ascending:false}).limit(1).maybeSingle<{
        id:string;package_id:string;amount_per_cycle:number;billing_interval:string;status:string;created_at:string
      }>(),
    admin.supabase.from("tenant_package_discounts")
      .select(SELECT).eq("tenant_id",tenantId).order("valid_from",{ascending:false}).limit(50).returns<DiscountRow[]>()
  ]);
  if (tenant.error || contracts.error || discounts.error) throw new Error(
    "tenant_discount_lookup_failed:" + (tenant.error?.message || contracts.error?.message || discounts.error?.message)
  );
  if (!tenant.data) return null;
  return {tenant:tenant.data,contract:contracts.data,discounts:discounts.data??[]};
}

export async function GET(_req: Request,ctx:{params:Promise<{tenantId:string}>}) {
  try {
    const admin=await requireItAdmin();
    const tenantId=parseTenantParam((await ctx.params).tenantId);
    const state=await readContext(tenantId,admin);
    if(!state)return fail("tenant_not_found","ไม่พบร้านค้า",404);
    const response=ok(state);
    response.headers.set("cache-control","private, no-store");
    return response;
  } catch(error){return guardItAdminError(error);}
}

export async function POST(req:Request,ctx:{params:Promise<{tenantId:string}>}) {
  try {
    const admin=await requireItAdmin();
    const tenantId=parseTenantParam((await ctx.params).tenantId);
    const input=await readBoundedJson<DiscountInput|null>(req,8192);
    if(!input||typeof input!=="object")return fail("invalid_body","กรุณากรอกข้อมูลส่วนลด",422);
    const title=typeof input.title==="string"?input.title.trim():"";
    const reason=typeof input.reason==="string"?input.reason.trim():"";
    const percent=Number(input.percent);
    const durationValue=Number(input.duration_value);
    const unit=input.duration_unit;
    if(title.length<2||title.length>160||reason.length<4||reason.length>600)
      return fail("invalid_details","กรุณาระบุชื่อโปรโมชั่นและเหตุผลที่ชัดเจน",422);
    if(!Number.isFinite(percent)||percent<=0||percent>100||Math.abs(Math.round(percent*100)-percent*100)>1e-6)
      return fail("invalid_percent","ส่วนลดต้องอยู่ระหว่าง 0.01–100.00%",422);
    if(unit!=="day"&&unit!=="month"&&unit!=="year")
      return fail("invalid_unit","เลือกระยะเวลาเป็นวัน เดือน หรือปี",422);
    if(!Number.isInteger(durationValue)||durationValue<1||durationValue>3650)
      return fail("invalid_duration","ระบุจำนวนวัน/เดือน/ปีให้ถูกต้อง",422);
    if(!isDate(input.valid_from)||!isDate(input.valid_until)||input.valid_until<input.valid_from)
      return fail("invalid_date","ช่วงวันส่วนลดไม่ถูกต้อง",422);
    if(input.valid_from<todayBangkok())
      return fail("retroactive_discount_blocked","ไม่สามารถเริ่มส่วนลดย้อนหลังได้ เพื่อรักษารายการเรียกเก็บที่มีอยู่",409);

    const state=await readContext(tenantId,admin);
    if(!state)return fail("tenant_not_found","ไม่พบร้านค้า",404);
    if(!state.tenant.is_active || !state.contract || state.contract.status!=="active" || Number(state.contract.amount_per_cycle)<=0)
      return fail("contract_not_eligible","ร้านต้องมีสัญญาใช้งานแบบชำระเงินจริงก่อนตั้งส่วนลด",409);
    const overlap=state.discounts.some(d=>d.status==="active" &&
      d.valid_from<=String(input.valid_until) && d.valid_until>=String(input.valid_from));
    if(overlap)return fail("discount_overlap","มีโปรโมชั่นรายร้านที่ซ้อนทับช่วงวันที่นี้แล้ว",409);

    const insert=await admin.supabase.from("tenant_package_discounts").insert({
      tenant_id:tenantId,package_id:state.contract.package_id,title,percent,
      valid_from:input.valid_from,valid_until:input.valid_until,
      duration_unit:unit,duration_value:durationValue,status:"active",
      reason,created_by:admin.auth.userId
    }).select(SELECT).single<DiscountRow>();
    if(insert.error){
      if(insert.error.code==="23P01")return fail("discount_overlap","ช่วงวันส่วนลดซ้ำกับรายการอื่น",409);
      throw new Error("tenant_discount_create_failed:"+insert.error.message);
    }
    await appendAuditLog({
      tenantId,actorUserId:admin.auth.userId,actorRole:admin.auth.platformRole,
      action:"tenant_package_discount_created",targetTable:"tenant_package_discounts",targetId:insert.data.id,
      module:"it_admin",beforeData:{},afterData:{
        percent,title,valid_from:input.valid_from,valid_until:input.valid_until,
        duration_unit:unit,duration_value:durationValue,package_id:state.contract.package_id
      },metadata:{reason,contract_id:state.contract.id,paid_history_unchanged:true},
      ipAddress:admin.requestMeta.ipAddress??undefined,userAgent:admin.requestMeta.userAgent??undefined
    });
    return ok(insert.data);
  }catch(error){return guardItAdminError(error);}
}

export async function PATCH(req:Request,ctx:{params:Promise<{tenantId:string}>}) {
  try {
    const admin=await requireItAdmin();
    const tenantId=parseTenantParam((await ctx.params).tenantId);
    const input=await readBoundedJson<DiscountInput|null>(req,4096);
    const id=typeof input?.id==="string"?input.id.trim():"";
    const reason=typeof input?.reason==="string"?input.reason.trim():"";
    if(!/^[0-9a-f-]{36}$/i.test(id)||reason.length<4||reason.length>600)
      return fail("invalid_request","กรุณาระบุรายการและเหตุผลการยกเลิก",422);
    const state=await readContext(tenantId,admin);
    if(!state)return fail("tenant_not_found","ไม่พบร้านค้า",404);
    const current=state.discounts.find(x=>x.id===id);
    if(!current)return fail("discount_not_found","ไม่พบสิทธิส่วนลดนี้",404);
    if(current.status!=="active")return fail("already_cancelled","สิทธินี้ถูกยกเลิกแล้ว",409);
    const changed=await admin.supabase.from("tenant_package_discounts").update({
      status:"cancelled",cancelled_by:admin.auth.userId,cancelled_at:new Date().toISOString(),
      updated_at:new Date().toISOString()
    }).eq("tenant_id",tenantId).eq("id",id).eq("status","active").select(SELECT).maybeSingle<DiscountRow>();
    if(changed.error)throw new Error("tenant_discount_cancel_failed:"+changed.error.message);
    if(!changed.data)return fail("concurrent_update","สิทธิถูกเปลี่ยนแปลงแล้ว กรุณารีเฟรช",409);
    await appendAuditLog({
      tenantId,actorUserId:admin.auth.userId,actorRole:admin.auth.platformRole,
      action:"tenant_package_discount_cancelled",targetTable:"tenant_package_discounts",targetId:id,
      module:"it_admin",beforeData:{status:current.status,percent:current.percent},
      afterData:{status:"cancelled"},metadata:{reason,settlements_and_receipts_untouched:true},
      ipAddress:admin.requestMeta.ipAddress??undefined,userAgent:admin.requestMeta.userAgent??undefined
    });
    return ok(changed.data);
  }catch(error){return guardItAdminError(error);}
}
