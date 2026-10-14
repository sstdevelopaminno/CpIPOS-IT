"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type Currency = "THB" | "LAK";
type Check = {
 tenant_code:string; currency_code:Currency; is_custom:boolean; it_allowed:boolean;
 settings_menu_enabled:boolean; currency_menu_enabled:boolean;
 approver_role:"it_admin"|"it_support";
 total_orders:number; unresolved_orders:number; open_shifts:number;
 active_sessions:number; pending_payment_intents:number; blockers:string[]; can_change:boolean;
};
type Api<T> = {data:T|null;error:{code?:string;message?:string}|null};

export function TenantCurrencyControl({tenantId}:{tenantId:string}) {
 const [state,setState]=useState<Check|null>(null);
 const [next,setNext]=useState<Currency>("LAK");
 const [confirm,setConfirm]=useState("");
 const [ack,setAck]=useState(false);
 const [loading,setLoading]=useState(true);
 const [saving,setSaving]=useState(false);
 const [enabling,setEnabling]=useState(false);
 const [error,setError]=useState("");
 const [notice,setNotice]=useState("");
 const endpoint=`/api/it-admin/v1/tenants/${encodeURIComponent(tenantId)}/pos-currency`;
 const menuEndpoint=`/api/it-admin/v1/tenants/${encodeURIComponent(tenantId)}/pos-menu-policies`;

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

 async function enableMenus(){
   if(!state?.is_custom||state.it_allowed||saving||enabling)return;
   const keys=[
     ...(!state.settings_menu_enabled?["main.settings"]:[]),
     ...(!state.currency_menu_enabled?["settings.currency"]:[])
   ];
   if(!keys.length)return;
   if(!window.confirm(`เปิดเมนูตั้งค่าและสกุลเงิน CUSTOM ให้ร้าน ${state.tenant_code} ใช่หรือไม่?\n\nการเปิดเมนูนี้ไม่ได้อนุมัติเปลี่ยนสกุลเงินหรือปิดบิลค้างโดยอัตโนมัติ`))return;
   setEnabling(true);setError("");setNotice("");
   try{
     for(const key of keys){
       const response=await fetch(menuEndpoint,{
         method:"PATCH",credentials:"include",headers:{"Content-Type":"application/json"},
         body:JSON.stringify({menu_key:key,is_enabled:true})
       });
       const result=await response.json() as Api<{is_enabled:boolean}>;
       if(!response.ok||result.data?.is_enabled!==true)
         throw new Error(`เปิด ${key} ไม่สำเร็จ: ${result.error?.message||"โปรดลองอีกครั้ง"}`);
     }
     setNotice("เปิดเมนู CUSTOM เรียบร้อยแล้ว กรุณาดำเนินการกับบิลค้างและ POS Session ก่อนอนุมัติสกุลเงิน");
   }catch(e){setError(e instanceof Error?e.message:"ไม่สามารถเปิดเมนู CUSTOM ได้")}
   finally{setEnabling(false);await load();}
 }

 async function save(){
  if(!state||saving||enabling)return;
  if(!state.can_change){setError("ยังอนุมัติไม่ได้: "+state.blockers.join(" • "));return;}
  if(!ack||confirm!==`CHANGE ${next}`||next===state.currency_code) {
   setError(`โปรดติ๊กยืนยันและพิมพ์ CHANGE ${next} ลงในช่องให้ครบก่อนอนุมัติ (ข้อความสีเทาเป็นเพียงตัวอย่าง)`);
   return;
  }
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

 const canSubmit=Boolean(state?.can_change && ack && confirm===`CHANGE ${next}` && next!==state.currency_code&&!saving&&!enabling);
 const isReady=state?.can_change===true;
 const menuMissing=Boolean(state?.is_custom&&!state.it_allowed);
 return <section className="surface" style={{maxWidth:940,margin:"0 auto",padding:24}}>
  <h2 style={{fontSize:24,fontWeight:800,marginBottom:8}}>ตั้งค่าสกุลเงินร้านค้า — IT CONTROL</h2>
  <p style={{marginBottom:16,color:"#475569"}}>การเปลี่ยนสกุลเงินของร้าน CUSTOM ต้องผ่านการตรวจธุรกรรมและอนุมัติโดย IT Admin ไม่แปลงราคาสินค้าหรือยอดย้อนหลัง</p>
  <p style={{marginBottom:12}}><Link href="/it-admin/tenants">← กลับรายการร้านค้า</Link></p>
  <button type="button" disabled={saving||enabling||loading} onClick={()=>void load()}
   style={{marginBottom:16,padding:"10px 14px",border:"1px solid #cbd5e1",borderRadius:9}}>ตรวจสอบเงื่อนไขใหม่</button>
  {loading?<p role="status">กำลังตรวจสิทธิ์และบิลที่ยังไม่ปิด...</p>:null}
  {error?<p role="alert" style={{color:"#b91c1c",marginBottom:16}}>{error}</p>:null}
  {notice?<p role="status" style={{color:"#15803d",marginBottom:16}}>{notice}</p>:null}
  {state?<div style={{display:"grid",gap:16}}>
   <div style={{padding:18,border:"1px solid #cbd5e1",borderRadius:12,display:"grid",gap:5}}>
      <div><strong>ร้าน:</strong> {state.tenant_code}</div>
      <div><strong>สกุลเงินปัจจุบัน:</strong> {state.currency_code==="LAK"?"LAK — ກີບ":"THB — บาท"}</div>
      <div><strong>แพ็กเกจ CUSTOM:</strong> {state.is_custom?"ใช่":"ไม่ใช่"}</div>
      <div><strong>เมนูตั้งค่าหลัก:</strong> {state.settings_menu_enabled?"เปิดแล้ว":"ยังไม่เปิด"}</div>
      <div><strong>เมนูตั้งค่าสกุลเงิน:</strong> {state.currency_menu_enabled?"เปิดแล้ว":"ยังไม่เปิด"}</div>
      <div><strong>สิทธิ์ของบัญชีนี้:</strong> {state.approver_role==="it_admin"?"IT Admin — สามารถอนุมัติเมื่อเงื่อนไขครบ":"IT Support — ตรวจสอบ/เปิดเมนูได้ แต่ต้องใช้ IT Admin อนุมัติ"}</div>
   </div>
   <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(145px,1fr))",gap:10}}>
     {([{label:"บิลย้อนหลัง",value:state.total_orders},{label:"บิลที่ยังไม่ปิด",value:state.unresolved_orders},{label:"กะที่เปิดอยู่",value:state.open_shifts},{label:"POS ที่ล็อกอิน",value:state.active_sessions},{label:"QR ค้างชำระ",value:state.pending_payment_intents}]).map(item=>
      <div key={item.label} style={{border:"1px solid #cbd5e1",borderRadius:12,padding:14}}>
       <small>{item.label}</small><div style={{fontWeight:800,fontSize:24}}>{item.value}</div>
      </div>)}
   </div>
   {menuMissing?<div style={{padding:16,border:"1px solid #93c5fd",borderRadius:12,display:"grid",gap:12}}>
     <strong>ขั้นที่ 1 — เปิดสิทธิ์เมนู CUSTOM ของร้าน</strong>
     <p style={{margin:0}}>ระบบยังไม่ได้เปิดเมนูหลักตั้งค่า หรือเมนูย่อยตั้งค่าสกุลเงิน สามารถเปิดตรงนี้โดยไม่ต้องย้อนหาในรายการเมนู</p>
     <button type="button" disabled={enabling||saving||loading} onClick={()=>void enableMenus()}
       style={{padding:"12px 16px",background:"#1d4ed8",color:"white",borderRadius:10,fontWeight:700}}>
       {enabling?"กำลังเปิดสิทธิ์...":"เปิดสิทธิ์เมนูตั้งค่าสกุลเงิน (CUSTOM)"}
     </button>
   </div>:null}
   {state.blockers.length?<div role="alert" style={{background:"#fff7ed",border:"1px solid #fdba74",borderRadius:12,padding:16}}>
     <strong>ขั้นที่ 2 — ยังไม่ผ่านเงื่อนไขการเปลี่ยนสกุลเงิน</strong>
     <ul style={{paddingLeft:20,marginTop:8}}>{state.blockers.map(item=><li key={item} style={{marginBottom:4}}>{item}</li>)}</ul>
     <div style={{display:"flex",flexWrap:"wrap",gap:14,marginTop:12}}>
      {state.unresolved_orders>0?<a href="https://cp-ipos-web.vercel.app/preview/pos/sales-list" target="_blank" rel="noopener noreferrer">ตรวจบิลค้างใน POS <strong>({state.unresolved_orders}) ↗</strong></a>:null}
      {state.active_sessions>0?<Link href={`/tenants/${encodeURIComponent(tenantId)}/devices`}>ตรวจอุปกรณ์และ POS Session ({state.active_sessions}) →</Link>:null}
      {state.approver_role!=="it_admin"?<strong>การอนุมัติขั้นสุดท้ายต้องลงชื่อเข้าใช้ด้วยบัญชี IT Admin</strong>:null}
     </div>
     <p style={{marginTop:10,marginBottom:0}}>ตรวจสอบและปิดบิลที่ค้างด้วยกระบวนการปกติ ปิดกะ/เครื่องที่ใช้งาน แล้วกด “ตรวจสอบเงื่อนไขใหม่” ห้ามลบบิลหรือ Session เพียงเพื่อผ่านเงื่อนไข</p>
   </div>:<p role="status" style={{color:"#166534",fontWeight:700}}>ตรวจสอบครบแล้ว พร้อมรับการอนุมัติโดย IT Admin</p>}
   <label style={{display:"grid",gap:7,fontWeight:700}}>สกุลเงินใหม่
    <select value={next} onChange={e=>{setNext(e.target.value as Currency);setConfirm("");setAck(false);setError("")}} style={{padding:12,border:"1px solid #cbd5e1",borderRadius:10}}>
     <option value="THB">THB — บาท</option><option value="LAK">LAK — ກີບ</option>
    </select>
   </label>
   <div style={{padding:16,background:"#f8fafc",borderRadius:12}}>
    <strong>ตรวจสอบก่อนอนุมัติ</strong>
    <p style={{marginBottom:0}}>ใบเสร็จเก่าคงสกุลเดิม / ไม่มีการแปลงราคาสินค้าอัตโนมัติ / ตรวจสอบราคาและวิธีรับเงินทุกสาขา / แยกรายงาน THB และ LAK</p>
   </div>
   <label style={{display:"flex",gap:9,alignItems:"flex-start"}}>
    <input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)}/>
    ข้าพเจ้าตรวจสอบยอดขายเดิมและรับทราบว่าจะไม่แปลงมูลค่าหรือราคาเดิมโดยอัตโนมัติ
   </label>
   <label style={{display:"grid",gap:6,fontWeight:700}}>พิมพ์คำว่า <strong>CHANGE {next}</strong> ลงในช่อง (ไม่ใช่ข้อความตัวอย่างสีเทา)
    <input value={confirm} onChange={e=>{setConfirm(e.target.value);setError("")}} autoComplete="off"
     placeholder={`พิมพ์ CHANGE ${next} ที่นี่`} style={{padding:12,border:"1px solid #cbd5e1",borderRadius:10}}/>
   </label>
   <button type="button" onClick={()=>void save()} disabled={saving||enabling||loading||next===state.currency_code}
     title={!isReady?"ระบบยังมีเงื่อนไขที่ต้องแก้ไขก่อนอนุมัติ":!canSubmit?"ติ๊กยืนยันและพิมพ์ข้อความให้ตรงก่อน":"อนุมัติ"}
     style={{padding:"13px 18px",borderRadius:11,background:"#2563eb",color:"white",fontWeight:700,opacity:canSubmit?1:0.66,cursor:"pointer"}}>
    {saving?"กำลังตรวจสอบและบันทึก":isReady?"อนุมัติเปลี่ยนสกุลเงิน":"ตรวจสอบเงื่อนไขก่อนอนุมัติ"}
   </button>
   {!isReady?<p role="status" style={{color:"#92400e",fontSize:14}}>ปุ่มนี้จะแจ้งสาเหตุที่ยังไม่อนุมัติ ไม่เปลี่ยนสกุลเงินจนกว่าทุกเงื่อนไขจะผ่าน</p>:null}
  </div>:null}
 </section>;
}
