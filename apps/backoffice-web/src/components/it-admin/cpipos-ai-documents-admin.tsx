"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./cpipos-ai-admin-console.module.css";

type Row = {
  tenant_id: string;
  store_code: string;
  name: string;
  active: boolean;
  package_code: string | null;
  package_name: string | null;
  contract_status: string | null;
  policy: { storage_limit_mb: number | null; retention_days: number | null; max_file_mb: number | null };
  usage: { count: number; bytes: number; last_document_at: string | null };
};
type Payload = { generated_at: string; rows: Row[] };
type Envelope<T> = { data?: T | null; error?: { message?: string } | null };

function fmt(value: unknown) {
  return new Intl.NumberFormat("th-TH").format(Number(value ?? 0));
}
function mb(bytes: unknown) {
  return (Number(bytes ?? 0) / 1024 / 1024).toFixed(2);
}
function dt(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("th-TH",{dateStyle:"medium",timeStyle:"short"});
}

export function CpiPosAiDocumentsAdmin() {
  const [data,setData] = useState<Payload | null>(null);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState("");
  const [query,setQuery] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/it-admin/v1/cpipos-ai/documents",{cache:"no-store",credentials:"include"});
      const body = (await response.json().catch(() => null)) as Envelope<Payload> | null;
      if (!response.ok || !body?.data) throw new Error(body?.error?.message ?? "โหลดข้อมูลเอกสาร AI ไม่สำเร็จ");
      setData(body.data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "โหลดข้อมูลเอกสาร AI ไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  },[]);

  useEffect(() => { void load(); },[load]);

  const rows = useMemo(() => {
    const needle=query.trim().toLowerCase();
    if (!needle) return data?.rows ?? [];
    return (data?.rows ?? []).filter((row) =>
      [row.name,row.store_code,row.package_name,row.tenant_id].filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle)));
  },[data?.rows,query]);

  const totals = useMemo(() => (data?.rows ?? []).reduce((acc,row) => ({
    files: acc.files + row.usage.count,
    bytes: acc.bytes + row.usage.bytes,
    stores: acc.stores + (row.usage.count > 0 ? 1 : 0)
  }),{files:0,bytes:0,stores:0}),[data?.rows]);

  return <div className={styles.page}>
    <header className={styles.header}>
      <div>
        <div className={styles.eyebrow}>AI DOCUMENT STORAGE</div>
        <h2>ไฟล์เอกสาร CpiPOS AI</h2>
        <p>ตรวจพื้นที่เอกสารตามร้านและแพ็กเกจ ไฟล์จริงอยู่ใน Private Storage ส่วนฐานข้อมูลเก็บเฉพาะ metadata</p>
      </div>
      <div className={styles.headerActions}>
        <Link className={styles.secondaryButton} href="/it-admin/cpipos-ai">AI / Quota</Link>
        <button type="button" className={styles.primaryButton} onClick={() => void load()} disabled={loading}>{loading ? "กำลังรีเฟรช…" : "รีเฟรช"}</button>
      </div>
    </header>

    <section className={styles.summaryGrid}>
      <article><span>ร้านที่มีเอกสาร</span><strong>{fmt(totals.stores)}</strong><small>ร้าน</small></article>
      <article><span>เอกสารทั้งหมด</span><strong>{fmt(totals.files)}</strong><small>ไฟล์</small></article>
      <article><span>พื้นที่ใช้งานรวม</span><strong>{mb(totals.bytes)}</strong><small>MB</small></article>
    </section>

    {error ? <div className={styles.error} role="alert">{error}</div> : null}

    <section className={styles.panel}>
      <div className={styles.toolbar}>
        <div><span className={styles.eyebrow}>DOCUMENT VAULTS</span><h3>พื้นที่เอกสารแต่ละร้าน</h3></div>
        <input value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="ค้นหาร้าน, Store Code, Package, Tenant ID" />
      </div>
      <div className={styles.tableWrap}><table>
        <thead><tr><th>ร้าน</th><th>แพ็กเกจ</th><th>เอกสาร</th><th>ใช้พื้นที่</th><th>โควตา</th><th>Retention</th><th>ไฟล์ล่าสุด</th><th /></tr></thead>
        <tbody>
          {loading ? <tr><td colSpan={8} className={styles.empty}>กำลังโหลด…</td></tr> :
           rows.length === 0 ? <tr><td colSpan={8} className={styles.empty}>ยังไม่มีข้อมูลเอกสาร AI</td></tr> :
           rows.map((row) => <tr key={row.tenant_id}>
             <td><div className={styles.storeCell}><strong>{row.name}</strong><span>{row.store_code} · {row.tenant_id}</span></div></td>
             <td><strong>{row.package_name ?? "—"}</strong><small className={styles.muted}>{row.contract_status ?? "—"}</small></td>
             <td>{fmt(row.usage.count)}</td>
             <td>{mb(row.usage.bytes)} MB</td>
             <td>{row.policy.storage_limit_mb ? `${fmt(row.policy.storage_limit_mb)} MB` : "ตามสัญญา / ยังไม่เปิด"}</td>
             <td>{row.policy.retention_days ? `${fmt(row.policy.retention_days)} วัน` : "ตามสัญญา"}</td>
             <td>{dt(row.usage.last_document_at)}</td>
             <td><Link className={styles.detailButton} href={`/it-admin/cpipos-ai/${encodeURIComponent(row.tenant_id)}`}>จัดการร้าน</Link></td>
           </tr>)}
        </tbody>
      </table></div>
    </section>
  </div>;
}
