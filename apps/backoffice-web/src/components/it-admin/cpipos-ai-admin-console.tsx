"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./cpipos-ai-admin-console.module.css";

type PackageQuota = {
  package_id: string;
  is_enabled: boolean;
  monthly_request_limit: number | null;
  monthly_token_limit: number | null;
  monthly_cost_limit_usd: number | string | null;
  history_retention_days: number | null;
  document_storage_mb: number | null;
  document_retention_days: number | null;
  document_max_file_mb: number | null;
  updated_at?: string | null;
};

type PackageRow = {
  id: string;
  code: string;
  name: string;
  monthly_price: number | string;
  quota: PackageQuota;
};

type StoreRow = {
  tenant_id: string;
  store_code: string;
  name: string;
  package_code: string | null;
  package_name: string | null;
  contract_status: string | null;
  ai_user_count: number;
  conversation_count: number;
  last_conversation_at: string | null;
  quota: {
    source: string;
    limits: { requests: number | null; tokens: number | null; cost_usd: number | null };
    history_retention_days: number | null;
  };
  usage: { requests: number; users: number; total_tokens: number; cost_usd: number };
  document_usage: { count: number; bytes: number; last_document_at: string | null };
};

type Payload = {
  stores: {
    generated_at: string;
    month: string;
    summary: { stores: number; ai_users: number; requests: number; total_tokens: number; total_cost_usd: number };
    rows: StoreRow[];
  };
  packages: PackageRow[];
};

type Envelope<T> = { data?: T | null; error?: { message?: string } | null };

function fmt(value: unknown) {
  return new Intl.NumberFormat("th-TH").format(Number(value ?? 0));
}

function usd(value: unknown) {
  return "$" + Number(value ?? 0).toFixed(4);
}

function inputValue(value: number | string | null | undefined) {
  return value == null ? "" : String(value);
}

export function CpiPosAiAdminConsole() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [drafts, setDrafts] = useState<Record<string, {
    is_enabled: boolean;
    monthly_request_limit: string;
    monthly_token_limit: string;
    monthly_cost_limit_usd: string;
    history_retention_days: string;
    document_storage_mb: string;
    document_retention_days: string;
    document_max_file_mb: string;
  }>>({});

  const load = useCallback(async (silent = false) => {
    silent ? setRefreshing(true) : setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/it-admin/v1/cpipos-ai", { cache: "no-store", credentials: "include" });
      const body = (await response.json().catch(() => null)) as Envelope<Payload> | null;
      if (!response.ok || !body?.data) throw new Error(body?.error?.message ?? "โหลดข้อมูล CpiPOS AI ไม่สำเร็จ");
      setData(body.data);
      setDrafts(Object.fromEntries(body.data.packages.map((pkg) => [pkg.id, {
        is_enabled: pkg.quota.is_enabled !== false,
        monthly_request_limit: inputValue(pkg.quota.monthly_request_limit),
        monthly_token_limit: inputValue(pkg.quota.monthly_token_limit),
        monthly_cost_limit_usd: inputValue(pkg.quota.monthly_cost_limit_usd),
        history_retention_days: inputValue(pkg.quota.history_retention_days),
        document_storage_mb: inputValue(pkg.quota.document_storage_mb),
        document_retention_days: inputValue(pkg.quota.document_retention_days),
        document_max_file_mb: inputValue(pkg.quota.document_max_file_mb)
      }])));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "โหลดข้อมูล CpiPOS AI ไม่สำเร็จ");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(false); }, [load]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return data?.stores.rows ?? [];
    return (data?.stores.rows ?? []).filter((row) =>
      [row.name, row.store_code, row.package_name, row.package_code, row.tenant_id]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle))
    );
  }, [data?.stores.rows, query]);

  async function savePackage(pkg: PackageRow) {
    const draft = drafts[pkg.id];
    if (!draft || saving) return;
    setSaving(pkg.id);
    setError("");
    try {
      const response = await fetch(`/api/it-admin/v1/cpipos-ai/packages/${encodeURIComponent(pkg.id)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          is_enabled: draft.is_enabled,
          monthly_request_limit: draft.monthly_request_limit || null,
          monthly_token_limit: draft.monthly_token_limit || null,
          monthly_cost_limit_usd: draft.monthly_cost_limit_usd || null,
          history_retention_days: draft.history_retention_days || null,
          document_storage_mb: draft.document_storage_mb || null,
          document_retention_days: draft.document_retention_days || null,
          document_max_file_mb: draft.document_max_file_mb || null
        })
      });
      const body = (await response.json().catch(() => null)) as Envelope<unknown> | null;
      if (!response.ok) throw new Error(body?.error?.message ?? "บันทึก AI Quota ไม่สำเร็จ");
      await load(true);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "บันทึก AI Quota ไม่สำเร็จ");
    } finally {
      setSaving(null);
    }
  }

  const summary = data?.stores.summary;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <div className={styles.eyebrow}>CPIPOS AI · CONTROL & COST</div>
          <h2>CpiPOS AI</h2>
          <p>ติดตามร้านที่เปิดใช้งาน AI, token, ค่าใช้จ่าย, Conversation ID และกำหนด AI Quota ต่อแพ็กเกจ/ต่อร้าน</p>
        </div>
        <button type="button" className={styles.primaryButton} onClick={() => void load(true)} disabled={refreshing}>
          {refreshing ? "กำลังรีเฟรช…" : "รีเฟรช"}
        </button>
      </header>

      <section className={styles.summaryGrid}>
        <article><span>ร้านที่เปิด AI</span><strong>{loading ? "—" : fmt(summary?.stores)}</strong><small>ตาม IT policy + quota</small></article>
        <article><span>ผู้ใช้ AI</span><strong>{loading ? "—" : fmt(summary?.ai_users)}</strong><small>Owner / Manager</small></article>
        <article><span>คำขอเดือนนี้</span><strong>{loading ? "—" : fmt(summary?.requests)}</strong><small>{data?.stores.month ?? "—"}</small></article>
        <article><span>Token เดือนนี้</span><strong>{loading ? "—" : fmt(summary?.total_tokens)}</strong><small>Input + Output</small></article>
        <article><span>ต้นทุน AI เดือนนี้</span><strong>{loading ? "—" : usd(summary?.total_cost_usd)}</strong><small>OpenAI estimated cost</small></article>
      </section>

      {error ? <div className={styles.error} role="alert">{error}</div> : null}

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div><span className={styles.eyebrow}>PACKAGE QUOTA</span><h3>AI Quota ต่อแพ็กเกจ / ต่อเดือน</h3></div>
          <small>เว้นช่องว่าง = ไม่จำกัด · ร้านสามารถ Override ได้ในหน้ารายละเอียด</small>
        </div>
        <div className={styles.packageGrid}>
          {(data?.packages ?? []).map((pkg) => {
            const draft = drafts[pkg.id] ?? { is_enabled: true, monthly_request_limit: "", monthly_token_limit: "", monthly_cost_limit_usd: "", history_retention_days: "", document_storage_mb: "", document_retention_days: "", document_max_file_mb: "" };
            return (
              <article className={styles.packageCard} key={pkg.id}>
                <div className={styles.packageTitle}>
                  <div><strong>{pkg.name}</strong><span>{pkg.code}</span></div>
                  <label className={styles.toggleLabel}>
                    <input type="checkbox" checked={draft.is_enabled}
                      onChange={(event) => setDrafts((current) => ({ ...current, [pkg.id]: { ...draft, is_enabled: event.target.checked } }))} />
                    <span>{draft.is_enabled ? "เปิด AI" : "ปิด AI"}</span>
                  </label>
                </div>
                <div className={styles.formGrid}>
                  <label><span>จำนวนคำขอ / เดือน</span><input inputMode="numeric" value={draft.monthly_request_limit}
                    onChange={(event) => setDrafts((current) => ({ ...current, [pkg.id]: { ...draft, monthly_request_limit: event.target.value.replace(/[^0-9]/g, "") } }))} placeholder="ไม่จำกัด" /></label>
                  <label><span>Token / เดือน</span><input inputMode="numeric" value={draft.monthly_token_limit}
                    onChange={(event) => setDrafts((current) => ({ ...current, [pkg.id]: { ...draft, monthly_token_limit: event.target.value.replace(/[^0-9]/g, "") } }))} placeholder="ไม่จำกัด" /></label>
                  <label><span>เก็บประวัติแชท (วัน)</span><input inputMode="numeric" value={draft.history_retention_days}
                    onChange={(event) => setDrafts((current) => ({ ...current, [pkg.id]: { ...draft, history_retention_days: event.target.value.replace(/[^0-9]/g, "") } }))} placeholder="IT / สัญญากำหนด" /></label>
                  <label><span>พื้นที่เอกสาร AI (MB)</span><input inputMode="numeric" value={draft.document_storage_mb}
                    onChange={(event) => setDrafts((current) => ({ ...current, [pkg.id]: { ...draft, document_storage_mb: event.target.value.replace(/[^0-9]/g, "") } }))} placeholder="ไม่เปิด / ตามสัญญา" /></label>
                  <label><span>เก็บเอกสาร (วัน)</span><input inputMode="numeric" value={draft.document_retention_days}
                    onChange={(event) => setDrafts((current) => ({ ...current, [pkg.id]: { ...draft, document_retention_days: event.target.value.replace(/[^0-9]/g, "") } }))} placeholder="ตามสัญญา" /></label>
                  <label><span>ขนาดไฟล์สูงสุด (MB)</span><input inputMode="numeric" value={draft.document_max_file_mb}
                    onChange={(event) => setDrafts((current) => ({ ...current, [pkg.id]: { ...draft, document_max_file_mb: event.target.value.replace(/[^0-9]/g, "") } }))} placeholder="5" /></label>
                  <label className={styles.span2}><span>งบ AI / เดือน (USD)</span><input inputMode="decimal" value={draft.monthly_cost_limit_usd}
                    onChange={(event) => setDrafts((current) => ({ ...current, [pkg.id]: { ...draft, monthly_cost_limit_usd: event.target.value.replace(/[^0-9.]/g, "") } }))} placeholder="ไม่จำกัด" /></label>
                </div>
                <button type="button" className={styles.secondaryButton} disabled={saving !== null} onClick={() => void savePackage(pkg)}>
                  {saving === pkg.id ? "กำลังบันทึก…" : "บันทึก AI Quota"}
                </button>
              </article>
            );
          })}
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.toolbar}>
          <div><span className={styles.eyebrow}>AI STORES</span><h3>ร้านค้าที่เปิดใช้งาน CpiPOS AI</h3></div>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นหาร้าน, Store Code, Package, Tenant ID" />
        </div>
        <div className={styles.tableWrap}>
          <table>
            <thead><tr><th>ร้านค้า</th><th>แพ็กเกจ</th><th>AI Users</th><th>คำขอเดือนนี้</th><th>Tokens</th><th>ค่าใช้จ่าย</th><th>เอกสาร</th><th>Quota / Retention</th><th /></tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={9} className={styles.empty}>กำลังโหลดข้อมูล…</td></tr> :
               rows.length === 0 ? <tr><td colSpan={9} className={styles.empty}>ยังไม่มีร้านที่เปิดใช้งาน CpiPOS AI</td></tr> :
               rows.map((row) => {
                 const requestLimit = row.quota.limits.requests;
                 const tokenLimit = row.quota.limits.tokens;
                 const costLimit = row.quota.limits.cost_usd;
                 const quotaText = requestLimit ? `${fmt(row.usage.requests)}/${fmt(requestLimit)} ครั้ง`
                   : tokenLimit ? `${fmt(row.usage.total_tokens)}/${fmt(tokenLimit)} tokens`
                   : costLimit ? `${usd(row.usage.cost_usd)}/${usd(costLimit)}`
                   : "ไม่จำกัด";
                 return (
                   <tr key={row.tenant_id}>
                     <td><div className={styles.storeCell}><strong>{row.name}</strong><span>{row.store_code} · {row.tenant_id}</span></div></td>
                     <td><strong>{row.package_name ?? "—"}</strong><small className={styles.muted}>{row.contract_status ?? "—"}</small></td>
                     <td>{fmt(row.ai_user_count)}<small className={styles.muted}>{fmt(row.conversation_count)} conversations</small></td>
                     <td>{fmt(row.usage.requests)}</td>
                     <td>{fmt(row.usage.total_tokens)}</td>
                     <td>{usd(row.usage.cost_usd)}</td>
                     <td>{fmt(row.document_usage.count)} ไฟล์<small className={styles.muted}>{(row.document_usage.bytes / 1024 / 1024).toFixed(2)} MB</small></td>
                     <td><span className={styles.quotaBadge}>{quotaText}</span><small className={styles.muted}>เก็บแชท {row.quota.history_retention_days ? `${fmt(row.quota.history_retention_days)} วัน` : "ตามสัญญา"} · เอกสาร {row.quota.documents?.retention_days ? `${fmt(row.quota.documents.retention_days)} วัน` : "ตามสัญญา"}</small></td>
                     <td><Link className={styles.detailButton} href={`/it-admin/cpipos-ai/${encodeURIComponent(row.tenant_id)}`}>ดูรายละเอียด</Link></td>
                   </tr>
                 );
               })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
