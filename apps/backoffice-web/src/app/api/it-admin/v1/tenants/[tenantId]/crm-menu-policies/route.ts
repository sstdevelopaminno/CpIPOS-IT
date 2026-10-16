import { readBoundedJson } from "@/lib/server/limited-json";
import { appendAuditLog } from "@/lib/audit-log";
import { fail, ok } from "@/lib/http";
import { guardItAdminError, parseTenantParam, requireItAdmin } from "@/lib/it-admin-guard";
import { CRM_MENU_CATALOG, isValidCrmMenuKey } from "@/lib/crm-menu-policy";
import { enforceRateLimit } from "@/lib/server/rate-limit";

export const dynamic="force-dynamic";
const keys=CRM_MENU_CATALOG.map(item=>item.key);

/** IT tenant card: read CRM-only keys, never return or modify POS keys. */
export async function GET(_request:Request,context:{params:Promise<{tenantId:string}>}){
  try{
    const admin=await requireItAdmin();
    const tenantId=parseTenantParam((await context.params).tenantId);
    const [tenant,policies]=await Promise.all([
      admin.supabase.from("tenants").select("id").eq("id",tenantId).maybeSingle(),
      admin.supabase.from("tenant_pos_menu_policies").select("menu_key,is_enabled")
        .eq("tenant_id",tenantId).in("menu_key",keys)
    ]);
    if(tenant.error)throw tenant.error;
    if(!tenant.data)return fail("tenant_not_found","ไม่พบร้านค้า",404);
    if(policies.error)throw policies.error;
    const overrides=Object.fromEntries((policies.data??[]).map(row=>[row.menu_key,row.is_enabled]));
    const response=ok({tenant_id:tenantId,catalog:CRM_MENU_CATALOG,overrides,total:CRM_MENU_CATALOG.length});
    response.headers.set("cache-control","private, no-store");
    return response;
  }catch(error){return guardItAdminError(error);}
}

export async function PATCH(request:Request,context:{params:Promise<{tenantId:string}>}){
  try{
    const admin=await requireItAdmin();
    const rate=await enforceRateLimit({namespace:"it_tenant_crm_menu_toggle",key:admin.auth.userId,max:30,windowMs:60_000});
    if(!rate.ok)return fail("rate_limited","กรุณารอสักครู่แล้วลองใหม่",429);
    const tenantId=parseTenantParam((await context.params).tenantId);
    const body=await readBoundedJson<{menu_key?:unknown;is_enabled?:unknown}|null>(request,4096);
    const key=typeof body?.menu_key==="string"?body.menu_key.trim():"";
    if(!isValidCrmMenuKey(key)||typeof body?.is_enabled!=="boolean")
      return fail("invalid_crm_menu_policy","รหัสเมนูหรือสถานะไม่ถูกต้อง",422);
    const tenant=await admin.supabase.from("tenants").select("id").eq("id",tenantId).maybeSingle();
    if(tenant.error)throw tenant.error;
    if(!tenant.data)return fail("tenant_not_found","ไม่พบร้านค้า",404);
    const existing=await admin.supabase.from("tenant_pos_menu_policies")
      .select("is_enabled").eq("tenant_id",tenantId).eq("menu_key",key)
      .maybeSingle<{is_enabled:boolean}>();
    if(existing.error)throw existing.error;
    const next=await admin.supabase.from("tenant_pos_menu_policies")
      .upsert({tenant_id:tenantId,menu_key:key,is_enabled:body.is_enabled,updated_by:admin.auth.userId,
        updated_at:new Date().toISOString()},{onConflict:"tenant_id,menu_key"})
      .select("menu_key,is_enabled,updated_at").single();
    if(next.error||!next.data)throw next.error??new Error("crm_menu_policy_write_failed");
    await appendAuditLog({
      tenantId,actorUserId:admin.auth.userId,actorRole:"it_admin",
      action:"it_tenant_crm_menu_policy_changed",targetTable:"tenant_pos_menu_policies",
      beforeData:{menu_key:key,is_enabled:existing.data?.is_enabled??true},
      afterData:{menu_key:key,is_enabled:body.is_enabled},
      metadata:{menu_key:key,system:"customer_portal_crm"},
      ipAddress:admin.requestMeta.ipAddress??undefined,userAgent:admin.requestMeta.userAgent??undefined
    });
    const response=ok({tenant_id:tenantId,...next.data});
    response.headers.set("cache-control","private, no-store");
    return response;
  }catch(error){return guardItAdminError(error);}
}
