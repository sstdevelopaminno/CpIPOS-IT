"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./cpipos-ai-document-admin-console.module.css";

type PackagePolicy = {
  package_id: string;
  is_enabled: boolean;
  retention_days: number | null;
  storage_limit_mb: number | null;
  max_files: number | null;
};

type PackageRow = {
  id: string;
  code: string;
  name: string;
  monthly_price: number | string;
  policy: PackagePolicy;
};

type StoreRow = {
  tenant_id: string;
  store_code: string;
  name: string;
  package_id: string | null;
  is_active: boolean;
  file_count: number;
  total_bytes: number;
  storage_mb: number;
  last_created_at: string | null;
};

type Payload = { generated_at: string; packages: PackageRow[]; stores: StoreRow[] };
type Envelope<T> = { data?: T | null; error?: { message?: string } | null };

function inputValue(value: number | null | undefined) { return value == null ? "" : String(value); }
function fmt(value: unknown) { return new Intl.NumberFormat("th-TH").format(Number(value ?? 0)); }

export function CpiPosAiDocumentAdminConsole() {
  const [data,setData]=useState<Payload|null>(null);
  const [drafts,setDrafts]=useState<Record<string,{is_enabled:boolean;retention_days:string;storage_limit_mb:string;max_files:string}>>({});
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState<string|null>(null);
  const [clearing,setClearing]=useState<string|null>(null);
  const [query,setQuery]=useState("");
  const [error,setError]=useState("");

  const load=useCallback(async()=>{
    setLoading(true); setError("");
    try{
      const response=await fetch("/api/it-admin/v1/cpipos-ai/documents",{cache:"no-store",credentials:"include"});
      const body=(await response.json().catch(()=>null)) as Envelope<Payload>|null;
      if(!response.ok||!body?.data) throw new Error(body?.error?.message??"โหลดข้อมูลเอกสาร AI ไม่สำเร็จ");
      setData(body.data);
      setDrafts(Object.fromEntries(body.data.packages.map(pkg=>[pkg.id,{
        is_enabled:pkg.policy.is_enabled!==false,
        retention_days:inputValue(pkg.policy.retention_days),
        storage_limit_mb:inputValue(pkg.policy.storage_limit_mb),
        max_files:inputValue(pkg.policy.max_files)
      }])));
    }catch(e){setError(e instanceof Error?e.message:"โหลดข้อมูลเอกสาร AI ไม่สำเร็จ");}
    finally{setLoading(false);}
  },[]);

  useEffect(()=>{void load();},[load]);

  const packageName=useMemo(()=>new Map((data?.packages??[]).map(row=>[row.id,row.name])),[data?.packages]);
  const stores=useMemo(()=>{
    const needle=query.trim().toLowerCase();
    if(!needle) return data?.stores??[];
    return (data?.stores??[]).filter(row=>[row.name,row.store_code,row.tenant_id,packageName.get(row.package_id??"")].filter(Boolean).some(v=>String(v).toLowerCase().includes(needle)));
  },[data?.stores,query,packageName]);

  async function savePackage(pkg:PackageRow){
    const draft=drafts[pkg.id]; if(!draft||saving) return;
    setSaving(pkg.id); setError("");
    try{
      const response=await fetch(`/api/it-admin/v1/cpipos-ai/documents/packages/${encodeURIComponent(pkg.id)}`,{
        method:"PATCH",credentials:"include",headers:{"content-type":"application/json"},
        body:JSON.stringify({
          is_enabled:draft.is_enabled,
          retention_days:draft.retention_days||null,
          storage_limit_mb:draft.storage_limit_mb||null,
          max_files:draft.max_files||null
        })
      });
      const body=(await response.json().catch(()=>null)) as Envelope<unknown>|null;
      if(!response.ok) throw new Error(body?.error?.message??"บันทึกนโยบายไม่สำเร็จ");
      await load();
    }catch(e){setError(e instanceof Error?e.message:"บันทึกนโยบายไม่สำเร็จ");}
    finally{setSaving(null);}
  }

  async function clearTenant(row:StoreRow){
    if(!window.confirm(`ลบไฟล์เอกสาร AI ทั้งหมดของร้าน “${row.name}” หรือไม่?\nไฟล์ในพื้นที่จัดเก็บจะถูกลบจริง และรายการนี้ย้อนกลับไม่ได้`)) return;
    setClearing(row.tenant_id); setError("");
    try{
      const response=await fetch(`/api/it-admin/v1/cpipos-ai/documents/tenants/${encodeURIComponent(row.tenant_id)}`,{method:"DELETE",credentials:"include"});
      const body=(await response.json().catch(()=>null)) as Envelope<{cleared_files?:number}>|null;
      if(!response.ok) throw new Error(body?.error?.message??"ล้างไฟล์ไม่สำเร็จ");
      await load();
    }catch(e){setError(e instanceof Error?e.message:"ล้างไฟล์ไม่สำเร็จ");}
    finally{setClearing(null);}
  }

  const totals=useMemo(()=>({
    files:(data?.stores??[]).reduce((sum,row)=>sum+Number(row.file_count||0),0),
    mb:(data?.stores??[]).reduce((sum,row)=>sum+Number(row.storage_mb||0),0)
  }),[data?.stores]);

  return <div className={styles.page}>
    <header className={styles.header}>
      <div><div className={styles.eyebrow}>CPIPOS AI · DOCUMENT STORAGE</div><h2>ไฟล์เอกสาร AI</h2><p>กำหนดพื้นที่เก็บ ระยะเวลา และตรวจสอบไฟล์ที่ CpiPOS AI สร้างให้แต่ละร้าน โดยไฟล์จริงเก็บใน Object Storage ไม่เก็บเนื้อหาไฟล์ในฐาน PostgreSQL</p></div>
      <button type="button" className={styles.primary} onClick={()=>void load()} disabled={loading}>{loading?"กำลังโหลด…":"รีเฟรช"}</button>
    </header>

    <section className={styles.summary}>
      <article><span>ไฟล์ทั้งหมด</span><strong>{fmt(totals.files)}</strong><small>Metadata + private object storage</small></article>
      <article><span>พื้นที่ใช้งาน</span><strong>{totals.mb.toFixed(2)} MB</strong><small>รวมทุกร้าน</small></article>
      <article><span>แพ็กเกจที่ตั้งค่า</span><strong>{fmt(data?.packages.length??0)}</strong><small>Starter · Growth · Business · CUSTOM</small></article>
    </section>

    {error?<div className={styles.error}>{error}</div>:null}

    <section className={styles.panel}>
      <div className={styles.panelHeader}><div><span className={styles.eyebrow}>PACKAGE POLICY</span><h3>พื้นที่และอายุไฟล์ตามแพ็กเกจ</h3></div><small>เว้นว่าง = IT / สัญญากำหนด · Starter สามารถปิดได้</small></div>
      <div className={styles.packageGrid}>
        {(data?.packages??[]).map(pkg=>{
          const draft=drafts[pkg.id]??{is_enabled:false,retention_days:"",storage_limit_mb:"",max_files:""};
          return <article key={pkg.id} className={styles.card}>
            <div className={styles.cardTitle}><div><strong>{pkg.name}</strong><span>{pkg.code}</span></div><label><input type="checkbox" checked={draft.is_enabled} onChange={e=>setDrafts(cur=>({...cur,[pkg.id]:{...draft,is_enabled:e.target.checked}}))}/><span>{draft.is_enabled?"เปิด":"ปิด"}</span></label></div>
            <div className={styles.formGrid}>
              <label><span>เก็บไฟล์ (วัน)</span><input inputMode="numeric" placeholder="ตามสัญญา" value={draft.retention_days} onChange={e=>setDrafts(cur=>({...cur,[pkg.id]:{...draft,retention_days:e.target.value.replace(/[^0-9]/g,"")}}))}/></label>
              <label><span>พื้นที่ (MB)</span><input inputMode="numeric" placeholder="ไม่จำกัด" value={draft.storage_limit_mb} onChange={e=>setDrafts(cur=>({...cur,[pkg.id]:{...draft,storage_limit_mb:e.target.value.replace(/[^0-9]/g,"")}}))}/></label>
              <label><span>จำนวนไฟล์สูงสุด</span><input inputMode="numeric" placeholder="ไม่จำกัด" value={draft.max_files} onChange={e=>setDrafts(cur=>({...cur,[pkg.id]:{...draft,max_files:e.target.value.replace(/[^0-9]/g,"")}}))}/></label>
            </div>
            <button type="button" className={styles.secondary} disabled={saving!==null} onClick={()=>void savePackage(pkg)}>{saving===pkg.id?"กำลังบันทึก…":"บันทึกนโยบาย"}</button>
          </article>;
        })}
      </div>
    </section>

    <section className={styles.panel}>
      <div className={styles.toolbar}><div><span className={styles.eyebrow}>STORE USAGE</span><h3>การใช้พื้นที่เอกสารรายร้าน</h3></div><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="ค้นหาร้าน, Store Code, Tenant ID"/></div>
      <div className={styles.tableWrap}><table><thead><tr><th>ร้านค้า</th><th>แพ็กเกจ</th><th>ไฟล์</th><th>พื้นที่</th><th>ล่าสุด</th><th /></tr></thead><tbody>
        {loading?<tr><td colSpan={6} className={styles.empty}>กำลังโหลด…</td></tr>:stores.length===0?<tr><td colSpan={6} className={styles.empty}>ยังไม่มีไฟล์เอกสาร AI</td></tr>:stores.map(row=><tr key={row.tenant_id}>
          <td><strong>{row.name}</strong><small>{row.store_code} · {row.tenant_id}</small></td>
          <td>{packageName.get(row.package_id??"")??"—"}</td><td>{fmt(row.file_count)}</td><td>{row.storage_mb.toFixed(3)} MB</td>
          <td>{row.last_created_at?new Date(row.last_created_at).toLocaleString("th-TH"):"—"}</td>
          <td><button type="button" className={styles.danger} disabled={clearing!==null||row.file_count===0} onClick={()=>void clearTenant(row)}>{clearing===row.tenant_id?"กำลังลบ…":"ล้างไฟล์ร้านนี้"}</button></td>
        </tr>)}
      </tbody></table></div>
    </section>
  </div>;
}
