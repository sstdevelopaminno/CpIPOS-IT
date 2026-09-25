"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type Row = {
  tenant_id: string; store_code: string; store_name: string; owner_name: string | null;
  billing_email: string | null; package_name: string; package_code: string | null;
  billing_interval: "monthly" | "yearly" | "other"; service_status: string;
  start_date: string | null; end_date: string | null; days_remaining: number | null;
  amount_per_cycle: number | null; currency: string; contract_id: string | null;
  billing_cycle: { id: string; status: string; amount_due: number; amount_paid: number;
    period_start: string; period_end: string } | null;
  payment: { id: string; status: string; amount_reported: number | null; submitted_at: string | null;
    reviewed_at: string | null; has_evidence: boolean } | null;
  has_verified_receipt: boolean;
};
type Envelope = { data?: { rows: Row[]; generated_at: string }; error?: { message?: string } };
type ContactSettings = { billing_email: string; support_email: string; billing_sender_name: string; support_sender_name: string };
type SettingsEnvelope = { data?: { settings: ContactSettings }; error?: { message?: string } };
const defaultContacts: ContactSettings = {
  billing_email: "cuttingpointtech@gmail.com",
  support_email: "cuttingpointtech.support@gmail.com",
  billing_sender_name: "CUTTING POINTTECH",
  support_sender_name: "Cutting Point Tech Support"
};

const statusText: Record<string, string> = {
  active: "ใช้งานอยู่", trial: "ทดลองใช้", suspended: "ระงับบริการ", expired: "หมดอายุ",
  cancelled: "ยกเลิกสัญญา", store_suspended: "ร้านถูกระงับ", no_contract: "ยังไม่มีสัญญา"
};
function date(value: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium", timeZone: "Asia/Bangkok"
  }).format(parsed);
}
function money(value: number | null, currency: string) {
  if (value == null) return "—";
  return new Intl.NumberFormat("th-TH", { style: "currency", currency: currency || "THB" }).format(value);
}
function intervalText(value: Row["billing_interval"]) {
  return value === "monthly" ? "รายเดือน" : value === "yearly" ? "รายปี" : "ตามสัญญา";
}

export function SubscriptionPaymentsConsole() {
  const [rows, setRows] = useState<Row[]>([]);
  const [contacts, setContacts] = useState<ContactSettings>(defaultContacts);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [contactsOpen, setContactsOpen] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [updatedAt, setUpdatedAt] = useState("");

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [paymentResponse, settingsResponse] = await Promise.all([
        fetch("/api/it-admin/v1/subscription-payments", { cache: "no-store" }),
        fetch("/api/it-admin/v1/subscription-payments/settings", { cache: "no-store" })
      ]);
      const result = await paymentResponse.json() as Envelope;
      const settingResult = await settingsResponse.json() as SettingsEnvelope;
      if (!paymentResponse.ok || !result.data) throw new Error(result.error?.message || "ไม่สามารถโหลดตารางชำระแพ็กเกจ");
      if (!settingsResponse.ok || !settingResult.data) throw new Error(settingResult.error?.message || "ไม่สามารถโหลดตั้งค่าอีเมล");
      setRows(result.data.rows);
      setContacts(settingResult.data.settings);
      setUpdatedAt(result.data.generated_at);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "โหลดข้อมูลไม่สำเร็จ");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void reload(); }, [reload]);
  const filtered = useMemo(() => rows.filter((row) => {
    const query = search.trim().toLowerCase();
    if (query && ![row.store_code, row.store_name, row.package_name, row.owner_name || ""]
      .some((value) => value.toLowerCase().includes(query))) return false;
    if (filter === "all") return true;
    if (filter === "due") return row.days_remaining !== null && row.days_remaining >= 0 && row.days_remaining <= 7;
    if (filter === "expired") return row.days_remaining !== null && row.days_remaining < 0;
    if (filter === "pending") return Boolean(row.payment && !["approved", "paid", "rejected"].includes(row.payment.status));
    return row.service_status === filter;
  }), [rows, search, filter]);

  function openEmailDraft(row: Row) {
    if (!row.billing_email) { setError("ร้านนี้ยังไม่มีอีเมลเจ้าของหลัก กรุณาตั้งค่าผู้ใช้หลักใน IT ก่อน"); return; }
    const subject = `แจ้งรายละเอียดแพ็กเกจ CpIPOS — ${row.store_code}`;
    const body = [
      `เรียน ${row.owner_name || row.store_name}`,
      "",
      `ร้านค้า: ${row.store_name} (${row.store_code})`,
      `แพ็กเกจ: ${row.package_name} / ${intervalText(row.billing_interval)}`,
      `วันเริ่มบริการ: ${date(row.start_date)}`,
      `วันสิ้นสุดบริการ: ${date(row.end_date)}`,
      `ค่าบริการตามสัญญาต่อรอบ: ${money(row.amount_per_cycle, row.currency)}`,
      "",
      "หมายเหตุ: ข้อความนี้เป็นการแจ้งรายละเอียดแพ็กเกจ ไม่ใช่หลักฐานรับชำระเงินหรือใบเสร็จรับเงิน",
      `ติดต่อฝ่ายบัญชี: ${contacts.billing_email}`,
      `ติดต่อ Support: ${contacts.support_email}`
    ].join("\n");
    const cc = contacts.billing_email ? `&cc=${encodeURIComponent(contacts.billing_email)}` : "";
    window.location.href = `mailto:${encodeURIComponent(row.billing_email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}${cc}`;
  }
  async function saveContacts() {
    setSaving(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/it-admin/v1/subscription-payments/settings", {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(contacts)
      });
      const result = await response.json() as SettingsEnvelope;
      if (!response.ok || !result.data) throw new Error(result.error?.message || "บันทึกอีเมลไม่สำเร็จ");
      setContacts(result.data.settings);
      setNotice("บันทึกอีเมลบริษัทและ Support แล้ว");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "บันทึกไม่สำเร็จ"); }
    finally { setSaving(false); }
  }

  const activeCount = rows.filter((r) => r.service_status === "active").length;
  const expiring = rows.filter((r) => r.days_remaining !== null && r.days_remaining >= 0 && r.days_remaining <= 7).length;
  const pending = rows.filter((r) => r.payment && !["approved", "paid", "rejected"].includes(r.payment.status)).length;
  return (
    <section className="space-y-5 px-5 py-6 md:px-7">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold tracking-[0.16em] text-blue-600">COMMERCIAL / SUBSCRIPTION</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">ตารางชำระแพ็กเกจ</h1>
          <p className="mt-1 text-sm text-slate-600">ติดตามสัญญา รอบบริการ ยอดที่แจ้งชำระ และข้อมูลสำหรับติดต่อร้านค้า</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => setContactsOpen((value) => !value)}
            className="rounded-lg border border-blue-200 bg-white px-4 py-2 text-sm font-semibold text-blue-700">
            ตั้งค่าอีเมลบริษัท
          </button>
          <button type="button" onClick={() => void reload()} disabled={loading}
            className="rounded-lg border border-blue-200 bg-white px-4 py-2 text-sm font-semibold text-blue-700 disabled:opacity-50">รีเฟรช</button>
        </div>
      </header>
      {error ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {notice ? <p role="status" className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">{notice}</p> : null}
      {contactsOpen ? <div className="rounded-xl border border-blue-200 bg-white p-5 shadow-sm">
        <h2 className="font-bold text-slate-900">ช่องทางอีเมล (แก้ไขได้เมื่อบริษัทเปลี่ยนอีเมล)</h2>
        <p className="my-2 text-sm text-slate-600">ช่องนี้เป็นข้อมูลติดต่อและ Reply-To ไม่เปลี่ยนบัญชี Gmail ที่อนุญาตให้ส่งจริงโดยอัตโนมัติ</p>
        <div className="grid gap-3 md:grid-cols-2">
          {([
            ["billing_email", "อีเมลฝ่ายบัญชี / บริษัท"],
            ["support_email", "อีเมล Support"],
            ["billing_sender_name", "ชื่อผู้ส่งฝ่ายบัญชี"],
            ["support_sender_name", "ชื่อผู้ส่ง Support"]
          ] as const).map(([key, label]) => <label key={key} className="grid gap-1 text-sm font-semibold text-slate-700">
            {label}<input type={key.includes("email") ? "email" : "text"} value={contacts[key]} maxLength={key.includes("email") ? 320 : 120}
            onChange={(event) => setContacts((current) => ({ ...current, [key]: event.target.value }))}
            className="rounded-lg border border-slate-300 px-3 py-2 font-normal" /></label>)}
        </div>
        <button type="button" onClick={() => void saveContacts()} disabled={saving}
          className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
          {saving ? "กำลังบันทึก..." : "บันทึกการตั้งค่า"}</button>
      </div> : null}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {([["ร้านค้าทั้งหมด", rows.length], ["ใช้งานอยู่", activeCount], ["หมดอายุใน 7 วัน", expiring], ["รอตรวจชำระ", pending]] as const)
          .map(([label, value]) => <article key={label} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-slate-500">{label}</p><strong className="mt-2 block text-3xl text-slate-900">{value}</strong>
          </article>)}
      </div>
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4">
          <h2 className="font-bold text-slate-900">รายการร้านค้าและรอบบริการ</h2>
          <div className="flex flex-wrap gap-2">
            <input aria-label="ค้นหาร้าน" value={search} onChange={(event) => setSearch(event.target.value)}
              placeholder="ค้นหาร้าน / รหัส / แพ็กเกจ" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
            <select aria-label="กรองสถานะ" value={filter} onChange={(event) => setFilter(event.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
              <option value="all">ทุกสถานะ</option><option value="active">ใช้งานอยู่</option>
              <option value="trial">ทดลอง</option><option value="due">หมดอายุภายใน 7 วัน</option>
              <option value="expired">เลยกำหนด</option><option value="pending">รอตรวจชำระ</option>
              <option value="suspended">ระงับบริการ</option>
            </select>
          </div>
        </div>
        <div className="overflow-x-auto"><table className="w-full min-w-[1400px] text-left text-sm">
          <thead className="bg-slate-50 text-slate-600"><tr>
            {["ร้านค้า / รหัสร้าน","แพ็กเกจ","รอบ","สถานะบริการ","วันเริ่ม","วันหมดอายุ","คงเหลือ","ค่าบริการ / รอบ","ชำระเงิน","เอกสาร / ดำเนินการ"]
              .map((head) => <th key={head} className="whitespace-nowrap border-b border-slate-200 px-4 py-3 font-semibold">{head}</th>)}
          </tr></thead><tbody className="divide-y divide-slate-100">
            {loading ? <tr><td colSpan={10} className="p-8 text-center text-slate-500">กำลังโหลดข้อมูล...</td></tr>
              : filtered.length ? filtered.map((row) => <tr key={row.tenant_id} className="align-top hover:bg-blue-50/30">
                <td className="px-4 py-4"><strong className="block text-slate-900">{row.store_name}</strong>
                  <span className="text-xs text-slate-500">{row.store_code}</span></td>
                <td className="px-4 py-4"><strong className="block">{row.package_name}</strong>
                  <span className="text-xs text-slate-500">{row.package_code || "—"}</span></td>
                <td className="px-4 py-4"><span className={row.billing_interval === "yearly" ?
                    "rounded-full bg-violet-50 px-2 py-1 text-violet-700" :
                    "rounded-full bg-blue-50 px-2 py-1 text-blue-700"}>{intervalText(row.billing_interval)}</span></td>
                <td className="px-4 py-4"><span className={row.service_status === "active" ?
                    "rounded-full bg-green-50 px-2 py-1 font-semibold text-green-700" :
                    "rounded-full bg-amber-50 px-2 py-1 font-semibold text-amber-800"}>
                    {statusText[row.service_status] || row.service_status}</span></td>
                <td className="whitespace-nowrap px-4 py-4">{date(row.start_date)}</td>
                <td className="whitespace-nowrap px-4 py-4">{date(row.end_date)}</td>
                <td className="px-4 py-4 font-bold">{row.days_remaining === null ? "—"
                  : row.days_remaining < 0 ? `เกิน ${Math.abs(row.days_remaining)} วัน`
                  : `${row.days_remaining} วัน`}</td>
                <td className="whitespace-nowrap px-4 py-4">{money(row.amount_per_cycle, row.currency)}</td>
                <td className="px-4 py-4"><span className="block text-xs text-slate-600">
                  {row.payment?.status ? `แจ้งชำระ: ${row.payment.status}` : "ยังไม่มีรายการแจ้งชำระ"}</span>
                  <span className="text-xs text-slate-500">{row.billing_cycle ?
                    `รอบบิล: ${row.billing_cycle.status}` : "ยังไม่มีรอบบิล"}</span></td>
                <td className="px-4 py-4"><div className="flex flex-col items-start gap-2">
                  <Link href={`/tenants/${row.tenant_id}`} className="text-xs font-semibold text-blue-700 underline">ดูสัญญา / จัดการร้าน</Link>
                  <button type="button" onClick={() => openEmailDraft(row)}
                    className="rounded-md border border-blue-200 px-2 py-1 text-xs font-semibold text-blue-700">
                    ร่างอีเมลถึงร้าน
                  </button>
                  <span className="text-xs text-slate-500">{row.has_verified_receipt ?
                    "ชำระครบแล้ว — รอเอกสารใบเสร็จที่ออกจริง" : "ใบเสร็จ: ยังไม่มีหลักฐานชำระครบ"}</span>
                </div></td>
              </tr>) : <tr><td colSpan={10} className="p-8 text-center text-slate-500">ไม่มีข้อมูลตามตัวกรอง</td></tr>}
          </tbody></table></div>
        <p className="border-t border-slate-100 p-3 text-xs text-slate-500">
          {updatedAt ? `อัปเดต: ${date(updatedAt)} · ` : ""}
          ตารางนี้อ่านข้อมูลจริงจาก CpiPOS-001 เท่านั้น ใบเสร็จและการส่งอีเมลอัตโนมัติจะเปิดใช้หลังเชื่อมระบบรับเงินและช่องทางส่งจริง
        </p>
      </div>
    </section>
  );
}
