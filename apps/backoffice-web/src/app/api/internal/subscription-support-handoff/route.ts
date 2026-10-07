import { Buffer } from "node:buffer";
import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { readEnv } from "@/lib/env";
import { getPrimarySupabaseServiceClient } from "@/lib/supabase-admin";
import { sendSupportMail } from "@/lib/services/it-admin/support-mail-service";
import { dispatchSupportPush } from "@/lib/support-chat/support-push";

export const runtime="nodejs";
export const dynamic="force-dynamic";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function bridgeToken(){
  const serviceRole=String(readEnv("SUPABASE_SERVICE_ROLE_KEY")??"").trim();
  if(!serviceRole)return"";
  return createHash("sha256")
    .update("cpipos:internal-subscription-support-handoff:v1|")
    .update(serviceRole)
    .digest("hex");
}
function authorized(req:Request){
  const raw=String(req.headers.get("authorization")??"").replace(/^Bearer\s+/i,"").trim();
  const expected=bridgeToken();
  if(!raw||!expected)return false;
  const a=Buffer.from(raw),b=Buffer.from(expected);
  return a.length===b.length&&timingSafeEqual(a,b);
}
function clean(value:unknown,max=800){return String(value??"").trim().slice(0,max);}
function response(ok:boolean,status:number,payload:Record<string,unknown>){
  return NextResponse.json({ok,...payload},{status,headers:{"cache-control":"no-store","x-content-type-options":"nosniff"}});
}

export async function POST(req:Request){
  if(!authorized(req))return response(false,401,{error:"unauthorized"});
  const db=getPrimarySupabaseServiceClient();
  let requestId="";
  try{
    const body=await req.json().catch(()=>null) as Record<string,unknown>|null;
    requestId=clean(body?.support_request_id,64);
    const tenantId=clean(body?.tenant_id,64);
    const reason=clean(body?.reason_code,120)||"subscription_support_required";
    const message=clean(body?.message,800);
    if(!UUID.test(requestId)||!UUID.test(tenantId))return response(false,422,{error:"invalid_scope"});

    const [tenantResult,dueResult,settingsResult]=await Promise.all([
      db.from("tenants").select("id,code,name,display_name,owner_name,contact_phone,owner_phone")
        .eq("id",tenantId).maybeSingle<Record<string,unknown>>(),
      db.rpc("subscription_billing_due_state",{p_tenant_id:tenantId}),
      db.from("it_communication_settings").select("billing_email,support_email")
        .eq("id","default").maybeSingle<{billing_email:string|null;support_email:string|null}>()
    ]);
    if(tenantResult.error||!tenantResult.data)return response(false,404,{error:"tenant_not_found"});
    if(dueResult.error)return response(false,503,{error:"billing_state_unavailable"});

    const tenant=tenantResult.data;
    const due=(dueResult.data??{}) as Record<string,unknown>;
    const target=String(settingsResult.data?.billing_email??"").trim()
      ||String(settingsResult.data?.support_email??"").trim()
      ||"cuttingpointtech@gmail.com";
    const storeName=String(tenant.display_name??tenant.name??"ร้านค้า");
    const storeCode=String(tenant.code??tenantId);
    const subject="CpiPOS Support → IT | แพ็กเกจถูกล็อก | "+storeCode;
    const bodyText=[
      "คำขอจากระบบ Support เรื่องแพ็กเกจ CpiPOS",
      "",
      "ร้าน: "+storeName,
      "รหัสร้าน: "+storeCode,
      "เหตุผล: "+reason,
      "สถานะแพ็กเกจ: "+String(due.status??"-"),
      "ครบกำหนด: "+String(due.due_at??"-"),
      "ยอดคงค้าง: "+String(due.outstanding??due.amount_due??0)+" "+String(due.currency??"THB"),
      "Payment Request: "+String(due.open_request_id??"-"),
      "Billing Cycle: "+String(due.billing_cycle_id??"-"),
      message?"ข้อความจากร้าน/Support: "+message:"",
      "",
      "กรุณาเปิด IT Admin → Tenants / Stores หรือ Subscription Payments เพื่อตรวจสอบและดำเนินการ",
      "อีเมลนี้สร้างโดย CpiPOS Support handoff อัตโนมัติ"
    ].filter(Boolean).join("\n");

    try{
      const mail=await sendSupportMail({to:target,subject,body:bodyText});
      await db.from("tenant_subscription_support_requests").update({
        status:"sent",email_status:"sent",email_detail:JSON.stringify(mail).slice(0,1000),updated_at:new Date().toISOString()
      }).eq("id",requestId).eq("tenant_id",tenantId);
      await dispatchSupportPush({
        audience:"it",tenant_id:tenantId,kind:"request",
        title:"Support ขอให้ตรวจแพ็กเกจ · "+storeName,
        body:storeCode+" · "+reason,
        url:"/it-admin/subscription-payments/"+tenantId,
        tag:"subscription-support:"+requestId
      }).catch(()=>null);
      return response(true,200,{status:"sent"});
    }catch(error){
      const detail=error instanceof Error?error.message:"support_mail_failed";
      await db.from("tenant_subscription_support_requests").update({
        status:"failed",email_status:"failed",email_detail:detail.slice(0,1000),updated_at:new Date().toISOString()
      }).eq("id",requestId).eq("tenant_id",tenantId);
      return response(false,503,{error:"support_mail_failed",detail});
    }
  }catch(error){
    const detail=error instanceof Error?error.message:"support_handoff_failed";
    if(UUID.test(requestId)){
      await db.from("tenant_subscription_support_requests").update({
        status:"failed",email_status:"failed",email_detail:detail.slice(0,1000),updated_at:new Date().toISOString()
      }).eq("id",requestId).catch(()=>null);
    }
    return response(false,500,{error:"support_handoff_failed",detail});
  }
}
