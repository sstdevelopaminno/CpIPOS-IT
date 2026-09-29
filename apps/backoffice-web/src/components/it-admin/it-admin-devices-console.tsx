"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Language } from "@/lib/i18n";

type Envelope<T>={data?:T;error?:{code?:string;message?:string}|null};
type Row={
  id:string;tenant_id:string;branch_id:string;tenant:string;branch:string;device:string;device_code:string;
  device_name:string;device_type:string;registry_status:string;health:string;app_version:string;runtime_version:string;
  last_seen_at:string|null;online:boolean;enrollment_id:string|null;mdm_status:string;mdm_trust:string;
  mdm_ownership_type:string;device_owner:boolean;full_mdm:boolean;capabilities:string[];printer_status:string;
  locked:boolean;
};
type Payload={checked_at:string;summary:Record<string,number>;rows:Row[];note:string|null};
type Ownership="company_owned"|"company_financed"|"customer_owned"|"byod";

const ownershipOptions:Array<{value:Ownership;th:string;en:string}>=[
  {value:"company_owned",th:"เครื่องบริษัท",en:"Company owned"},
  {value:"company_financed",th:"เครื่องผ่อน/ให้เช่าโดยบริษัท",en:"Company financed"},
  {value:"customer_owned",th:"เครื่องลูกค้า",en:"Customer owned"},
  {value:"byod",th:"อุปกรณ์ส่วนตัว (BYOD)",en:"BYOD"}
];

function dt(value:string|null,language:Language){
  if(!value)return "—";
  const d=new Date(value); if(Number.isNaN(d.valueOf()))return "—";
  return d.toLocaleString(language==="th"?"th-TH":"en-US",{dateStyle:"medium",timeStyle:"short"});
}
async function json<T>(response:Response):Promise<T>{
  const body=await response.json().catch(()=>null) as Envelope<T>|null;
  if(!response.ok||!body?.data||body.error)throw new Error(body?.error?.message||`Request failed (${response.status})`);
  return body.data;
}

export function ItAdminDevicesConsole({language}:{language:Language}){
  const th=language==="th";
  const t={
    eyebrow:th?"อุปกรณ์ / MDM":"DEVICES / MDM",
    title:th?"อุปกรณ์ / ระบบจัดการเครื่อง (MDM)":"Devices / MDM",
    desc:th?"ค้นหาและจัดการเครื่อง POS, MDM, เวอร์ชันแอป และเครื่องพิมพ์จากศูนย์กลาง":"Search and manage POS devices, MDM, app versions and printer diagnostics from one console.",
    refresh:th?"รีเฟรช":"Refresh", search:th?"ค้นหาร้าน / สาขา / เครื่อง / รหัส / เวอร์ชัน":"Search store / branch / device / code / version",
    allMdm:th?"MDM ทั้งหมด":"All MDM", connected:th?"เชื่อมต่อแล้ว":"Connected", pending:th?"รออนุมัติ":"Pending", notEnrolled:th?"ยังไม่ Pair":"Not paired",
    allState:th?"ทุกสถานะ":"All states", online:th?"ออนไลน์":"Online", offline:th?"ออฟไลน์":"Offline", locked:th?"ถูกล็อก":"Locked",
    device:th?"อุปกรณ์":"Device", store:th?"ร้าน / สาขา":"Store / Branch", app:th?"เวอร์ชัน":"Version", mdm:th?"MDM":"MDM",
    printer:th?"เครื่องพิมพ์":"Printer", seen:th?"พบล่าสุด":"Last seen", actions:th?"จัดการ":"Actions",
    manage:th?"จัดการ":"Manage", health:th?"Health / Full MDM":"Health / Full MDM", pair:th?"Pair / เชื่อม MDM":"Pair / Connect MDM",
    testPrinter:th?"ทดสอบเครื่องพิมพ์":"Test printer",
    diagnostics:th?"เก็บ Diagnostics":"Collect diagnostics",
    checkUpdate:th?"ตรวจอัปเดตแอป":"Check app update",
    edit:th?"แก้ไข":"Edit", remove:th?"ลบรายการ":"Remove",
    close:th?"ปิด":"Close", save:th?"บันทึก":"Save", disconnect:th?"ตัด MDM":"Disconnect MDM", connect:th?"เชื่อม MDM":"Connect MDM",
    remote:th?"ดูหน้าจอ":"View screen", remoteUnavailable:th?"Agent ยังไม่รองรับ Remote Screen":"Remote screen agent not available",
    noRows:th?"ไม่พบอุปกรณ์ตามเงื่อนไข":"No devices match the filters",
    name:th?"ชื่อเครื่อง":"Device name", type:th?"ประเภท":"Type", lock:th?"ล็อกการใช้งาน":"Access lock",
    unlocked:th?"ไม่ล็อก":"Unlocked", lockOn:th?"ล็อก":"Locked", ownership:th?"ประเภทเจ้าของเครื่อง":"Ownership",
    latestModern:th?"Full MDM ต้องใช้ Android 1.0.23 + Device Owner · Browser/PWA รองรับ diagnostics/printer/update check แต่ไม่สามารถดูหน้าจอหรือถอนแอป Android ได้":"Full MDM requires Android 1.0.23 + Device Owner · Browser/PWA supports diagnostics/printer/update checks but cannot provide Android screen view or app uninstall",
    total:th?"อุปกรณ์ทั้งหมด":"Total devices",
    registry:th?"Registry ใช้งาน":"Registry active",
    healthReported:th?"มี Health":"Health reported",
    mdmConnected:th?"MDM เชื่อมต่อ":"MDM connected",
    onlineCount:th?"ออนไลน์":"Online",
    lockedCount:th?"ถูกล็อก":"Locked"
  };
  const [data,setData]=useState<Payload|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [success,setSuccess]=useState("");
  const [query,setQuery]=useState("");
  const [mdmFilter,setMdmFilter]=useState("all");
  const [stateFilter,setStateFilter]=useState("all");
  const [selected,setSelected]=useState<Row|null>(null);
  const [name,setName]=useState("");
  const [type,setType]=useState("pos_terminal");
  const [lock,setLock]=useState<"locked"|"unlocked">("unlocked");
  const [ownership,setOwnership]=useState<Ownership>("customer_owned");
  const [busy,setBusy]=useState(false);

  const load=useCallback(async()=>{
    setLoading(true);setError("");
    try{
      const response=await fetch("/api/it-admin/v1/modules/devices",{cache:"no-store",credentials:"include"});
      setData(await json<Payload>(response));
    }catch(e){setError(e instanceof Error?e.message:"Unable to load devices.");}
    finally{setLoading(false);}
  },[]);
  useEffect(()=>{void load();},[load]);

  const rows=useMemo(()=>{
    const q=query.trim().toLowerCase();
    return (data?.rows??[]).filter(row=>{
      if(q && ![row.tenant,row.branch,row.device,row.device_code,row.app_version,row.runtime_version].join(" ").toLowerCase().includes(q))return false;
      if(mdmFilter==="connected"&&row.mdm_status!=="active")return false;
      if(mdmFilter==="pending"&&row.mdm_status!=="pending")return false;
      if(mdmFilter==="not_enrolled"&&row.mdm_status!=="not_enrolled")return false;
      if(stateFilter==="online"&&!row.online)return false;
      if(stateFilter==="offline"&&row.online)return false;
      if(stateFilter==="locked"&&!row.locked)return false;
      return true;
    });
  },[data?.rows,query,mdmFilter,stateFilter]);

  function open(row:Row){
    setSelected(row);setName(row.device_name||row.device);setType(row.device_type||"pos_terminal");
    setLock(row.locked?"locked":"unlocked");
    setOwnership((["company_owned","company_financed","customer_owned","byod"] as string[]).includes(row.mdm_ownership_type)?row.mdm_ownership_type as Ownership:"customer_owned");
    setError("");setSuccess("");
  }

  async function patch(row:Row,payload:Record<string,unknown>){
    const response=await fetch(`/api/it-admin/v1/tenants/${row.tenant_id}/devices`,{
      method:"PATCH",headers:{"content-type":"application/json"},credentials:"include",
      body:JSON.stringify({device_id:row.id,...payload})
    });
    return json(response);
  }
  async function save(){
    if(!selected)return;setBusy(true);setError("");
    try{
      await patch(selected,{action:"update",device_name:name,device_type:type,lock_mode:lock});
      setSuccess(th?"บันทึกข้อมูลเครื่องแล้ว":"Device updated.");setSelected(null);await load();
    }catch(e){setError(e instanceof Error?e.message:"Update failed.");}finally{setBusy(false);}
  }
  async function remove(row:Row){
    if(!window.confirm(th?`ลบรายการ ${row.device}? ระบบจะเก็บ Audit และยกเลิก MDM/คำสั่งค้าง`:`Remove ${row.device}? Audit history will be retained.`))return;
    setBusy(true);setError("");
    try{await patch(row,{action:"delete"});setSuccess(th?"ลบรายการแบบเก็บประวัติแล้ว":"Device removed with audit retained.");await load();}
    catch(e){setError(e instanceof Error?e.message:"Remove failed.");}finally{setBusy(false);}
  }
  async function queueDeviceCommand(row:Row,commandType:"test_printer"|"request_diagnostics"|"check_update"){
    setBusy(true);setError("");
    try{
      const response=await fetch("/api/it-admin/v1/device-commands",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
        tenant_id:row.tenant_id,branch_id:row.branch_id,pos_device_id:row.id,command_type:commandType
      })});
      await json(response);
      const message=commandType==="test_printer"
        ? (th?"ส่งคำสั่งทดสอบเครื่องพิมพ์แล้ว รอ heartbeat/ACK จากเครื่อง":"Printer test queued; waiting for device heartbeat/ACK.")
        : commandType==="request_diagnostics"
          ? (th?"ส่งคำสั่งเก็บ Diagnostics แล้ว รอเครื่องตอบกลับ":"Diagnostics request queued; waiting for device response.")
          : (th?"ส่งคำสั่งตรวจอัปเดตแอปแล้ว รอเครื่องตอบกลับ":"App update check queued; waiting for device response.");
      setSuccess(message);
    }catch(e){setError(e instanceof Error?e.message:"Device command failed.");}finally{setBusy(false);}
  }
  async function disconnect(row:Row){
    if(!row.enrollment_id)return;
    if(!window.confirm(th?"ตัดการเชื่อมต่อ MDM และยกเลิกคำสั่งที่ยังไม่รับ?":"Disconnect MDM and cancel pending commands?"))return;
    setBusy(true);setError("");
    try{
      const response=await fetch(`/api/it-admin/v1/device-enrollments/${row.enrollment_id}/revoke`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({reason:"it_devices_console_disconnect"})});
      await json(response);setSuccess(th?"ตัด MDM แล้ว":"MDM disconnected.");setSelected(null);await load();
    }catch(e){setError(e instanceof Error?e.message:"Disconnect failed.");}finally{setBusy(false);}
  }
  async function connect(row:Row){
    if(!row.enrollment_id){window.location.assign(`/tenants/${row.tenant_id}/devices`);return;}
    setBusy(true);setError("");
    try{
      const response=await fetch(`/api/it-admin/v1/device-enrollments/${row.enrollment_id}/approve`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({ownership_type:ownership})});
      await json(response);setSuccess(th?"เชื่อม MDM แล้ว รอ heartbeat จาก Android เพื่อยืนยัน capability":"MDM connected; waiting for Android heartbeat capability confirmation.");setSelected(null);await load();
    }catch(e){setError(e instanceof Error?e.message:"Connect failed.");}finally{setBusy(false);}
  }

  return <div className="space-y-4 p-1">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><div className="text-xs font-black tracking-[0.18em] text-blue-600">{t.eyebrow}</div><h2 className="mt-1 text-3xl font-black text-slate-950">{t.title}</h2><p className="mt-1 text-sm text-slate-600">{t.desc}</p></div>
      <button onClick={()=>void load()} disabled={loading} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold">{t.refresh}</button>
    </header>
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-600">{t.latestModern}</div>
    {success?<div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-700">{success}</div>:null}
    {error?<div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div>:null}
    <section className="grid grid-cols-2 gap-3 md:grid-cols-6">
      {Object.entries(data?.summary??{}).map(([k,v])=>{
        const labels:Record<string,string>={
          total:t.total,active:t.registry,health_reported:t.healthReported,mdm_connected:t.mdmConnected,online:t.onlineCount,locked:t.lockedCount
        };
        return <div key={k} className="rounded-2xl border border-slate-200 bg-white p-4"><div className="text-xs text-slate-500">{labels[k]??k}</div><div className="mt-1 text-2xl font-black">{v}</div></div>;
      })}
    </section>
    <section className="rounded-2xl border border-slate-200 bg-white p-3">
      <div className="grid gap-2 md:grid-cols-[1fr_180px_180px]">
        <input value={query} onChange={e=>setQuery(e.target.value)} placeholder={t.search} className="rounded-xl border border-slate-300 px-3 py-2 text-sm"/>
        <select value={mdmFilter} onChange={e=>setMdmFilter(e.target.value)} className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
          <option value="all">{t.allMdm}</option><option value="connected">{t.connected}</option><option value="pending">{t.pending}</option><option value="not_enrolled">{t.notEnrolled}</option>
        </select>
        <select value={stateFilter} onChange={e=>setStateFilter(e.target.value)} className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
          <option value="all">{t.allState}</option><option value="online">{t.online}</option><option value="offline">{t.offline}</option><option value="locked">{t.locked}</option>
        </select>
      </div>
    </section>
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="overflow-x-auto"><table className="min-w-[1180px] w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs text-slate-600"><tr>{[t.store,t.device,t.app,t.mdm,t.printer,t.seen,t.actions].map(x=><th key={x} className="px-4 py-3">{x}</th>)}</tr></thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map(row=>{
            const remoteReady=row.full_mdm&&row.capabilities.includes("remote_support");
            return <tr key={row.id} className="align-top">
              <td className="px-4 py-3"><b>{row.tenant}</b><div className="text-xs text-slate-500">{row.branch}</div></td>
              <td className="px-4 py-3"><b>{row.device}</b><div className="text-xs text-slate-500">{row.device_code} · {row.device_type}</div><div className={`mt-1 text-xs font-bold ${row.online?"text-emerald-600":"text-slate-400"}`}>{row.online?t.online:t.offline}{row.locked?" · "+t.locked:""}</div></td>
              <td className="px-4 py-3"><b>{row.app_version||"—"}</b><div className="text-xs text-slate-500">{row.runtime_version||"—"}</div></td>
              <td className="px-4 py-3"><b>{row.mdm_status}</b><div className="text-xs text-slate-500">{row.full_mdm?"Full MDM · Device Owner":row.mdm_trust}</div></td>
              <td className="px-4 py-3"><b>{row.printer_status||"—"}</b><button disabled={busy} onClick={()=>void queueDeviceCommand(row,"test_printer")} className="mt-1 block rounded-lg border border-slate-300 px-2 py-1 text-xs font-bold">{t.testPrinter}</button></td>
              <td className="px-4 py-3 text-xs">{dt(row.last_seen_at,language)}</td>
              <td className="px-4 py-3"><div className="flex flex-wrap gap-1.5">
                <Link href={`/tenants/${row.tenant_id}/devices/${row.id}/health`} className="rounded-lg bg-blue-600 px-2 py-1 text-xs font-bold text-white">{t.health}</Link>
                <button onClick={()=>open(row)} className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-bold">{t.manage}</button>
                <Link href={`/tenants/${row.tenant_id}/devices`} className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-bold">{t.pair}</Link>
                <button disabled={busy} onClick={()=>void queueDeviceCommand(row,"request_diagnostics")} className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-bold">{t.diagnostics}</button>
                <button disabled={busy} onClick={()=>void queueDeviceCommand(row,"check_update")} className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-bold">{t.checkUpdate}</button>
                <button disabled={!remoteReady} title={remoteReady?t.remote:t.remoteUnavailable} className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-bold disabled:opacity-40">{t.remote}</button>
              </div></td>
            </tr>;
          })}
          {!rows.length?<tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-500">{loading?"…":t.noRows}</td></tr>:null}
        </tbody>
      </table></div>
    </section>
    {selected?<div className="fixed inset-0 z-[500] grid place-items-center bg-slate-950/55 p-4" onMouseDown={e=>{if(e.target===e.currentTarget)setSelected(null);}}>
      <div className="w-full max-w-xl rounded-2xl bg-white p-5 shadow-2xl">
        <div className="flex items-start justify-between"><div><h3 className="text-xl font-black">{selected.device}</h3><p className="text-xs text-slate-500">{selected.device_code}</p></div><button onClick={()=>setSelected(null)} className="h-9 w-9 rounded-full border">×</button></div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-bold">{t.name}<input value={name} onChange={e=>setName(e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"/></label>
          <label className="text-xs font-bold">{t.type}<select value={type} onChange={e=>setType(e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"><option value="pos_terminal">POS Terminal</option><option value="mobile_scanner">Mobile Scanner</option><option value="kiosk">Kiosk</option></select></label>
          <label className="text-xs font-bold">{t.lock}<select value={lock} onChange={e=>setLock(e.target.value as "locked"|"unlocked")} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"><option value="unlocked">{t.unlocked}</option><option value="locked">{t.lockOn}</option></select></label>
          <label className="text-xs font-bold">{t.ownership}<select value={ownership} onChange={e=>setOwnership(e.target.value as Ownership)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm">{ownershipOptions.map(o=><option key={o.value} value={o.value}>{th?o.th:o.en}</option>)}</select></label>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <button disabled={busy} onClick={()=>void save()} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-black text-white">{t.save}</button>
          {selected.mdm_status==="active"?<button disabled={busy} onClick={()=>void disconnect(selected)} className="rounded-xl border border-orange-300 px-4 py-2 text-sm font-black text-orange-700">{t.disconnect}</button>:
          <button disabled={busy} onClick={()=>void connect(selected)} className="rounded-xl border border-emerald-300 px-4 py-2 text-sm font-black text-emerald-700">{selected.enrollment_id?t.connect:t.pair}</button>}
          <button disabled={busy} onClick={()=>void remove(selected)} className="rounded-xl border border-red-300 px-4 py-2 text-sm font-black text-red-700">{t.remove}</button>
          <button onClick={()=>setSelected(null)} className="ml-auto rounded-xl border px-4 py-2 text-sm font-bold">{t.close}</button>
        </div>
      </div>
    </div>:null}
  </div>;
}
