import { fail, ok } from "@/lib/http";
import { assertItSupportAction, guardItAdminError, requireItAdmin } from "@/lib/it-admin-guard";
import { writeAuditLog } from "@/lib/server/audit-log";

export const dynamic = "force-dynamic";

const severities = new Set(["info","warning","critical"]);
const manualStatuses = new Set(["open","investigating","resolved"]);

function clean(value: unknown, max = 500) {
  return typeof value === "string" ? value.trim().slice(0,max) : "";
}

async function loadIncidentData(supabase: Awaited<ReturnType<typeof requireItAdmin>>["supabase"]) {
  const [system, manual, tenants, branches, devices] = await Promise.all([
    supabase.from("pos_device_incidents")
      .select("id,tenant_id,branch_id,pos_device_id,device_code,code,severity,title,message,detected_at,last_seen_at,occurrence_count,resolved_at")
      .order("detected_at",{ascending:false}).limit(200),
    supabase.from("it_manual_incidents")
      .select("id,tenant_id,branch_id,severity,code,title,message,status,detected_at,resolved_at,created_by,updated_by")
      .order("detected_at",{ascending:false}).limit(200),
    supabase.from("tenants").select("id,name,code").order("name",{ascending:true}),
    supabase.from("branches").select("id,tenant_id,name,code").order("name",{ascending:true}),
    supabase.from("branch_devices").select("id,device_name,device_code")
  ]);
  for (const result of [system,manual,tenants,branches,devices]) if (result.error) throw result.error;
  const tenantMap=new Map((tenants.data??[]).map(row=>[String(row.id),row]));
  const branchMap=new Map((branches.data??[]).map(row=>[String(row.id),row]));
  const deviceMap=new Map((devices.data??[]).map(row=>[String(row.id),row]));
  const rows=[
    ...(system.data??[]).map(row=>({
      id:row.id,source:"system",tenant_id:row.tenant_id,branch_id:row.branch_id,
      tenant:tenantMap.get(String(row.tenant_id))?.name??"—",
      branch:branchMap.get(String(row.branch_id))?.name??"—",
      device:deviceMap.get(String(row.pos_device_id))?.device_name??row.device_code??"—",
      severity:row.severity,code:row.code,title:row.title,message:row.message,detected_at:row.detected_at,
      last_seen_at:row.last_seen_at??row.detected_at,occurrence_count:Number(row.occurrence_count??1),
      status:row.resolved_at?"resolved":"open",editable:false,deletable:false
    })),
    ...(manual.data??[]).map(row=>({
      id:row.id,source:"manual",tenant_id:row.tenant_id,branch_id:row.branch_id,
      tenant:row.tenant_id?tenantMap.get(String(row.tenant_id))?.name??"—":"ส่วนกลาง",
      branch:row.branch_id?branchMap.get(String(row.branch_id))?.name??"—":"—",
      device:"—",severity:row.severity,code:row.code,title:row.title,message:row.message,detected_at:row.detected_at,
      last_seen_at:row.detected_at,occurrence_count:1,
      status:row.status,editable:true,deletable:true
    }))
  ].sort((a,b)=>Date.parse(String(b.detected_at))-Date.parse(String(a.detected_at)));
  return {
    rows,
    options:{
      tenants:(tenants.data??[]).map(row=>({id:row.id,name:row.name,code:row.code})),
      branches:(branches.data??[]).map(row=>({id:row.id,tenant_id:row.tenant_id,name:row.name,code:row.code}))
    }
  };
}

export async function GET(request: Request) {
  try {
    const {supabase}=await requireItAdmin();
    const {searchParams}=new URL(request.url);
    const q=clean(searchParams.get("q"),120).toLowerCase();
    const severity=clean(searchParams.get("severity"),20);
    const status=clean(searchParams.get("status"),20);
    const source=clean(searchParams.get("source"),20);
    const data=await loadIncidentData(supabase);
    const rows=data.rows.filter(row=>{
      if(severity&&row.severity!==severity)return false;
      if(status&&row.status!==status)return false;
      if(source&&row.source!==source)return false;
      if(!q)return true;
      return [row.tenant,row.branch,row.device,row.code,row.title,row.message].some(value=>String(value??"").toLowerCase().includes(q));
    });
    return ok({
      summary:{
        total:rows.length,
        open:rows.filter(row=>row.status!=="resolved").length,
        critical:rows.filter(row=>row.status!=="resolved"&&row.severity==="critical").length,
        manual:rows.filter(row=>row.source==="manual").length
      },
      rows,
      options:data.options
    });
  } catch(error){ return guardItAdminError(error); }
}

export async function POST(request: Request) {
  try {
    const context=await requireItAdmin();
    const body=await request.json().catch(()=>null) as Record<string,unknown>|null;
    const title=clean(body?.title,160);
    const message=clean(body?.message,2000);
    const severity=clean(body?.severity,20)||"warning";
    const code=clean(body?.code,80)||"MANUAL";
    const branchId=clean(body?.branch_id,80)||null;
    let tenantId=clean(body?.tenant_id,80)||null;
    if(!title)return fail("incident_title_required","กรุณาระบุชื่อเหตุขัดข้อง",422);
    if(!severities.has(severity))return fail("incident_severity_invalid","ระดับความรุนแรงไม่ถูกต้อง",422);
    if(branchId&&!tenantId){
      const branch=await context.supabase.from("branches").select("tenant_id").eq("id",branchId).maybeSingle();
      if(branch.error)throw branch.error;
      tenantId=branch.data?.tenant_id??null;
    }
    const inserted=await context.supabase.from("it_manual_incidents").insert({
      tenant_id:tenantId,branch_id:branchId,severity,code,title,message,status:"open",
      created_by:context.auth.userId,updated_by:context.auth.userId
    }).select("id").single();
    if(inserted.error)throw inserted.error;
    await writeAuditLog({
      tenantId,branchId,actorUserId:context.auth.userId,actorRole:context.auth.platformRole,
      action:"it_incident_created",targetTable:"it_manual_incidents",targetId:inserted.data.id,targetType:"incident",
      ipAddress:context.requestMeta.ipAddress,userAgent:context.requestMeta.userAgent,
      metadata:{severity,code,title}
    });
    return ok({id:inserted.data.id});
  } catch(error){ return guardItAdminError(error); }
}

export async function PATCH(request: Request) {
  try {
    const context=await requireItAdmin();
    const body=await request.json().catch(()=>null) as Record<string,unknown>|null;
    const id=clean(body?.id,80);
    const source=clean(body?.source,20);
    if(!id)return fail("incident_id_required","ไม่พบรหัส Incident",422);

    if(source==="system"){
      const status=clean(body?.status,20);
      if(status!=="open"&&status!=="resolved")return fail("incident_status_invalid","สถานะไม่ถูกต้อง",422);
      const result=await context.supabase.from("pos_device_incidents")
        .update({resolved_at:status==="resolved"?new Date().toISOString():null}).eq("id",id)
        .select("tenant_id,branch_id").maybeSingle();
      if(result.error)throw result.error;
      await writeAuditLog({
        tenantId:result.data?.tenant_id??null,branchId:result.data?.branch_id??null,
        actorUserId:context.auth.userId,actorRole:context.auth.platformRole,
        action:status==="resolved"?"it_system_incident_resolved":"it_system_incident_reopened",
        targetTable:"pos_device_incidents",targetId:id,targetType:"incident",
        ipAddress:context.requestMeta.ipAddress,userAgent:context.requestMeta.userAgent
      });
      return ok({id,status});
    }

    const current=await context.supabase.from("it_manual_incidents").select("*").eq("id",id).maybeSingle();
    if(current.error)throw current.error;
    if(!current.data)return fail("incident_not_found","ไม่พบ Incident",404);
    const severity=clean(body?.severity,20)||String(current.data.severity);
    const status=clean(body?.status,20)||String(current.data.status);
    if(!severities.has(severity)||!manualStatuses.has(status))return fail("incident_update_invalid","ข้อมูล Incident ไม่ถูกต้อง",422);
    const title=clean(body?.title,160)||String(current.data.title);
    const message=typeof body?.message==="string"?clean(body.message,2000):String(current.data.message??"");
    const code=clean(body?.code,80)||String(current.data.code);
    const tenantId=typeof body?.tenant_id==="string"?(clean(body.tenant_id,80)||null):current.data.tenant_id;
    const branchId=typeof body?.branch_id==="string"?(clean(body.branch_id,80)||null):current.data.branch_id;
    const update={
      tenant_id:tenantId,branch_id:branchId,severity,status,title,message,code,
      resolved_at:status==="resolved"?(current.data.resolved_at??new Date().toISOString()):null,
      updated_by:context.auth.userId,updated_at:new Date().toISOString()
    };
    const result=await context.supabase.from("it_manual_incidents").update(update).eq("id",id);
    if(result.error)throw result.error;
    await writeAuditLog({
      tenantId,branchId,actorUserId:context.auth.userId,actorRole:context.auth.platformRole,
      action:"it_incident_updated",targetTable:"it_manual_incidents",targetId:id,targetType:"incident",
      oldValue:{severity:current.data.severity,status:current.data.status,title:current.data.title},
      newValue:{severity,status,title},ipAddress:context.requestMeta.ipAddress,userAgent:context.requestMeta.userAgent
    });
    return ok({id,status});
  } catch(error){ return guardItAdminError(error); }
}

export async function DELETE(request: Request) {
  try {
    const context=await requireItAdmin();
    assertItSupportAction(context,"การลบ Incident ที่ IT สร้างเองอนุญาตเฉพาะ IT Support");
    const body=await request.json().catch(()=>null) as Record<string,unknown>|null;
    const id=clean(body?.id,80);
    if(!id)return fail("incident_id_required","ไม่พบรหัส Incident",422);
    const current=await context.supabase.from("it_manual_incidents").select("tenant_id,branch_id,title,severity").eq("id",id).maybeSingle();
    if(current.error)throw current.error;
    if(!current.data)return fail("incident_not_found","ไม่พบ Incident หรือเป็น Incident จากระบบที่ห้ามลบ",404);
    const result=await context.supabase.from("it_manual_incidents").delete().eq("id",id);
    if(result.error)throw result.error;
    await writeAuditLog({
      tenantId:current.data.tenant_id,branchId:current.data.branch_id,actorUserId:context.auth.userId,actorRole:context.auth.platformRole,
      action:"it_incident_deleted",targetTable:"it_manual_incidents",targetId:id,targetType:"incident",
      ipAddress:context.requestMeta.ipAddress,userAgent:context.requestMeta.userAgent,
      metadata:{title:current.data.title,severity:current.data.severity}
    });
    return ok({id,deleted:true});
  } catch(error){ return guardItAdminError(error); }
}
