"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Language } from "@/lib/i18n";

type Row={id:string;tenant_id?:string;branch_id?:string;store:string;branch:string;level:string;queued_orders:number;stale_orders:number;print_queue:number;dead_letters:number;api_errors:number;api_5xx:number};
type Payload={checked_at:string;summary:Record<string,number|string>;rows:Row[];note:string|null};
const copy={
  th:{eyebrow:"ปฏิบัติการ",title:"มอนิเตอร์ระบบ",desc:"ตรวจคิว งานค้าง เครื่องพิมพ์ และ API ของแต่ละสาขาในช่วง 60 นาทีล่าสุด",source:"CpiPOS-001 · มอนิเตอร์ระบบ",search:"ค้นหาร้านหรือสาขา",all:"ทุกสถานะ",ok:"ปกติ",warning:"เตือน",critical:"วิกฤต",refresh:"รีเฟรช",create:"สร้าง Incident",current:"ข้อมูลปัจจุบัน",empty:"ไม่พบข้อมูลตามเงื่อนไข",loading:"กำลังโหลด...",error:"โหลดข้อมูล Monitoring ไม่สำเร็จ",branches:"สาขาที่ตรวจ",queued:"คิวรอ",api:"API ผิดพลาด",warnings:"แจ้งเตือน",criticals:"วิกฤต",store:"ร้าน",branch:"สาขา",status:"สถานะ",stale:"ค้าง",print:"คิวพิมพ์",dead:"Dead Letters",five:"5xx"},
  en:{eyebrow:"OPERATIONS",title:"Monitoring",desc:"Monitor queues, stale work, print jobs and API errors per branch for the last 60 minutes.",source:"CpiPOS-001 · Runtime Monitoring",search:"Search store or branch",all:"All statuses",ok:"OK",warning:"Warning",critical:"Critical",refresh:"Refresh",create:"Create Incident",current:"Current data",empty:"No matching rows",loading:"Loading...",error:"Unable to load Monitoring",branches:"Branches",queued:"Queued",api:"API errors",warnings:"Warnings",criticals:"Critical",store:"Store",branch:"Branch",status:"Status",stale:"Stale",print:"Print Queue",dead:"Dead Letters",five:"5xx"}
} as const;

export function ItAdminMonitoringConsole({language}:{language:Language}){
  const t=copy[language];
  const [data,setData]=useState<Payload|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [q,setQ]=useState("");
  const [level,setLevel]=useState("");
  const load=useCallback(async()=>{
    setLoading(true);setError("");
    try{
      const response=await fetch("/api/it-admin/v1/modules/monitoring",{cache:"no-store"});
      const body=await response.json().catch(()=>null) as {data?:Payload;error?:{message?:string}}|null;
      if(!response.ok||!body?.data)throw new Error(body?.error?.message||t.error);
      setData(body.data);
    }catch(e){setError(e instanceof Error?e.message:t.error);}finally{setLoading(false);}
  },[t.error]);
  useEffect(()=>{void load();},[load]);
  const rows=useMemo(()=> (data?.rows??[]).filter(row=>{
    if(level&&row.level.toLowerCase()!==level)return false;
    const term=q.trim().toLowerCase();
    return !term||[row.store,row.branch].some(v=>String(v).toLowerCase().includes(term));
  }),[data,q,level]);
  const createIncident=async(row:Row)=>{
    const severity=row.level==="Critical"?"critical":"warning";
    const message=`Monitoring: queued=${row.queued_orders}, stale=${row.stale_orders}, print=${row.print_queue}, dead_letters=${row.dead_letters}, api_errors=${row.api_errors}, api_5xx=${row.api_5xx}`;
    const response=await fetch("/api/it-admin/v1/incidents",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
      tenant_id:row.tenant_id||"",branch_id:row.branch_id||"",severity,code:"MONITORING",
      title:`${row.store} · ${row.branch} · ${row.level}`,message
    })});
    if(response.ok)window.location.assign("/it-admin/incidents");
    else alert(language==="th"?"สร้าง Incident ไม่สำเร็จ":"Unable to create incident");
  };
  return <div className="grid gap-5">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div><div className="text-xs font-black uppercase tracking-[.18em] text-blue-600">{t.eyebrow}</div><h2 className="mt-2 text-3xl font-black">{t.title}</h2><p className="mt-2 text-sm text-slate-600">{t.desc}</p></div>
      <button onClick={()=>void load()} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold">{t.refresh}</button>
    </header>
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm"><strong>{t.source}</strong>{data?.checked_at?<span className="ml-3 text-slate-500">{new Date(data.checked_at).toLocaleString(language==="th"?"th-TH":"en-US")}</span>:null}</div>
    {error?<div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-900">{error}</div>:null}
    <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
      {[["branches",t.branches],["queued_orders",t.queued],["api_errors",t.api],["warnings",t.warnings],["critical",t.criticals]].map(([key,label])=><article key={key} className="rounded-2xl border border-slate-200 bg-white p-4"><div className="text-xs text-slate-500">{label}</div><div className="mt-2 text-2xl font-black">{data?.summary?.[key]??"—"}</div></article>)}
    </section>
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="flex flex-wrap gap-3 border-b border-slate-200 p-4">
        <input value={q} onChange={e=>setQ(e.target.value)} placeholder={t.search} className="min-w-[240px] flex-1 rounded-xl border border-slate-300 px-3 py-2"/>
        <select value={level} onChange={e=>setLevel(e.target.value)} className="rounded-xl border border-slate-300 px-3 py-2"><option value="">{t.all}</option><option value="ok">{t.ok}</option><option value="warning">{t.warning}</option><option value="critical">{t.critical}</option></select>
      </div>
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-left"><tr>{[t.store,t.branch,t.status,t.queued,t.stale,t.print,t.dead,t.api,t.five,""].map((h,i)=><th key={i} className="px-3 py-3">{h}</th>)}</tr></thead><tbody>
        {rows.map(row=><tr key={row.id} className="border-t border-slate-100"><td className="px-3 py-3 font-semibold">{row.store}</td><td className="px-3 py-3">{row.branch}</td><td className="px-3 py-3">{row.level}</td><td className="px-3 py-3">{row.queued_orders}</td><td className="px-3 py-3">{row.stale_orders}</td><td className="px-3 py-3">{row.print_queue}</td><td className="px-3 py-3">{row.dead_letters}</td><td className="px-3 py-3">{row.api_errors}</td><td className="px-3 py-3">{row.api_5xx}</td><td className="px-3 py-3">{row.level!=="OK"?<button onClick={()=>void createIncident(row)} className="rounded-lg border border-blue-300 px-3 py-1.5 font-bold text-blue-700">{t.create}</button>:null}</td></tr>)}
        {!loading&&!rows.length?<tr><td colSpan={10} className="p-8 text-center text-slate-500">{t.empty}</td></tr>:null}
        {loading?<tr><td colSpan={10} className="p-8 text-center text-slate-500">{t.loading}</td></tr>:null}
      </tbody></table></div>
    </section>
  </div>;
}
