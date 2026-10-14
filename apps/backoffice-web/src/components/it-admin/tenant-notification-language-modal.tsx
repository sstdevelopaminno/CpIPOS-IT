"use client";
import { useCallback, useEffect, useState } from "react";

type Lang = "th" | "en" | "lo";
type Data = {language:Lang; store_name:string; tenant_code:string; channels:string[]};
type Envelope<T> = { data:T|null; error:{message?:string;code?:string}|null };
const options: {code:Lang;name:string;example:string}[] = [
  {code:"th",name:"ไทย (Thailand)",example:"การแจ้งเตือนจากระบบ CpIPOS"},
  {code:"en",name:"English (International)",example:"Notification from CpIPOS"},
  {code:"lo",name:"ລາວ (Laos)",example:"ແຈ້ງເຕືອນຈາກລະບົບ CpIPOS"}
];

export function TenantNotificationLanguageModal({tenantId,onClose}:{tenantId:string;onClose:()=>void}) {
  const [data,setData]=useState<Data|null>(null);
  const [language,setLanguage]=useState<Lang>("th");
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState("");
  const [success,setSuccess]=useState("");
  const endpoint=`/api/it-admin/v1/tenants/${encodeURIComponent(tenantId)}/notification-language`;

  const refresh=useCallback(async()=>{
    setLoading(true);setError("");
    try {
      const response=await fetch(endpoint,{cache:"no-store",credentials:"include"});
      const payload=await response.json() as Envelope<Data>;
      if(!response.ok||!payload.data) throw new Error(payload.error?.message||"อ่านค่าภาษาการแจ้งเตือนไม่สำเร็จ");
      setData(payload.data);setLanguage(payload.data.language);
    }catch(e){setError(e instanceof Error?e.message:"อ่านค่าไม่สำเร็จ");}
    finally{setLoading(false);}
  },[endpoint]);
  useEffect(()=>{void refresh();},[refresh]);

  async function save(){
    if(!data||saving||loading||data.language===language)return;
    setSaving(true);setError("");setSuccess("");
    try {
      const response=await fetch(endpoint,{method:"PATCH",credentials:"include",headers:{"content-type":"application/json"},
        body:JSON.stringify({language,expected_language:data.language})});
      const payload=await response.json() as Envelope<{language:Lang}>;
      if(!response.ok||!payload.data)throw new Error(payload.error?.message||"ไม่สามารถบันทึกได้");
      setData({...data,language:payload.data.language});setSuccess("บันทึกสำเร็จ การแจ้งเตือนใหม่จะใช้ภาษาที่กำหนด โดยไม่ส่งข้อความย้อนหลังซ้ำ");
    }catch(e){setError(e instanceof Error?e.message:"บันทึกไม่สำเร็จ");}
    finally{setSaving(false);}
  }
  return (
    <div className="fixed inset-0 z-[120] grid place-items-center bg-slate-950/55 p-4" onMouseDown={event=>{if(event.target===event.currentTarget&&!saving)onClose();}}>
      <section role="dialog" aria-modal="true" aria-labelledby="notification-language-title" className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-blue-600">IT · STORE NOTIFICATION LANGUAGE</p>
            <h2 className="mt-1 text-xl font-bold" id="notification-language-title">ตั้งค่าภาษาระบบแจ้งเตือน</h2>
            <p className="mt-2 text-sm text-slate-500">{data?.store_name||"ร้านค้า"} · {data?.tenant_code??""}</p>
          </div>
          <button type="button" aria-label="ปิด" disabled={saving} onClick={onClose} className="rounded-lg border px-3 py-1.5 text-lg">×</button>
        </div>
        <p className="mb-4 text-sm leading-relaxed text-slate-600">
          เลือกภาษาสำหรับการแจ้งเตือนของร้าน ทั้ง Email และ Push Notification โดยไม่เปลี่ยนภาษาหน้าขาย POS
          และไม่เปิดหรือปิดช่องทางการแจ้งเตือนที่ร้านตั้งไว้
        </p>
        {loading?<p role="status" className="text-sm">กำลังโหลดการตั้งค่าร้าน...</p>:null}
        {error?<p role="alert" className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>:null}
        {success?<p role="status" className="mb-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{success}</p>:null}
        {data?<div className="space-y-2">
          {options.map(option=><label key={option.code} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-4 ${language===option.code?"border-blue-500 bg-blue-50":"border-slate-200"}`}>
            <input type="radio" name="tenant-notification-language" value={option.code}
              checked={language===option.code} onChange={()=>{setLanguage(option.code);setSuccess("");}} disabled={saving}/>
            <span className="flex-1"><strong className="block text-sm">{option.name}</strong><small className="text-slate-600">{option.example}</small></span>
          </label>)}
          <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
            <strong>มีผลกับข้อความใหม่เท่านั้น</strong> · การส่งเดิมและใบเสร็จเก่าจะไม่ถูกแก้ไข
          </div>
          <button type="button" onClick={()=>void save()} disabled={saving||language===data.language}
            className="w-full rounded-xl bg-blue-600 p-3 font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">
            {saving?"กำลังบันทึก...":"บันทึกภาษาการแจ้งเตือน"}
          </button>
        </div>:null}
      </section>
    </div>
  );
}
