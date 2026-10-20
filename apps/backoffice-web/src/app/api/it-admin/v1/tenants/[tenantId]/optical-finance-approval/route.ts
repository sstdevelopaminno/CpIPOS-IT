import {appendAuditLog} from "@/lib/audit-log";
import {fail,ok} from "@/lib/http";
import {guardItAdminError,parseTenantParam,requireItAdmin} from "@/lib/it-admin-guard";
import {enforceRateLimit} from "@/lib/server/rate-limit";

const allowedFeatures=["optical_work_orders","optical_deposit"] as const;
type FinanceFeature=typeof allowedFeatures[number];
type Contract={id:string;package_id:string;status:string;ended_at:string|null;metadata:Record<string,unknown>|null;updated_at:string};
function readGrants(c:Contract){
 const custom=c.metadata?.custom_features;
 const grants=custom&&typeof custom==="object"&&!Array.isArray(custom)?custom as Record<string,unknown>:{};
 return {optical_work_orders:grants.optical_work_orders===true,optical_deposit:grants.optical_deposit===true};
}
async function lookup(supabase:Awaited<ReturnType<typeof requireItAdmin>>["supabase"],tenantId:string){
 const {data,error}=await supabase.from("tenant_subscription_contracts")
   .select("id,package_id,status,ended_at,metadata,updated_at")
   .eq("tenant_id",tenantId).in("status",["active","trial"]).order("created_at",{ascending:false}).limit(2);
 if(error)throw error;
 if(data?.length!==1)return {contract:null,valid:false,reason:"ต้องมีสัญญาที่ใช้งานอยู่เพียงรายการเดียว"};
 const c=data[0] as Contract;
 const [pkg,lifecycle]=await Promise.all([
   supabase.from("subscription_packages").select("code").eq("id",c.package_id).maybeSingle(),
   supabase.from("tenant_data_lifecycle").select("access_locked,trial_expires_at").eq("tenant_id",tenantId).maybeSingle()
 ]);
 if(pkg.error||lifecycle.error)throw pkg.error??lifecycle.error;
 const modes=c.metadata?.sales_modes;
 const eligible=String(pkg.data?.code??"").toLowerCase()==="custom"
   &&!!modes&&typeof modes==="object"&&!Array.isArray(modes)
   &&(modes as Record<string,unknown>).optical_retail===true
   &&(!c.ended_at||Date.parse(c.ended_at)>Date.now())
   &&lifecycle.data?.access_locked!==true
   &&(c.status!=="trial"||!lifecycle.data?.trial_expires_at||Date.parse(lifecycle.data.trial_expires_at)>Date.now());
 return {contract:c,valid:eligible,reason:eligible?null:"เฉพาะสัญญา CUSTOM Optical ที่ใช้งานได้เท่านั้น"};
}
export async function GET(_req:Request,ctx:{params:Promise<{tenantId:string}>}){
 try{
   const admin=await requireItAdmin();
   const id=parseTenantParam((await ctx.params).tenantId);
   const x=await lookup(admin.supabase,id);
   const response=ok({eligible:x.valid,reason:x.reason,
     granted:x.contract?readGrants(x.contract):{optical_work_orders:false,optical_deposit:false},
     rollout:"separate_vercel_environment_variable",
     rollout_hint:"Vercel POS Web: OPTICAL_FINANCE_V1_ENABLED=true หลังผ่านการตรวจรับธุรกรรมเท่านั้น"});
   response.headers.set("Cache-Control","private, no-store");return response;
 }catch(e){return guardItAdminError(e);}
}
export async function PATCH(req:Request,ctx:{params:Promise<{tenantId:string}>}){
 try{
   const admin=await requireItAdmin();
   const id=parseTenantParam((await ctx.params).tenantId);
   const rate=await enforceRateLimit({namespace:"it_optical_finance_approval",key:admin.auth.userId,max:6,windowMs:60_000});
   if(!rate.ok)return fail("rate_limited","ลองใหม่อีกครั้งภายหลัง",429);
   const body=await req.json().catch(()=>null) as {feature?:string;enabled?:boolean;confirmation?:string}|null;
   if(!body||!allowedFeatures.includes(body.feature as FinanceFeature)
     ||typeof body.enabled!=="boolean"||body.confirmation!=="OPTICAL")
     return fail("invalid_approval","โปรดยืนยัน OPTICAL พร้อมเลือกสิทธิ์ที่ต้องการ",422);
   const state=await lookup(admin.supabase,id);
   if(!state.valid||!state.contract)return fail("optical_contract_not_eligible",state.reason??"Contract invalid",409);
   const contract=state.contract;
   const old=readGrants(contract);
   if(body.feature==="optical_deposit"&&body.enabled&&!old.optical_work_orders)
     return fail("work_orders_approval_required","ต้องอนุมัติใบสั่งงาน Optical ก่อนเงินมัดจำ",409);
   if(body.feature==="optical_work_orders"&&!body.enabled&&old.optical_deposit)
     return fail("disable_deposit_first","ต้องปิดสิทธิ์รับมัดจำก่อนปิดใบสั่งงาน",409);
   const metadata=contract.metadata??{};
   const custom=metadata.custom_features;
   const oldCustom=custom&&typeof custom==="object"&&!Array.isArray(custom)?custom as Record<string,unknown>:{};
   const next={...metadata,custom_features:{...oldCustom,[body.feature]:body.enabled}};
   const update=await admin.supabase.from("tenant_subscription_contracts")
     .update({metadata:next,updated_at:new Date().toISOString()})
     .eq("id",contract.id).eq("tenant_id",id).eq("updated_at",contract.updated_at)
     .select("id").maybeSingle();
   if(update.error)throw update.error;
   if(!update.data)return fail("approval_conflict","มีการแก้ไขสัญญาพร้อมกัน กรุณาโหลดใหม่ก่อนบันทึก",409);
   await appendAuditLog({tenantId:id,actorUserId:admin.auth.userId,actorRole:"it_admin",
     action:body.enabled?"it_optical_finance_feature_approved":"it_optical_finance_feature_revoked",
     targetTable:"tenant_subscription_contracts",targetId:contract.id,
     beforeData:{feature:body.feature,enabled:old[body.feature as FinanceFeature]},
     afterData:{feature:body.feature,enabled:body.enabled},
     metadata:{source:"it_optical_finance_approval",rollout:"unchanged"},
     ipAddress:admin.requestMeta.ipAddress??undefined,userAgent:admin.requestMeta.userAgent??undefined});
   return ok({feature:body.feature,enabled:body.enabled,granted:{...old,[body.feature]:body.enabled},
     rollout:"unchanged"});
 }catch(e){return guardItAdminError(e);}
}
