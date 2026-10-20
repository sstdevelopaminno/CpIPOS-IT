"use client";
import {useCallback,useEffect,useState} from "react";
type Feature="optical_work_orders"|"optical_deposit";
type ApiResponse={data?:{eligible:boolean;reason:string|null;
 granted:Record<Feature,boolean>;rollout_hint:string};error?:{message:string}};
export function OpticalFinanceApprovalCard({tenantId}:{tenantId:string}){
 const [data,setData]=useState<ApiResponse["data"]|null>(null);
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState<Feature|null>(null);
 const [error,setError]=useState(""),[notice,setNotice]=useState("");
 const read=useCallback(async()=>{
  setLoading(true);setError("");
  try{
   const response=await fetch(`/api/it-admin/v1/tenants/${encodeURIComponent(tenantId)}/optical-finance-approval`,{
     cache:"no-store",credentials:"same-origin"
   });
   const body=await response.json() as ApiResponse;
   if(!response.ok||!body.data)throw new Error(body.error?.message??"ไม่สามารถอ่านสิทธิ์ Optical finance");
   setData(body.data);
  }catch(e){setError(e instanceof Error?e.message:"ไม่สามารถอ่านสิทธิ์");setData(null);}
  finally{setLoading(false);}
 },[tenantId]);
 useEffect(()=>{void read();},[read]);
 const change=async(feature:Feature)=>{
  if(!data||!data.eligible||busy)return;
  const enabled=!data.granted[feature];
  const label=feature==="optical_work_orders"?"ใบสั่งงาน Optical":"รับเงินมัดจำ Optical";
  if(!window.confirm(`IT ยืนยัน${enabled?"อนุมัติ":"ยกเลิกสิทธิ์"} ${label} สำหรับร้านนี้เท่านั้น? การอนุมัติไม่เปิดสวิตช์ Vercel และต้องตรวจรับระบบเงินจริงก่อนใช้งาน`))return;
  setBusy(feature);setError("");setNotice("");
  try{
   const response=await fetch(`/api/it-admin/v1/tenants/${encodeURIComponent(tenantId)}/optical-finance-approval`,{
     method:"PATCH",credentials:"same-origin",headers:{"Content-Type":"application/json"},
     body:JSON.stringify({feature,enabled,confirmation:"OPTICAL"})
   });
   const body=await response.json() as ApiResponse;
   if(!response.ok||body.error)throw new Error(body.error?.message??"ไม่สามารถบันทึกการอนุมัติ");
   setNotice(`บันทึกการ${enabled?"อนุมัติ":"ปิดสิทธิ์"} ${label} แล้ว พร้อมบันทึก Audit`);
   await read();
  }catch(e){setError(e instanceof Error?e.message:"ไม่สามารถปรับสิทธิ์");}
  finally{setBusy(null);}
 };
 return <section id="optical-finance-approval" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4"
  aria-label="CUSTOM Optical finance approval">
  <div className="flex flex-wrap items-center justify-between gap-2">
   <h3 className="text-lg font-bold text-emerald-900">อนุมัติ CUSTOM Optical Finance (IT)</h3>
   <button type="button" className="rounded-lg border px-3 py-2 text-sm"
    onClick={()=>void read()} disabled={loading||Boolean(busy)}>โหลดสถานะ</button>
  </div>
  <p className="mt-2 text-sm text-slate-700">IT เปิดสิทธิ์ใบสั่งงานและมัดจำให้ร้านนี้เพียงครั้งเดียว ไม่ต้องกดอนุมัติทุกบิล
    หลังเปิดแล้วเจ้าของร้านและพนักงานดำเนินงานตามสิทธิ์ POS ได้ตามปกติ · การรับเงินโอนยังต้องตรวจยอดเงินจริง</p>
  {loading?<p className="mt-2 text-sm">กำลังตรวจสอบสัญญา...</p>:null}
  {data&&!data.eligible?<p role="status" className="mt-2 text-sm text-amber-800">{data.reason}</p>:null}
  {data?.eligible?<div className="mt-3 grid gap-3 sm:grid-cols-2">
    {([{id:"optical_work_orders",label:"อนุมัติใบสั่งงาน Optical"},
       {id:"optical_deposit",label:"อนุมัติรับเงินมัดจำ Optical"}] as const).map(x=>
      <div key={x.id} className="rounded-lg border bg-white p-3">
       <p className="text-sm font-semibold">{x.label}</p>
       <p className="mt-1 text-sm">{data.granted[x.id]?"สถานะ: IT อนุมัติแล้ว":"สถานะ: รอ IT อนุมัติ"}</p>
       <button type="button" onClick={()=>void change(x.id)} disabled={Boolean(busy)||loading}
         className="mt-2 min-h-10 rounded-lg border border-emerald-600 px-4 py-2 text-sm font-semibold text-emerald-900">
         {data.granted[x.id]?"ปิดสิทธิ์":"กดอนุมัติ"}
       </button>
      </div>)}
   </div>:null}
   <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
     การเปิดสิทธิ์ฟีเจอร์ไม่เปิดรับเงินจริงทันที: หลังทดสอบธุรกรรมผ่านแล้ว ให้ผู้ดูแล Deployment เปิด
     <code> OPTICAL_FINANCE_V1_ENABLED=true </code> ใน Vercel POS Web → Settings → Environment Variables และ Deploy ใหม่
     (หน้านี้ไม่สามารถยืนยันสถานะสวิตช์ Vercel ของ POS ได้)
   </p>
   {error?<p className="mt-2 text-sm text-rose-700" role="alert">{error}</p>:null}
   {notice?<p className="mt-2 text-sm text-emerald-800" role="status">{notice}</p>:null}
 </section>;
}
