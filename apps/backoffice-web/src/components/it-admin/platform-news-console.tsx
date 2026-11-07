"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

export type NewsRow = {
  id: string;
  title: string;
  body: string;
  image_url: string | null;
  link_url: string | null;
  target_tenant_id: string | null;
  status: "draft" | "published" | "archived";
  created_at: string;
  updated_at: string;
  published_at: string | null;
};

type NewsFormValue = Pick<NewsRow,"title" | "body" | "image_url" | "link_url" | "target_tenant_id"> & { status: "draft" | "published" };
type TenantChoice = { id: string; display_name?: string | null; name?: string | null; code?: string | null };
const EMPTY: NewsFormValue = { title: "", body: "", image_url: null, link_url: null, target_tenant_id: null, status: "published" };
const BASE = "/api/it-admin/v1/news";

async function readData<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null) as { data?: T; error?: { message?: string } } | null;
  if (!response.ok || !body?.data) throw new Error(body?.error?.message || "ไม่สามารถติดต่อระบบแจ้งข่าวสารได้");
  return body.data;
}

function Status({ status }: { status: NewsRow["status"] }) {
  return <span className={"rounded-full px-3 py-1 text-xs font-bold " +
    (status === "published" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600")}>
    {status === "published" ? "เผยแพร่แล้ว" : status === "draft" ? "ฉบับร่าง" : "ลบแล้ว"}
  </span>;
}

function NewsEditor({ initial, onCancel, onSaved }: {
  initial?: NewsRow;
  onCancel: () => void;
  onSaved: (item: NewsRow) => void;
}) {
  const [form, setForm] = useState<NewsFormValue>(() => initial ? {
    title: initial.title, body: initial.body, image_url: initial.image_url,
    link_url: initial.link_url, target_tenant_id: initial.target_tenant_id,
    status: initial.status === "draft" ? "draft" : "published"
  } : EMPTY);
  const [tenants, setTenants] = useState<TenantChoice[]>([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const response = await fetch("/api/it-admin/v1/tenants?limit=100", { cache: "no-store" });
        const data = await readData<{ tenants?: TenantChoice[] }>(response);
        if (alive) setTenants(data.tenants ?? []);
      } catch { /* The global announcement option remains available. */ }
    })();
    return () => { alive = false; };
  }, []);

  async function upload(file: File | undefined) {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024 || !["image/jpeg","image/png","image/webp"].includes(file.type)) {
      setError("รูปภาพต้องเป็น JPG, PNG หรือ WEBP ขนาดไม่เกิน 2 MB");
      return;
    }
    setUploading(true);
    setError("");
    try {
      const data = new FormData();
      data.append("image", file);
      const result = await readData<{ image_url: string }>(await fetch(BASE + "/image", { method: "POST", body: data }));
      setForm(current => ({ ...current, image_url: result.image_url }));
    } catch (e) { setError(e instanceof Error ? e.message : "อัปโหลดรูปภาพไม่สำเร็จ"); }
    finally { setUploading(false); }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || uploading) return;
    setSaving(true);
    setError("");
    try {
      const url = initial ? BASE + "/" + encodeURIComponent(initial.id) : BASE;
      const response = await fetch(url, {
        method: initial ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });
      const data = await readData<{ item: NewsRow }>(response);
      onSaved(data.item);
    } catch (e) { setError(e instanceof Error ? e.message : "ไม่สามารถบันทึกข่าวสารได้"); }
    finally { setSaving(false); }
  }

  return (
    <div role="presentation" onClick={onCancel} className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/60 p-3">
      <form onSubmit={event => void save(event)} onClick={event => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="เพิ่มหรือแก้ไขข่าวสาร" className="grid max-h-[92vh] w-full max-w-2xl gap-4 overflow-y-auto rounded-3xl bg-white p-5 text-slate-950 shadow-2xl sm:p-7">
        <header className="flex items-center justify-between gap-4">
          <h2 className="text-xl font-extrabold">{initial ? "แก้ไขข่าวสาร" : "เพิ่มข่าวสารใหม่"}</h2>
          <button type="button" disabled={saving || uploading} onClick={onCancel} className="rounded-lg border px-3 py-1" aria-label="ปิดฟอร์ม">×</button>
        </header>
        <label className="grid gap-1 text-sm font-bold">หัวข้อข่าวสาร
          <input required minLength={2} maxLength={180} value={form.title} onChange={event => setForm(current => ({ ...current, title: event.target.value }))} className="rounded-xl border border-slate-300 px-3 py-3 font-normal" placeholder="เช่น อัปเดตระบบ CpiPOS เวอร์ชันใหม่" />
        </label>
        <label className="grid gap-1 text-sm font-bold">รายละเอียด
          <textarea required minLength={2} maxLength={10000} rows={6} value={form.body} onChange={event => setForm(current => ({ ...current, body: event.target.value }))} className="rounded-xl border border-slate-300 px-3 py-3 font-normal" placeholder="รายละเอียดการปรับปรุง ฟังก์ชัน หรือประกาศสำคัญ" />
        </label>
        <label className="grid gap-1 text-sm font-bold">ผู้รับข่าวสาร
          <select value={form.target_tenant_id ?? ""} onChange={event => setForm(current => ({ ...current, target_tenant_id: event.target.value || null }))} className="rounded-xl border border-slate-300 bg-white px-3 py-3 font-normal">
            <option value="">ทุกร้านค้า / ทุกสาขา</option>
            {form.target_tenant_id && !tenants.some(tenant => tenant.id === form.target_tenant_id) ? <option value={form.target_tenant_id}>ร้านที่เลือกไว้</option> : null}
            {tenants.map(tenant => <option value={tenant.id} key={tenant.id}>{tenant.display_name || tenant.name || tenant.code || tenant.id}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-bold">เพิ่มรูปภาพ (JPG / PNG / WEBP สูงสุด 2 MB)
          <input type="file" accept="image/png,image/jpeg,image/webp" disabled={saving || uploading} onChange={event => void upload(event.target.files?.[0])} className="rounded-xl border border-slate-300 px-3 py-2 font-normal" />
        </label>
        {form.image_url ? <div className="relative rounded-xl bg-slate-50 p-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={form.image_url} alt="รูปประกอบข่าวสาร" className="max-h-44 w-full object-contain" />
          <button type="button" onClick={() => setForm(current => ({ ...current, image_url: null }))} className="mt-2 text-xs font-semibold text-red-600">นำรูปภาพออก</button>
        </div> : null}
        <label className="grid gap-1 text-sm font-bold">ลิงก์เพิ่มเติม (HTTPS)
          <input type="url" value={form.link_url ?? ""} onChange={event => setForm(current => ({ ...current, link_url: event.target.value || null }))} className="rounded-xl border border-slate-300 px-3 py-3 font-normal" placeholder="https://..." />
        </label>
        <label className="grid gap-1 text-sm font-bold">สถานะ
          <select value={form.status} onChange={event => setForm(current => ({ ...current, status: event.target.value as "draft" | "published" }))} className="rounded-xl border border-slate-300 bg-white px-3 py-3 font-normal">
            <option value="published">เผยแพร่ไปยัง POS เมื่อบันทึก</option>
            <option value="draft">บันทึกฉบับร่าง (ยังไม่แจ้งลูกค้า)</option>
          </select>
        </label>
        {error ? <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p> : null}
        <footer className="flex items-center justify-end gap-2">
          <button type="button" disabled={saving || uploading} onClick={onCancel} className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-bold">ยกเลิก</button>
          <button type="submit" disabled={saving || uploading} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white disabled:opacity-60">
            {saving || uploading ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" aria-hidden /> : null}
            {uploading ? "กำลังอัปโหลด..." : saving ? "กำลังบันทึก..." : "บันทึก"}
          </button>
        </footer>
      </form>
    </div>
  );
}

export function ItPlatformNewsConsole() {
  const [items, setItems] = useState<NewsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editor, setEditor] = useState(false);
  const [toast, setToast] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  async function load() {
    try {
      const result = await readData<{ items: NewsRow[] }>(await fetch(BASE, { cache: "no-store" }));
      setItems(result.items);
      setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "โหลดข่าวสารไม่สำเร็จ"); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  function success(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 3100);
  }
  async function remove(item: NewsRow) {
    if (!window.confirm("ต้องการลบประกาศ \"" + item.title + "\" ใช่หรือไม่?")) return;
    setDeleting(item.id);
    try {
      await readData<{ archived: boolean }>(await fetch(BASE + "/" + item.id, { method: "DELETE" }));
      setItems(current => current.filter(entry => entry.id !== item.id));
      success("ลบข่าวสารเรียบร้อย");
    } catch (e) { setError(e instanceof Error ? e.message : "ลบข่าวสารไม่สำเร็จ"); }
    finally { setDeleting(null); }
  }

  return (
    <section className="mx-auto max-w-6xl space-y-5 px-3 py-5 text-slate-950 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div><h1 className="text-2xl font-extrabold">แจ้งข่าวสาร</h1><p className="mt-1 text-sm text-slate-500">ประกาศอัปเดตระบบและข่าวสารไปยังร้านค้า CpiPOS</p></div>
        <button type="button" onClick={() => setEditor(true)} className="rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white shadow hover:bg-blue-700">+ เพิ่มรายการ</button>
      </header>
      {toast ? <div role="status" className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700 transition-opacity duration-700">{toast}</div> : null}
      {error ? <div role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error} <button type="button" className="ml-3 underline" onClick={() => void load()}>ลองอีกครั้ง</button></div> : null}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {loading ? <p className="p-8 text-sm text-slate-500">กำลังโหลดรายการ...</p>
          : items.length === 0 ? <p className="p-8 text-sm text-slate-500">ยังไม่มีประกาศ กด + เพิ่มรายการ เพื่อสร้างข่าวสาร</p>
          : <div className="divide-y divide-slate-100">
            {items.map(item => (
              <div key={item.id} className="flex flex-wrap items-center gap-4 p-4 hover:bg-slate-50">
                <div className="min-w-0 flex-1">
                  <Link href={"/it-admin/news/" + item.id} className="block truncate text-base font-extrabold text-blue-700 hover:underline">{item.title}</Link>
                  <p className="mt-1 line-clamp-1 text-sm text-slate-500">{item.body}</p>
                  <p className="mt-1 text-xs text-slate-400">{new Date(item.published_at || item.created_at).toLocaleString("th-TH")} · {item.target_tenant_id ? "เฉพาะร้าน" : "ทุกร้านค้า"}</p>
                </div>
                <Status status={item.status} />
                <Link href={"/it-admin/news/" + item.id} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold">รายละเอียด</Link>
                <button type="button" onClick={() => void remove(item)} disabled={deleting === item.id} className="rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-600 disabled:opacity-40">{deleting === item.id ? "กำลังลบ..." : "ลบ"}</button>
              </div>
            ))}
          </div>}
      </div>
      {editor ? <NewsEditor onCancel={() => setEditor(false)} onSaved={item => { setItems(current => [item, ...current]); setEditor(false); success("บันทึกข่าวสารเรียบร้อย"); }} /> : null}
    </section>
  );
}

export function ItPlatformNewsDetail({ id }: { id: string }) {
  const [item, setItem] = useState<NewsRow | null>(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [removing, setRemoving] = useState(false);
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const result = await readData<{ item: NewsRow }>(await fetch(BASE + "/" + id, { cache: "no-store" }));
        if (alive) setItem(result.item);
      } catch (e) { if (alive) setError(e instanceof Error ? e.message : "โหลดรายละเอียดไม่สำเร็จ"); }
    })();
    return () => { alive = false; };
  }, [id]);

  async function remove() {
    if (!item || !window.confirm("ลบข่าวสารนี้หรือไม่?")) return;
    setRemoving(true);
    try {
      await readData<{ archived: boolean }>(await fetch(BASE + "/" + id, { method: "DELETE" }));
      window.location.assign("/it-admin/news");
    } catch (e) { setError(e instanceof Error ? e.message : "ลบไม่สำเร็จ"); setRemoving(false); }
  }

  return <section className="mx-auto max-w-4xl space-y-5 px-3 py-5 text-slate-950 sm:px-6">
    <Link href="/it-admin/news" className="text-sm font-bold text-blue-700">← กลับรายการแจ้งข่าวสาร</Link>
    {error ? <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-700">{error}</p> : null}
    {toast ? <p role="status" className="rounded-xl bg-emerald-50 p-3 text-emerald-700">{toast}</p> : null}
    {item ? <article className="space-y-5 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div><Status status={item.status}/><h1 className="mt-3 text-2xl font-extrabold">{item.title}</h1>
          <p className="mt-1 text-sm text-slate-500">เผยแพร่: {item.published_at ? new Date(item.published_at).toLocaleString("th-TH") : "ยังไม่เผยแพร่"}</p></div>
        <div className="flex gap-2"><button type="button" onClick={() => setEditing(true)} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white">แก้ไข</button>
          <button type="button" disabled={removing} onClick={() => void remove()} className="rounded-xl border border-red-200 px-4 py-2 text-sm font-bold text-red-600">{removing ? "กำลังลบ..." : "ลบ"}</button></div>
      </div>
      {item.image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.image_url} alt={item.title} className="max-h-[460px] w-full rounded-2xl object-contain" />
      ) : null}
      <p className="whitespace-pre-wrap break-words text-base leading-8">{item.body}</p>
      {item.link_url ? <p><a href={item.link_url} target="_blank" rel="noopener noreferrer" className="font-bold text-blue-700 underline">เปิดลิงก์เพิ่มเติม</a></p> : null}
      <div className="border-t border-slate-100 pt-4 text-sm text-slate-500">ผู้รับ: {item.target_tenant_id ?? "ทุกร้านค้า"}</div>
    </article> : !error ? <p role="status">กำลังโหลดรายละเอียด...</p> : null}
    {item && editing ? <NewsEditor initial={item} onCancel={() => setEditing(false)} onSaved={updated => {
      setItem(updated); setEditing(false); setToast("บันทึกการแก้ไขสำเร็จ");
      window.setTimeout(() => setToast(""), 3100);
    }} /> : null}
  </section>;
}
