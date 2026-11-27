"use client";

import { useEffect, useState } from "react";

type Snapshot = {
  version:string; clauses:string[]; store_name:string; company_address:string;
  issuer_name:string; issuer_registration:string; issuer_address:string; director_name:string;
  amount_per_cycle:number; currency:string; billing_interval:string;
  commercial_terms:Record<string,unknown>;
};
type Evidence = {id?:string; snapshot:Snapshot; accepted_at:string|null};
type Activation = {acceptance_id:string; settlement_id:string; starts_at:string; ends_at:string};
type Status = {activation:Activation|null; acceptance:Evidence|null};
const endpoint = "/api/support/line/payment/custom-agreement";
const date = (value:string) => new Intl.DateTimeFormat("th-TH", {dateStyle:"medium",timeStyle:"short",timeZone:"Asia/Bangkok"}).format(new Date(value));

async function read<T>(url:string, init?:RequestInit):Promise<T> {
  const response = await fetch(url,{cache:"no-store",...init});
  const json = await response.json() as {data?:T;error?:{message?:string}};
  if(!response.ok || !json.data) throw new Error(json.error?.message || "ไม่สามารถโหลดข้อมูลสัญญาได้");
  return json.data;
}

export function CustomAgreementAcceptance({requestId}:{requestId:string|null}) {
  const [evidence,setEvidence] = useState<Evidence|null>(null);
  const [activation,setActivation] = useState<Activation|null>(null);
  const [consent,setConsent] = useState(false);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  useEffect(()=>{
    const controller=new AbortController();
    setEvidence(null); setActivation(null); setConsent(false); setError(""); setBusy(true);
    async function load(){
      try {
        const status=await read<Status>(endpoint,{signal:controller.signal});
        if(controller.signal.aborted)return;
        setActivation(status.activation);
        if(status.activation && Date.parse(status.activation.ends_at)>Date.now()){
          setEvidence(status.acceptance); return;
        }
        if(requestId){
          const quote=await read<Evidence>(endpoint+"?request_id="+encodeURIComponent(requestId),{signal:controller.signal});
          if(!controller.signal.aborted){setActivation(null);setEvidence(quote);}
        }else setEvidence(status.acceptance);
      }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:"โหลดข้อมูลไม่สำเร็จ");}
      finally{if(!controller.signal.aborted)setBusy(false);}
    }
    void load();
    return ()=>controller.abort();
  },[requestId]);
  async function accept(){
    if(!requestId||!evidence||!consent||busy||evidence.accepted_at)return;
    setBusy(true);setError("");
    try{
      const saved=await read<Evidence>(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({request_id:requestId,accepted:true,snapshot:evidence.snapshot})});
      setEvidence(saved);setConsent(false);
    }catch(e){setError(e instanceof Error?e.message:"ยืนยันไม่สำเร็จ");}
    finally{setBusy(false);}
  }
  const quote=evidence?.snapshot;
  return <section className="mt-5 space-y-3 rounded-xl border border-blue-200 p-4">
    <h3 className="font-bold text-slate-900">หลักฐานสัญญาอิเล็กทรอนิกส์</h3>
    {error?<p role="status" className="text-sm text-amber-800">{error}</p>:null}
    {busy&&!quote?<p className="text-sm">กำลังตรวจสอบ...</p>:null}
    {!busy&&!quote&&!error?<p className="text-sm">ยังไม่มีสัญญาหรือรายการ CUSTOM ที่ IT อนุมัติ</p>:null}
    {quote?<div className="space-y-2 text-sm">
      <p>ฉบับ {quote.version}</p>
      <p>ผู้ให้บริการ: {quote.issuer_name} · {quote.issuer_registration}</p>
      <p>ที่อยู่ผู้ให้บริการ: {quote.issuer_address}</p>
      <p>กรรมการผู้มีอำนาจ: {quote.director_name}</p>
      <p>ผู้รับบริการ: {quote.store_name}</p>
      <p>ที่อยู่: {quote.company_address}</p>
      <p>ค่าบริการ: {new Intl.NumberFormat("th-TH",{style:"currency",currency:quote.currency}).format(quote.amount_per_cycle)} / {quote.billing_interval==="yearly"?"ปี":"เดือน"}</p>
      <ol className="list-decimal space-y-1 pl-5">{quote.clauses.map((clause,index)=><li key={index}>{clause}</li>)}</ol>
      <details><summary className="cursor-pointer font-semibold">รายละเอียดแพ็กเกจที่ IT อนุมัติ</summary>
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(quote.commercial_terms,null,2)}</pre>
      </details>
      {activation?<div className="rounded-lg bg-slate-50 p-3">
        <p>เริ่มสัญญา: {date(activation.starts_at)}</p><p>สิ้นสุดสัญญา: {date(activation.ends_at)}</p>
        <p>เลขอ้างอิงรับเงินจริง: {activation.settlement_id}</p>
        <a href={endpoint+"/documents/"+encodeURIComponent(activation.acceptance_id)} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex rounded-lg border border-blue-200 bg-white px-3 py-2 font-bold text-blue-700">เปิดสัญญา / พิมพ์ PDF</a>
      </div>:evidence?.accepted_at?<p role="status">ยอมรับแล้ว {date(evidence.accepted_at)} · รอการยืนยันรับเงินจริง</p>:null}
      {evidence?.id?<p>เลขอ้างอิงการยอมรับ: {evidence.id}</p>:null}
      {!evidence?.accepted_at&&requestId&&!activation?<div className="space-y-3">
        <label className="flex items-start gap-2"><input type="checkbox" checked={consent} disabled={busy} onChange={e=>setConsent(e.target.checked)}/>
          <span>ข้าพเจ้ามีอำนาจแทนร้านค้า ได้อ่านและยอมรับข้อสัญญาฉบับที่แสดงทั้งหมด และรับทราบว่าจะเริ่มเมื่อรับชำระรอบแรกสำเร็จ</span>
        </label>
        <button type="button" disabled={!consent||busy} onClick={()=>void accept()} className="rounded-xl bg-blue-700 px-4 py-2 font-bold text-white disabled:opacity-50">บันทึกการยอมรับ</button>
      </div>:null}
    </div>:null}
  </section>;
}
