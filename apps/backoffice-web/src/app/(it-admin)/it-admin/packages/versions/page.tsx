"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type Plan = {
 id: string; code: string; name: string; quota_mode: string;
 monthly_price: number; yearly_price: number|null; max_branches: number; max_devices: number; max_users: number; retention_months: number|null
};
type Version = { id: string; package_id: string; version_no: number; state: string; effective_at: string;
 proposed_terms: Record<string, unknown>; reason: string; created_at: string };
type Catalog = { packages: Plan[] };
const bg = {padding:20,background:"#fff",border:"1px solid #cbd5e1",borderRadius:12};
async function api<T>(url:string, init?:RequestInit):Promise<T> {
 const response = await fetch(url,{credentials:"include",cache:"no-store",...init});
 const data = await response.json().catch(()=>null) as {data?:T,error?:{message?:string}}|null;
 if(!response.ok||!data?.data) throw new Error(data?.error?.message||`HTTP ${response.status}`);
 return data.data;
}
export default function PackageVersionsPage() {
 const [plans,setPlans]=useState<Plan[]>([]);
 const [versions,setVersions]=useState<Version[]>([]);
 const [selected,setSelected]=useState("");
 const [monthly,setMonthly]=useState("0");
 const [yearly,setYearly]=useState("");
 const [branches,setBranches]=useState("1");
 const [devices,setDevices]=useState("1");
 const [users,setUsers]=useState("1");
 const [retention,setRetention]=useState("6");
 const [effectiveAt,setEffectiveAt]=useState("");
 const [reason,setReason]=useState("");
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const [message,setMessage]=useState("");
 const load=useCallback(async()=>{
  const [a,b]=await Promise.all([api<Catalog>("/api/it-admin/v1/packages"),api<{versions:Version[]}>("/api/it-admin/v1/packages/versions")]);
  setPlans(a.packages.filter(p=>p.quota_mode==="standard"));setVersions(b.versions);
 },[]);
 useEffect(()=>{void load().catch(e=>setError(e instanceof Error?e.message:"โหลดข้อมูลไม่สำเร็จ"));},[load]);
 function select(id:string){
  setSelected(id);const p=plans.find(x=>x.id===id);if(!p)return;
  setMonthly(String(p.monthly_price));setYearly(p.yearly_price==null?"":String(p.yearly_price));
  setBranches(String(p.max_branches));setDevices(String(p.max_devices??1));setUsers(String(p.max_users??1));
  setRetention(String(p.retention_months??6));
 }
 async function perform(body:Record<string,unknown>) {
  setBusy(true);setError("");setMessage("");
  try {await api("/api/it-admin/v1/packages/versions",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
   setMessage("บันทึกแล้ว · ยังไม่เปลี่ยนราคาหรือสิทธิ์ลูกค้าเดิม");await load();
  }catch(e){setError(e instanceof Error?e.message:"บันทึกไม่สำเร็จ");}
  finally{setBusy(false);}
 }
 const field=(label:string,value:string,setter:(v:string)=>void)=> <label style={{display:"grid",gap:5,fontSize:13}}>{label}<input
  style={{padding:10,border:"1px solid #cbd5e1",borderRadius:8}} type="number" min="0" value={value} onChange={e=>setter(e.target.value)}/></label>;
 return <main style={{maxWidth:1110,margin:"20px auto",padding:18,display:"grid",gap:18}}>
  <header><Link href="/it-admin/packages">← แพ็กเกจ</Link><h1>Package Catalog · เวอร์ชันราคาและโควตา</h1>
   <p>สร้างเวอร์ชันข้อเสนอใหม่และกำหนดวันเริ่มใช้ โดยไม่แก้แพ็กเกจกลางหรือสัญญาลูกค้าปัจจุบัน</p></header>
  {error?<p role="alert" style={{color:"#b42318"}}>{error}</p>:null}
  {message?<p role="status" style={{color:"#166534"}}>{message}</p>:null}
  <section style={{...bg,display:"grid",gap:14}}>
   <h2>สร้าง Draft เวอร์ชันใหม่</h2>
   <label>เลือกแพ็กเกจมาตรฐาน
    <select style={{display:"block",padding:10,width:"100%",marginTop:5}} value={selected} onChange={e=>select(e.target.value)}>
     <option value="">เลือกแพ็กเกจ</option>{plans.map(p=><option key={p.id} value={p.id}>{p.name} ({p.code})</option>)}
    </select></label>
   <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))",gap:12}}>
    {field("ราคารายเดือน (บาท)",monthly,setMonthly)}{field("ราคารายปี (บาท / เว้นว่างได้)",yearly,setYearly)}
    {field("สาขา",branches,setBranches)}{field("เครื่อง POS",devices,setDevices)}{field("ผู้ใช้",users,setUsers)}
    {field("เก็บยอดขาย (เดือน)",retention,setRetention)}
    <label style={{display:"grid",gap:5}}>วันเริ่มมีผลที่เสนอ<input type="datetime-local" style={{padding:10}} value={effectiveAt} onChange={e=>setEffectiveAt(e.target.value)}/></label>
   </div>
   <label>เหตุผล / หมายเหตุการเปลี่ยนแพ็กเกจ<textarea style={{display:"block",width:"100%",padding:10,minHeight:70}} value={reason} onChange={e=>setReason(e.target.value)}/></label>
   <button disabled={busy||!selected||!effectiveAt||reason.trim().length<5} style={{padding:13,border:0,borderRadius:8,color:"white",background:"#2458a8",cursor:"pointer"}}
    onClick={()=>void perform({action:"draft",package_id:selected,monthly_price:Number(monthly),yearly_price:yearly===""?null:Number(yearly),
     max_branches:Number(branches),max_devices:Number(devices),max_users:Number(users),retention_months:Number(retention),
     effective_at:new Date(effectiveAt).toISOString(),reason})}>บันทึก Draft ราคา/โควตาใหม่</button>
   <small>การกดอนุมัติเวอร์ชันเป็นการรับรองข้อเสนอเท่านั้น ไม่ได้เผยแพร่ราคาใหม่หรือเปลี่ยนสัญญาจริงโดยอัตโนมัติ</small>
  </section>
  <section style={bg}><h2>ประวัติเวอร์ชัน</h2>
   <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",textAlign:"left"}}>
   <thead><tr><th>แพ็กเกจ</th><th>เวอร์ชัน</th><th>ราคา / เดือน</th><th>ราคา / ปี</th><th>วันเสนอมีผล</th><th>สถานะ</th><th>จัดการ</th></tr></thead>
   <tbody>{versions.map(v=><tr key={v.id} style={{borderTop:"1px solid #e2e8f0"}}>
    <td>{plans.find(p=>p.id===v.package_id)?.name??v.package_id.slice(0,8)}</td><td>v{v.version_no}</td>
    <td>{String(v.proposed_terms.monthly_price??"—")}</td><td>{String(v.proposed_terms.yearly_price??"—")}</td>
    <td>{new Date(v.effective_at).toLocaleString("th-TH")}</td><td>{v.state}</td>
    <td>{v.state==="draft"?<div style={{display:"flex",gap:6}}>
     <button disabled={busy} onClick={()=>{if(window.confirm("รับรองเวอร์ชันนี้? ยังไม่อัปเดตราคา Production"))void perform({action:"approve",id:v.id});}}>อนุมัติข้อเสนอ</button>
     <button disabled={busy} onClick={()=>{if(window.confirm("ยกเลิกเวอร์ชันนี้?"))void perform({action:"retire",id:v.id});}}>ยกเลิก</button>
    </div>:"—"}</td>
   </tr>)}{versions.length===0?<tr><td colSpan={7}>ยังไม่มีเวอร์ชันใหม่</td></tr>:null}</tbody></table></div>
  </section>
 </main>;
}
