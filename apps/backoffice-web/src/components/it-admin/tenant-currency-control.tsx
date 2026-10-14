"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type Currency = "THB" | "LAK";
type Check = { tenant_code:string; currency_code:Currency; is_custom:boolean; it_allowed:boolean; total_orders:number; unresolved_orders:number; open_shifts:number; active_sessions:number; pending_payment_intents:number; blockers:string[]; can_change:boolean };
type Api<T> = {data:T|null;error:{code?:string;message?:string}|null};

export function TenantCurrencyControl({tenantId}:{tenantId:string}) {
 const [state,setState]=useState<Check|null>(null);
 const [next,setNext]=useState<Currency>("LAK");
 const [confirm,setConfirm]=useState("");
 const [ack,setAck]=useState(false);
 const [loading,setLoading]=useState(true);
 const [saving,setSaving]=useState(false);
 const [error,setError]=useState("");
 const [notice,setNotice]=useState("");
 const endpoint=`/api/it-admin/v1/tenants/${encodeURIComponent(tenantId)}/pos-currency`;
 const load=useCallback(async()=>{
   setLoading(true);setError("");
   try{
    const response=await fetch(endpoint,{cache:"no-store",credentials:"include"});
    const body=await response.json() as Api<Check>;
    if(!response.ok||!body.data)throw new Error(body.error?.message||"ไม่สามารถอ่านค่าร้านได้");
    setState(body.data);setNext(body.data.currency_code==="LAK"?"THB":"LAK");
   }catch(e){setState(null);setError(e instanceof Error?e.message:"ไม่สามารถอ่านข้อมูลได้");}
   finally{setLoading(false)}
 },[endpoint]);
 useEffect(()=>{void load()},[load]);
 async function save(){
  if(!state?.can_change||saving||!ack||confirm!==`CHANGE ${next}`||next===state.currency_code)return;
  if(!window.confirm(`ยืนยันอนุมัติเปลี่ยนสกุลเงินร้าน ${state.tenant_code} จาก ${state.currency_code} เป็น ${next}?\n\nใบเสร็จและข้อมูลขายเก่าต้องคงสกุลเดิม และระบบไม่แปลงราคาสินค้า`))return;
  setSaving(true);setError("");setNotice("");
  try{
   const response=await fetch(endpoint,{method:"PATCH",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify({currency_code:next,expected_currency:state.currency_code,confirmation:confirm,acknowledge_history:true})});
   const body=await response.json() as Api<{currency_code:Currency}>;
   if(!response.ok||!body.data)throw new Error(body.error?.message||"ไม่สามารถอนุมัติได้");
   setNotice(`อนุมัติ ${body.data.currency_code} แล้ว กรุณาเข้าสู่ POS ใหม่และตรวจสอบราคาสินค้าก่อนเริ่มขาย`);
   setAck(false);setConfirm("");await load();
  }catch(e){setError(e instanceof Error?e.message:"ไม่สามารถอนุมัติได้")}
  finally{setSaving(false)}
 }
 return <section className="surface" style={{maxWidth:820,margin:"0 auto",padding:24}}>
  <h2 style={{fontSize:24,fontWeight:800,marginBottom:8}}>ตั้งค่าสกุลเงินร้านค้า — IT CONTROL</h2>
  <p style={{marginBottom:16,color:"#475569"}}>การเปลี่ยนสกุลเงินสำหรับแพ็กเกจ CUSTOM โดย IT Admin เท่านั้น ไม่มีการแปลงราคาสินค้าหรือยอดขายย้อนหลัง</p>
  <p style={{marginBottom:16}}><Link href="/it-admin/tenants">← กลับรายการร้านค้า</Link></p>
  <button type="button" disabled={saving||loading} onClick={()=>void load()} style={{marginBottom:16,padding:"8px 14px",border:"1px solid #cbd5e1",borderRadius:9}}>ตรวจสอบเงื่อนไขใหม่</button>
  {loading?<p role="status">กำลังตรวจสิทธิ์และบิลที่ยังไม่ปิด...</p>:null}
  {error?<p role="alert" style={{color:"#b91c1c",marginBottom:16}}>{error}</p>:null}
  {notice?<p role="status" style={{color:"#15803d",marginBottom:16}}>{notice}</p>:null}
  {state?<div style={{display:"grid",gap:15}}>
    <div style={{padding:18,border:"1px solid #cbd5e1",borderRadius:12}}>
      <div><strong>ร้าน:</strong> {state.tenant_code}</div>
      <div><strong>สกุลเงินปัจจุบัน:</strong> {state.currency_code==="LAK"?"LAK — ກີບ":"THB — บาท"}</div>
      <div><strong>แพ็กเกจ CUSTOM:</strong> {state.is_custom?"ใช่":"ไม่ใช่"}</div>
      <div><strong>IT เปิดเมนูตั้งค่าสกุลเงิน:</strong> {state.it_allowed?"เปิด":"ยังไม่เปิด"}</div>
    </div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:10}}>
      {([{label:"บิลย้อนหลัง",value:state.total_orders},{label:"บิลที่ยังไม่ปิด",value:state.unresolved_orders},{label:"กะที่เปิดอยู่",value:state.open_shifts},{label:"POS ที่ล็อกอิน",value:state.active_sessions},{label:"QR ค้างชำระ",value:state.pending_payment_intents}]).map(item=><div key={item.label} style={{border:"1px solid #cbd5e1",borderRadius:12,padding:14}}><small>{item.label}</small><div style={{fontWeight:800,fontSize:24}}>{item.value}</div></div>)}
    </div>
    {state.blockers.length?<div role="alert" style={{background:"#fff7ed",border:"1px solid #fdba74",borderRadius:12,padding:16}}>
      <strong>ยังไม่อนุญาตให้เปลี่ยนสกุลเงิน</strong><ul>{state.blockers.map(item=><li key={item}>• {item}</li>)}</ul>
      <p>ฝ่าย IT ต้องเปิดเมนู CUSTOM, ปิดบิล กะ รายการ QR ค้างชำระ และให้เครื่อง POS ออกจากระบบก่อน</p>
    </div>:<p role="status" style={{color:"#166534"}}>เงื่อนไขพร้อมสำหรับตรวจสอบและอนุมัติโดย IT Admin</p>}
    <label style={{display:"grid",gap:7,fontWeight:700}}>สกุลเงินใหม่
      <select value={next} onChange={e=>{setNext(e.target.value as Currency);setConfirm("");setAck(false)}} style={{padding:12,border:"1px solid #cbd5e1",borderRadius:10}}>
        <option value="THB">THB — บาท</option><option value="LAK">LAK — ກີບ</option>
      </select>
    </label>
    <div style={{padding:16,background:"#f8fafc",borderRadius:12}}>
      <strong>ตรวจสอบก่อนอนุมัติ</strong>
      <p>ใบเสร็จเก่าต้องเป็น THB ตามมูลค่าเดิม / ไม่แปลงราคาสินค้า / ตรวจสอบการตั้งราคาทุกสาขาและวิธีรับชำระ / รายงานข้ามช่วงสกุลเงินต้องแยกก่อนนำยอดมารวม</p>
    </div>
    <label style={{display:"flex",gap:9,alignItems:"flex-start"}}>
      <input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)} />
      ข้าพเจ้าตรวจสอบยอดขายเดิมและรับทราบว่าจะไม่แปลงมูลค่าหรือราคาเดิมโดยอัตโนมัติ
    </label>
    <label style={{display:"grid",gap:6}}>พิมพ์ <strong>CHANGE {next}</strong> เพื่อยืนยัน
      <input value={confirm} onChange={e=>setConfirm(e.target.value)} autoComplete="off" placeholder={`CHANGE ${next}`} style={{padding:12,border:"1px solid #cbd5e1",borderRadius:10}} />
    </label>
    <button type="button" onClick={()=>void save()} disabled={!state.can_change||saving||!ack||next===state.currency_code||confirm!==`CHANGE ${next}`}
      style={{padding:"13px 18px",borderRadius:11,background:"#2563eb",color:"white",fontWeight:700,opacity:!state.can_change||saving||!ack||next===state.currency_code||confirm!==`CHANGE ${next}`?0.5:1}}>
      {saving?"กำลังตรวจสอบและบันทึก":"อนุมัติเปลี่ยนสกุลเงิน"}
    </button>
  </div>:null}
 </section>
}
