"use client";

import { useCallback, useEffect, useState } from "react";

type ContactRow = {
  id:string;name:string;phone:string;email:string|null;message:string;locale:string;source:string;
  status:"new"|"in_progress"|"contacted"|"closed";internal_note:string|null;
  assigned_user_id:string|null;assigned_user_name:string|null;created_at:string;updated_at:string;last_contacted_at:string|null;
};
type Payload={rows:ContactRow[];summary:{total:number;new:number;active:number;closed:number}};
type Envelope<T>={data?:T;error?:{message?:string}};
const statusText={new:"ใหม่",in_progress:"กำลังดำเนินการ",contacted:"ติดต่อแล้ว",closed:"ปิดงาน"} as const;
const fmt=(v:string)=>!v||!Number.isFinite(Date.parse(v))?"—":new Intl.DateTimeFormat("th-TH",{dateStyle:"short",timeStyle:"short",timeZone:"Asia/Bangkok"}).format(new Date(v));

export function OtherContactsConsole(){
  const [data,setData]=useState<Payload>({rows:[],summary:{total:0,new:0,active:0,closed:0}});
  const [search,setSearch]=useState("");const [status,setStatus]=useState("all");
  const [draft,setDraft]=useState<ContactRow|null>(null);const [busy,setBusy]=useState("");const [error,setError]=useState("");

  const load=useCallback(async()=>{
    setBusy(v=>v||"load");setError("");
    try{
      const qs=new URLSearchParams();if(search.trim())qs.set("search",search.trim());if(status!=="all")qs.set("status",status);
      const res=await fetch(`/api/it-admin/v1/other-contacts?${qs}`,{cache:"no-store"});
      const json=await res.json().catch(()=>null) as Envelope<Payload>|null;
      if(!res.ok||!json?.data)throw new Error(json?.error?.message||"โหลดรายการติดต่อไม่สำเร็จ");
      setData(json.data);
      if(draft){const fresh=json.data.rows.find(r=>r.id===draft.id);if(fresh)setDraft(fresh);}
    }catch(e){setError(e instanceof Error?e.message:"โหลดรายการติดต่อไม่สำเร็จ");}finally{setBusy("");}
  },[search,status,draft?.id]);

  useEffect(()=>{void load();},[status]);
  useEffect(()=>{const t=window.setTimeout(()=>void load(),350);return()=>window.clearTimeout(t);},[search]);

  async function save(){
    if(!draft)return;setBusy("save");setError("");
    try{
      const res=await fetch("/api/it-admin/v1/other-contacts",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
        action:"update",id:draft.id,patch:{name:draft.name,phone:draft.phone,email:draft.email,message:draft.message,status:draft.status,internal_note:draft.internal_note,assign_to_me:true}
      })});
      const json=await res.json().catch(()=>null) as Envelope<{row:ContactRow}>|null;
      if(!res.ok||!json?.data?.row)throw new Error(json?.error?.message||"บันทึกไม่สำเร็จ");
      setDraft(json.data.row);await load();
    }catch(e){setError(e instanceof Error?e.message:"บันทึกไม่สำเร็จ");}finally{setBusy("");}
  }

  async function remove(row:ContactRow){
    if(!window.confirm(`ลบรายการติดต่อของ “${row.name}” ถาวรหรือไม่?`))return;
    setBusy(`delete:${row.id}`);setError("");
    try{
      const res=await fetch("/api/it-admin/v1/other-contacts",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"delete",id:row.id})});
      const json=await res.json().catch(()=>null) as Envelope<{deleted:true}>|null;
      if(!res.ok||!json?.data?.deleted)throw new Error(json?.error?.message||"ลบไม่สำเร็จ");
      if(draft?.id===row.id)setDraft(null);await load();
    }catch(e){setError(e instanceof Error?e.message:"ลบไม่สำเร็จ");}finally{setBusy("");}
  }

  return <main className="space-y-5 p-4 sm:p-6">
    <header className="flex flex-wrap items-start justify-between gap-3"><div>
      <div className="text-xs font-black uppercase tracking-[.16em] text-blue-600">COMMUNICATIONS</div>
      <h1 className="mt-1 text-2xl font-black text-slate-950">การติดต่ออื่นๆ</h1>
      <p className="mt-1 text-sm text-slate-500">คำขอจากเว็บไซต์บริษัท · CpiPOS-Communications แยกจากฐาน POS</p>
    </div><button onClick={()=>void load()} className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-black">{busy==="load"?"กำลังรีเฟรช…":"รีเฟรช"}</button></header>
    {error?<div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</div>:null}
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[["ทั้งหมด",data.summary.total],["ใหม่",data.summary.new],["กำลังดูแล",data.summary.active],["ปิดงาน",data.summary.closed]].map(([l,v])=><article key={String(l)} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="text-xs text-slate-500">{l}</div><div className="mt-2 text-2xl font-black">{v}</div></article>)}</section>
    <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm"><div className="flex flex-wrap gap-2">
      <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="ค้นหา ชื่อ เบอร์ อีเมล หรือข้อความ" className="min-w-[260px] flex-1 rounded-xl border border-slate-300 px-3 py-2.5 text-sm"/>
      <select value={status} onChange={e=>setStatus(e.target.value)} className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-bold"><option value="all">ทุกสถานะ</option><option value="new">ใหม่</option><option value="in_progress">กำลังดำเนินการ</option><option value="contacted">ติดต่อแล้ว</option><option value="closed">ปิดงาน</option></select>
    </div></section>
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="bg-slate-50 text-xs font-black text-slate-500"><tr><th className="px-4 py-3">ผู้ติดต่อ</th><th className="px-4 py-3">รายละเอียด</th><th className="px-4 py-3">สถานะ</th><th className="px-4 py-3">วันที่</th><th className="px-4 py-3 text-right">จัดการ</th></tr></thead><tbody className="divide-y divide-slate-100">
      {data.rows.map(row=><tr key={row.id} className="align-top"><td className="px-4 py-4"><div className="font-black">{row.name}</div><div className="mt-1 text-xs text-slate-500">{row.phone}</div><div className="text-xs text-slate-500">{row.email||"—"}</div></td><td className="max-w-xl px-4 py-4"><p className="line-clamp-3 whitespace-pre-wrap">{row.message}</p>{row.assigned_user_name?<p className="mt-2 text-[11px] font-bold text-blue-600">ผู้ดูแล: {row.assigned_user_name}</p>:null}</td><td className="px-4 py-4"><span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-black text-blue-700">{statusText[row.status]}</span></td><td className="whitespace-nowrap px-4 py-4 text-xs text-slate-500">{fmt(row.created_at)}</td><td className="px-4 py-4"><div className="flex justify-end gap-2"><button onClick={()=>setDraft(row)} className="rounded-lg border border-blue-200 px-3 py-2 text-xs font-black text-blue-700">เปิด / แก้ไข</button><button disabled={busy===`delete:${row.id}`} onClick={()=>void remove(row)} className="rounded-lg border border-red-200 px-3 py-2 text-xs font-black text-red-700 disabled:opacity-50">ลบ</button></div></td></tr>)}
      {!data.rows.length?<tr><td colSpan={5} className="px-4 py-12 text-center text-slate-400">ยังไม่มีรายการติดต่อ</td></tr>:null}
    </tbody></table></div></section>

    {draft?<div className="fixed inset-0 z-[500] grid place-items-center bg-slate-950/50 p-4" onMouseDown={e=>{if(e.target===e.currentTarget)setDraft(null);}}>
      <section role="dialog" aria-modal="true" className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-200 px-6 py-5"><div><div className="text-xs font-black tracking-[.14em] text-blue-600">CONTACT DETAIL</div><h2 className="mt-1 text-xl font-black">{draft.name}</h2></div><button onClick={()=>setDraft(null)} className="grid h-10 w-10 place-items-center rounded-full border border-slate-300 text-xl">×</button></div>
        <div className="grid gap-4 overflow-y-auto p-6 sm:grid-cols-2">
          <label className="text-xs font-bold">ชื่อ-นามสกุล<input value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"/></label>
          <label className="text-xs font-bold">เบอร์โทรศัพท์<input value={draft.phone} onChange={e=>setDraft({...draft,phone:e.target.value})} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"/></label>
          <label className="text-xs font-bold sm:col-span-2">อีเมล<input value={draft.email??""} onChange={e=>setDraft({...draft,email:e.target.value||null})} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"/></label>
          <label className="text-xs font-bold sm:col-span-2">รายละเอียด<textarea rows={5} value={draft.message} onChange={e=>setDraft({...draft,message:e.target.value})} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"/></label>
          <label className="text-xs font-bold">สถานะ<select value={draft.status} onChange={e=>setDraft({...draft,status:e.target.value as ContactRow["status"]})} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm"><option value="new">ใหม่</option><option value="in_progress">กำลังดำเนินการ</option><option value="contacted">ติดต่อแล้ว</option><option value="closed">ปิดงาน</option></select></label>
          <div className="text-xs font-bold">สร้างเมื่อ<div className="mt-2 rounded-xl bg-slate-50 px-3 py-3 text-sm">{fmt(draft.created_at)}</div></div>
          <label className="text-xs font-bold sm:col-span-2">หมายเหตุภายใน IT<textarea rows={4} value={draft.internal_note??""} onChange={e=>setDraft({...draft,internal_note:e.target.value||null})} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"/></label>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 px-6 py-4"><button onClick={()=>setDraft(null)} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-black">ยกเลิก</button><button disabled={busy==="save"} onClick={()=>void save()} className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-black text-white disabled:opacity-50">{busy==="save"?"กำลังบันทึก…":"บันทึกการแก้ไข"}</button></div>
      </section>
    </div>:null}
  </main>;
}
