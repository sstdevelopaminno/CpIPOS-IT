import { fail, ok } from "@/lib/http";
import { summarizeContractIntegrity, type ContractIntegrityCandidate } from "@/lib/contract-integrity";
import { guardItAdminError, parseTenantParam, requireItAdmin } from "@/lib/it-admin-guard";
import { appendAuditLog } from "@/lib/audit-log";
import { readBoundedJson } from "@/lib/server/limited-json";
import { enforceRateLimit } from "@/lib/server/rate-limit";
export const dynamic = "force-dynamic";

type Code = "THB" | "LAK";
type Contract = { id:string; package_id:string; status:string; ended_at:string|null; updated_at:string; metadata:Record<string,unknown>|null };
async function state(tenantId:string, admin:Awaited<ReturnType<typeof requireItAdmin>>) {
  const db=admin.supabase;
  const [tenant,contract,contracts,policies,orders,unresolved,openShifts,activeSessions,paymentIntents] = await Promise.all([
    db.from("tenants").select("id,code").eq("id",tenantId).maybeSingle(),
    db.from("tenant_subscription_contracts").select("id,package_id,status,ended_at,updated_at,metadata").eq("tenant_id",tenantId).order("created_at",{ascending:false}).limit(1).maybeSingle<Contract>(),
    db.from("tenant_subscription_contracts").select("id,status,ended_at").eq("tenant_id",tenantId).in("status",["active","trial"]).returns<ContractIntegrityCandidate[]>(),
    db.from("tenant_pos_menu_policies").select("menu_key,is_enabled").eq("tenant_id",tenantId).in("menu_key",["main.settings","settings.currency"]),
    db.from("orders").select("id",{count:"exact",head:true}).eq("tenant_id",tenantId),
    db.from("orders").select("id",{count:"exact",head:true}).eq("tenant_id",tenantId).in("status",["draft","queued","preparing"]),
    db.from("shifts").select("id",{count:"exact",head:true}).eq("tenant_id",tenantId).eq("status","open"),
    db.from("pos_sessions").select("id",{count:"exact",head:true}).eq("tenant_id",tenantId).eq("status","active"),
    db.from("pos_payment_intents").select("id",{count:"exact",head:true}).eq("tenant_id",tenantId).in("status",["pending","created","processing","authorized","awaiting_payment","active"])
  ]);
  for(const result of [tenant,contract,contracts,policies,orders,unresolved,openShifts,activeSessions,paymentIntents]) if(result.error) throw result.error;
  if(!tenant.data) return null;
  const pkg=contract.data?.package_id ? await db.from("subscription_packages").select("code").eq("id",contract.data.package_id).maybeSingle() : {data:null,error:null};
  if(pkg.error) throw pkg.error;
  const flags=Object.fromEntries((policies.data??[]).map(p=>[p.menu_key,p.is_enabled]));
  const active=Boolean(contract.data && ["active","trial"].includes(contract.data.status) && (!contract.data.ended_at||Date.parse(contract.data.ended_at)>Date.now()));
  const custom=active && String(pkg.data?.code||"").toLowerCase()==="custom";
  const settingsMenuEnabled=flags["main.settings"]===true;
  const currencyMenuEnabled=flags["settings.currency"]===true;
  const allowed=custom && settingsMenuEnabled && currencyMenuEnabled;
  const currency:Code=contract.data?.metadata?.pos_currency_code==="LAK"?"LAK":"THB";
  const integrity=summarizeContractIntegrity(contracts.data??[]);
  const blockers:string[]=[];
  if(integrity.has_conflict)blockers.push(`พบสัญญาที่มีผลใช้งานซ้อนกัน ${integrity.effective_contract_count} รายการ ต้องตรวจสอบประวัติสัญญาและการเงินโดย IT ก่อนอนุมัติ`);
  if(!custom)blockers.push("ร้านต้องมีสัญญาแพ็กเกจ CUSTOM ที่ยังใช้งานอยู่");
  if(custom && !settingsMenuEnabled)blockers.push("ยังไม่ได้เปิดเมนูหลัก ตั้งค่า (CUSTOM)");
  if(custom && !currencyMenuEnabled)blockers.push("ยังไม่ได้เปิดเมนูย่อย ตั้งค่าสกุลเงิน (CUSTOM)");
  if((unresolved.count??0)>0)blockers.push("มีบิลยังไม่สิ้นสุด");
  if((openShifts.count??0)>0)blockers.push("มีกะขายยังเปิดอยู่");
  if((activeSessions.count??0)>0)blockers.push("มีเครื่อง POS ที่ยังเข้าสู่ระบบ");
  if((paymentIntents.count??0)>0)blockers.push("มีรายการรับเงิน QR ที่ยังไม่สิ้นสุด");
  if(admin.profile.platform_role!=="it_admin" && admin.profile.platform_role!=="it_support")blockers.push("เฉพาะบัญชีฝ่าย IT ที่ยังเปิดใช้งานเท่านั้น");
  return {tenant_code:tenant.data.code, currency_code:currency, is_custom:custom, settings_menu_enabled:settingsMenuEnabled, currency_menu_enabled:currencyMenuEnabled, it_allowed:allowed, approver_role:admin.profile.platform_role === "it_admin" ? "it_admin" : "it_support", total_orders:orders.count??0, unresolved_orders:unresolved.count??0, open_shifts:openShifts.count??0, active_sessions:activeSessions.count??0, pending_payment_intents:paymentIntents.count??0, effective_contract_count:integrity.effective_contract_count, has_contract_conflict:integrity.has_conflict, blockers, can_change:blockers.length===0, contract:contract.data};
}
export async function GET(_request:Request,context:{params:Promise<{tenantId:string}>}){
 try{
  const admin=await requireItAdmin();
  const tenantId=parseTenantParam((await context.params).tenantId);
  const x=await state(tenantId,admin);
  if(!x)return fail("tenant_not_found","ไม่พบร้านค้า",404);
  const {contract:_contract,...publicState}=x;
  const response=ok(publicState);response.headers.set("Cache-Control","private, no-store");return response;
 }catch(error){return guardItAdminError(error)}
}
export async function PATCH(request:Request,context:{params:Promise<{tenantId:string}>}){
 try{
  const admin=await requireItAdmin();
  if(admin.profile.platform_role!=="it_admin" && admin.profile.platform_role!=="it_support")return fail("it_role_required","การเปลี่ยนสกุลเงินต้องได้รับอนุมัติจากบัญชีฝ่าย IT",403);
  const tenantId=parseTenantParam((await context.params).tenantId);
  const rate=await enforceRateLimit({namespace:"it_currency_cutover",key:admin.auth.userId,max:8,windowMs:60000});
  if(!rate.ok)return fail("rate_limited","กรุณาลองอีกครั้งภายหลัง",429);
  const body=await readBoundedJson<{currency_code?:unknown;expected_currency?:unknown;confirmation?:unknown;acknowledge_history?:unknown}|null>(request,2048);
  const next=body?.currency_code;
  if(next!=="THB"&&next!=="LAK")return fail("invalid_currency","รองรับ THB และ LAK เท่านั้น",422);
  if(body?.confirmation!==`CHANGE ${next}`||body?.acknowledge_history!==true)return fail("confirmation_required","กรุณายืนยันการตรวจยอดย้อนหลัง",422);
  const x=await state(tenantId,admin);
  if(!x)return fail("tenant_not_found","ไม่พบร้านค้า",404);
  if(!x.can_change||!x.contract)return fail("cutover_blocked",x.blockers.join(" • ")||"ไม่สามารถเปลี่ยนสกุลเงินได้",409);
  if(body.expected_currency!==x.currency_code)return fail("currency_conflict","สกุลเงินร้านมีการเปลี่ยนแปลง กรุณารีเฟรช",409);
  if(next===x.currency_code)return ok({currency_code:x.currency_code,unchanged:true});
  const {data:updated,error}=await admin.supabase.from("tenant_subscription_contracts")
    .update({metadata:{...(x.contract.metadata??{}),pos_currency_code:next,pos_currency_cutover_at:new Date().toISOString(),pos_currency_cutover_previous:x.currency_code,pos_currency_cutover_order_count:x.total_orders}})
    .eq("tenant_id",tenantId).eq("id",x.contract.id).eq("updated_at",x.contract.updated_at).select("id").maybeSingle();
  if(error)throw error;
  if(!updated)return fail("currency_conflict","มีการแก้ไขข้อมูลสัญญาพร้อมกัน กรุณารีเฟรช",409);
  await appendAuditLog({tenantId,actorUserId:admin.auth.userId,actorRole:admin.profile.platform_role??"it_admin",action:"it_pos_currency_cutover_approved",targetTable:"tenant_subscription_contracts",targetId:x.contract.id,
    beforeData:{currency_code:x.currency_code},afterData:{currency_code:next},
    metadata:{existing_orders:x.total_orders,unresolved_orders:x.unresolved_orders,open_shifts:x.open_shifts,active_sessions:x.active_sessions,pending_payment_intents:x.pending_payment_intents,financial_history_acknowledged:true},
    ipAddress:admin.requestMeta.ipAddress??undefined,userAgent:admin.requestMeta.userAgent??undefined});
  return ok({currency_code:next});
 }catch(error){return guardItAdminError(error)}
}
