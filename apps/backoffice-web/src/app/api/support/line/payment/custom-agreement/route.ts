import { fail, ok } from "@/lib/http";
import { LineSupportError, requireLineSupportSession } from "@/lib/support-chat/line-support-auth";
import { getPrimarySupabaseServiceClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VERSION = "CUSTOM-TH-2026-11-v1-draft";
const CLAUSES = [
  "ระยะเวลาสัญญา 12 เดือน นับจากวันที่รับชำระค่าบริการรอบแรกสำเร็จตามหลักฐานที่บริษัทตรวจสอบ ไม่เริ่มนับใหม่ทุกเดือน",
  "ชำระค่าบริการตามรอบและอัตราที่ IT อนุมัติ ผ่าน CpiPOS หรือ LINE ทางการ โดยใช้บัญชีบริษัทหรือบัญชีฉุกเฉินที่ประกาศรับรองเท่านั้น",
  "ผู้ให้บริการจัดให้มีช่องทางดูแลและ Support ตลอด 24 ชั่วโมง ทุกวัน",
  "ลูกค้าได้รับสิทธิใช้ซอฟต์แวร์ตามสัญญา ไม่ได้รับกรรมสิทธิ์หรือซอร์สโค้ด มีสิทธิขอสำเนาข้อมูลที่บันทึกในระบบ",
  "ผู้ให้บริการดูแลความปลอดภัยและสำรองข้อมูล หากเกิดเหตุโจรกรรมหรือโจมตีระบบจะดำเนินการกู้คืนข้อมูลเท่าที่ทำได้ ส่วนความเสียหายจากช่องโหว่ฝั่งลูกค้าอยู่ภายใต้ความรับผิดตามสาเหตุและกฎหมาย",
  "เมื่อสิ้นสุดสัญญาและไม่ต่ออายุ ลูกค้ามีเวลา 30 วันเพื่อขอรับข้อมูล หลังจากนั้นดำเนินการลบตามนโยบายสำรองข้อมูลและข้อกำหนดทางกฎหมาย",
  "สัญญาจริงต้องมีหลักฐานการยอมรับทางอิเล็กทรอนิกส์และการรับชำระที่ตรวจสอบแล้ว ไม่ต้องมีลายเซ็นลูกค้าบนกระดาษ"
];

async function handle(request: Request, accept: boolean) {
  try {
    const session = await requireLineSupportSession();
    if (accept && (!request.headers.get("content-type")?.startsWith("application/json") || request.headers.get("origin") !== new URL(request.url).origin)) return fail("invalid_origin","คำขอไม่ถูกต้อง",403);
    // Fail closed until the schema, issuer, signed terms and retention policy are approved.
    const director = process.env.CUSTOM_AGREEMENT_AUTHORIZED_DIRECTOR?.trim();
    if (process.env.CUSTOM_AGREEMENT_ENABLED !== "true" || !director ||
        VERSION.endsWith("-draft")) {
      return fail("agreement_not_enabled","ยังไม่เปิดใช้งานสัญญาอิเล็กทรอนิกส์",503);
    }
    const input: unknown = accept ? await request.json().catch(() => null) : null;
    const data = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string,unknown> : null;
    const requestId = accept ? data?.request_id : new URL(request.url).searchParams.get("request_id");
    const snapshot = accept ? data?.snapshot : null;
    if (!accept && requestId === null) {
      const db = getPrimarySupabaseServiceClient();
      const status = await db.from("tenant_custom_agreement_activations")
        .select("acceptance_id,settlement_id,starts_at,ends_at")
        .eq("tenant_id",session.tenantId).order("starts_at",{ascending:false}).limit(1).maybeSingle();
      if (status.error) return fail("agreement_unavailable","ไม่สามารถโหลดสถานะสัญญาได้",503);
      const evidence = status.data ? await db.from("tenant_custom_agreement_acceptances")
        .select("id,snapshot,accepted_at").eq("tenant_id",session.tenantId)
        .eq("id",status.data.acceptance_id).maybeSingle() : null;
      if (evidence?.error || (status.data && !evidence?.data)) return fail("agreement_unavailable","ไม่สามารถโหลดหลักฐานสัญญาได้",503);
      const response = ok({activation:status.data,acceptance:evidence?.data ?? null});
      response.headers.set("cache-control","private, no-store");
      return response;
    }

    if (typeof requestId !== "string" || !UUID.test(requestId) ||
        (accept && (data?.accepted !== true || !snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)))) {
      return fail("invalid_agreement_request","ข้อมูลสัญญาไม่ครบถ้วน",422);
    }
    const db = getPrimarySupabaseServiceClient();
    const binding = await db.from("line_support_bindings").select("verified_owner_user_id").eq("id",session.bindingId).eq("tenant_id",session.tenantId).eq("is_active",true).maybeSingle();
    if (binding.error || !binding.data?.verified_owner_user_id) return fail("owner_required","กรุณายืนยันเจ้าของร้านใหม่",403);
    const result = await db.rpc("custom_agreement_quote_or_accept",{
      p_tenant_id:session.tenantId,
      p_request_id:requestId,
      p_actor_user_id:binding.data.verified_owner_user_id,
      p_channel:"line",
      p_line_binding_id:session.bindingId,
      p_version:VERSION,
      p_clauses:CLAUSES,
      p_director_name:director,
      p_expected_snapshot:snapshot
    });
    if (result.error) return fail("agreement_unavailable","ไม่สามารถยืนยันสัญญาได้ กรุณาโหลดข้อมูลใหม่หรือติดต่อ Support",409);
    const response = ok(result.data);
    response.headers.set("cache-control","private, no-store");
    return response;
  } catch(error) {
    if(error instanceof LineSupportError) return fail(error.code,error.message,error.status);
    return fail("agreement_unavailable","ไม่สามารถโหลดข้อมูลสัญญาได้",503);
  }
}
export async function GET(request: Request) { return handle(request,false); }
export async function POST(request: Request) { return handle(request,true); }
