"use client";
import {useEffect,useState} from "react";
type Agreement={id:string;payment_request_id:string;actor_user_id:string;accepted_at:string;version:string;acceptance_channel:"pos"|"line";amount_per_cycle:number;currency:string;billing_interval:string;activation:null|{settlement_id:string;starts_at:string;ends_at:string}};
export function CustomAgreementHistory({tenantId,refreshKey}:{tenantId:string;refreshKey:string}){
  const [state,setState]=useState<{enabled:boolean;agreements:Agreement[];checkedAt:number}|null>(null);
  const [error,setError]=useState("");
  useEffect(()=>{
    const abort=new AbortController();setState(null);setError("");
    void (async()=>{
      try{
        const response=await fetch("/api/it-admin/v1/subscription-payments/custom-agreements/"+encodeURIComponent(tenantId),{cache:"no-store",signal:abort.signal});
        const json=await response.json();
        if(!response.ok||!json.data)throw new Error(json.error?.message||"โหลดสัญญาไม่สำเร็จ");
        if(!abort.signal.aborted)setState({...json.data,checkedAt:Date.now()});
      }catch(e){if(!abort.signal.aborted)setError(e instanceof Error?e.message:"โหลดสัญญาไม่สำเร็จ");}
    })();
    return()=>abort.abort();
  },[tenantId,refreshKey]);
  const date=(v:string)=>new Date(v).toLocaleString("th-TH",{timeZone:"Asia/Bangkok"});
  return <section className="rounded-2xl border border-slate-200 bg-white p-4">
    <h3 className="text-base font-black">หลักฐานสัญญา CUSTOM</h3>
    {error?<p role="alert" className="mt-2 text-sm text-red-700">{error}</p>:null}
    {!error&&!state?<p className="text-sm text-slate-500">กำลังโหลด...</p>:null}
    {state&&!state.enabled?<p className="mt-2 text-sm text-amber-700">ระบบหลักฐานสัญญายังไม่เปิดใช้งาน</p>:null}
    {state?.enabled&&!state.agreements.length?<p className="mt-2 text-sm text-slate-500">ยังไม่มีหลักฐานการยอมรับ ห้ามถือว่าร้านมีสัญญาผูกพันย้อนหลัง</p>:null}
    {state?.agreements.map(row=><article key={row.id} className="mt-3 space-y-1 rounded-xl bg-slate-50 p-3 text-xs">
      <p className="font-bold text-sm">{row.version} · {row.activation?(Date.parse(row.activation.ends_at)>(state?.checkedAt??0)?"ACTIVE":"EXPIRED"):"ACCEPTED — รอยืนยันรับเงินจริง"}</p>
      <p>เลขที่หลักฐาน: {row.id}</p><p>คำขอชำระ: {row.payment_request_id}</p>
      <p>ยอมรับทาง {row.acceptance_channel.toUpperCase()} · {date(row.accepted_at)}</p>
      <p>รหัสเจ้าของร้าน: {row.actor_user_id}</p><p>{new Intl.NumberFormat("th-TH",{style:"currency",currency:row.currency}).format(row.amount_per_cycle)} / {row.billing_interval==="yearly"?"ปี":"เดือน"}</p>
      {row.activation?<><p>เริ่ม {date(row.activation.starts_at)} · สิ้นสุด {date(row.activation.ends_at)}</p><p>Settlement: {row.activation.settlement_id}</p><a href={"/api/it-admin/v1/subscription-payments/custom-agreements/"+encodeURIComponent(tenantId)+"/documents/"+encodeURIComponent(row.id)} target="_blank" rel="noopener noreferrer" className="inline-flex rounded-lg border border-blue-200 bg-white px-3 py-2 font-bold text-blue-700">เปิดสัญญา / พิมพ์ PDF</a></>:null}
    </article>)}
  </section>;
}
