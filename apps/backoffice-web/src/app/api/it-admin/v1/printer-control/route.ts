import { appendAuditLog } from "@/lib/audit-log";
import { fail, ok } from "@/lib/http";
import { assertItSupportAction, guardItAdminError, requireItAdmin } from "@/lib/it-admin-guard";
import { enforceRateLimit, getClientIpAddress } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

type JsonRecord = Record<string, unknown>;
type ResourceType = "printer" | "agent" | "runtime";

type PrinterRow = {
  id:string;tenant_id:string;branch_id:string;printer_profile_id:string|null;
  display_name:string;brand:string|null;model:string|null;connection_mode:string;
  paper_width_mm:number;runtime_device_code:string|null;status:string;is_active:boolean;
  last_seen_at:string|null;metadata:JsonRecord|null;created_at:string;updated_at:string;
};
type AgentRow = {
  id:string;tenant_id:string;branch_id:string;device_id:string|null;device_code:string;
  agent_name:string;status:string;last_seen_at:string|null;last_claim_at:string|null;
  app_version:string|null;metadata:JsonRecord|null;created_at:string;updated_at:string;
};
type DeviceRow = {
  id:string;tenant_id:string;branch_id:string;device_code:string;device_name:string;
  device_type:string;status:string;is_active:boolean;last_seen_at:string|null;metadata:JsonRecord|null;
};
type HealthRow = {
  pos_device_id:string|null;status:string;last_seen_at:string;metadata:JsonRecord|null;
};
type PrintJobMetricRow = {
  id:string;status:string;created_at:string;claimed_at:string|null;printed_at:string|null;failed_at:string|null;
  retry_count:number;last_error:string|null;agent_error_code:string|null;
};

function text(value:unknown,max=180){
  return typeof value==="string" ? value.trim().slice(0,max) : "";
}
function asRecord(value:unknown):JsonRecord{
  return value && typeof value==="object" && !Array.isArray(value) ? value as JsonRecord : {};
}
function isOnline(lastSeen:string|null,status:string){
  const seen=lastSeen ? Date.parse(lastSeen) : NaN;
  return status==="active" && Number.isFinite(seen) && Date.now()-seen<=5*60_000;
}
function elapsedMs(start:string|null,end:string|null){
  if(!start||!end)return null;
  const a=Date.parse(start); const b=Date.parse(end);
  return Number.isFinite(a)&&Number.isFinite(b)&&b>=a ? b-a : null;
}
function percentile(values:number[],ratio:number){
  if(!values.length)return null;
  const sorted=[...values].sort((a,b)=>a-b);
  const index=Math.min(sorted.length-1,Math.max(0,Math.ceil(sorted.length*ratio)-1));
  return Math.round(sorted[index]??0);
}
function surfaceFromMetadata(metadata:JsonRecord|null){
  const source=text(metadata?.source).toLowerCase();
  const runtime=text(metadata?.runtime).toLowerCase();
  if(source.includes("android")||runtime.includes("android")) return "android_mdm";
  if(source.includes("browser")||runtime.includes("browser")) return "browser";
  if(source.includes("windows")||runtime.includes("windows")) return "windows_runtime";
  return "registered";
}
const PRINTER_DB_STATUSES=new Set(["online","offline","checking","connecting","needs_check","disabled","disconnected"]);

function connectionType(mode:string){
  if(mode==="lan") return "NETWORK_ESC_POS";
  if(mode==="bluetooth") return "BLUETOOTH_BRIDGE";
  return "LOCAL_BRIDGE";
}

function normalizePrinterStatus(requested:unknown,current:unknown,active:boolean){
  if(!active)return "disabled";
  const requestedStatus=text(requested,40).toLowerCase();
  if(PRINTER_DB_STATUSES.has(requestedStatus) && requestedStatus!=="disabled")return requestedStatus;
  const currentStatus=text(current,40).toLowerCase();
  if(PRINTER_DB_STATUSES.has(currentStatus) && currentStatus!=="disabled")return currentStatus;
  return "offline";
}

async function loadSnapshot(context:Awaited<ReturnType<typeof requireItAdmin>>){
  const db=context.supabase;
  const [printers,agents,tenants,branches,devices,health,profiles,commands,printJobs]=await Promise.all([
    db.from("printer_devices").select("id,tenant_id,branch_id,printer_profile_id,display_name,brand,model,connection_mode,paper_width_mm,runtime_device_code,status,is_active,last_seen_at,metadata,created_at,updated_at").eq("is_active",true).neq("status","disabled").order("updated_at",{ascending:false}).limit(500).returns<PrinterRow[]>(),
    db.from("print_agents").select("id,tenant_id,branch_id,device_id,device_code,agent_name,status,last_seen_at,last_claim_at,app_version,metadata,created_at,updated_at").order("updated_at",{ascending:false}).limit(500).returns<AgentRow[]>(),
    db.from("tenants").select("id,name").limit(500),
    db.from("branches").select("id,name").limit(500),
    db.from("branch_devices").select("id,tenant_id,branch_id,device_code,device_name,device_type,status,is_active,last_seen_at,metadata").eq("is_active",true).limit(500).returns<DeviceRow[]>(),
    db.from("pos_device_health_latest").select("pos_device_id,status,last_seen_at,metadata").order("last_seen_at",{ascending:false}).limit(1000).returns<HealthRow[]>(),
    db.from("printer_profiles").select("id,printer_name,printer_role,connection_type,paper_width_mm,enabled,metadata").limit(500),
    db.from("device_commands").select("id,pos_device_id,command_type,status,issued_at,delivered_at,result").in("command_type",["request_diagnostics","test_printer"]).order("issued_at",{ascending:false}).limit(300),
    db.from("print_jobs").select("id,status,created_at,claimed_at,printed_at,failed_at,retry_count,last_error,agent_error_code").order("created_at",{ascending:false}).limit(1000).returns<PrintJobMetricRow[]>()
  ]);
  for(const result of [printers,agents,tenants,branches,devices,health,profiles,commands,printJobs]){
    if(result.error) throw new Error(result.error.message);
  }

  const tenantName=new Map((tenants.data??[]).map(row=>[String(row.id),String(row.name)]));
  const branchName=new Map((branches.data??[]).map(row=>[String(row.id),String(row.name)]));
  const profileById=new Map((profiles.data??[]).map(row=>[String(row.id),row]));
  const latestHealth=new Map<string,HealthRow>();
  for(const row of health.data??[]){
    if(row.pos_device_id && !latestHealth.has(String(row.pos_device_id))) latestHealth.set(String(row.pos_device_id),row);
  }
  const latestCommand=new Map<string,Record<string,unknown>>();
  for(const row of commands.data??[]){
    if(row.pos_device_id && !latestCommand.has(String(row.pos_device_id))) latestCommand.set(String(row.pos_device_id),row as Record<string,unknown>);
  }
  const deviceByCode=new Map<string,DeviceRow>();
  for(const row of devices.data??[]) deviceByCode.set(`${row.tenant_id}:${row.branch_id}:${row.device_code.toUpperCase()}`,row);

  const printerRows=(printers.data??[]).map(row=>{
    const profile=row.printer_profile_id ? profileById.get(String(row.printer_profile_id)) : null;
    const runtime=row.runtime_device_code ? deviceByCode.get(`${row.tenant_id}:${row.branch_id}:${row.runtime_device_code.toUpperCase()}`) : null;
    const surface=surfaceFromMetadata(row.metadata);
    return {
      resource_type:"printer" as const,
      id:row.id,tenant_id:row.tenant_id,branch_id:row.branch_id,
      tenant:tenantName.get(row.tenant_id)??row.tenant_id,
      branch:branchName.get(row.branch_id)??row.branch_id,
      name:row.display_name,
      brand:row.brand,model:row.model,connection:row.connection_mode,
      paper_width_mm:row.paper_width_mm,
      runtime_device_code:row.runtime_device_code,
      status:row.is_active ? row.status : "inactive",
      active:row.is_active,
      online:isOnline(row.last_seen_at,row.is_active?"active":"inactive") || row.status==="online",
      last_seen_at:row.last_seen_at,
      source:surface,
      profile_id:row.printer_profile_id,
      profile_enabled:Boolean(profile?.enabled),
      profile_role:profile?.printer_role??null,
      profile_connection_type:profile?.connection_type??connectionType(row.connection_mode),
      remote_device_id:runtime?.id??null,
      remote_device_name:runtime?.device_name??null,
      latest_command:runtime ? latestCommand.get(runtime.id)??null : null,
      editable:true,deletable:true
    };
  });

  const agentRows=(agents.data??[]).map(row=>{
    const runtime=row.device_id ? (devices.data??[]).find(device=>device.id===row.device_id) :
      deviceByCode.get(`${row.tenant_id}:${row.branch_id}:${row.device_code.toUpperCase()}`);
    return {
      resource_type:"agent" as const,
      id:row.id,tenant_id:row.tenant_id,branch_id:row.branch_id,
      tenant:tenantName.get(row.tenant_id)??row.tenant_id,
      branch:branchName.get(row.branch_id)??row.branch_id,
      name:row.agent_name,
      device_code:row.device_code,
      status:row.status,
      active:row.status==="active",
      online:isOnline(row.last_seen_at,row.status),
      last_seen_at:row.last_seen_at,
      last_claim_at:row.last_claim_at,
      app_version:row.app_version,
      source:surfaceFromMetadata(row.metadata),
      remote_device_id:runtime?.id??row.device_id,
      remote_device_name:runtime?.device_name??null,
      latest_command:runtime ? latestCommand.get(runtime.id)??null : null,
      editable:true,deletable:true
    };
  });

  const agentRuntimeKeys=new Set(agentRows.flatMap(row=>[
    row.remote_device_id ? `id:${row.remote_device_id}` : "",
    row.device_code ? `code:${row.tenant_id}:${row.branch_id}:${String(row.device_code).toUpperCase()}` : ""
  ].filter(Boolean)));

  const remoteTargets=(devices.data??[]).map(device=>{
    const healthRow=latestHealth.get(device.id);
    const metadata=asRecord(healthRow?.metadata ?? device.metadata);
    const observedAt=healthRow?.last_seen_at??device.last_seen_at;
    const agentBound=
      agentRuntimeKeys.has(`id:${device.id}`) ||
      agentRuntimeKeys.has(`code:${device.tenant_id}:${device.branch_id}:${device.device_code.toUpperCase()}`);
    return {
      id:device.id,tenant_id:device.tenant_id,branch_id:device.branch_id,
      tenant:tenantName.get(device.tenant_id)??device.tenant_id,
      branch:branchName.get(device.branch_id)??device.branch_id,
      device_code:device.device_code,device_name:device.device_name,
      device_type:device.device_type,status:device.status,last_seen_at:observedAt,
      online:isOnline(observedAt,device.status),
      surface:text(metadata.telemetry_profile)||text(metadata.native_android_bridge)||"web",
      print_agent_bound:agentBound,
      latest_command:latestCommand.get(device.id)??null
    };
  });

  const runtimeRows=remoteTargets.map(target=>({
    resource_type:"runtime" as const,
    id:target.id,tenant_id:target.tenant_id,branch_id:target.branch_id,
    tenant:target.tenant,branch:target.branch,
    name:target.device_name,
    device_code:target.device_code,
    status:target.print_agent_bound ? target.status : "agent_missing",
    active:true,
    online:target.online,
    last_seen_at:target.last_seen_at,
    source:target.surface==="android"||target.surface==="CpiposMdm" ? "android_mdm" : target.surface==="browser" ? "browser" : "registered",
    app_version:null,
    remote_device_id:target.id,
    remote_device_name:target.device_name,
    print_agent_bound:target.print_agent_bound,
    latest_command:target.latest_command,
    editable:false,deletable:false
  }));

  const metricRows=printJobs.data??[];
  const nowMs=Date.now();
  const printed=metricRows.filter(row=>row.status==="printed");
  const queueToClaim=printed.map(row=>elapsedMs(row.created_at,row.claimed_at)).filter((value):value is number=>value!==null);
  const claimToPrint=printed.map(row=>elapsedMs(row.claimed_at,row.printed_at)).filter((value):value is number=>value!==null);
  const totalPrint=printed.map(row=>elapsedMs(row.created_at,row.printed_at)).filter((value):value is number=>value!==null);
  const lastJobAt=metricRows[0]?.created_at??null;
  const lastJobMs=lastJobAt?Date.parse(lastJobAt):NaN;
  const jobs24h=metricRows.filter(row=>Date.parse(row.created_at)>=nowMs-24*60*60_000);
  const jobs30d=metricRows.filter(row=>Date.parse(row.created_at)>=nowMs-30*24*60*60_000);
  const failuresByCode=new Map<string,number>();
  for(const row of jobs30d.filter(row=>row.status==="failed"||row.status==="retrying")){
    const code=text(row.agent_error_code)||text(row.last_error,80)||"unknown";
    failuresByCode.set(code,(failuresByCode.get(code)??0)+1);
  }
  const topFailures=Array.from(failuresByCode.entries()).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([code,count])=>({code,count}));

  const rows=[...printerRows,...agentRows,...runtimeRows];
  return {
    checked_at:new Date().toISOString(),
    summary:{
      total:rows.length,
      printers:printerRows.length,
      agents:agentRows.length,
      runtimes:runtimeRows.length,
      missing_agents:runtimeRows.filter(row=>row.status==="agent_missing").length,
      active:rows.filter(row=>row.active).length,
      online:rows.filter(row=>row.online).length,
      remote_targets:remoteTargets.length
    },
    print_health:{
      sample_jobs:metricRows.length,
      pending:metricRows.filter(row=>row.status==="pending").length,
      retrying:metricRows.filter(row=>row.status==="retrying").length,
      failed_24h:jobs24h.filter(row=>row.status==="failed").length,
      failed_30d:jobs30d.filter(row=>row.status==="failed").length,
      retried_30d:jobs30d.filter(row=>Number(row.retry_count)>0).length,
      last_job_at:lastJobAt,
      telemetry_stale:!Number.isFinite(lastJobMs)||nowMs-lastJobMs>30*60_000,
      p50_queue_to_claim_ms:percentile(queueToClaim,.5),
      p95_queue_to_claim_ms:percentile(queueToClaim,.95),
      p50_claim_to_print_ms:percentile(claimToPrint,.5),
      p95_claim_to_print_ms:percentile(claimToPrint,.95),
      p50_total_ms:percentile(totalPrint,.5),
      p95_total_ms:percentile(totalPrint,.95),
      top_failures:topFailures
    },
    rows,
    remote_targets:remoteTargets,
    note:"IT combines printer registry, Print Agent, POS runtime heartbeat and print queue telemetry. Browser USB/Bluetooth still requires local user permission once by browser security design."
  };
}

export async function GET(){
  const started=Date.now();
  try{
    const context=await requireItAdmin();
    const data=await loadSnapshot(context);
    const response=ok(data);
    response.headers.set("cache-control","private, no-store");
    response.headers.set("x-admin-api-ms",String(Date.now()-started));
    return response;
  }catch(error){
    const response=guardItAdminError(error);
    response.headers.set("x-admin-api-ms",String(Date.now()-started));
    return response;
  }
}

export async function POST(request:Request){
  try{
    const context=await requireItAdmin();
    assertItSupportAction(context);
    const rate=await enforceRateLimit({
      namespace:"it_printer_control_action",
      key:`${context.auth.userId}:${getClientIpAddress(request)??"unknown"}`,
      max:20,windowMs:60_000,failClosedOnBackendError:true
    });
    if(!rate.ok) return fail("rate_limited","Too many printer control actions.",429);

    const body=await request.json().catch(()=>null) as {action?:unknown;tenant_id?:unknown;branch_id?:unknown;device_id?:unknown;resource_type?:unknown;id?:unknown}|null;
    const action=text(body?.action,40);
    if(action!=="discover" && action!=="test") return fail("invalid_action","Unknown printer control action.",422);

    const db=context.supabase;
    let deviceQuery=db.from("branch_devices").select("id,tenant_id,branch_id,device_code,device_name,status,is_active,last_seen_at").eq("is_active",true);
    const tenantId=text(body?.tenant_id,80); const branchId=text(body?.branch_id,80); const deviceId=text(body?.device_id,80);
    if(tenantId) deviceQuery=deviceQuery.eq("tenant_id",tenantId);
    if(branchId) deviceQuery=deviceQuery.eq("branch_id",branchId);
    if(deviceId) deviceQuery=deviceQuery.eq("id",deviceId);

    if(action==="test"){
      const resourceType=text(body?.resource_type,20) as ResourceType;
      const id=text(body?.id,80);
      if(!id || (resourceType!=="printer"&&resourceType!=="agent"&&resourceType!=="runtime")) return fail("resource_required","Printer, Print Agent, or POS runtime is required.",422);

      let target:{tenant_id:string;branch_id:string;device_code:string|null;device_id:string|null}|null=null;
      if(resourceType==="runtime"){
        const found=await db.from("branch_devices").select("id,tenant_id,branch_id,device_code").eq("id",id).eq("is_active",true).maybeSingle();
        if(found.error) throw found.error;
        if(found.data) target={tenant_id:String(found.data.tenant_id),branch_id:String(found.data.branch_id),device_code:String(found.data.device_code??""),device_id:String(found.data.id)};
      }else if(resourceType==="printer"){
        const found=await db.from("printer_devices").select("tenant_id,branch_id,runtime_device_code").eq("id",id).maybeSingle();
        if(found.error) throw found.error;
        if(found.data) target={tenant_id:String(found.data.tenant_id),branch_id:String(found.data.branch_id),device_code:found.data.runtime_device_code?String(found.data.runtime_device_code):null,device_id:null};
      }else{
        const found=await db.from("print_agents").select("tenant_id,branch_id,device_code,device_id").eq("id",id).maybeSingle();
        if(found.error) throw found.error;
        if(found.data) target={tenant_id:String(found.data.tenant_id),branch_id:String(found.data.branch_id),device_code:String(found.data.device_code??""),device_id:found.data.device_id?String(found.data.device_id):null};
      }
      if(!target) return fail("resource_not_found","Printer resource was not found.",404);
      let targetQuery=db.from("branch_devices").select("id,tenant_id,branch_id,device_code,device_name,status,is_active").eq("tenant_id",target.tenant_id).eq("branch_id",target.branch_id).eq("is_active",true);
      if(target.device_id) targetQuery=targetQuery.eq("id",target.device_id); else if(target.device_code) targetQuery=targetQuery.eq("device_code",target.device_code);
      else return fail("remote_target_missing","This printer is not bound to a POS runtime/Print Agent device.",409);
      const device=await targetQuery.maybeSingle();
      if(device.error) throw device.error;
      if(!device.data) return fail("remote_target_missing","No active POS runtime is available for this printer.",409);
      const now=new Date();
      const inserted=await db.from("device_commands").insert({
        tenant_id:device.data.tenant_id,branch_id:device.data.branch_id,pos_device_id:device.data.id,
        command_type:"test_printer",status:"pending",issued_by_user_id:context.auth.userId,
        issued_at:now.toISOString(),expires_at:new Date(now.getTime()+5*60_000).toISOString(),
        result:{},metadata:{source:"it_printer_control",safe_action:"test_printer_connection"}
      }).select("id,status,issued_at,expires_at").single();
      if(inserted.error) throw inserted.error;
      await appendAuditLog({
        tenantId:String(device.data.tenant_id),branchId:String(device.data.branch_id),
        actorUserId:context.auth.userId,actorRole:context.auth.platformRole,
        action:"it_printer_remote_test",targetTable:"device_commands",targetId:String(inserted.data.id),
        module:"printer",entityType:resourceType,entityId:id,
        ipAddress:context.requestMeta.ipAddress??undefined,userAgent:context.requestMeta.userAgent??undefined
      });
      return ok({queued:1,command:inserted.data});
    }

    const deviceResult=await deviceQuery.limit(100);
    if(deviceResult.error) throw deviceResult.error;
    const devices=deviceResult.data??[];
    if(!devices.length) return ok({queued:0,skipped:0,devices:[]});

    const recentSince=new Date(Date.now()-90_000).toISOString();
    const recent=await db.from("device_commands").select("pos_device_id").eq("command_type","request_diagnostics").in("status",["pending","delivered"]).gte("issued_at",recentSince).in("pos_device_id",devices.map(device=>device.id));
    if(recent.error) throw recent.error;
    const skip=new Set((recent.data??[]).map(row=>String(row.pos_device_id)));
    const now=new Date();
    const rows=devices.filter(device=>!skip.has(String(device.id))).map(device=>({
      tenant_id:device.tenant_id,branch_id:device.branch_id,pos_device_id:device.id,
      command_type:"request_diagnostics",status:"pending",issued_by_user_id:context.auth.userId,
      issued_at:now.toISOString(),expires_at:new Date(now.getTime()+10*60_000).toISOString(),
      result:{},metadata:{source:"it_printer_remote_discovery",safe_action:"refresh_printer_inventory",device_code:device.device_code}
    }));
    if(rows.length){
      const inserted=await db.from("device_commands").insert(rows);
      if(inserted.error) throw inserted.error;
    }
    await appendAuditLog({
      actorUserId:context.auth.userId,actorRole:context.auth.platformRole,
      action:"it_printer_remote_discovery",targetTable:"device_commands",
      module:"printer",entityType:"printer_discovery",
      metadata:{tenant_id:tenantId||null,branch_id:branchId||null,device_id:deviceId||null,queued:rows.length,skipped:skip.size},
      ipAddress:context.requestMeta.ipAddress??undefined,userAgent:context.requestMeta.userAgent??undefined
    });
    return ok({queued:rows.length,skipped:skip.size,devices:devices.map(device=>({id:device.id,device_code:device.device_code,device_name:device.device_name}))});
  }catch(error){return guardItAdminError(error);}
}

export async function PATCH(request:Request){
  try{
    const context=await requireItAdmin();
    assertItSupportAction(context);
    const rate=await enforceRateLimit({
      namespace:"it_printer_control_write",
      key:`${context.auth.userId}:${getClientIpAddress(request)??"unknown"}`,
      max:30,windowMs:60_000,failClosedOnBackendError:true
    });
    if(!rate.ok) return fail("rate_limited","Too many printer changes.",429);
    const body=await request.json().catch(()=>null) as {
      resource_type?:unknown;id?:unknown;name?:unknown;brand?:unknown;model?:unknown;
      paper_width_mm?:unknown;status?:unknown;active?:unknown
    }|null;
    const resourceType=text(body?.resource_type,20) as ResourceType;
    const id=text(body?.id,80);
    if(!id || (resourceType!=="printer"&&resourceType!=="agent")) return fail("resource_required","Only Printer or Print Agent can be edited.",422);
    const db=context.supabase;

    if(resourceType==="printer"){
      const current=await db.from("printer_devices").select("id,tenant_id,branch_id,printer_profile_id,display_name,brand,model,paper_width_mm,status,is_active").eq("id",id).maybeSingle();
      if(current.error) throw current.error;
      if(!current.data) return fail("printer_not_found","Printer was not found.",404);
      const name=text(body?.name,120)||String(current.data.display_name);
      const paper=Number(body?.paper_width_mm);
      const nextPaper=paper===58||paper===80?paper:Number(current.data.paper_width_mm);
      const active=typeof body?.active==="boolean"?body.active:Boolean(current.data.is_active);
      const status=normalizePrinterStatus(body?.status,current.data.status,active);
      const update=await db.from("printer_devices").update({
        display_name:name,brand:text(body?.brand,100)||null,model:text(body?.model,120)||null,
        paper_width_mm:nextPaper,status,is_active:active,disconnected_at:active?null:new Date().toISOString(),updated_at:new Date().toISOString()
      }).eq("id",id).select("id").single();
      if(update.error) throw update.error;
      if(current.data.printer_profile_id){
        const profile=await db.from("printer_profiles").select("metadata").eq("id",current.data.printer_profile_id).maybeSingle();
        const metadata={...asRecord(profile.data?.metadata),it_admin_updated_at:new Date().toISOString()};
        const profileUpdate=await db.from("printer_profiles").update({
          printer_name:name,paper_width_mm:nextPaper,enabled:active,metadata,updated_at:new Date().toISOString()
        }).eq("id",current.data.printer_profile_id);
        if(profileUpdate.error) throw profileUpdate.error;
      }
      await appendAuditLog({
        tenantId:String(current.data.tenant_id),branchId:String(current.data.branch_id),
        actorUserId:context.auth.userId,actorRole:context.auth.platformRole,
        action:"it_printer_updated",targetTable:"printer_devices",targetId:id,module:"printer",
        beforeData:current.data as Record<string,unknown>,
        afterData:{display_name:name,brand:text(body?.brand,100)||null,model:text(body?.model,120)||null,paper_width_mm:nextPaper,status,is_active:active},
        ipAddress:context.requestMeta.ipAddress??undefined,userAgent:context.requestMeta.userAgent??undefined
      });
      return ok({updated:true});
    }

    const current=await db.from("print_agents").select("id,tenant_id,branch_id,agent_name,status,device_code").eq("id",id).maybeSingle();
    if(current.error) throw current.error;
    if(!current.data) return fail("agent_not_found","Print Agent was not found.",404);
    const status=text(body?.status,40);
    const allowed=new Set(["active","inactive","blocked"]);
    const nextStatus=allowed.has(status)?status:String(current.data.status);
    const name=text(body?.name,120)||String(current.data.agent_name);
    const updated=await db.from("print_agents").update({agent_name:name,status:nextStatus,updated_at:new Date().toISOString()}).eq("id",id);
    if(updated.error) throw updated.error;
    await appendAuditLog({
      tenantId:String(current.data.tenant_id),branchId:String(current.data.branch_id),
      actorUserId:context.auth.userId,actorRole:context.auth.platformRole,
      action:"it_print_agent_updated",targetTable:"print_agents",targetId:id,module:"printer",
      beforeData:current.data as Record<string,unknown>,afterData:{agent_name:name,status:nextStatus},
      ipAddress:context.requestMeta.ipAddress??undefined,userAgent:context.requestMeta.userAgent??undefined
    });
    return ok({updated:true});
  }catch(error){return guardItAdminError(error);}
}

export async function DELETE(request:Request){
  try{
    const context=await requireItAdmin();
    assertItSupportAction(context);
    const rate=await enforceRateLimit({
      namespace:"it_printer_control_delete",
      key:`${context.auth.userId}:${getClientIpAddress(request)??"unknown"}`,
      max:12,windowMs:60_000,failClosedOnBackendError:true
    });
    if(!rate.ok) return fail("rate_limited","Too many printer delete actions.",429);
    const body=await request.json().catch(()=>null) as {resource_type?:unknown;id?:unknown}|null;
    const resourceType=text(body?.resource_type,20) as ResourceType;
    const id=text(body?.id,80);
    if(!id || (resourceType!=="printer"&&resourceType!=="agent")) return fail("resource_required","Only Printer or Print Agent can be removed.",422);
    const db=context.supabase;

    if(resourceType==="printer"){
      const current=await db.from("printer_devices").select("id,tenant_id,branch_id,printer_profile_id,display_name").eq("id",id).maybeSingle();
      if(current.error) throw current.error;
      if(!current.data) return fail("printer_not_found","Printer was not found.",404);
      const now=new Date().toISOString();
      const removed=await db.from("printer_devices").update({is_active:false,status:"disabled",disconnected_at:now,updated_at:now}).eq("id",id);
      if(removed.error) throw removed.error;
      if(current.data.printer_profile_id){
        const disabled=await db.from("printer_profiles").update({enabled:false,updated_at:now}).eq("id",current.data.printer_profile_id);
        if(disabled.error) throw disabled.error;
      }
      await appendAuditLog({
        tenantId:String(current.data.tenant_id),branchId:String(current.data.branch_id),
        actorUserId:context.auth.userId,actorRole:context.auth.platformRole,
        action:"it_printer_removed",targetTable:"printer_devices",targetId:id,module:"printer",
        metadata:{display_name:current.data.display_name,recoverable:true},
        ipAddress:context.requestMeta.ipAddress??undefined,userAgent:context.requestMeta.userAgent??undefined
      });
      return ok({deleted:true,recoverable:true});
    }

    const current=await db.from("print_agents").select("id,tenant_id,branch_id,agent_name,device_code").eq("id",id).maybeSingle();
    if(current.error) throw current.error;
    if(!current.data) return fail("agent_not_found","Print Agent was not found.",404);
    const disabled=await db.from("print_agents").update({
      status:"inactive",updated_at:new Date().toISOString()
    }).eq("id",id).eq("tenant_id",current.data.tenant_id).eq("branch_id",current.data.branch_id);
    if(disabled.error) throw disabled.error;

    const released=await db.from("print_jobs").update({
      claimed_by_agent_id:null,claimed_at:null,claim_expires_at:null,agent_attempt_id:null,updated_at:new Date().toISOString()
    }).eq("claimed_by_agent_id",id).eq("tenant_id",current.data.tenant_id).eq("branch_id",current.data.branch_id);
    if(released.error) throw released.error;

    const deleted=await db.from("print_agents").delete().eq("id",id);
    if(deleted.error) throw deleted.error;
    await appendAuditLog({
      tenantId:String(current.data.tenant_id),branchId:String(current.data.branch_id),
      actorUserId:context.auth.userId,actorRole:context.auth.platformRole,
      action:"it_print_agent_deleted",targetTable:"print_agents",targetId:id,module:"printer",
      metadata:{agent_name:current.data.agent_name,device_code:current.data.device_code},
      ipAddress:context.requestMeta.ipAddress??undefined,userAgent:context.requestMeta.userAgent??undefined
    });
    return ok({deleted:true});
  }catch(error){return guardItAdminError(error);}
}
