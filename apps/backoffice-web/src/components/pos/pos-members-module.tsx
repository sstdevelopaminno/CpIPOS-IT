"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Image from "next/image";
import QRCode from "qrcode";
import type { Language } from "@/lib/i18n";
import { fetchWithTimeout } from "@/lib/client-fetch";

type Member = {
  id: string;
  name: string;
  phone: string;
  email?: string;
  member_token?: string;
  portal_path?: string;
  points: number;
  stamps: number;
  updated_at: string | null;
};

type MemberForm = {
  name: string;
  phone: string;
  email: string;
  points: string;
  stamps: string;
};

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

function emptyForm(): MemberForm {
  return { name: "", phone: "", email: "", points: "0", stamps: "0" };
}

function getPortalUrl(member: Member): string {
  const path = member.portal_path ?? `/member/${member.member_token ?? member.id}`;
  if (typeof window === "undefined") return path;
  return new URL(path, window.location.origin).toString();
}

export function PosMembersModule({ lang }: { lang: Language }) {
  const th = lang === "th";
  const [members, setMembers] = useState<Member[]>([]);
  const [query, setQuery] = useState("");
  const [form, setForm] = useState<MemberForm>(emptyForm);
  const [editingMember, setEditingMember] = useState<Member | null>(null);
  const [viewMember, setViewMember] = useState<Member | null>(null);
  const [deleteMember, setDeleteMember] = useState<Member | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [portalQrDataUrl, setPortalQrDataUrl] = useState("");

  const copy = useMemo(
    () => ({
      title: th ? "สมาชิก" : "Members",
      subtitle: th ? "ใช้ข้อมูลชุดเดียวกับ SSTiPOSMobile: mobile_members" : "Shared with SSTiPOSMobile: mobile_members",
      search: th ? "ค้นหาชื่อ เบอร์โทร หรืออีเมล์" : "Search name, phone, or email",
      addTitle: th ? "เพิ่ม/อัปเดตสมาชิก" : "Add / Update Member",
      editTitle: th ? "แก้ไขสมาชิก" : "Edit Member",
      name: th ? "ชื่อสมาชิก" : "Member name",
      phone: th ? "เบอร์โทร" : "Phone",
      email: th ? "อีเมล์" : "Email",
      points: th ? "คะแนน" : "Points",
      stamps: th ? "แต้ม" : "Stamps",
      save: th ? "บันทึกสมาชิก" : "Save member",
      searchButton: th ? "ค้นหา" : "Search",
      empty: th ? "ยังไม่พบสมาชิก" : "No members found",
      loadFailed: th ? "โหลดสมาชิกไม่สำเร็จ" : "Failed to load members",
      saved: th ? "บันทึกสมาชิกเรียบร้อยแล้ว" : "Member saved",
      deleted: th ? "ลบสมาชิกเรียบร้อยแล้ว" : "Member deleted",
      view: th ? "ดูรายการ" : "View",
      edit: th ? "แก้ไข" : "Edit",
      remove: th ? "ลบ" : "Delete",
      close: th ? "ปิด" : "Close",
      cancel: th ? "ยกเลิก" : "Cancel",
      confirmDelete: th ? "ยืนยันลบสมาชิก" : "Confirm delete",
      deleteHint: th ? "รายการนี้จะถูกซ่อนจากหน้าสมาชิก และไม่ลบประวัติการขายเดิม" : "This hides the member from the list and keeps previous sales history.",
      portal: th ? "ลิงก์สิทธิ์สมาชิก" : "Member benefit link",
      sendEmail: th ? "ส่งลิงก์ทางอีเมล์" : "Send email link",
      noEmail: th ? "ยังไม่มีอีเมล์สมาชิก" : "No member email",
      qrPending: th ? "กำลังสร้าง QR..." : "Generating QR..."
    }),
    [th]
  );

  async function load(nextQuery = query) {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchWithTimeout(`/api/pos/members?q=${encodeURIComponent(nextQuery)}`, { cache: "no-store" }, 10000);
      const body = await response.json();
      if (!response.ok || body.error) throw new Error(body.error?.message ?? copy.loadFailed);
      setMembers((body.data?.members ?? []) as Member[]);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : copy.loadFailed);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    setPortalQrDataUrl("");
    if (!viewMember) return;
    void QRCode.toDataURL(getPortalUrl(viewMember), { width: 164, margin: 1, errorCorrectionLevel: "M" })
      .then((url) => {
        if (!cancelled) setPortalQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setPortalQrDataUrl("");
      });
    return () => {
      cancelled = true;
    };
  }, [viewMember]);

  function openCreate() {
    setEditingMember(null);
    setForm(emptyForm());
    setFormOpen(true);
  }

  function openEdit(member: Member) {
    setEditingMember(member);
    setForm({ name: member.name, phone: member.phone, email: member.email ?? "", points: String(member.points), stamps: String(member.stamps) });
    setFormOpen(true);
  }

  async function saveMember() {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetchWithTimeout(
        "/api/pos/members",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: form.name,
            phone: digitsOnly(form.phone),
            email: form.email.trim(),
            points: Number(form.points || 0),
            stamps: Number(form.stamps || 0)
          })
        },
        10000
      );
      const body = await response.json();
      if (!response.ok || body.error) throw new Error(body.error?.message ?? "Failed");
      setMessage(copy.saved);
      setFormOpen(false);
      setEditingMember(null);
      setForm(emptyForm());
      await load(query);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed");
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleteMember) return;
    setDeleting(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetchWithTimeout(`/api/pos/members?id=${encodeURIComponent(deleteMember.id)}`, { method: "DELETE" }, 10000);
      const body = await response.json().catch(() => null);
      if (!response.ok || body?.error) throw new Error(body?.error?.message ?? "Failed");
      setMessage(copy.deleted);
      setDeleteMember(null);
      if (viewMember?.id === deleteMember.id) setViewMember(null);
      await load(query);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed");
    } finally {
      setDeleting(false);
    }
  }

  function emailHref(member: Member) {
    if (!member.email) return "#";
    const link = getPortalUrl(member);
    const subject = th ? "ลิงก์สิทธิ์สมาชิก SSTiPOS" : "SSTiPOS member benefit link";
    const body = th
      ? `สวัสดี ${member.name}\n\nตรวจสอบคะแนน แต้ม และสิทธิ์สมาชิกได้ที่ลิงก์นี้:\n${link}`
      : `Hello ${member.name}\n\nCheck your points, stamps, and member benefits here:\n${link}`;
    return `mailto:${encodeURIComponent(member.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  return (
    <section className="pos-section-card w-full self-start overflow-hidden rounded-2xl border border-slate-300 bg-white">
      <div className="border-b border-slate-200 bg-[linear-gradient(130deg,#f8fbff_0%,#f2f7ff_52%,#fff7ed_100%)] px-4 py-4 lg:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-2xl font-extrabold text-slate-900">{copy.title}</h2>
            <p className="mt-1 text-sm font-semibold text-slate-500">{copy.subtitle}</p>
          </div>
          <button type="button" onClick={openCreate} className="h-11 rounded-lg bg-blue-600 px-4 text-sm font-extrabold text-white shadow-sm hover:bg-blue-700">
            {copy.addTitle}
          </button>
        </div>
      </div>

      <div className="grid gap-4 p-4 lg:p-6">
        <div className="flex gap-2">
          <input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void load(query); }} placeholder={copy.search} className="h-11 min-w-0 flex-1 rounded-lg border border-slate-300 px-3 text-sm font-semibold outline-none focus:border-blue-400" />
          <button type="button" onClick={() => void load(query)} className="h-11 rounded-lg bg-blue-600 px-4 text-sm font-bold text-white">{copy.searchButton}</button>
        </div>

        {error ? <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</p> : null}
        {message ? <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">{message}</p> : null}

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="grid grid-cols-[minmax(170px,1.3fr)_120px_120px_minmax(130px,1fr)_190px] gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs font-black text-slate-500">
            <span>{copy.name}</span>
            <span>{copy.points}</span>
            <span>{copy.stamps}</span>
            <span>{copy.email}</span>
            <span className="text-right">{th ? "จัดการ" : "Actions"}</span>
          </div>
          {loading ? <p className="px-4 py-8 text-center text-sm font-semibold text-slate-500">Loading...</p> : null}
          {!loading && members.length === 0 ? <p className="px-4 py-8 text-center text-sm font-semibold text-slate-500">{copy.empty}</p> : null}
          {members.map((member) => (
            <article key={member.id} className="grid grid-cols-[minmax(170px,1.3fr)_120px_120px_minmax(130px,1fr)_190px] items-center gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0 hover:bg-slate-50">
              <button type="button" onClick={() => setViewMember(member)} className="min-w-0 text-left">
                <strong className="block truncate text-base text-slate-950">{member.name}</strong>
                <span className="text-sm font-semibold text-slate-500">{member.phone}</span>
              </button>
              <span className="w-fit rounded-lg bg-blue-50 px-3 py-2 text-xs font-black text-blue-700">{member.points} {copy.points}</span>
              <span className="w-fit rounded-lg bg-amber-50 px-3 py-2 text-xs font-black text-amber-700">{member.stamps} {copy.stamps}</span>
              <span className="truncate text-sm font-semibold text-slate-600">{member.email || "-"}</span>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setViewMember(member)} className="h-9 rounded-lg border border-slate-300 px-3 text-xs font-black text-slate-700">{copy.view}</button>
                <button type="button" onClick={() => openEdit(member)} className="h-9 rounded-lg border border-blue-200 bg-blue-50 px-3 text-xs font-black text-blue-700">{copy.edit}</button>
                <button type="button" onClick={() => setDeleteMember(member)} className="h-9 rounded-lg border border-red-200 bg-red-50 px-3 text-xs font-black text-red-700">{copy.remove}</button>
              </div>
            </article>
          ))}
        </div>
      </div>

      {formOpen ? (
        <MemberModal title={editingMember ? copy.editTitle : copy.addTitle} closeLabel={copy.close} onClose={() => setFormOpen(false)}>
          <div className="grid gap-3">
            <input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder={copy.name} className="h-11 rounded-lg border border-slate-300 px-3 text-sm font-semibold" />
            <input value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: digitsOnly(event.target.value) }))} placeholder={copy.phone} inputMode="tel" className="h-11 rounded-lg border border-slate-300 px-3 text-sm font-semibold" />
            <input value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} placeholder={copy.email} inputMode="email" className="h-11 rounded-lg border border-slate-300 px-3 text-sm font-semibold" />
            <div className="grid grid-cols-2 gap-2">
              <input value={form.points} onChange={(event) => setForm((current) => ({ ...current, points: event.target.value }))} placeholder={copy.points} inputMode="numeric" className="h-11 rounded-lg border border-slate-300 px-3 text-sm font-semibold" />
              <input value={form.stamps} onChange={(event) => setForm((current) => ({ ...current, stamps: event.target.value }))} placeholder={copy.stamps} inputMode="numeric" className="h-11 rounded-lg border border-slate-300 px-3 text-sm font-semibold" />
            </div>
            <button type="button" onClick={() => void saveMember()} disabled={saving} className="h-11 rounded-lg bg-orange-600 px-4 text-sm font-extrabold text-white disabled:opacity-60">{saving ? (th ? "กำลังบันทึก..." : "Saving...") : copy.save}</button>
          </div>
        </MemberModal>
      ) : null}

      {viewMember ? (
        <MemberModal title={viewMember.name} closeLabel={copy.close} onClose={() => setViewMember(null)}>
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-2">
              <Info label={copy.phone} value={viewMember.phone} />
              <Info label={copy.email} value={viewMember.email || "-"} />
              <Info label={copy.points} value={String(viewMember.points)} />
              <Info label={copy.stamps} value={String(viewMember.stamps)} />
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-black text-slate-900">{copy.portal}</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-[164px_minmax(0,1fr)]">
                <div className="grid h-[164px] w-[164px] place-items-center rounded-lg border border-slate-200 bg-white p-2 text-center">
                  {portalQrDataUrl ? <Image src={portalQrDataUrl} alt={copy.portal} width={148} height={148} unoptimized className="h-full w-full" /> : <p className="text-sm font-black text-slate-500">{copy.qrPending}</p>}
                </div>
                <div className="min-w-0">
                  <p className="break-all rounded-lg border border-slate-200 bg-white p-3 text-xs font-bold text-slate-700">{getPortalUrl(viewMember)}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" onClick={() => void navigator.clipboard?.writeText(getPortalUrl(viewMember))} className="h-10 rounded-lg border border-slate-300 px-3 text-sm font-black text-slate-700">{th ? "คัดลอกลิงก์" : "Copy link"}</button>
                    <a href={emailHref(viewMember)} aria-disabled={!viewMember.email} className={`inline-flex h-10 items-center rounded-lg px-3 text-sm font-black ${viewMember.email ? "bg-blue-600 text-white" : "pointer-events-none bg-slate-200 text-slate-500"}`}>{viewMember.email ? copy.sendEmail : copy.noEmail}</a>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </MemberModal>
      ) : null}

      {deleteMember ? (
        <MemberModal title={copy.confirmDelete} closeLabel={copy.close} onClose={() => setDeleteMember(null)}>
          <p className="text-sm font-semibold text-slate-600">{copy.deleteHint}</p>
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm font-black text-red-700">{deleteMember.name} / {deleteMember.phone}</p>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={() => setDeleteMember(null)} className="h-10 rounded-lg border border-slate-300 px-4 text-sm font-black text-slate-700">{copy.cancel}</button>
            <button type="button" onClick={() => void confirmDelete()} disabled={deleting} className="h-10 rounded-lg bg-red-600 px-4 text-sm font-black text-white disabled:opacity-60">{deleting ? "..." : copy.remove}</button>
          </div>
        </MemberModal>
      ) : null}
    </section>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <p className="text-xs font-bold text-slate-500">{label}</p>
      <p className="mt-1 text-base font-black text-slate-950">{value}</p>
    </div>
  );
}

function MemberModal({ title, closeLabel, children, onClose }: { title: string; closeLabel: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/45 p-4" role="dialog" aria-modal="true" onClick={onClose}>
      <section className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <header className="mb-4 flex items-start justify-between gap-3">
          <h3 className="text-xl font-black text-slate-950">{title}</h3>
          <button type="button" onClick={onClose} className="h-9 rounded-lg border border-slate-300 px-3 text-sm font-black text-slate-700">{closeLabel}</button>
        </header>
        {children}
      </section>
    </div>
  );
}
