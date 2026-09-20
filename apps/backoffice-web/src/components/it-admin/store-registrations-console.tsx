"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import styles from "./store-registrations-console.module.css";

type Modes = { takeaway: boolean; dine_in: boolean; buffet_table: boolean; delivery: boolean; general_sale: boolean };
type Row = {
  id: string; store_name: string; business_type: string; owner_name: string;
  owner_phone: string; owner_email: string; package_id: string; sales_modes: Modes;
  trial_days: number; status: "pending" | "processing" | "failed" | "activated";
  tenant_id: string | null; created_at: string; activated_at: string | null; last_error: string | null;
};
type Pkg = { id: string; code: string; name: string; monthly_price: number; max_branches: number; max_devices: number };
type Payload = { requests: Row[]; packages: Pkg[]; truncated: boolean };
type Envelope<T> = { data: T | null; error: { message?: string; code?: string } | null };
const modes: { key: keyof Modes; label: string }[] = [
  { key: "takeaway", label: "ขายกลับบ้าน" },
  { key: "dine_in", label: "นั่งโต๊ะ" },
  { key: "general_sale", label: "ร้านชำ / ขายทั่วไป" }
];
function dateTime(v: string | null) {
  return v ? new Date(v).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", dateStyle: "medium", timeStyle: "short" }) : "—";
}
async function api<T>(body?: Record<string, unknown>): Promise<T> {
  const response = await fetch("/api/it-admin/v1/store-registrations", {
    method: body ? "POST" : "GET", credentials: "include", cache: "no-store",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const json = await response.json().catch(() => null) as Envelope<T> | null;
  if (!response.ok || !json?.data) throw new Error(json?.error?.message ?? `HTTP ${response.status}`);
  return json.data;
}
type Form = Pick<Row,"store_name"|"business_type"|"owner_name"|"owner_phone"|"owner_email"|"package_id"|"sales_modes">;
function draft(r: Row): Form {
  return { store_name: r.store_name, business_type: r.business_type, owner_name: r.owner_name,
    owner_phone: r.owner_phone, owner_email: r.owner_email, package_id: r.package_id,
    sales_modes: {
      takeaway: Boolean(r.sales_modes?.takeaway), dine_in: Boolean(r.sales_modes?.dine_in),
      buffet_table: Boolean(r.sales_modes?.buffet_table), delivery: Boolean(r.sales_modes?.delivery),
      general_sale: Boolean(r.sales_modes?.general_sale)
    }
  };
}
export function StoreRegistrationsConsole() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState<Row | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [intent, setIntent] = useState<"edit" | "activate" | null>(null);
  const [ownerCode, setOwnerCode] = useState("100001");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try { setData(await api<Payload>()); setError(""); }
    catch (e) { setError(e instanceof Error ? e.message : "โหลดคำขอไม่สำเร็จ"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  function open(row: Row, mode: "edit" | "activate") {
    setSelected(row); setForm(draft(row)); setIntent(mode); setPin(""); setError(""); setSuccess("");
    setOwnerCode("100001");
  }
  function close() { if (!busy) { setSelected(null); setIntent(null); setForm(null); setPin(""); } }
  function update<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((f) => f ? { ...f, [key]: value } : null);
  }
  async function submit() {
    if (!selected || !intent || busy || !form) return;
    if (!Object.values(form.sales_modes).some(Boolean)) { setError("ต้องเปิดโหมดขายอย่างน้อยหนึ่งโหมด"); return; }
    if (intent === "activate" && (!/^\d{6}$/.test(ownerCode) || !/^\d{6}$/.test(pin))) {
      setError("รหัสเจ้าของร้านและ PIN ต้องเป็นตัวเลข 6 หลัก"); return;
    }
    const action = intent;
    if (action === "activate" && !window.confirm(`เปิดร้าน ${selected.store_name} ทดลองใช้ 7 วัน พร้อมสร้าง Owner และสาขาหลักใช่หรือไม่?`)) return;
    setBusy(true); setError("");
    try {
      const body = action === "edit" ? { action, id: selected.id, ...form }
        : { action, id: selected.id, owner_code: ownerCode, owner_pin: pin };
      const result = await api<{ id: string; status: string; result?: { store_code: string } }>(body);
      setSuccess(action === "activate" ? `เปิดร้านสำเร็จ · Store Code ${result.result?.store_code ?? "—"} · ทดลองใช้ 7 วัน` : "บันทึกข้อมูลคำขอแล้ว");
      setSelected(null); setForm(null); setIntent(null); setPin("");
      await reload();
    } catch (e) { setError(e instanceof Error ? e.message : "ดำเนินการไม่สำเร็จ"); }
    finally { setBusy(false); }
  }
  async function remove(row: Row) {
    if (busy || !window.confirm(`ลบคำขอของร้าน ${row.store_name}? การลบไม่กระทบร้านที่เปิดแล้ว`)) return;
    setBusy(true); setError("");
    try {
      await api({ action: "delete", id: row.id });
      setSuccess("ลบคำขอออกจากรายการแล้ว");
      await reload();
    } catch (e) { setError(e instanceof Error ? e.message : "ลบไม่สำเร็จ"); }
    finally { setBusy(false); }
  }
  const rows = (data?.requests ?? []).filter((r) => filter === "all" || r.status === filter);
  const pending = data?.requests.filter((r) => r.status === "pending").length ?? 0;
  return <div className={styles.shell}>
    <header className={styles.hero}>
      <div><span className={styles.eyebrow}>WEBSITE → CPIPOS-001 → IT APPROVAL</span>
        <h2>คำขอเปิดร้าน</h2>
        <p>ตรวจข้อมูลจากเว็บไซต์ก่อนสร้างร้านจริง · ทดลองใช้งาน 7 วันเริ่มเมื่อกดเปิดใช้งานเท่านั้น</p></div>
      <span className={styles.counter}>{pending} รายการรอดำเนินการ</span>
    </header>
    <div className={styles.toolbar}>
      <label>สถานะ <select value={filter} onChange={(e) => setFilter(e.target.value)}>
        <option value="all">ทั้งหมด</option><option value="pending">รอเปิดร้าน</option>
        <option value="processing">กำลังเปิดร้าน</option><option value="failed">ต้องแก้ไข / ลองใหม่</option>
        <option value="activated">เปิดแล้ว</option>
      </select></label>
      <button type="button" disabled={loading} onClick={() => void reload()}>{loading ? "กำลังโหลด…" : "รีเฟรชข้อมูล"}</button>
      <Link href="/it-admin/tenants">ไปยัง Tenants / Stores →</Link>
    </div>
    {error ? <div role="alert" className={styles.error}>{error}</div> : null}
    {success ? <div role="status" className={styles.success}>{success}</div> : null}
    {data?.truncated ? <div className={styles.error}>แสดงคำขอสูงสุด 200 รายการล่าสุด กรุณากรอง/จัดการรายการก่อน</div> : null}
    <div className={styles.tableWrap}><table className={styles.table}>
      <thead><tr><th>วันที่รับคำขอ</th><th>ร้าน / ประเภท</th><th>เจ้าของร้าน / ติดต่อ</th>
        <th>แพ็กเกจ</th><th>โหมดขาย</th><th>สถานะ</th><th>จัดการ</th></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.id}>
        <td>{dateTime(r.created_at)}</td>
        <td><strong>{r.store_name}</strong><small>{r.business_type}</small></td>
        <td><strong>{r.owner_name}</strong><small>{r.owner_phone}</small><small>{r.owner_email}</small></td>
        <td>{data?.packages.find((p) => p.id === r.package_id)?.name ?? "แพ็กเกจเดิม"}
          <small>{r.status === "activated" ? "เปิดทดลองใช้ 7 วันแล้ว" : "ทดลองใช้ 7 วัน เมื่ออนุมัติ"}</small></td>
        <td>{modes.filter((m) => r.sales_modes?.[m.key]).map((m) => m.label).join(" / ") || "—"}</td>
        <td><span className={styles.pill} data-status={r.status}>{{
          pending:"รอเปิดร้าน",processing:"กำลังเปิดร้าน",failed:"ต้องตรวจสอบ",activated:"เปิดใช้งาน"
        }[r.status]}</span>{r.last_error ? <small title={r.last_error}>{r.last_error}</small> : null}</td>
        <td><div className={styles.actions}>
          {r.status === "activated" && r.tenant_id ? <Link href="/it-admin/tenants">ดูร้าน →</Link> : null}
          {r.status === "pending" || r.status === "failed" ? <>
            <button disabled={busy} onClick={() => open(r,"edit")}>แก้ไข</button>
            <button disabled={busy} className={styles.primary} onClick={() => open(r,"activate")}>เปิดใช้งาน</button>
            <button disabled={busy} className={styles.danger} onClick={() => void remove(r)}>ลบ</button>
          </> : null}
        </div></td></tr>)}
        {!rows.length ? <tr><td colSpan={7} className={styles.empty}>{loading ? "กำลังโหลด…" : "ยังไม่มีคำขอในสถานะนี้"}</td></tr> : null}
      </tbody></table></div>
    {selected && form && intent ? <div className={styles.backdrop} onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="register-dialog-title">
        <header className={styles.dialogHead}><div><span>IT CONTROL PLANE</span><h3 id="register-dialog-title">{intent === "edit" ? "แก้ไขข้อมูลคำขอ" : "ยืนยันเปิดร้านทดลอง 7 วัน"}</h3></div>
          <button type="button" disabled={busy} onClick={close}>ปิด ✕</button></header>
        <div className={styles.dialogBody}>
          {intent === "edit" ? <div className={styles.formGrid}>
            <label>ชื่อร้าน<input required value={form.store_name} onChange={(e) => update("store_name", e.target.value)} /></label>
            <label>ประเภทร้าน<input required value={form.business_type} onChange={(e) => update("business_type", e.target.value)} /></label>
            <label>ชื่อเจ้าของ<input required value={form.owner_name} onChange={(e) => update("owner_name", e.target.value)} /></label>
            <label>เบอร์ติดต่อ<input required value={form.owner_phone} onChange={(e) => update("owner_phone", e.target.value)} /></label>
            <label>อีเมล Owner<input required type="email" value={form.owner_email} onChange={(e) => update("owner_email", e.target.value)} /></label>
            <label>แพ็กเกจ<select value={form.package_id} onChange={(e) => update("package_id", e.target.value)}>{data?.packages.map((p) =>
              <option key={p.id} value={p.id}>{p.name} · {p.max_branches} สาขา / {p.max_devices} เครื่อง</option>)}</select></label>
            </div> : <div className={styles.summary}>
              <strong>{selected.store_name}</strong><span>{selected.business_type} · {selected.owner_name}</span>
              <span>{selected.owner_email} · {selected.owner_phone}</span>
              <span>แพ็กเกจ: {data?.packages.find((p) => p.id === selected.package_id)?.name ?? "—"} · 7 วันนับจากอนุมัติ</span>
              <span>สร้างรหัสร้านโดยระบบ · สาขาแรก “สาขาหลัก” · เครื่องขายต้องจับคู่กับอุปกรณ์จริงภายหลัง</span>
              <label>รหัสเจ้าของร้าน (6 หลัก)<input inputMode="numeric" maxLength={6} value={ownerCode}
                onChange={(e) => setOwnerCode(e.target.value.replace(/\D/g,"").slice(0,6))} /></label>
              <label>PIN เจ้าของร้าน (6 หลัก)<input type="password" autoComplete="new-password"
                inputMode="numeric" maxLength={6} value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g,"").slice(0,6))} /></label>
              <small>PIN ส่งตรงให้ระบบสร้าง Owner ในคำขอนี้เท่านั้น ไม่เก็บไว้ในตารางคำขอหรือ Audit Log</small>
            </div>}
          {intent === "edit" ? <fieldset className={styles.modes}><legend>โหมดขายเริ่มต้น (เลือกได้หลายโหมด)</legend>{modes.map((m) =>
            <label key={m.key}><input type="checkbox" checked={form.sales_modes[m.key]}
              onChange={(e) => update("sales_modes",{...form.sales_modes,[m.key]:e.target.checked})}/>{m.label}</label>)}</fieldset> : null}
          {error ? <p role="alert" className={styles.error}>{error}</p> : null}
        </div>
        <footer className={styles.dialogFoot}><button type="button" disabled={busy} onClick={close}>ยกเลิก</button>
          <button type="button" className={styles.primary} disabled={busy} onClick={() => void submit()}>{busy ? "กำลังดำเนินการ…" : intent === "edit" ? "บันทึกข้อมูล" : "ยืนยันเปิดใช้งาน"}</button></footer>
      </section>
    </div> : null}
  </div>;
}
