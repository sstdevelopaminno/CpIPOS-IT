"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Row={
  id:string;tenant_id:string;branch_id:string;user_id:string;title:string;document_type:string;
  file_name:string;mime_type:string;size_bytes:number;created_at:string;expires_at:string|null;
  store_code:string;store_name:string;
};
type Payload={rows:Row[];summary:{files:number;total_bytes:number;stores:number};by_tenant:Array<{tenant_id:string;store_code:string;store_name:string;files:number;size_bytes:number}>};
type Envelope<T>={data?:T|null;error?:{message?:string}|null};

function bytes(value:number){
  if(value<1024) return `${value} B`;
  if(value<1024*1024) return `${(value/1024).toFixed(1)} KB`;
  return `${(value/1024/1024).toFixed(1)} MB`;
}
function dt(value:string|null){if(!value)return"—";const d=new Date(value);return Number.isNaN(d.getTime())?"—":d.toLocaleString("th-TH",{dateStyle:"medium",timeStyle:"short"});}

export function CpiPosAiDocumentsConsole(){
  const [data,setData]=useState<Payload|null>(null);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState("");
  const [query,setQuery]=useState("");
  const [error,setError]=useState("");

  const load=useCallback(async()=>{
    setLoading(true);setError("");
    try{
      const response=await fetch("/api/it-admin/v1/cpipos-ai/documents",{cache:"no-store",credentials:"include"});
      const body=(await response.json().catch(()=>null)) as Envelope<Payload>|null;
      if(!response.ok||!body?.data) throw new Error(body?.error?.message??"โหลดเอกสาร AI ไม่สำเร็จ");
      setData(body.data);
    }catch(e){setError(e instanceof Error?e.message:"โหลดเอกสาร AI ไม่สำเร็จ");}
    finally{setLoading(false);}
  },[]);
  useEffect(()=>{void load();},[load]);

  const rows=useMemo(()=>{
    const needle=query.trim().toLowerCase();
    if(!needle) return data?.rows??[];
    return (data?.rows??[]).filter((row)=>[row.title,row.store_code,row.store_name,row.document_type,row.tenant_id].some((v)=>String(v).toLowerCase().includes(needle)));
  },[data?.rows,query]);

  async function remove(row:Row){
    if(busy||!window.confirm(`ลบเอกสาร “${row.title}” ของ ${row.store_name} หรือไม่?\n\nไฟล์จะถูกลบออกจากพื้นที่จัดเก็บถาวร`))return;
    setBusy(row.id);setError("");
    try{
      const response=await fetch(`/api/it-admin/v1/cpipos-ai/documents/${encodeURIComponent(row.id)}`,{method:"DELETE",credentials:"include"});
      const body=(await response.json().catch(()=>null)) as Envelope<unknown>|null;
      if(!response.ok) throw new Error(body?.error?.message??"ลบเอกสารไม่สำเร็จ");
      await load();
    }catch(e){setError(e instanceof Error?e.message:"ลบเอกสารไม่สำเร็จ");}
    finally{setBusy("");}
  }

  return <div style={{padding:24}}>
    <header style={{display:"flex",justifyContent:"space-between",gap:16,alignItems:"flex-start"}}>
      <div>
        <div style={{fontSize:12,fontWeight:800,color:"#2563eb",letterSpacing:1.2}}>CPIPOS AI · DOCUMENT STORAGE</div>
        <h2 style={{fontSize:28,margin:"6px 0 4px"}}>เก็บไฟล์เอกสาร AI</h2>
        <p style={{margin:0,color:"#64748b"}}>ตรวจสอบไฟล์ที่สร้างจาก CpiPOS AI แยกตามร้าน พร้อมพื้นที่ใช้งานและวันหมดอายุ</p>
      </div>
      <button onClick={()=>void load()} style={{border:"1px solid #dbe3ef",borderRadius:10,padding:"10px 14px",background:"#fff",fontWeight:700}}>รีเฟรช</button>
    </header>

    <section style={{display:"grid",gridTemplateColumns:"repeat(3,minmax(0,1fr))",gap:12,marginTop:20}}>
      <article style={{border:"1px solid #e2e8f0",borderRadius:14,padding:16,background:"#fff"}}><span style={{color:"#64748b",fontSize:12}}>ร้านที่มีเอกสาร</span><strong style={{display:"block",fontSize:28,marginTop:6}}>{loading?"—":data?.summary.stores??0}</strong></article>
      <article style={{border:"1px solid #e2e8f0",borderRadius:14,padding:16,background:"#fff"}}><span style={{color:"#64748b",fontSize:12}}>ไฟล์ทั้งหมด</span><strong style={{display:"block",fontSize:28,marginTop:6}}>{loading?"—":data?.summary.files??0}</strong></article>
      <article style={{border:"1px solid #e2e8f0",borderRadius:14,padding:16,background:"#fff"}}><span style={{color:"#64748b",fontSize:12}}>พื้นที่รวม</span><strong style={{display:"block",fontSize:28,marginTop:6}}>{loading?"—":bytes(data?.summary.total_bytes??0)}</strong></article>
    </section>

    {error?<div style={{marginTop:16,padding:12,borderRadius:10,background:"#fef2f2",color:"#b91c1c",fontWeight:700}}>{error}</div>:null}

    <section style={{marginTop:18,border:"1px solid #e2e8f0",borderRadius:16,background:"#fff",overflow:"hidden"}}>
      <div style={{padding:16,borderBottom:"1px solid #e2e8f0",display:"flex",gap:12,alignItems:"center"}}>
        <input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="ค้นหาร้าน เอกสาร Tenant ID" style={{flex:1,border:"1px solid #dbe3ef",borderRadius:10,padding:"10px 12px"}}/>
        <span style={{fontSize:12,color:"#64748b"}}>{rows.length} รายการ</span>
      </div>
      <div style={{overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",minWidth:1000}}>
          <thead><tr style={{background:"#f8fafc",textAlign:"left",fontSize:12,color:"#64748b"}}><th style={{padding:12}}>ร้าน</th><th>เอกสาร</th><th>ประเภท</th><th>ขนาด</th><th>สร้างเมื่อ</th><th>หมดอายุ</th><th /></tr></thead>
          <tbody>{loading?<tr><td colSpan={7} style={{padding:28,textAlign:"center",color:"#94a3b8"}}>กำลังโหลด…</td></tr>:
            rows.length?rows.map((row)=><tr key={row.id} style={{borderTop:"1px solid #f1f5f9",fontSize:13}}>
              <td style={{padding:12}}><strong>{row.store_name}</strong><div style={{color:"#94a3b8",fontSize:11}}>{row.store_code}</div></td>
              <td><strong>{row.title}</strong><div style={{color:"#94a3b8",fontSize:11}}>{row.file_name}</div></td>
              <td>{row.document_type}</td><td>{bytes(Number(row.size_bytes??0))}</td><td>{dt(row.created_at)}</td><td>{dt(row.expires_at)}</td>
              <td style={{textAlign:"right",paddingRight:12}}><button disabled={busy===row.id} onClick={()=>void remove(row)} style={{border:"1px solid #fecaca",color:"#b91c1c",background:"#fff",borderRadius:8,padding:"7px 10px",fontWeight:700}}>ลบ</button></td>
            </tr>):<tr><td colSpan={7} style={{padding:32,textAlign:"center",color:"#94a3b8"}}>ยังไม่มีเอกสาร AI</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  </div>;
}
