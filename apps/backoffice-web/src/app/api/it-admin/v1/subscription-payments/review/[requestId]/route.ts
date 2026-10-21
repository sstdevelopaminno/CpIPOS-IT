import { appendAuditLog } from "@/lib/audit-log";
import { fail, ok } from "@/lib/http";
import { guardItAdminError, ItAdminGuardError, requireItAdmin } from "@/lib/it-admin-guard";
import { dispatchSupportPush } from "@/lib/support-chat/support-push";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{requestId:string}> };
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type ReviewRow = {id:string;tenant_id:string;status:string;review_note:string|null;evidence_url?:string|null;requested_package_id?:string|null;metadata?:Record<string,unknown>|null};

export async function POST(request:Request,{params}:Params) {
  try {
    const {auth,supabase,requestMeta}=await requireItAdmin();
    const {requestId}=await params;
    if(!UUID.test(requestId)) throw new ItAdminGuardError("request_invalid","Invalid request ID.",422);
    const body=await request.json().catch(()=>null) as {action?:unknown;note?:unknown}|null;
    const action=body?.action;
    if(action!=="under_review" && action!=="reject") {
      throw new ItAdminGuardError("invalid_review_action","Select review or reject.",422);
    }
    const note=typeof body?.note==="string"?body.note.trim().slice(0,500):"";
    if(action==="reject" && !note) {
      throw new ItAdminGuardError("rejection_note_required","Explain why the request was rejected.",422);
    }
    const existing=await supabase.from("tenant_subscription_payment_requests")
      .select("id,tenant_id,status,review_note,evidence_url,requested_package_id,metadata").eq("id",requestId).maybeSingle<ReviewRow>();
    if(existing.error) throw new Error("Subscription request lookup failed.");
    if(!existing.data) return fail("request_not_found","Subscription request not found.",404);
    const previous=existing.data;
    // A quote is NOT a bank payment. Rejecting a quote via the payment
    // review workflow would invoke the tenant subscription rejection lock.
    if(previous.metadata?.kind==="custom_quote_request"){
      return fail("custom_quote_not_a_payment","คำขอ CUSTOM ยังไม่ได้รับรองราคา ให้เปิดเมนู Tenants / Stores → CUSTOM PACKAGE เพื่อตกลงเงื่อนไขก่อน",409);
    }
    if(action==="under_review" && !["pending","rejected"].includes(previous.status)) {
      return fail("review_conflict","Only pending or previously rejected requests can be moved into review.",409);
    }
    const reopening=action==="under_review" && previous.status==="rejected";
    if(reopening && (!previous.evidence_url || !previous.requested_package_id || note.length<8)){
      return fail("review_reopen_requires_reason","Reopening requires existing evidence and an IT reason; POS remains locked until a bank settlement is confirmed.",422);
    }
    if(reopening){
      const open=await supabase.from("tenant_subscription_payment_requests").select("id")
        .eq("tenant_id",previous.tenant_id).in("status",["pending","under_review"])
        .limit(1).maybeSingle();
      if(open.error)return fail("review_lookup_failed","Unable to check other open payment requests.",503);
      if(open.data)return fail("review_conflict","Another open payment request exists.",409);
    }
    if(action==="reject" && !["pending","under_review"].includes(previous.status)) {
      return fail("review_conflict","This request is already terminal.",409);
    }
    const status=action==="reject"?"rejected":"under_review";
    const now=new Date().toISOString();
    const result=await supabase.from("tenant_subscription_payment_requests").update({
      status,reviewed_by:auth.userId,reviewed_at:now,review_note:note||null,updated_at:now
    }).eq("id",requestId).eq("tenant_id",previous.tenant_id).eq("status",previous.status)
      .select("id,tenant_id,status,review_note").maybeSingle<ReviewRow>();
    if(result.error) throw new Error("Subscription review update failed.");
    if(!result.data) return fail("review_conflict","Request changed; refresh before reviewing.",409);
    if(action==="reject"){
      const event=await supabase.from("tenant_subscription_approval_events").insert({
        tenant_id:previous.tenant_id,payment_request_id:requestId,
        action:"reject",actor_id:auth.userId,from_status:previous.status,to_status:"rejected",
        metadata:{reason:note}
      });
      if(event.error) console.error("[it-billing] review event insert failed",event.error.message);
    }
    await appendAuditLog({
      tenantId:previous.tenant_id,actorUserId:auth.userId,actorRole:"it_admin",
      action:action==="reject"?"subscription_request_rejected":previous.status==="rejected"?"subscription_request_reopened":"subscription_request_under_review",
      targetTable:"tenant_subscription_payment_requests",targetId:requestId,module:"it_admin",
      beforeData:{status:previous.status},afterData:{status},
      metadata:{note},ipAddress:requestMeta.ipAddress??undefined,userAgent:requestMeta.userAgent??undefined
    });
    await dispatchSupportPush({
      audience:"store",
      tenant_id:previous.tenant_id,
      kind:"request",
      title:action==="reject" ? "คำขอถูกปฏิเสธ" : reopening ? "ฝ่าย IT เปิดตรวจสอบใหม่" : "IT รับคำขอแล้ว",
      body:action==="reject" ? (note || "กรุณาตรวจสอบรายละเอียดคำขอ") : reopening ? "รายการยังล็อกอยู่จนกว่า IT จะยืนยันเงินเข้าและอนุมัติ" : "คำขอของคุณอยู่ระหว่างการตรวจสอบ",
      url:"/preview/pos/payments/package",
      tag:`subscription-request:${requestId}`
    }).catch(()=>null);
    const response=ok({request:result.data});
    response.headers.set("cache-control","private, no-store");
    return response;
  } catch(error){return guardItAdminError(error);}
}
