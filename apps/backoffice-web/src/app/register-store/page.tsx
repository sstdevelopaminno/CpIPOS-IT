"use client";

import { useEffect, useState } from "react";
import styles from "./register-store.module.css";

type Package = { id: string; code: string; name: string; monthly_price: number; max_branches: number; max_devices: number };
type SalesModes = { takeaway: boolean; dine_in: boolean; general_sale: boolean };
const labels: Array<{key:keyof SalesModes;label:string;description:string}> = [
  {key:"takeaway",label:"ขายกลับบ้าน",description:"รับออเดอร์ / สั่งกลับบ้าน"},
  {key:"dine_in",label:"นั่งโต๊ะ",description:"เปิดโต๊ะและคิดเงิน"},
  {key:"general_sale",label:"ร้านชำ / ขายทั่วไป",description:"บาร์โค้ด / SKU / ร้านค้าปลีก"}
];
const formatPrice = (n:number) => new Intl.NumberFormat("th-TH", { style:"currency",currency:"THB",maximumFractionDigits:0 }).format(n);
export default function RegisterStorePage() {
  const [packages,setPackages]=useState<Package[]>([]);
  const [loading,setLoading]=useState(true);
  const [packageId,setPackageId]=useState("");
  const [modes,setModes]=useState<SalesModes>({takeaway:true,dine_in:false,general_sale:false});
  const [storeName,setStoreName]=useState("");
  const [businessType,setBusinessType]=useState("");
  const [ownerName,setOwnerName]=useState("");
  const [ownerPhone,setOwnerPhone]=useState("");
  const [ownerEmail,setOwnerEmail]=useState("");
  const [consent,setConsent]=useState(false);
  const [honeypot,setHoneypot]=useState("");
  const [startedAt]=useState(() => Date.now());
  const [submissionKey,setSubmissionKey]=useState(() => globalThis.crypto.randomUUID());
  const [submitting,setSubmitting]=useState(false);
  const [done,setDone]=useState(false);
  const [error,setError]=useState("");
  useEffect(() => {
    const controller=new AbortController();
    fetch("/api/store-registration",{cache:"no-store",signal:controller.signal}).then(async r=>{
      if(!r.ok)throw new Error("โหลดแพ็กเกจไม่สำเร็จ");
      return r.json() as Promise<{packages:Package[]}>;
    }).then(d=>{setPackages(d.packages);setPackageId(d.packages[0]?.id??"");})
      .catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:"โหลดแพ็กเกจไม่สำเร็จ");})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[]);
  async function submit(e:React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if(submitting||!Object.values(modes).some(Boolean)) {setError("กรุณาเลือกโหมดขายอย่างน้อยหนึ่งรายการ");return;}
    setSubmitting(true);setError("");
    try {
      const response=await fetch("/api/store-registration",{method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({submission_key:submissionKey,store_name:storeName,business_type:businessType,
          owner_name:ownerName,owner_phone:ownerPhone,owner_email:ownerEmail,
          package_id:packageId,sales_modes:modes,consent,website:honeypot,started_at:startedAt})});
      const payload=await response.json().catch(()=>null) as {error?:string;id?:string}|null;
      if(!response.ok)throw new Error(payload?.error??"บันทึกคำขอไม่สำเร็จ");
      setDone(true);setSubmissionKey(globalThis.crypto.randomUUID());
    }catch(e){setError(e instanceof Error?e.message:"ส่งคำขอไม่สำเร็จ");}
    finally{setSubmitting(false);}
  }
  return <main className={styles.screen}>
    <div className={styles.wrapper}>
      <header className={styles.header}>
        <span className={styles.mark}>CP</span>
        <span>CpiPOS · รับสมัครร้านค้า</span>
        <span className={styles.badge}>ทดลองใช้ฟรี 7 วัน</span>
      </header>
      {done?<section className={styles.success}>
        <span className={styles.check}>✓</span><h1>ได้รับคำขอของคุณแล้ว</h1>
        <p>ทีมงานจะตรวจสอบข้อมูลและเปิดร้านทดลองใช้ 7 วันเมื่ออนุมัติ โดยจะแจ้งรหัสร้านและขั้นตอนเข้าใช้งานให้ทราบ</p>
        <p>ยังไม่มีการเปิดร้านหรือเริ่มนับวันทดลองจนกว่าผู้ดูแลจะยืนยันเปิดใช้งาน</p>
        <button onClick={()=>{setDone(false);setStoreName("");setOwnerName("");setOwnerPhone("");setOwnerEmail("");setConsent(false);}}>ส่งคำขอใหม่</button>
      </section>:<div className={styles.grid}>
      <aside className={styles.intro}><span className={styles.eyebrow}>CPIPOS STORE ONBOARDING</span>
        <h1>เริ่มต้นร้านค้าของคุณ<br/>กับ CpiPOS</h1>
        <p>กรอกข้อมูลร้านค้าเพื่อขอเปิดใช้งานระบบ POS พร้อมโหมดขายที่เหมาะกับธุรกิจของคุณ</p>
        <div className={styles.benefits}><span>✓ เลือกแพ็กเกจและโหมดขายได้</span><span>✓ ทดลองใช้ฟรี 7 วันหลังได้รับอนุมัติ</span>
          <span>✓ ทีมงานสร้างสาขาหลักและแนะนำการเชื่อมต่อเครื่องขาย</span></div>
        <div className={styles.caution}>เพื่อความปลอดภัย ระบบจะไม่ขอรหัสผ่านหรือ PIN ของคุณในแบบฟอร์มสาธารณะ ผู้ดูแลจะดำเนินการตั้งค่าให้ภายหลังผ่านช่องทางที่ยืนยันตัวตน</div>
      </aside>
      <form className={styles.form} onSubmit={(e)=>void submit(e)}>
        <div className={styles.formHead}><span>ลงทะเบียนขอเปิดร้าน</span><h2>ข้อมูลร้านค้าและเจ้าของร้าน</h2><p>ข้อมูลที่ส่งจะปรากฏใน IT Control Plane เพื่อรออนุมัติ</p></div>
        <div className={styles.fields}>
          <label>ชื่อร้านค้า <input required minLength={2} maxLength={180} value={storeName} onChange={e=>setStoreName(e.target.value)} placeholder="ชื่อร้านที่ต้องการแสดงใน POS"/></label>
          <label>ประเภทร้านค้า <select required value={businessType} onChange={e=>setBusinessType(e.target.value)}>
            <option value="">เลือกประเภทร้าน</option><option>ร้านอาหาร</option><option>ร้านกาแฟ / เครื่องดื่ม</option>
            <option>ร้านชำ / มินิมาร์ท</option><option>ร้านค้าปลีก</option><option>ธุรกิจบริการ</option><option>อื่น ๆ</option>
          </select></label>
          <label>ชื่อเจ้าของร้าน <input required minLength={2} maxLength={180} value={ownerName} onChange={e=>setOwnerName(e.target.value)} /></label>
          <label>เบอร์ติดต่อ <input required type="tel" inputMode="tel" minLength={8} maxLength={40} value={ownerPhone} onChange={e=>setOwnerPhone(e.target.value)} /></label>
          <label className={styles.wide}>อีเมลเจ้าของร้าน (สำหรับบัญชีเข้าใช้ระบบ) <input required type="email" maxLength={254} autoComplete="email" value={ownerEmail} onChange={e=>setOwnerEmail(e.target.value)}/></label>
        </div>
        <div className={styles.group}><h3>เลือกแพ็กเกจ</h3>
          <select required disabled={loading} value={packageId} onChange={e=>setPackageId(e.target.value)}>
            {packages.map(p=><option key={p.id} value={p.id}>{p.name} · {formatPrice(p.monthly_price)}/เดือน หลังทดลอง · {p.max_branches} สาขา · {p.max_devices} เครื่อง</option>)}
          </select><small>ไม่มีการเรียกเก็บเงินจากแบบฟอร์มนี้ การเปิดใช้งานแบบชำระเงินต้องผ่านขั้นตอนอนุมัติแยกต่างหาก</small>
        </div>
        <fieldset className={styles.group}><legend>เลือกโหมดขาย (เลือกได้หลายแบบ)</legend><div className={styles.modeGrid}>
          {labels.map(l=><label key={l.key} className={styles.mode}>
            <input type="checkbox" checked={modes[l.key]} onChange={e=>setModes(v=>({...v,[l.key]:e.target.checked}))}/>
            <span><strong>{l.label}</strong><small>{l.description}</small></span>
          </label>)}</div></fieldset>
        <label className={styles.consent}><input required type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>
          ยินยอมให้ CpiPOS เก็บข้อมูลที่กรอกเพื่อพิจารณาเปิดร้านและติดต่อกลับ</label>
        <div className={styles.hidden} aria-hidden="true"><label>Website<input tabIndex={-1} autoComplete="off" value={honeypot} onChange={e=>setHoneypot(e.target.value)}/></label></div>
        {error?<p role="alert" className={styles.error}>{error}</p>:null}
        <button type="submit" disabled={loading||submitting||!packageId}>{submitting?"กำลังส่งคำขอ…":"ส่งคำขอเปิดร้าน →"}</button>
        <p className={styles.note}>การส่งคำขอไม่ใช่การเปิดร้านทันที ทีมงานจะตรวจสอบก่อนสร้างรหัสร้านและบัญชี Owner</p>
      </form></div>}
    </div>
  </main>;
}
