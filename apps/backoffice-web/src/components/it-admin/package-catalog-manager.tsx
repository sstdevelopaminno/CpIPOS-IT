"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./package-catalog-manager.module.css";

type PackageRow = {
  id: string;
  code: string;
  name: string;
  monthly_price: number;
  yearly_price: number | null;
  monthly_discount_percent: number;
  yearly_discount_percent: number;
  effective_monthly_price: number;
  effective_yearly_price: number | null;
  max_branches: number;
  max_devices: number | null;
  max_users: number | null;
  max_products: number | null;
  monthly_bill_limit: number | null;
  storage_limit_gb: number | null;
  retention_months: number | null;
  quota_mode: "standard" | "custom" | "exempt";
  is_active: boolean;
  status: string;
  feature_codes: string[];
  custom_per_store: boolean;
  metadata?: Record<string, unknown> | null;
};

type Payload = {
  generated_at: string;
  packages: PackageRow[];
  features: Array<{ code: string; name: string; description?: string | null; is_active?: boolean }>;
};

type Draft = {
  id?: string;
  code: string;
  name: string;
  monthly_price: string;
  yearly_price: string;
  monthly_discount_percent: string;
  yearly_discount_percent: string;
  max_branches: string;
  max_devices: string;
  max_users: string;
  max_products: string;
  monthly_bill_limit: string;
  storage_limit_gb: string;
  retention_months: string;
  is_active: boolean;
  quota_mode: "standard" | "custom";
};

const emptyDraft = (): Draft => ({
  code: "",
  name: "",
  monthly_price: "0",
  yearly_price: "",
  monthly_discount_percent: "0",
  yearly_discount_percent: "0",
  max_branches: "1",
  max_devices: "1",
  max_users: "1",
  max_products: "",
  monthly_bill_limit: "",
  storage_limit_gb: "",
  retention_months: "6",
  is_active: true,
  quota_mode: "standard"
});

function money(value: number | null | undefined) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB", maximumFractionDigits: 0 }).format(Number(value));
}

function metaNumber(row: PackageRow, key: string) {
  const parsed = Number(row.metadata?.[key] ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
function metaBoolean(row: PackageRow, key: string) {
  return row.metadata?.[key] === true;
}
function numberOrNull(value: string) {
  const text = value.trim();
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function draftFrom(row: PackageRow): Draft {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    monthly_price: String(row.monthly_price ?? 0),
    yearly_price: row.yearly_price == null ? "" : String(row.yearly_price),
    monthly_discount_percent: String(row.monthly_discount_percent ?? 0),
    yearly_discount_percent: String(row.yearly_discount_percent ?? 0),
    max_branches: String(row.max_branches ?? 1),
    max_devices: String(row.max_devices ?? 1),
    max_users: String(row.max_users ?? 1),
    max_products: row.max_products == null ? "" : String(row.max_products),
    monthly_bill_limit: row.monthly_bill_limit == null ? "" : String(row.monthly_bill_limit),
    storage_limit_gb: row.storage_limit_gb == null ? "" : String(row.storage_limit_gb),
    retention_months: row.retention_months == null ? "" : String(row.retention_months),
    is_active: row.is_active,
    quota_mode: row.quota_mode === "custom" ? "custom" : "standard"
  };
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store", credentials: "include" });
  const body = await response.json().catch(() => null) as { data?: T; error?: { message?: string } } | null;
  if (!response.ok || body?.data == null) throw new Error(body?.error?.message || `HTTP ${response.status}`);
  return body.data;
}

export function PackageCatalogManager() {
  const [data, setData] = useState<Payload | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [showRetired, setShowRetired] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api<Payload>("/api/it-admin/v1/packages"));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "โหลดแพ็กเกจไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const rows = useMemo(() => (data?.packages ?? []).filter((row) => showRetired || row.status !== "retired"), [data, showRetired]);
  const activeCount = data?.packages.filter((row) => row.is_active && row.status === "active").length ?? 0;

  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => current ? { ...current, [key]: value } : current);
  }

  async function save() {
    if (!draft || busy) return;
    if (!draft.name.trim() || !draft.code.trim()) {
      setError("กรอกชื่อและ Code แพ็กเกจ");
      return;
    }
    setBusy(true); setError(""); setSuccess("");
    const custom = draft.quota_mode === "custom";
    const payload = {
      code: draft.code.trim().toLowerCase(),
      name: draft.name.trim(),
      quota_mode: draft.quota_mode,
      monthly_price: custom ? 0 : numberOrNull(draft.monthly_price) ?? 0,
      yearly_price: custom ? 0 : numberOrNull(draft.yearly_price),
      monthly_discount_percent: custom ? 0 : numberOrNull(draft.monthly_discount_percent) ?? 0,
      yearly_discount_percent: custom ? 0 : numberOrNull(draft.yearly_discount_percent) ?? 0,
      max_branches: custom ? 999999 : numberOrNull(draft.max_branches) ?? 1,
      max_devices: custom ? 999999 : numberOrNull(draft.max_devices) ?? 1,
      max_users: custom ? 999999 : numberOrNull(draft.max_users) ?? 1,
      max_products: custom ? null : numberOrNull(draft.max_products),
      monthly_bill_limit: custom ? null : numberOrNull(draft.monthly_bill_limit),
      storage_limit_gb: custom ? null : numberOrNull(draft.storage_limit_gb),
      retention_months: custom ? null : numberOrNull(draft.retention_months),
      is_active: draft.is_active,
      status: draft.is_active ? "active" : "inactive"
    };

    try {
      if (draft.id) {
        await api(`/api/it-admin/v1/packages/${encodeURIComponent(draft.id)}`, {
          method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(payload)
        });
        setSuccess("บันทึกแพ็กเกจแล้ว");
      } else {
        await api("/api/it-admin/v1/packages", {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload)
        });
        setSuccess("เพิ่มแพ็กเกจแล้ว");
      }
      setDraft(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "บันทึกแพ็กเกจไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function remove(row: PackageRow) {
    if (busy) return;
    const reason = window.prompt(
      ["starter","growth","business","custom"].includes(row.code)
        ? "แพ็กเกจหลักจะถูกพักใช้งาน ไม่ลบประวัติ กรุณาระบุเหตุผล"
        : "ระบุเหตุผลการลบ/พักแพ็กเกจ",
      "ปรับปรุงรายการแพ็กเกจ"
    );
    if (reason === null) return;
    setBusy(true); setError(""); setSuccess("");
    try {
      const result = await api<{ deleted: boolean; retired: boolean }>(
        `/api/it-admin/v1/packages/${encodeURIComponent(row.id)}`,
        { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason }) }
      );
      setSuccess(result.deleted ? "ลบแพ็กเกจแล้ว" : "แพ็กเกจถูกพักเป็น Retired เพื่อรักษาประวัติ");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "ลบแพ็กเกจไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return <div className={styles.page}>
    <header className={styles.header}>
      <div>
        <span>COMMERCIAL</span>
        <h2>แพ็กเกจ / Subscription</h2>
        <p>ราคา · ส่วนลด · โควตา · อายุข้อมูล</p>
      </div>
      <div className={styles.headerActions}>
        <Link href="/it-admin/cpipos-ai">AI Quota</Link>
        <Link href="/it-admin/tenants">CUSTOM รายร้าน</Link>
        <button type="button" onClick={() => setDraft(emptyDraft())}>+ เพิ่มแพ็กเกจ</button>
      </div>
    </header>

    <section className={styles.stats}>
      <article><span>ทั้งหมด</span><strong>{data?.packages.length ?? 0}</strong></article>
      <article><span>Active</span><strong>{activeCount}</strong></article>
      <article><span>Canonical</span><strong>Starter · Growth · Business · CUSTOM</strong></article>
    </section>

    <div className={styles.toolbar}>
      <span>ข้อมูลจาก CpiPOS-001</span>
      <label><input type="checkbox" checked={showRetired} onChange={(e) => setShowRetired(e.target.checked)} /> แสดง Retired</label>
      <button type="button" disabled={loading} onClick={() => void load()}>{loading ? "กำลังโหลด…" : "รีเฟรช"}</button>
    </div>

    {error ? <div className={styles.error} role="alert">{error}</div> : null}
    {success ? <div className={styles.success} role="status">{success}</div> : null}

    <section className={styles.tableCard}>
      <div className={styles.tableWrap}>
        <table>
          <thead><tr><th>แพ็กเกจ</th><th>รายเดือน</th><th>รายปี</th><th>โควตา</th><th>สินค้า / บิล</th><th>AI / โหมดขาย</th><th>เก็บยอดขาย</th><th>สถานะ</th><th /></tr></thead>
          <tbody>
            {rows.map((row) => <tr key={row.id}>
              <td><strong>{row.name}</strong><small>{row.code}{row.custom_per_store ? " · รายร้าน" : ""}</small></td>
              <td>
                {row.custom_per_store ? <strong>กำหนดรายร้าน</strong> : <>
                  <strong>{money(row.effective_monthly_price)}</strong>
                  {row.monthly_discount_percent > 0 ? <small>ส่วนลด {row.monthly_discount_percent}% · จาก {money(row.monthly_price)}</small> : null}
                </>}
              </td>
              <td>
                {row.custom_per_store ? "—" : row.yearly_price && row.effective_yearly_price ? <>
                  <strong>{money(row.effective_yearly_price)}</strong>
                  {row.yearly_discount_percent > 0 ? <small>ส่วนลด {row.yearly_discount_percent}%</small> : null}
                </> : "ยังไม่ตั้ง"}
              </td>
              <td>{row.custom_per_store ? <span className={styles.customBadge}>IT กำหนด</span> :
                <span>{row.max_branches} สาขา · {row.max_devices ?? "—"} เครื่อง · {row.max_users ?? "—"} ผู้ใช้</span>}</td>
              <td>{row.custom_per_store ? "ตามสัญญา" : <span>{row.max_products ?? "ไม่จำกัด"} สินค้า · {row.monthly_bill_limit ?? "ไม่จำกัด"} บิล/เดือน</span>}</td>
              <td>{row.custom_per_store ? <span className={styles.customBadge}>IT กำหนด</span> : <span>
                {metaBoolean(row,"ai_included") ? `AI รวม ${metaNumber(row,"ai_monthly_requests") ?? "ตามโควตา"}` :
                  metaBoolean(row,"ai_addon_available") ? `AI Add-on ฿${metaNumber(row,"ai_addon_monthly_price") ?? 299}` : "ไม่รวม AI"}
                {" · "}
                {metaNumber(row,"sales_mode_limit") ? `${metaNumber(row,"sales_mode_limit")} โหมด` : "โหมดตามสัญญา"}
              </span>}</td>
              <td><strong>{row.custom_per_store ? "ตามสัญญา" : row.retention_months ? `${row.retention_months} เดือน` : "ไม่กำหนด"}</strong></td>
              <td><span className={row.is_active && row.status === "active" ? styles.active : styles.retired}>{row.status}</span></td>
              <td><div className={styles.rowActions}>
                <button type="button" onClick={() => setDraft(draftFrom(row))}>แก้ไข</button>
                <button type="button" className={styles.deleteButton} onClick={() => void remove(row)} disabled={busy}>ลบ</button>
              </div></td>
            </tr>)}
            {!loading && rows.length === 0 ? <tr><td colSpan={9} className={styles.empty}>ยังไม่มีแพ็กเกจ</td></tr> : null}
          </tbody>
        </table>
      </div>
    </section>

    {draft ? <div className={styles.backdrop} onMouseDown={(e) => { if (e.currentTarget === e.target && !busy) setDraft(null); }}>
      <section className={styles.modal} role="dialog" aria-modal="true" aria-label="แก้ไขแพ็กเกจ">
        <header><div><span>PACKAGE SETTINGS</span><h3>{draft.id ? "แก้ไขแพ็กเกจ" : "เพิ่มแพ็กเกจ"}</h3></div><button type="button" onClick={() => setDraft(null)} disabled={busy}>×</button></header>
        {draft.quota_mode === "custom" ? <div className={styles.customNote}>
          <strong>CUSTOM</strong><span>ราคาและโควตาจริงกำหนดแยกรายร้านใน Tenants / Stores</span>
        </div> : null}
        <div className={styles.formGrid}>
          <label><span>ชื่อแพ็กเกจ</span><input value={draft.name} onChange={(e) => update("name",e.target.value)} /></label>
          <label><span>Code</span><input value={draft.code} disabled={Boolean(draft.id && ["starter","growth","business","custom"].includes(draft.code))} onChange={(e) => update("code",e.target.value)} /></label>
          {!draft.id ? <label><span>ประเภท</span><select value={draft.quota_mode} onChange={(e) => update("quota_mode",e.target.value as Draft["quota_mode"])}><option value="standard">Standard</option><option value="custom">CUSTOM</option></select></label> : null}
          <label className={styles.switch}><input type="checkbox" checked={draft.is_active} onChange={(e) => update("is_active",e.target.checked)} /><span>เปิดใช้งาน</span></label>
        </div>

        {!draft.quota_mode.includes("custom") ? <>
          <h4>ราคาและส่วนลด</h4>
          <div className={styles.formGrid}>
            <label><span>รายเดือน</span><input type="number" min="0" value={draft.monthly_price} onChange={(e) => update("monthly_price",e.target.value)} /></label>
            <label><span>ส่วนลดรายเดือน %</span><input type="number" min="0" max="100" value={draft.monthly_discount_percent} onChange={(e) => update("monthly_discount_percent",e.target.value)} /></label>
            <label><span>รายปี</span><input type="number" min="0" placeholder="ยังไม่เปิด" value={draft.yearly_price} onChange={(e) => update("yearly_price",e.target.value)} /></label>
            <label><span>ส่วนลดรายปี %</span><input type="number" min="0" max="100" value={draft.yearly_discount_percent} onChange={(e) => update("yearly_discount_percent",e.target.value)} /></label>
          </div>

          <h4>โควตา</h4>
          <div className={styles.formGrid}>
            <label><span>สาขา</span><input type="number" min="1" value={draft.max_branches} onChange={(e) => update("max_branches",e.target.value)} /></label>
            <label><span>เครื่องขาย</span><input type="number" min="1" value={draft.max_devices} onChange={(e) => update("max_devices",e.target.value)} /></label>
            <label><span>ผู้ใช้งาน</span><input type="number" min="1" value={draft.max_users} onChange={(e) => update("max_users",e.target.value)} /></label>
            <label><span>สินค้า</span><input type="number" min="1" placeholder="ไม่จำกัด" value={draft.max_products} onChange={(e) => update("max_products",e.target.value)} /></label>
            <label><span>บิล / เดือน</span><input type="number" min="1" placeholder="ไม่จำกัด" value={draft.monthly_bill_limit} onChange={(e) => update("monthly_bill_limit",e.target.value)} /></label>
            <label><span>Storage GB</span><input type="number" min="0.01" step="0.01" placeholder="ไม่กำหนด" value={draft.storage_limit_gb} onChange={(e) => update("storage_limit_gb",e.target.value)} /></label>
            <label><span>Sales Retention (เดือน)</span><input type="number" min="1" placeholder="ไม่กำหนด" value={draft.retention_months} onChange={(e) => update("retention_months",e.target.value)} /></label>
          </div>
        </> : null}

        <footer><button type="button" className={styles.cancel} onClick={() => setDraft(null)} disabled={busy}>ยกเลิก</button><button type="button" className={styles.primary} onClick={() => void save()} disabled={busy}>{busy ? "กำลังบันทึก…" : "บันทึก"}</button></footer>
      </section>
    </div> : null}
  </div>;
}
