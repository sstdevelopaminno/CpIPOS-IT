"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { isCrmMenuEnabled, type CrmMenuDefinition } from "@/lib/crm-menu-policy";
import styles from "./tenant-pos-menu-policies.module.css";

type Payload={catalog:CrmMenuDefinition[];overrides:Record<string,boolean>;total:number};
type Envelope<T>={data?:T|null;error?:{message?:string}|null};

/** Independent CRM switches inside the existing tenant management card workflow. */
export function TenantCrmMenuPolicies({tenantId,storeName,mode="menus"}:{tenantId:string;storeName:string;mode?:"menus"|"access"}){
  const [data,setData]=useState<Payload|null>(null);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState<string|null>(null);
  const [error,setError]=useState("");
  const [success,setSuccess]=useState("");
  const endpoint=`/api/it-admin/v1/tenants/${encodeURIComponent(tenantId)}/crm-menu-policies`;
  const refresh=useCallback(async()=>{
    setLoading(true);
    try{
      const result=await fetch(endpoint,{cache:"no-store",credentials:"include"});
      const payload=await result.json() as Envelope<Payload>;
      if(!result.ok||!payload.data)throw new Error(payload.error?.message??"ไม่สามารถอ่านสวิตช์เมนู CRM ได้");
      setData(payload.data);setError("");
    }catch(e){setData(null);setError(e instanceof Error?e.message:"ไม่สามารถโหลดเมนู CRM ได้");}
    finally{setLoading(false);}
  },[endpoint]);
  useEffect(()=>{void refresh();},[refresh]);
  const main=useMemo(()=>data?.catalog.filter(menu=>menu.group==="main")??[],[data]);
  const opticalApi=useMemo(()=>data?.catalog.filter(menu=>menu.group==="optical_api")??[],[data]);
  const crmAccess=useMemo(()=>data?.catalog.filter(menu=>menu.group==="crm_access")??[],[data]);
  const children=useMemo(()=>new Map(main.map(parent=>[
    parent.key, data?.catalog.filter(menu=>menu.parent===parent.key)??[]
  ])),[main,data]);
  async function toggle(item:CrmMenuDefinition){
    if(!data||busy)return;
    // A disabled parent must never override or silently rewrite individual child choices.
    const current=item.key==="settings.crm_access_staff"
      ? data.overrides[item.key]===true : data.overrides[item.key]!==false;
    const apiControl=item.group==="optical_api";
    const note=item.group==="crm_access"?"สวิตช์นี้กำหนดเพียงประเภทบัญชีที่แพ็กเกจอนุญาตเข้า CRM ไม่ให้สิทธิ์พนักงานเป็นรายบุคคล เจ้าของร้านต้องกำหนดสิทธิ์เอง":apiControl?"สวิตช์นี้บังคับใช้กับ POS Optical API โดยตรง แต่ไม่เปลี่ยนสิทธิ์แพ็กเกจหรือทำธุรกรรมย้อนหลัง":"เมนู CRM จะถูกซ่อน และเมื่อ Deploy RLS แล้วจะเพิกถอนสิทธิ์ Data API ของ Optical";
    if(!window.confirm(`${current?"ปิด":"เปิด"}${apiControl?"สิทธิ์ API":"เมนู CRM"} "${item.label}" ของร้าน ${storeName}?\n\n${note}`))return;
    setBusy(item.key);setError("");setSuccess("");
    try{
      const response=await fetch(endpoint,{method:"PATCH",credentials:"include",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({menu_key:item.key,is_enabled:!current})});
      const result=await response.json() as Envelope<{is_enabled:boolean}>;
      if(!response.ok||!result.data)throw new Error(result.error?.message??"บันทึกสวิตช์ CRM ไม่สำเร็จ");
      setData(previous=>previous?{...previous,overrides:{...previous.overrides,[item.key]:result.data!.is_enabled}}:previous);
      setSuccess(`บันทึกเมนู CRM "${item.label}" แล้ว`);
    }catch(e){setError(e instanceof Error?e.message:"บันทึกสวิตช์ CRM ไม่สำเร็จ");}
    finally{setBusy(null);}
  }
  function menuRow(item:CrmMenuDefinition,child:boolean){
    const configured=item.key==="settings.crm_access_staff"?data?.overrides[item.key]===true:data?.overrides[item.key]!==false;
    const effective=Boolean(data&&(item.group==="crm_access"?configured:isCrmMenuEnabled(item.key,data.overrides)));
    const parentBlocked=Boolean(item.parent&&!isCrmMenuEnabled(item.parent!,data?.overrides??{}));
    const apiControl=item.group==="optical_api";
    const detail=parentBlocked?"เมนูแม่ถูก IT ปิด":configured?(item.group==="crm_access"?"แพ็กเกจอนุญาตบทบาทนี้ · เจ้าของร้านกำหนดสิทธิ์รายคน":apiControl?"อนุญาต API (ยังต้องผ่านแพ็กเกจ / Role)":"อนุญาตใน CRM"):(item.group==="crm_access"?"ยังไม่อนุญาตบทบาทนี้เข้า CRM":apiControl?"IT ปิด POS Optical API":"IT ปิดเมนู CRM");
    return <div className={child?styles.child:styles.parent} key={item.key}>
      <div className={styles.menuLabel}>
        <strong>{item.label}</strong>
        <small className={effective?styles.available:styles.unavailable}>{detail}</small>
      </div>
      <button type="button" role="switch" aria-checked={effective}
        aria-label={`${item.label}: ${detail}`}
        className={effective?styles.switchOn:styles.switchOff}
        disabled={busy!==null||parentBlocked} onClick={()=>void toggle(item)}>
        <span>{effective?"เปิด":"ปิด"}</span><i aria-hidden/>
      </button>
    </div>;
  }
  return <div className={styles.root}>
    <header className={styles.header}><div>
      <strong>{mode==="access"?"กำหนดประเภทบัญชีที่แพ็กเกจอนุญาตเข้า CRM":"เปิด–ปิดเมนูหลักและเมนูย่อย CRM"}</strong>
      <p>{mode==="access"?"IT กำหนดขอบเขตประเภทบัญชีของแพ็กเกจเท่านั้น · เจ้าของร้านจัดการสิทธิ์พนักงานรายคน":"ควบคุมแยกจาก POS รายร้าน · เมนูแม่ปิดแล้วเมนูลูกจะถูกซ่อน แต่ค่าของเมนูลูกยังคงอยู่"}</p>
    </div><button className={styles.refresh} type="button" disabled={busy!==null} onClick={()=>void refresh()}>รีเฟรช</button></header>
    {error?<p role="alert" className={styles.error}>{error}</p>:null}
    {success?<p role="status" className={styles.success}>{success}</p>:null}
    {loading?<p className={styles.empty}>กำลังโหลดสิทธิ์เมนู CRM…</p>:!data?<p className={styles.empty}>ไม่สามารถยืนยันสิทธิ์เมนูได้</p>:
      mode==="access"?crmAccess.map(item=><section className={styles.group} key={item.key}>{menuRow(item,false)}</section>):main.map(item=><section className={styles.group} key={item.key}>
        {menuRow(item,false)}
        {(children.get(item.key)?.length??0)>0?<div className={styles.children}>
          {children.get(item.key)?.map(child=>menuRow(child,true))}
        </div>:null}
      </section>)}
    {mode==="menus"&&opticalApi.length>0?<section className={styles.group}>
      <strong>ควบคุม API ระบบ Optical เฉพาะร้านนี้ (POS)</strong>
      <p className={styles.note}>เมื่อ IT ปิด ระบบ POS จะปฏิเสธ API นั้นเพิ่มเติมจากเงื่อนไข CUSTOM Optical / Role / กะ / Currency ที่ต้องผ่านอยู่แล้ว</p>
      <div className={styles.children}>{opticalApi.map(item=>menuRow(item,true))}</div>
    </section>:null}
    {mode==="access"?<p className={styles.note}>Staff ปิดโดยค่าเริ่มต้น; เปิดแล้วต้องมีสิทธิ์รายพนักงานที่เจ้าของร้านกำหนด และต้องรอ Backend รองรับการเข้าระบบ Staff ก่อนเปิดใช้งานจริง</p>:<p className={styles.note}>เมนู CRM ที่ไม่มีสวิตช์ยังคงแสดงเพื่อความเข้ากันได้ การปิดเมนู Optical จะเพิกถอนสิทธิ์ฐานข้อมูลหลัง Migration RLS ที่เกี่ยวข้องผ่านการทดสอบและ Deploy แล้ว โดยไม่แก้แพ็กเกจ</p>}
    <p className={styles.note}>รายการที่ใช้ร่วมกับ POS ยังต้องผ่านสิทธิ์แพ็กเกจ IT ของ POS และสิทธิ์ Owner/Manager ตามเดิม</p>
  </div>;
}
