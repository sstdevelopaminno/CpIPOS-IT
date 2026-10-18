"use client";
import Link from "next/link";
import { useCallback,useEffect,useState } from "react";
import { useParams } from "next/navigation";
type Feature = {code:string,name:string,default_monthly_price:number|string,default_yearly_price:number|string};
type Proposal = {id:string;addon_type:string;addon_code:string;quantity:number;unit_price:number;total_price:number;currency:string;billing_interval:string;state:string;reason:string;created_at:string};
type Payload = {tenant:{id:string,name:string};proposals:Proposal[];features:Feature[]};
async function api<T>(url:string,init?:RequestInit):Promise<T>{
 const resp=await fetch(url,{credentials:"include",cache:"no-store",...init});
 const json=await resp.json().catch(()=>null) as {data?:T,error?:{message?:string}}|null;
 if(!resp.ok||!json?.data)throw new Error(json?.error?.message||`HTTP ${resp.status}`);
 return json.data;
}
const box={background:"white",border:"1px solid #cbd5e1",padding:18,borderRadius:12};
export default function TenantAddonsPage(){
 const {tenantId}=useParams<{tenantId:string}>();
 const [data,setData]=useState<Payload|null>(null);
 const [type,setType]=useState<"quota"|"feature">("quota");
 const [code,setCode]=useState("extra_device");
 const [quantity,setQuantity]=useState("1");
 const [unitPrice,setUnitPrice]=useState("0");
 const [interval,setInterval]=useState("monthly");
 const [reason,setReason]=useState("");
 const [loading,setLoading]=useState(false);
 const [error,setError]=useState("");
 const [message,setMessage]=useState("");
 const endpoint=`/api/it-admin/v1/tenants/${tenantId}/addon-proposals`;
 const load=useCallback(async()=>setData(await api<Payload>(endpoint)),[endpoint]);
 useEffect(()=>{void load().catch(e=>setError(e instanceof Error?e.message:"ไม่สามารถโหลดข้อเสนอได้"));},[load]);
 async function mutate(input:Record<string,unknown>){
  setLoading(true);setError("");setMessage("");
  try{await api(endpoint,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(input)});
   await load();setMessage("บันทึกแล้ว · ยังไม่เปิดสิทธิ์หรือสร้างการชำระเงิน");
  }catch(e){setError(e instanceof Error?e.message:"บันทึกไม่สำเร็จ");}
  finally{setLoading(false);}
 }
 return <main style={{maxWidth:1100,margin:"22px auto",padding:18,display:"grid",gap:18}}>
  <header><Link href="/it-admin/tenants">← Tenants / Stores</Link><h1>Add-ons · {data?.tenant.name??"ร้านค้า"}</h1>
   <p>เสนอเพิ่มโควตาหรือฟีเจอร์เฉพาะร้าน ไม่เปลี่ยนแพ็กเกจหลัก และไม่เปิดสิทธิ์ก่อนตรวจรับชำระ</p></header>
  {error?<p style={{color:"#b42318"}} role="alert">{error}</p>:null}
  {message?<p style={{color:"#166534"}} role="status">{message}</p>:null}
  <section style={{...box,display:"grid",gap:12}}><h2>สร้างข้อเสนอ Add-on</h2>
   <label>ประเภท Add-on<select style={{display:"block",padding:10,width:"100%"}} value={type} onChange={e=>{
    const v=e.target.value as "quota"|"feature";setType(v);setCode(v==="quota"?"extra_device":"");setUnitPrice("0");
   }}><option value="quota">เพิ่มโควตา</option><option value="feature">เพิ่มฟีเจอร์</option></select></label>
   <label>รายการ<select style={{display:"block",padding:10,width:"100%"}} value={code} onChange={e=>{
     const next=e.target.value;setCode(next);
     const feat=data?.features.find(f=>f.code===next);
     if(feat)setUnitPrice(String(interval==="yearly"?feat.default_yearly_price:feat.default_monthly_price));
   }}>
    {type==="quota"?<><option value="extra_branch">เพิ่มสาขา</option><option value="extra_device">เพิ่มเครื่อง POS</option><option value="extra_user">เพิ่มผู้ใช้งาน</option><option value="extra_storage_gb">เพิ่ม Storage GB</option></>:<>
     <option value="">เลือกฟีเจอร์</option>{(data?.features??[]).filter(f=>!f.code.startsWith("pos.")&&
      !["core_pos_sales","pin_login","user_management","device_management","branch_management"].includes(f.code))
       .map(f=><option key={f.code} value={f.code}>{f.name} ({f.code})</option>)}</>}
   </select></label>
   <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))",gap:12}}>
    <label>จำนวน<input style={{display:"block",padding:10,width:"100%"}} type="number" min={1} step={1} value={quantity} onChange={e=>setQuantity(e.target.value)}/></label>
    <label>ราคา/หน่วย (สกุลเงินตามสัญญาร้าน)<input style={{display:"block",padding:10,width:"100%"}} type="number" min={0} step="0.01" value={unitPrice} onChange={e=>setUnitPrice(e.target.value)}/></label>
    <label>รอบคิดราคา<select style={{display:"block",padding:10,width:"100%"}} value={interval} onChange={e=>{
     const newInterval=e.target.value;setInterval(newInterval);
     const f=data?.features.find(f=>f.code===code);if(f&&newInterval!=="one_time")setUnitPrice(String(newInterval==="yearly"?f.default_yearly_price:f.default_monthly_price));
    }}><option value="monthly">รายเดือน</option><option value="yearly">รายปี</option><option value="one_time">ครั้งเดียว</option></select></label>
   </div>
   <label>เหตุผล / ขอบเขตงาน<textarea style={{display:"block",padding:10,width:"100%",minHeight:75}} value={reason} onChange={e=>setReason(e.target.value)}/></label>
   <strong>ยอดเสนอราคา: {Number.isFinite(Number(quantity)*Number(unitPrice))?(Number(quantity)*Number(unitPrice)).toLocaleString("th-TH"):"—"}</strong>
   <button type="button" disabled={loading||!code||reason.trim().length<5} onClick={()=>void mutate({action:"draft",addon_type:type,addon_code:code,quantity:Number(quantity),unit_price:Number(unitPrice),billing_interval:interval,reason})}
    style={{background:"#2055a1",padding:13,color:"white",border:0,borderRadius:8}}>บันทึกข้อเสนอ Add-on</button>
   <small>การอนุมัติข้อเสนอไม่เรียกเก็บเงิน ไม่เพิ่มโควตาสัญญา และไม่เปิดฟีเจอร์จริง ขั้นตอนชำระ/เปิดสิทธิ์จะดำเนินการแยกภายหลัง</small>
  </section>
  <section style={box}><h2>ประวัติข้อเสนอรายร้าน</h2>
   <div style={{overflowX:"auto"}}><table style={{width:"100%",textAlign:"left",borderCollapse:"collapse"}}>
    <thead><tr><th>รายการ</th><th>จำนวน</th><th>ยอด</th><th>รอบ</th><th>สถานะ</th><th>จัดการ</th></tr></thead>
    <tbody>{(data?.proposals??[]).map(p=><tr key={p.id} style={{borderTop:"1px solid #e2e8f0"}}>
     <td>{p.addon_code}<small style={{display:"block"}}>{p.reason}</small></td><td>{p.quantity}</td><td>{Number(p.total_price).toLocaleString("th-TH")} {p.currency}</td>
     <td>{p.billing_interval}</td><td>{p.state}</td><td>{p.state==="draft"?<div style={{display:"flex",gap:6}}>
      <button disabled={loading} onClick={()=>{if(window.confirm("อนุมัติข้อเสนอเท่านั้น ยังไม่เปิด Add-on หรือคิดเงิน ยืนยัน?"))void mutate({action:"approve",id:p.id});}}>อนุมัติข้อเสนอ</button>
      <button disabled={loading} onClick={()=>{if(window.confirm("ยกเลิกข้อเสนอนี้?"))void mutate({action:"cancel",id:p.id});}}>ยกเลิก</button>
     </div>:"—"}</td></tr>)}{!data?.proposals.length?<tr><td colSpan={6}>ยังไม่มีข้อเสนอ Add-on</td></tr>:null}</tbody>
   </table></div>
  </section>
 </main>;
}
