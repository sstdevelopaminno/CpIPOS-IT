import { appendAuditLog } from "@/lib/audit-log";
import { fail, ok } from "@/lib/http";
import { guardItAdminError, ItAdminGuardError, requireItAdmin } from "@/lib/it-admin-guard";

export const dynamic="force-dynamic";

type Params={params:Promise<{kind:string;recordId:string}>};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(value:unknown,max=1000){
  return typeof value==="string" ? value.trim().slice(0,max) : "";
}
function number(value:unknown){
  const parsed=Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function dateOnly(value:unknown){
  const raw=typeof value==="string" ? value.trim() : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}

export async function PATCH(request:Request,{params}:Params){
  try{
    const {auth,supabase,requestMeta}=await requireItAdmin();
    const {kind,recordId}=await params;
    if(!UUID.test(recordId)) throw new ItAdminGuardError("record_invalid","Invalid record ID.",422);
    const body=await request.json().catch(()=>null) as Record<string,unknown>|null;
    if(!body) throw new ItAdminGuardError("body_required","Request body is required.",422);

    if(kind==="request"){
      const existing=await supabase.from("tenant_subscription_payment_requests")
        .select("id,tenant_id,status,amount_reported,review_note,metadata,evidence_url")
        .eq("id",recordId).maybeSingle<any>();
      if(existing.error) throw new Error("payment_request_lookup_failed");
      if(!existing.data) return fail("record_not_found","Payment request not found.",404);
      if(existing.data.status==="approved"){
        return fail("settled_request_immutable","Approved/settled requests cannot be edited. Use receipt correction or a new adjustment request.",409);
      }
      const amountReported=body.amount_reported===null?null:number(body.amount_reported);
      if(amountReported!==null && (amountReported<=0 || amountReported>10000000)){
        throw new ItAdminGuardError("amount_invalid","Amount must be greater than 0.",422);
      }
      const reviewNote=text(body.review_note,500);
      const note=text(body.note,500);
      const nextMetadata={...(existing.data.metadata??{})};
      if("note" in body) nextMetadata.note=note;
      const updated=await supabase.from("tenant_subscription_payment_requests").update({
        amount_reported:amountReported,
        review_note:reviewNote||null,
        metadata:nextMetadata,
        updated_at:new Date().toISOString()
      }).eq("id",recordId).eq("tenant_id",existing.data.tenant_id)
        .select("id,tenant_id,status,amount_reported,review_note").maybeSingle<any>();
      if(updated.error||!updated.data) throw new Error("payment_request_update_failed");
      await appendAuditLog({
        tenantId:existing.data.tenant_id,actorUserId:auth.userId,actorRole:"it_admin",
        action:"subscription_request_admin_updated",targetTable:"tenant_subscription_payment_requests",targetId:recordId,module:"it_admin",
        beforeData:{amount_reported:existing.data.amount_reported,review_note:existing.data.review_note},
        afterData:{amount_reported:updated.data.amount_reported,review_note:updated.data.review_note},
        metadata:{note},ipAddress:requestMeta.ipAddress??undefined,userAgent:requestMeta.userAgent??undefined
      });
      return ok({record:updated.data});
    }

    if(kind==="cycle"){
      const existing=await supabase.from("tenant_billing_cycles")
        .select("id,tenant_id,status,period_start,period_end,amount_due,amount_paid")
        .eq("id",recordId).maybeSingle<any>();
      if(existing.error) throw new Error("billing_cycle_lookup_failed");
      if(!existing.data) return fail("record_not_found","Billing cycle not found.",404);
      const linked=await supabase.from("tenant_subscription_receipts").select("id").eq("billing_cycle_id",recordId).limit(1);
      if(linked.error) throw new Error("billing_cycle_receipt_lookup_failed");
      if(existing.data.status==="paid" || (linked.data?.length??0)>0){
        return fail("paid_cycle_immutable","Paid or receipted billing cycles cannot be edited.",409);
      }
      const start=dateOnly(body.period_start)||existing.data.period_start;
      const end=dateOnly(body.period_end)||existing.data.period_end;
      if(start>=end) throw new ItAdminGuardError("period_invalid","Period end must be after period start.",422);
      const amountDue="amount_due" in body ? number(body.amount_due) : Number(existing.data.amount_due);
      if(amountDue===null || amountDue<0 || amountDue>10000000) throw new ItAdminGuardError("amount_invalid","Invalid amount due.",422);
      const updated=await supabase.from("tenant_billing_cycles").update({
        period_start:start,period_end:end,amount_due:amountDue
      }).eq("id",recordId).eq("tenant_id",existing.data.tenant_id)
        .select("id,tenant_id,status,period_start,period_end,amount_due,amount_paid").maybeSingle<any>();
      if(updated.error||!updated.data) throw new Error("billing_cycle_update_failed");
      await appendAuditLog({
        tenantId:existing.data.tenant_id,actorUserId:auth.userId,actorRole:"it_admin",
        action:"subscription_billing_cycle_admin_updated",targetTable:"tenant_billing_cycles",targetId:recordId,module:"it_admin",
        beforeData:existing.data,afterData:updated.data,metadata:{},
        ipAddress:requestMeta.ipAddress??undefined,userAgent:requestMeta.userAgent??undefined
      });
      return ok({record:updated.data});
    }

    if(kind==="receipt"){
      const existing=await supabase.from("tenant_subscription_receipts")
        .select("id,tenant_id,receipt_number").eq("id",recordId).maybeSingle<any>();
      if(existing.error) throw new Error("receipt_lookup_failed");
      if(!existing.data) return fail("record_not_found","Receipt not found.",404);
      const correctionNote=text(body.correction_note,1000);
      const upsert=await supabase.from("tenant_subscription_receipt_annotations").upsert({
        receipt_id:recordId,tenant_id:existing.data.tenant_id,correction_note:correctionNote||null,
        updated_at:new Date().toISOString(),updated_by:auth.userId
      },{onConflict:"receipt_id"}).select("receipt_id,correction_note,voided_at").maybeSingle<any>();
      if(upsert.error||!upsert.data) throw new Error("receipt_annotation_update_failed");
      await appendAuditLog({
        tenantId:existing.data.tenant_id,actorUserId:auth.userId,actorRole:"it_admin",
        action:"subscription_receipt_annotation_updated",targetTable:"tenant_subscription_receipt_annotations",targetId:recordId,module:"it_admin",
        beforeData:{},afterData:{correction_note:correctionNote},metadata:{receipt_number:existing.data.receipt_number},
        ipAddress:requestMeta.ipAddress??undefined,userAgent:requestMeta.userAgent??undefined
      });
      return ok({record:upsert.data});
    }

    throw new ItAdminGuardError("record_kind_invalid","Unsupported record type.",422);
  }catch(error){return guardItAdminError(error);}
}

export async function DELETE(request:Request,{params}:Params){
  try{
    const {auth,supabase,requestMeta}=await requireItAdmin();
    const {kind,recordId}=await params;
    if(!UUID.test(recordId)) throw new ItAdminGuardError("record_invalid","Invalid record ID.",422);
    const body=await request.json().catch(()=>null) as {reason?:unknown}|null;
    const reason=text(body?.reason,500);
    if(!reason) throw new ItAdminGuardError("reason_required","Reason is required.",422);

    if(kind==="request"){
      const existing=await supabase.from("tenant_subscription_payment_requests")
        .select("id,tenant_id,status,evidence_url").eq("id",recordId).maybeSingle<any>();
      if(existing.error) throw new Error("payment_request_lookup_failed");
      if(!existing.data) return fail("record_not_found","Payment request not found.",404);
      if(existing.data.status==="approved") return fail("settled_request_immutable","Approved/settled requests cannot be deleted.",409);
      const settled=await supabase.from("tenant_subscription_settlements").select("id").eq("payment_request_id",recordId).limit(1);
      if(settled.error) throw new Error("settlement_lookup_failed");
      if((settled.data?.length??0)>0) return fail("settled_request_immutable","Settled requests cannot be deleted.",409);
      const deleted=await supabase.from("tenant_subscription_payment_requests")
        .delete().eq("id",recordId).eq("tenant_id",existing.data.tenant_id);
      if(deleted.error) throw new Error("payment_request_delete_failed");
      if(existing.data.evidence_url){
        await supabase.storage.from("subscription-payment-evidence").remove([existing.data.evidence_url]).catch(()=>null);
      }
      await appendAuditLog({
        tenantId:existing.data.tenant_id,actorUserId:auth.userId,actorRole:"it_admin",
        action:"subscription_request_admin_deleted",targetTable:"tenant_subscription_payment_requests",targetId:recordId,module:"it_admin",
        beforeData:{status:existing.data.status},afterData:{deleted:true},metadata:{reason},
        ipAddress:requestMeta.ipAddress??undefined,userAgent:requestMeta.userAgent??undefined
      });
      return ok({deleted:true});
    }

    if(kind==="cycle"){
      const existing=await supabase.from("tenant_billing_cycles")
        .select("id,tenant_id,status,amount_paid").eq("id",recordId).maybeSingle<any>();
      if(existing.error) throw new Error("billing_cycle_lookup_failed");
      if(!existing.data) return fail("record_not_found","Billing cycle not found.",404);
      const linked=await supabase.from("tenant_subscription_receipts").select("id").eq("billing_cycle_id",recordId).limit(1);
      if(linked.error) throw new Error("billing_cycle_receipt_lookup_failed");
      if(existing.data.status==="paid" || Number(existing.data.amount_paid)>0 || (linked.data?.length??0)>0){
        return fail("paid_cycle_immutable","Paid or receipted billing cycles cannot be deleted.",409);
      }
      const deleted=await supabase.from("tenant_billing_cycles").delete().eq("id",recordId).eq("tenant_id",existing.data.tenant_id);
      if(deleted.error) throw new Error("billing_cycle_delete_failed");
      await appendAuditLog({
        tenantId:existing.data.tenant_id,actorUserId:auth.userId,actorRole:"it_admin",
        action:"subscription_billing_cycle_admin_deleted",targetTable:"tenant_billing_cycles",targetId:recordId,module:"it_admin",
        beforeData:existing.data,afterData:{deleted:true},metadata:{reason},
        ipAddress:requestMeta.ipAddress??undefined,userAgent:requestMeta.userAgent??undefined
      });
      return ok({deleted:true});
    }

    if(kind==="receipt"){
      const existing=await supabase.from("tenant_subscription_receipts")
        .select("id,tenant_id,receipt_number").eq("id",recordId).maybeSingle<any>();
      if(existing.error) throw new Error("receipt_lookup_failed");
      if(!existing.data) return fail("record_not_found","Receipt not found.",404);
      const now=new Date().toISOString();
      const upsert=await supabase.from("tenant_subscription_receipt_annotations").upsert({
        receipt_id:recordId,tenant_id:existing.data.tenant_id,correction_note:reason,
        voided_at:now,voided_by:auth.userId,updated_at:now,updated_by:auth.userId,
        metadata:{void_reason:reason}
      },{onConflict:"receipt_id"}).select("receipt_id,correction_note,voided_at").maybeSingle<any>();
      if(upsert.error||!upsert.data) throw new Error("receipt_void_failed");
      await appendAuditLog({
        tenantId:existing.data.tenant_id,actorUserId:auth.userId,actorRole:"it_admin",
        action:"subscription_receipt_voided",targetTable:"tenant_subscription_receipt_annotations",targetId:recordId,module:"it_admin",
        beforeData:{voided:false},afterData:{voided:true,voided_at:now},metadata:{reason,receipt_number:existing.data.receipt_number},
        ipAddress:requestMeta.ipAddress??undefined,userAgent:requestMeta.userAgent??undefined
      });
      return ok({voided:true,record:upsert.data});
    }

    throw new ItAdminGuardError("record_kind_invalid","Unsupported record type.",422);
  }catch(error){return guardItAdminError(error);}
}
