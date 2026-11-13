"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Discount = {
  id: string; title: string; percent: number; valid_from: string; valid_until: string;
  duration_unit: "day" | "month" | "year"; duration_value: number;
  reason: string; status: "active" | "cancelled"; created_at: string;
};
type State = {
  tenant: { id:string; name:string; is_active:boolean };
  contract: { id:string;package_id:string;amount_per_cycle:number;billing_interval:string;status:string } | null;
  discounts: Discount[];
};
type Envelope<T> = {data:T|null;error?:{message?:string}|null};

function dateAfterDuration(start:string,unit:"day"|"month"|"year",count:number) {
  const d=new Date(start+"T12:00:00.000Z");
  if(!Number.isFinite(d.getTime())||!Number.isInteger(count)||count<1)return "";
  if(unit==="day")d.setUTCDate(d.getUTCDate()+count);
  else {
    const day=d.getUTCDate();
    d.setUTCDate(1);
    if(unit==="month")d.setUTCMonth(d.getUTCMonth()+count);
    else d.setUTCFullYear(d.getUTCFullYear()+count);
    const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();
    d.setUTCDate(Math.min(day,last));
  }
  d.setUTCDate(d.getUTCDate()-1);
  return d.toISOString().slice(0,10);
}

const inputStyle={border:"1px solid #cbd5e1",background:"#fff",borderRadius:10,padding:"10px 12px",width:"100%",minHeight:42} as const;
const labelStyle={display:"grid",gap:6,fontSize:13,fontWeight:650,color:"#334155"} as const;
const money=(v:number)=>new Intl.NumberFormat("th-TH",{style:"currency",currency:"THB",minimumFractionDigits:2}).format(v);
const unitText={day:"วัน",month:"เดือน",year:"ปี"};
const todayBkk=()=>new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Bangkok",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());

export function TenantDiscountManager({tenantId}:{tenantId:string}) {
  const [state,setState]=useState<State|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [title,setTitle]=useState("");
  const [percent,setPercent]=useState("10");
  const [validFrom,setValidFrom]=useState(todayBkk);
  const [unit,setUnit]=useState<"day"|"month"|"year">("month");
  const [quantity,setQuantity]=useState(1);
  const [validUntil,setValidUntil]=useState(()=>dateAfterDuration(todayBkk(),"month",1));
  const [reason,setReason]=useState("");

  const load=useCallback(async()=>{
    const response=await fetch("/api/it-admin/v1/tenants/"+encodeURIComponent(tenantId)+"/discounts",{cache:"no-store"});
    const payload=await response.json() as Envelope<State>;
    if(!response.ok||!payload.data)throw new Error(payload.error?.message??"ไม่สามารถโหลดส่วนลดรายร้านได้");
    setState(payload.data);
  },[tenantId]);

  useEffect(()=>{let active=true;load().catch(err=>{if(active)setError(err instanceof Error?err.message:"โหลดข้อมูลไม่สำเร็จ");});return()=>{active=false;};},[load]);

  const amount=Number(state?.contract?.amount_per_cycle??0);
  const savings=useMemo(()=>{
    const value=Number(percent);
    return Number.isFinite(value)&&value>0&&value<=100?Math.round(amount*value)/100:0;
  },[percent,amount]);
  const canSave=Boolean(state?.tenant.is_active&&state?.contract?.status==="active"&&amount>0);
  function setDuration(nextStart:string,nextUnit:"day"|"month"|"year",nextQuantity:number) {
    setValidUntil(dateAfterDuration(nextStart,nextUnit,nextQuantity));
  }

  async function save(){
    setError("");setNotice("");
    if(!canSave||!title.trim()||!reason.trim()||!validFrom||!validUntil||validUntil<validFrom){
      setError("กรุณาตรวจสอบชื่อโปรโมชั่น วันที่ และเหตุผล");return;
    }
    if(!window.confirm("ยืนยันอนุมัติส่วนลด "+percent+"% สำหรับร้านนี้ ตั้งแต่ "+validFrom+" ถึง "+validUntil+" ?"))return;
    setBusy(true);
    try{
      const response=await fetch("/api/it-admin/v1/tenants/"+encodeURIComponent(tenantId)+"/discounts",{
        method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({title,percent:Number(percent),valid_from:validFrom,valid_until:validUntil,
          duration_unit:unit,duration_value:quantity,reason})
      });
      const payload=await response.json() as Envelope<Discount>;
      if(!response.ok)throw new Error(payload.error?.message??"บันทึกไม่สำเร็จ");
      await load();
      setNotice("บันทึกสิทธิส่วนลดแล้ว รอบบิลใหม่ที่เข้าเงื่อนไขจะคำนวณอัตโนมัติ");
      setTitle("");setReason("");
    }catch(err){setError(err instanceof Error?err.message:"บันทึกส่วนลดไม่สำเร็จ");}
    finally{setBusy(false);}
  }

  async function cancel(row:Discount){
    const note=window.prompt("ระบุเหตุผลการยกเลิกสิทธิส่วนลด \""+row.title+"\" (อย่างน้อย 4 ตัวอักษร)");
    if(note===null)return;
    if(note.trim().length<4){setError("กรุณาระบุเหตุผลการยกเลิกอย่างน้อย 4 ตัวอักษร");return;}
    if(!window.confirm("ยืนยันยกเลิกส่วนลดรายการนี้? จะไม่แก้ไขบิลหรือใบเสร็จที่ชำระแล้ว"))return;
    setBusy(true);setError("");setNotice("");
    try{
      const response=await fetch("/api/it-admin/v1/tenants/"+encodeURIComponent(tenantId)+"/discounts",{
        method:"PATCH",headers:{"content-type":"application/json"},
        body:JSON.stringify({id:row.id,reason:note.trim()})
      });
      const payload=await response.json() as Envelope<Discount>;
      if(!response.ok)throw new Error(payload.error?.message??"ยกเลิกไม่สำเร็จ");
      await load();setNotice("ยกเลิกสิทธิแล้ว ข้อมูลการชำระที่ยืนยันแล้วไม่ถูกแก้ไข");
    }catch(err){setError(err instanceof Error?err.message:"ยกเลิกไม่สำเร็จ");}
    finally{setBusy(false);}
  }
  return <section aria-label="ส่วนลดแพ็กเกจเฉพาะร้าน" style={{background:"#f8fbff",border:"1px solid #bfdbfe",borderRadius:18,padding:18,display:"grid",gap:16}}>
    <div>
      <p style={{fontSize:11,fontWeight:800,color:"#2563eb",letterSpacing:1}}>IT · TENANT DISCOUNT</p>
      <h4 style={{fontSize:18,fontWeight:800,margin:"4px 0"}}>กำหนดส่วนลดแพ็กเกจของร้านค้า</h4>
      <p style={{fontSize:13,color:"#475569",lineHeight:1.6}}>เลือกเปอร์เซ็นต์และระยะเวลา (วัน / เดือน / ปี) พร้อมวันที่เริ่มและสิ้นสุด ระบบจะหักส่วนลดเฉพาะรอบบิลใหม่ที่มีวันเริ่มอยู่ในช่วงนี้ ไม่แก้ราคาสัญญาถาวรหรือประวัติการชำระเงิน</p>
    </div>
    {error?<p role="alert" style={{background:"#fff1f2",color:"#9f1239",padding:12,borderRadius:10}}>{error}</p>:null}
    {notice?<p role="status" style={{background:"#ecfdf5",color:"#065f46",padding:12,borderRadius:10}}>{notice}</p>:null}
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))",gap:12}}>
      <label style={labelStyle}>ชื่อโปรโมชั่น<input style={inputStyle} value={title} maxLength={160} disabled={busy||!canSave} onChange={e=>setTitle(e.target.value)} placeholder="เช่น ของขวัญปีใหม่ 2570"/></label>
      <label style={labelStyle}>ส่วนลด (%)<input style={inputStyle} type="number" min=".01" max="99.99" step=".01" value={percent} disabled={busy||!canSave} onChange={e=>setPercent(e.target.value)}/></label>
      <label style={labelStyle}>วันที่เริ่มรับสิทธิ<input style={inputStyle} type="date" value={validFrom} disabled={busy||!canSave} onChange={e=>{setValidFrom(e.target.value);setDuration(e.target.value,unit,quantity);}}/></label>
      <label style={labelStyle}>หน่วยระยะเวลา<select style={inputStyle} value={unit} disabled={busy||!canSave} onChange={e=>{const u=e.target.value as typeof unit;setUnit(u);setDuration(validFrom,u,quantity);}}><option value="day">รายวัน</option><option value="month">รายเดือน</option><option value="year">รายปี</option></select></label>
      <label style={labelStyle}>จำนวน {unitText[unit]}<input style={inputStyle} type="number" min="1" max="3650" value={quantity} disabled={busy||!canSave} onChange={e=>{const n=Number(e.target.value);setQuantity(n);setDuration(validFrom,unit,n);}}/></label>
      <label style={labelStyle}>วันสิ้นสุด (รวมวันนี้)<input style={inputStyle} type="date" value={validUntil} disabled={busy||!canSave} onChange={e=>setValidUntil(e.target.value)}/></label>
    </div>
    <label style={labelStyle}>เหตุผลประกอบการอนุมัติ (Audit)<textarea style={{...inputStyle,minHeight:72}} value={reason} maxLength={600} disabled={busy||!canSave} onChange={e=>setReason(e.target.value)} placeholder="เช่น ลูกค้าใช้งานต่อเนื่องครบตามเงื่อนไขโปรโมชั่นปีใหม่"/></label>
    <div style={{display:"flex",flexWrap:"wrap",justifyContent:"space-between",alignItems:"center",gap:10}}>
      <span style={{fontSize:13,color:"#1e3a8a"}}>ฐานราคา {money(amount)} → <strong>{money(Math.max(0,amount-savings))}</strong> ต่อรอบบิลที่เข้าเงื่อนไข</span>
      <button type="button" disabled={busy||!canSave} onClick={()=>void save()} style={{padding:"10px 22px",background:canSave?"#155bdf":"#94a3b8",color:"white",border:0,borderRadius:12,fontWeight:800,cursor:"pointer"}}>{busy?"กำลังบันทึก...":"บันทึกและอนุมัติส่วนลด"}</button>
    </div>
    <div style={{display:"grid",gap:9}}>
      <strong>ประวัติสิทธิส่วนลดรายร้าน</strong>
      {state?.discounts.length?state.discounts.map(d=><div key={d.id} style={{border:"1px solid #cbd5e1",padding:12,borderRadius:12,display:"flex",flexWrap:"wrap",justifyContent:"space-between",gap:10,background:"white"}}>
        <div style={{display:"grid",gap:4,fontSize:13}}>
          <strong>{d.title} · ลด {d.percent}%</strong>
          <span>{d.valid_from} ถึง {d.valid_until} · {d.duration_value} {unitText[d.duration_unit]}</span>
          <small style={{color:d.status==="active"?"#047857":"#64748b"}}>{d.status==="active"?"อนุมัติแล้ว":"ยกเลิกแล้ว"} · {d.reason}</small>
        </div>
        {d.status==="active"?<button type="button" disabled={busy} onClick={()=>void cancel(d)} style={{padding:"7px 12px",borderRadius:9,border:"1px solid #fecdd3",background:"#fff1f2",color:"#be123c",cursor:"pointer"}}>ยกเลิกสิทธิ</button>:null}
      </div>):<p style={{fontSize:13,color:"#64748b"}}>ยังไม่มีโปรโมชั่นที่บันทึกในระบบ</p>}
    </div>
  </section>;
}
