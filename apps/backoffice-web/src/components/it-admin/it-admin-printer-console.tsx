"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Language="th"|"en";
type ResourceType="printer"|"agent"|"runtime";
type Row={
  resource_type:ResourceType;id:string;tenant_id:string;branch_id:string;tenant:string;branch:string;
  name:string;status:string;active:boolean;online:boolean;last_seen_at:string|null;source:string;
  brand?:string|null;model?:string|null;connection?:string|null;paper_width_mm?:number|null;
  runtime_device_code?:string|null;device_code?:string|null;app_version?:string|null;
  remote_device_id?:string|null;remote_device_name?:string|null;print_agent_bound?:boolean;
};
type Snapshot={
  checked_at:string;
  summary:{total:number;printers:number;agents:number;runtimes:number;missing_agents:number;active:number;online:number;remote_targets:number};
  print_health:{
    sample_jobs:number;pending:number;retrying:number;failed_24h:number;failed_30d:number;retried_30d:number;retried_24h:number;stale_claims:number;slow_queue_24h:number;slow_transport_24h:number;
    last_job_at:string|null;telemetry_stale:boolean;
    p50_queue_to_claim_ms:number|null;p95_queue_to_claim_ms:number|null;
    p50_claim_to_print_ms:number|null;p95_claim_to_print_ms:number|null;
    p50_total_ms:number|null;p95_total_ms:number|null;
    top_failures:Array<{code:string;count:number}>;transport_failures:Array<{transport:string;count:number}>;
  };
  rows:Row[];remote_targets:Array<{id:string;tenant:string;branch:string;device_code:string;device_name:string;surface:string;last_seen_at:string|null;print_agent_bound?:boolean}>;
  note:string;
};
type Envelope<T>={data?:T;error?:{message?:string}};

const COPY={
 th:{
  eyebrow:"ระบบพิมพ์ / รีโมต",
  title:"เครื่องพิมพ์ / Print Agent",
  desc:"จัดการเครื่องพิมพ์และ Print Agent จากศูนย์กลาง พร้อมค้นหา แก้ไข ทดสอบ และลบรายการที่เกี่ยวข้อง",
  refresh:"รีเฟรช",discover:"ค้นหา / ดึง Diagnostics",search:"ค้นหาร้าน / สาขา / เครื่อง / Agent / POS Runtime / รุ่น",
  all:"ทั้งหมด",printers:"เครื่องพิมพ์",agents:"Print Agent",runtimes:"POS Runtime",active:"ใช้งาน",online:"ออนไลน์",
  type:"ประเภท",store:"ร้าน",branch:"สาขา",name:"ชื่อ",detail:"รุ่น / รหัสเครื่อง",connection:"การเชื่อมต่อ",status:"สถานะ",seen:"พบล่าสุด",actions:"จัดการ",
  edit:"แก้ไข",test:"ทดสอบ",remove:"ลบ",save:"บันทึก",cancel:"ยกเลิก",close:"ปิด",
  confirmDelete:"ยืนยันลบรายการนี้ออกจากรายการใช้งาน? ประวัติงานพิมพ์จะยังคงเก็บไว้",removed:"ลบรายการแล้ว",updated:"บันทึกการแก้ไขแล้ว",tested:"ส่งคำสั่งทดสอบแล้ว",
  noRows:"ไม่พบรายการตามเงื่อนไข",loading:"กำลังโหลด...",error:"โหลดข้อมูลไม่สำเร็จ",
  printer:"เครื่องพิมพ์",agent:"Print Agent",paper:"ขนาดกระดาษ",brand:"ยี่ห้อ",model:"รุ่น",enabled:"เปิดใช้งาน",
  source:"แหล่งข้อมูล",inactive:"ไม่ใช้งาน",blocked:"ถูกบล็อก",offline:"ออฟไลน์",checking:"กำลังตรวจ",agentMissing:"ยังไม่มี Print Agent",unknown:"ไม่ทราบ",
  queue:"คิวรอ/Retry",failed:"ล้มเหลว 30 วัน",latency:"P95 พิมพ์ครบ",telemetry:"Telemetry ล่าสุด",diagnose:"ตรวจใหม่",queueLatency:"คิว→Agent P95",printLatency:"Agent→พิมพ์ P95",retry24h:"Retry 24 ชม.",staleLease:"Lease ค้าง",slowQueue:"คิวช้า ≥3s",slowPrint:"พิมพ์ช้า ≥3s",failureCodes:"สาเหตุล้มเหลว",transportFailures:"ปัญหาตามการเชื่อมต่อ"
 },
 en:{
  eyebrow:"PRINT / REMOTE OPERATIONS",title:"Printer / Print Agent",
  desc:"Central printer and Print Agent management with search, edit, test and remove actions.",
  refresh:"Refresh",discover:"Discover / Pull Diagnostics",search:"Search store / branch / printer / agent / POS runtime / model",
  all:"All",printers:"Printers",agents:"Print Agents",runtimes:"POS Runtimes",active:"Active",online:"Online",
  type:"Type",store:"Store",branch:"Branch",name:"Name",detail:"Model / device code",connection:"Connection",status:"Status",seen:"Last seen",actions:"Actions",
  edit:"Edit",test:"Test",remove:"Delete",save:"Save",cancel:"Cancel",close:"Close",
  confirmDelete:"Remove this item from active inventory? Print history will be preserved.",removed:"Item removed",updated:"Changes saved",tested:"Remote test queued",
  noRows:"No matching records",loading:"Loading...",error:"Unable to load data",
  printer:"Printer",agent:"Print Agent",paper:"Paper width",brand:"Brand",model:"Model",enabled:"Enabled",
  source:"Source",inactive:"Inactive",blocked:"Blocked",offline:"Offline",checking:"Checking",agentMissing:"Print Agent missing",unknown:"Unknown",
  queue:"Queue / Retry",failed:"Failed 30d",latency:"P95 end-to-end",telemetry:"Latest telemetry",diagnose:"Diagnose",queueLatency:"Queue→Agent P95",printLatency:"Agent→Print P95",retry24h:"Retry 24h",staleLease:"Stale lease",slowQueue:"Slow queue ≥3s",slowPrint:"Slow print ≥3s",failureCodes:"Failure codes",transportFailures:"Transport failures"
 }
} as const;

function statusLabel(row:Row,t:typeof COPY.th|typeof COPY.en){
 if(row.online)return t.online;
 if(row.status==="active")return t.active;
 if(row.status==="inactive")return t.inactive;
 if(row.status==="blocked")return t.blocked;
 if(row.status==="offline")return t.offline;
 if(row.status==="checking")return t.checking;
 if(row.status==="agent_missing")return t.agentMissing;
 return row.status||t.unknown;
}
function sourceLabel(source:string,language:Language){
 const th:Record<string,string>={android_mdm:"Android MDM",browser:"เว็บแอป / Browser",windows_runtime:"Windows Runtime",registered:"ลงทะเบียนในระบบ"};
 const en:Record<string,string>={android_mdm:"Android MDM",browser:"Web App / Browser",windows_runtime:"Windows Runtime",registered:"Registered"};
 return (language==="th"?th:en)[source]||source;
}
function fmt(value:string|null,language:Language){
 if(!value)return "—"; const d=new Date(value); if(Number.isNaN(d.getTime()))return "—";
 return new Intl.DateTimeFormat(language==="th"?"th-TH":"en-GB",{dateStyle:"short",timeStyle:"short",timeZone:"Asia/Bangkok"}).format(d);
}
function duration(value:number|null|undefined){
 if(value==null||!Number.isFinite(value))return "—";
 if(value<1000)return `${Math.round(value)} ms`;
 return `${(value/1000).toFixed(value<10_000?2:1)} s`;
}
async function api<T>(url:string,init?:RequestInit):Promise<T>{
 const response=await fetch(url,{...init,headers:{"content-type":"application/json",...(init?.headers??{})},cache:"no-store",credentials:"include"});
 const body=await response.json().catch(()=>null) as Envelope<T>|null;
 if(!response.ok||!body?.data)throw new Error(body?.error?.message||`HTTP ${response.status}`);
 return body.data;
}

export function ItAdminPrinterConsole({language}:{language:Language}){
 const t=COPY[language];
 const [data,setData]=useState<Snapshot|null>(null);
 const [loading,setLoading]=useState(true);
 const [busy,setBusy]=useState<string|null>(null);
 const [error,setError]=useState("");
 const [notice,setNotice]=useState("");
 const [query,setQuery]=useState("");
 const [kind,setKind]=useState<"all"|ResourceType>("all");
 const [status,setStatus]=useState("all");
 const [editing,setEditing]=useState<Row|null>(null);
 const [form,setForm]=useState({name:"",brand:"",model:"",paper_width_mm:"80",status:"active",active:true});

 const load=useCallback(async(silent=false)=>{
  if(!silent)setLoading(true); setError("");
  try{setData(await api<Snapshot>("/api/it-admin/v1/printer-control"));}
  catch(e){setError(e instanceof Error?e.message:t.error);}
  finally{if(!silent)setLoading(false);}
 },[t.error]);

 useEffect(()=>{void load(); const onFocus=()=>void load(true); window.addEventListener("focus",onFocus); return()=>window.removeEventListener("focus",onFocus);},[load]);

 const rows=useMemo(()=>{
  const q=query.trim().toLowerCase();
  return (data?.rows??[]).filter(row=>{
   if(kind!=="all"&&row.resource_type!==kind)return false;
   if(status==="online"&&!row.online)return false;
   if(status==="active"&&!row.active)return false;
   if(status!=="all"&&status!=="online"&&status!=="active"&&row.status!==status)return false;
   if(!q)return true;
   return [row.tenant,row.branch,row.name,row.brand,row.model,row.device_code,row.runtime_device_code,row.status,row.source]
    .some(value=>String(value??"").toLowerCase().includes(q));
  });
 },[data?.rows,kind,status,query]);

 function removeFromSnapshot(row:Row){
  setData(current=>{
   if(!current)return current;
   const nextRows=current.rows.filter(item=>!(item.resource_type===row.resource_type&&item.id===row.id));
   return {
    ...current,
    rows:nextRows,
    summary:{
     ...current.summary,
     total:nextRows.length,
     printers:nextRows.filter(item=>item.resource_type==="printer").length,
     agents:nextRows.filter(item=>item.resource_type==="agent").length,
     runtimes:nextRows.filter(item=>item.resource_type==="runtime").length,
     missing_agents:nextRows.filter(item=>item.resource_type==="runtime"&&item.status==="agent_missing").length,
     active:nextRows.filter(item=>item.active).length,
     online:nextRows.filter(item=>item.online).length
    }
   };
  });
 }

 function openEdit(row:Row){
  setEditing(row);
  setForm({name:row.name,brand:row.brand??"",model:row.model??"",paper_width_mm:String(row.paper_width_mm??80),status:row.status,active:row.active});
 }

 async function discover(row?:Row){
  const key=row?`discover:${row.id}`:"discover:all";
  setBusy(key);setError("");setNotice("");
  try{
   const result=await api<{queued:number;skipped:number}>("/api/it-admin/v1/printer-control",{
    method:"POST",
    body:JSON.stringify({action:"discover",device_id:row?.resource_type==="runtime"?row.id:undefined,tenant_id:row?.tenant_id,branch_id:row?.branch_id})
   });
   setNotice(language==="th"
    ? `ส่งคำสั่งเก็บ Diagnostics แล้ว ${result.queued} เครื่อง · ข้ามคำสั่งซ้ำ ${result.skipped}`
    : `Diagnostics queued for ${result.queued} device(s) · ${result.skipped} duplicate request(s) skipped`);
   window.setTimeout(()=>void load(true),4500);
  }catch(e){setError(e instanceof Error?e.message:t.error);}
  finally{setBusy(null);}
 }

 async function test(row:Row){
  setBusy(`test:${row.id}`);setError("");setNotice("");
  try{
   await api("/api/it-admin/v1/printer-control",{method:"POST",body:JSON.stringify({action:"test",resource_type:row.resource_type,id:row.id})});
   setNotice(t.tested); window.setTimeout(()=>void load(true),4000);
  }catch(e){setError(e instanceof Error?e.message:t.error);}
  finally{setBusy(null);}
 }

 async function save(){
  if(!editing)return; setBusy("save");setError("");
  try{
   await api("/api/it-admin/v1/printer-control",{method:"PATCH",body:JSON.stringify({
    resource_type:editing.resource_type,id:editing.id,name:form.name,
    brand:editing.resource_type==="printer"?form.brand:undefined,
    model:editing.resource_type==="printer"?form.model:undefined,
    paper_width_mm:editing.resource_type==="printer"?Number(form.paper_width_mm):undefined,
    status:form.status,active:editing.resource_type==="printer"?form.active:undefined
   })});
   setNotice(t.updated);setEditing(null);await load(true);
  }catch(e){setError(e instanceof Error?e.message:t.error);}
  finally{setBusy(null);}
 }

 async function remove(row:Row){
  if(!window.confirm(t.confirmDelete))return;
  setBusy(`delete:${row.id}`);setError("");
  try{
   await api("/api/it-admin/v1/printer-control",{method:"DELETE",body:JSON.stringify({resource_type:row.resource_type,id:row.id})});
   removeFromSnapshot(row);
   setNotice(t.removed);
   void load(true);
  }catch(e){setError(e instanceof Error?e.message:t.error);}
  finally{setBusy(null);}
 }

 const summary=data?.summary;
 return <div className="mx-auto w-full max-w-[1540px] px-6 py-7">
  <div className="flex flex-wrap items-start justify-between gap-4">
   <div><div className="text-xs font-black uppercase tracking-[.18em] text-blue-600">{t.eyebrow}</div><h1 className="mt-2 text-3xl font-black text-slate-950">{t.title}</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{t.desc}</p></div>
   <div className="flex flex-wrap gap-2">
    <button onClick={()=>void discover()} disabled={busy==="discover:all"} className="rounded-xl border border-blue-300 bg-blue-50 px-4 py-2.5 text-sm font-black text-blue-700 disabled:opacity-50">{t.discover}</button>
    <button onClick={()=>void load()} className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-black text-slate-700">{t.refresh}</button>
   </div>
  </div>

  {notice?<div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-800">{notice}</div>:null}
  {error?<div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div>:null}

  <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
   {[
    [t.all,summary?.total??"—"],[t.printers,summary?.printers??"—"],[t.agents,summary?.agents??"—"],
    [t.runtimes,summary?.runtimes??"—"],[t.active,summary?.active??"—"],[t.online,summary?.online??"—"]
   ].map(([label,value])=><div key={String(label)} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="text-xs text-slate-500">{label}</div><div className="mt-2 text-2xl font-black text-slate-950">{value}</div></div>)}
  </div>

  <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
   {[
    [t.queue,`${data?.print_health.pending??0} / ${data?.print_health.retrying??0}`],
    [t.queueLatency,duration(data?.print_health.p95_queue_to_claim_ms)],
    [t.printLatency,duration(data?.print_health.p95_claim_to_print_ms)],
    [t.latency,duration(data?.print_health.p95_total_ms)],
    [t.retry24h,data?.print_health.retried_24h??0],
    [t.staleLease,data?.print_health.stale_claims??0],
    [t.slowQueue,data?.print_health.slow_queue_24h??0],
    [t.slowPrint,data?.print_health.slow_transport_24h??0]
   ].map(([label,value])=><div key={String(label)} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="text-xs text-slate-500">{label}</div><div className="mt-2 text-xl font-black text-slate-950">{value}</div></div>)}
  </div>
  <div className="mt-3 grid gap-3 lg:grid-cols-2">
   <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
    <div className="text-xs font-black uppercase tracking-[.12em] text-slate-500">{t.failureCodes}</div>
    <div className="mt-3 flex flex-wrap gap-2">
     {(data?.print_health.top_failures??[]).length
      ? (data?.print_health.top_failures??[]).map(item=><span key={item.code} className="rounded-full bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700">{item.code} · {item.count}</span>)
      : <span className="text-xs text-slate-400">—</span>}
    </div>
   </div>
   <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
    <div className="text-xs font-black uppercase tracking-[.12em] text-slate-500">{t.transportFailures}</div>
    <div className="mt-3 flex flex-wrap gap-2">
     {(data?.print_health.transport_failures??[]).length
      ? (data?.print_health.transport_failures??[]).map(item=><span key={item.transport} className="rounded-full bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-700">{item.transport} · {item.count}</span>)
      : <span className="text-xs text-slate-400">—</span>}
    </div>
   </div>
  </div>
  {data?.print_health.telemetry_stale?<div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-800">{language==="th"?"Telemetry งานพิมพ์ไม่สด: ไม่มี print job ใหม่เกิน 30 นาที ให้กด “ค้นหา / ดึง Diagnostics” และตรวจ Print Agent binding":"Print telemetry is stale: no new print job for more than 30 minutes. Pull diagnostics and verify Print Agent binding."}</div>:null}

  <div className="mt-5 flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-3">
   <input value={query} onChange={e=>setQuery(e.target.value)} placeholder={t.search} className="min-w-[260px] flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm" />
   <select value={kind} onChange={e=>setKind(e.target.value as typeof kind)} className="rounded-xl border border-slate-300 px-3 py-2 text-sm"><option value="all">{t.all}</option><option value="printer">{t.printers}</option><option value="agent">{t.agents}</option><option value="runtime">{t.runtimes}</option></select>
   <select value={status} onChange={e=>setStatus(e.target.value)} className="rounded-xl border border-slate-300 px-3 py-2 text-sm"><option value="all">{t.all}</option><option value="active">{t.active}</option><option value="online">{t.online}</option><option value="inactive">{t.inactive}</option><option value="blocked">{t.blocked}</option><option value="offline">{t.offline}</option><option value="checking">{t.checking}</option></select>
  </div>

  <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white">
   <div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="bg-slate-50 text-xs font-black text-slate-600"><tr>
    {[t.type,t.store,t.branch,t.name,t.detail,t.connection,t.status,t.seen,t.actions].map(x=><th key={x} className="whitespace-nowrap px-4 py-3">{x}</th>)}
   </tr></thead><tbody className="divide-y divide-slate-100">
    {rows.map(row=><tr key={`${row.resource_type}:${row.id}`} className="hover:bg-slate-50/70">
     <td className="px-4 py-3 font-bold">{row.resource_type==="printer"?t.printer:row.resource_type==="agent"?t.agent:t.runtimes}</td>
     <td className="px-4 py-3">{row.tenant}</td><td className="px-4 py-3">{row.branch}</td>
     <td className="px-4 py-3"><div className="font-bold text-slate-900">{row.name}</div><div className="text-[11px] text-slate-500">{sourceLabel(row.source,language)}</div></td>
     <td className="px-4 py-3">{row.resource_type==="printer"?([row.brand,row.model].filter(Boolean).join(" ")||"—"):(row.device_code||"—")}</td>
     <td className="px-4 py-3">{row.resource_type==="printer"?`${row.connection||"—"} · ${row.paper_width_mm??"—"} mm`:row.resource_type==="agent"?(row.app_version||"—"):(row.print_agent_bound?(language==="th"?"Agent เชื่อมแล้ว":"Agent bound"):(language==="th"?"รอ Print Agent":"Print Agent missing"))}</td>
     <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-black ${row.online?"bg-emerald-100 text-emerald-700":row.status==="blocked"?"bg-red-100 text-red-700":"bg-slate-100 text-slate-700"}`}>{statusLabel(row,t)}</span></td>
     <td className="whitespace-nowrap px-4 py-3">{fmt(row.last_seen_at,language)}</td>
     <td className="px-4 py-3"><div className="flex gap-1.5">
      {row.resource_type!=="runtime"?<button onClick={()=>openEdit(row)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-bold">{t.edit}</button>:null}
      <button onClick={()=>void test(row)} disabled={busy===`test:${row.id}`} className="rounded-lg border border-blue-300 px-2.5 py-1.5 text-xs font-bold text-blue-700 disabled:opacity-50">{t.test}</button>
      {row.resource_type==="runtime"?<button onClick={()=>void discover(row)} disabled={busy===`discover:${row.id}`} className="rounded-lg border border-amber-300 px-2.5 py-1.5 text-xs font-bold text-amber-700 disabled:opacity-50">{t.diagnose}</button>:null}
      {row.resource_type!=="runtime"?<button onClick={()=>void remove(row)} disabled={busy===`delete:${row.id}`} className="rounded-lg border border-red-300 px-2.5 py-1.5 text-xs font-bold text-red-700 disabled:opacity-50">{t.remove}</button>:null}
     </div></td>
    </tr>)}
    {!loading&&rows.length===0?<tr><td colSpan={9} className="px-4 py-10 text-center text-slate-500">{t.noRows}</td></tr>:null}
    {loading?<tr><td colSpan={9} className="px-4 py-10 text-center text-slate-500">{t.loading}</td></tr>:null}
   </tbody></table></div>
  </div>

  {editing?<div className="fixed inset-0 z-[500] grid place-items-center bg-slate-950/50 p-4"><div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl">
   <div className="flex items-start justify-between"><div><div className="text-xs font-black text-blue-600">{editing.resource_type==="printer"?t.printer:t.agent}</div><h2 className="mt-1 text-xl font-black">{t.edit}</h2></div><button onClick={()=>setEditing(null)} className="h-9 w-9 rounded-full border">×</button></div>
   <div className="mt-5 grid gap-4">
    <label className="grid gap-1 text-xs font-bold text-slate-600">{t.name}<input value={form.name} onChange={e=>setForm(v=>({...v,name:e.target.value}))} className="rounded-xl border border-slate-300 px-3 py-2 text-sm" /></label>
    {editing.resource_type==="printer"?<>
      <div className="grid gap-3 sm:grid-cols-2">
       <label className="grid gap-1 text-xs font-bold text-slate-600">{t.brand}<input value={form.brand} onChange={e=>setForm(v=>({...v,brand:e.target.value}))} className="rounded-xl border border-slate-300 px-3 py-2 text-sm" /></label>
       <label className="grid gap-1 text-xs font-bold text-slate-600">{t.model}<input value={form.model} onChange={e=>setForm(v=>({...v,model:e.target.value}))} className="rounded-xl border border-slate-300 px-3 py-2 text-sm" /></label>
      </div>
      <label className="grid gap-1 text-xs font-bold text-slate-600">{t.paper}<select value={form.paper_width_mm} onChange={e=>setForm(v=>({...v,paper_width_mm:e.target.value}))} className="rounded-xl border border-slate-300 px-3 py-2 text-sm"><option value="58">58 mm</option><option value="80">80 mm</option></select></label>
      <label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={form.active} onChange={e=>setForm(v=>({...v,active:e.target.checked}))} />{t.enabled}</label>
    </>:<label className="grid gap-1 text-xs font-bold text-slate-600">{t.status}<select value={form.status} onChange={e=>setForm(v=>({...v,status:e.target.value}))} className="rounded-xl border border-slate-300 px-3 py-2 text-sm"><option value="active">{t.active}</option><option value="inactive">{t.inactive}</option><option value="blocked">{t.blocked}</option></select></label>}
   </div>
   <div className="mt-6 flex justify-end gap-2"><button onClick={()=>setEditing(null)} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold">{t.cancel}</button><button onClick={()=>void save()} disabled={busy==="save"} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-black text-white disabled:opacity-50">{t.save}</button></div>
  </div></div>:null}
 </div>;
}
