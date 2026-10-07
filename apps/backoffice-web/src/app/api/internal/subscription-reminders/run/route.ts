import { NextResponse } from "next/server";
import { buildSubscriptionDueReminderEmail,buildTenantDeletionWarningEmail,buildTrialExpiryReminderEmail,deliverCustomerEmail } from "@/lib/services/it-admin/customer-email-service";
import { getPrimarySupabaseServiceClient } from "@/lib/supabase-admin";

type Body={token?:string};
type Candidate={
  tenant_id:string;store_name:string;store_code:string;owner_name:string|null;owner_email:string|null;
  reminder_type:"subscription_due_reminder"|"trial_expiry_reminder"|"tenant_deletion_warning";milestone:string;due_at:string;
  days_remaining:number|string;package_name:string;billing_interval:string;amount_due:number|string;currency:string;
  lifecycle_kind?: "trial"|"subscription"; final_notice?: boolean;
};
function response(ok:boolean,status:number,payload:Record<string,unknown>){
  return NextResponse.json({ok,...payload},{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
}
function num(v:unknown){const n=Number(v??0);return Number.isFinite(n)?n:0;}

export async function POST(request:Request){
  const db=getPrimarySupabaseServiceClient();
  try{
    const body=await request.json().catch(()=>null) as Body|null;
    const token=String(body?.token??"").trim();
    if(token.length<32)return response(false,401,{error:"unauthorized"});
    const consumed=await db.rpc("consume_subscription_reminder_worker_token",{p_token:token});
    if(consumed.error||consumed.data!==true)return response(false,401,{error:"unauthorized"});

    const query=await db.rpc("subscription_reminder_candidates",{});
    if(query.error)return response(false,500,{error:"subscription_reminder_candidates_failed",detail:query.error.message});
    const rows=(query.data??[]) as Candidate[];
    const results:Array<Record<string,unknown>>=[];
    let sent=0,alreadySent=0,blocked=0,failed=0;
    for(const row of rows){
      const days=num(row.days_remaining),amount=num(row.amount_due);
      const message=row.reminder_type==="trial_expiry_reminder"
        ? buildTrialExpiryReminderEmail({storeName:row.store_name,ownerName:row.owner_name,packageName:row.package_name,dueAt:row.due_at,daysRemaining:days,amountDue:amount,currency:row.currency})
        : row.reminder_type==="tenant_deletion_warning"
          ? buildTenantDeletionWarningEmail({
              storeName:row.store_name,
              ownerName:row.owner_name,
              lifecycleKind:row.lifecycle_kind==="trial"||row.milestone.startsWith("trial_retention")?"trial":"subscription",
              deletionReviewAt:row.due_at,
              daysRemaining:days,
              finalNotice:row.final_notice===true||row.milestone.endsWith("_final")
            })
          : buildSubscriptionDueReminderEmail({storeName:row.store_name,ownerName:row.owner_name,packageName:row.package_name,dueAt:row.due_at,daysRemaining:days,amountDue:amount,currency:row.currency,billingInterval:row.billing_interval});
      const dueKey=row.due_at.slice(0,10).replaceAll("-","");
      const delivery=await deliverCustomerEmail({
        db,eventType:row.reminder_type,sourceId:row.tenant_id,tenantId:row.tenant_id,to:String(row.owner_email??""),
        message,triggerMode:"automatic",actorUserId:null,eventKeySuffix:dueKey+"_"+row.milestone
      });
      if(delivery.status==="sent")sent++;
      else if(delivery.status==="already_sent")alreadySent++;
      else if(delivery.status==="blocked"||delivery.status==="automatic_disabled")blocked++;
      else if(delivery.status==="failed")failed++;
      results.push({tenant_id:row.tenant_id,reminder_type:row.reminder_type,milestone:row.milestone,due_at:row.due_at,status:delivery.status,delivery_id:delivery.delivery_id??null,message:delivery.message??null});
    }
    return response(true,200,{candidate_count:rows.length,sent,already_sent:alreadySent,blocked,failed,results});
  }catch(error){
    return response(false,500,{error:error instanceof Error?error.message:"subscription_reminder_worker_failed"});
  }
}