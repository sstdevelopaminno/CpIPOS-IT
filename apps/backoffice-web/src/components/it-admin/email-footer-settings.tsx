"use client";

import { useEffect, useState } from "react";

type EmailSettings = {
  billing_email: string;
  support_email: string;
  billing_sender_name: string;
  support_sender_name: string;
  auto_send_store_activation: boolean;
  auto_send_payment_confirmation: boolean;
  company_thai_name: string;
  company_english_name: string;
  contact_phone: string;
  website_url: string;
  email_footer_note: string;
};

type Envelope = {
  data?: { settings?: EmailSettings };
  error?: { message?: string };
};

const defaults: EmailSettings = {
  billing_email: "cuttingpointtech@gmail.com",
  support_email: "cuttingpointtech.support@gmail.com",
  billing_sender_name: "CUTTING POINTTECH",
  support_sender_name: "Cutting Point Tech Support",
  auto_send_store_activation: true,
  auto_send_payment_confirmation: true,
  company_thai_name: "บริษัท คัตติ้งพอยท์ เทค จำกัด",
  company_english_name: "Cutting Point Tech Co., Ltd.",
  contact_phone: "098-5460-355",
  website_url: "https://cuttingpointinnovation.vercel.app/",
  email_footer_note: "หากต้องการความช่วยเหลือ กรุณาติดต่อ Support"
};

export function EmailFooterSettings() {
  const [form, setForm] = useState<EmailSettings>(defaults);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/api/it-admin/v1/subscription-payments/settings", { cache: "no-store" });
        const json = await response.json().catch(() => null) as Envelope | null;
        if (!response.ok || !json?.data?.settings) {
          throw new Error(json?.error?.message || "โหลดการตั้งค่าอีเมลไม่สำเร็จ");
        }
        if (active) setForm(json.data.settings);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "โหลดการตั้งค่าอีเมลไม่สำเร็จ");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  function set<K extends keyof EmailSettings>(key: K, value: EmailSettings[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/it-admin/v1/subscription-payments/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form)
      });
      const json = await response.json().catch(() => null) as Envelope | null;
      if (!response.ok || !json?.data?.settings) {
        throw new Error(json?.error?.message || "บันทึกการตั้งค่าไม่สำเร็จ");
      }
      setForm(json.data.settings);
      setNotice("บันทึกข้อมูลท้ายอีเมลและการตั้งค่าการส่งเรียบร้อยแล้ว");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "บันทึกการตั้งค่าไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="grid gap-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <span className="text-[11px] font-black tracking-[0.12em] text-blue-600">EMAIL BRANDING & DELIVERY</span>
          <h2 className="mt-1 text-3xl font-black text-slate-900">ตั้งค่า ข้อความท้ายอีเมล์</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            ข้อมูลส่วนนี้ใช้กับอีเมลเปิดระบบและอีเมลยืนยันการรับชำระทั้งแบบอัตโนมัติและกดส่งเอง
            โดยระบบจะสร้าง HTML รูปแบบบริษัทให้อัตโนมัติ ไม่อนุญาตให้ใส่ HTML ดิบ
          </p>
        </div>
        <button
          type="button"
          onClick={() => void save()}
          disabled={loading || saving}
          className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white shadow-sm disabled:opacity-50"
        >
          {saving ? "กำลังบันทึก..." : "บันทึกการตั้งค่า"}
        </button>
      </header>

      {error ? <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</div> : null}
      {notice ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-700">{notice}</div> : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_460px]">
        <section className="grid gap-5">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4">
              <h3 className="text-lg font-black text-slate-900">ข้อมูลบริษัทที่แสดงท้ายอีเมล</h3>
              <p className="mt-1 text-sm text-slate-500">แก้ชื่อบริษัท เบอร์โทร เว็บไซต์ และข้อความช่วยเหลือได้จากจุดเดียว</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="ชื่อบริษัท (ภาษาไทย)" value={form.company_thai_name} disabled={loading}
                onChange={(value) => set("company_thai_name", value)} />
              <Field label="Company name (English)" value={form.company_english_name} disabled={loading}
                onChange={(value) => set("company_english_name", value)} />
              <Field label="เบอร์โทรศัพท์" value={form.contact_phone} disabled={loading}
                onChange={(value) => set("contact_phone", value)} />
              <Field label="เว็บไซต์" value={form.website_url} type="url" disabled={loading}
                onChange={(value) => set("website_url", value)} />
              <Field label="อีเมลฝ่ายบัญชี" value={form.billing_email} type="email" disabled={loading}
                onChange={(value) => set("billing_email", value)} />
              <Field label="อีเมล Support" value={form.support_email} type="email" disabled={loading}
                onChange={(value) => set("support_email", value)} />
              <label className="grid gap-2 md:col-span-2">
                <span className="text-sm font-bold text-slate-700">ข้อความก่อนลายเซ็นท้ายอีเมล</span>
                <textarea
                  value={form.email_footer_note}
                  disabled={loading}
                  maxLength={500}
                  rows={3}
                  onChange={(event) => set("email_footer_note", event.target.value)}
                  className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 disabled:bg-slate-50"
                  placeholder="เช่น หากต้องการความช่วยเหลือ กรุณาติดต่อ Support"
                />
              </label>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="text-lg font-black text-slate-900">ชื่อผู้ส่งและการส่งอัตโนมัติ</h3>
            <p className="mt-1 text-sm text-slate-500">Gmail ผู้ส่งจริงยังถูกควบคุมด้วย Mail Bridge; ช่องนี้กำหนดชื่อที่ลูกค้าเห็นและพฤติกรรม Auto Send</p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <Field label="ชื่อผู้ส่งฝ่ายบัญชี" value={form.billing_sender_name} disabled={loading}
                onChange={(value) => set("billing_sender_name", value)} />
              <Field label="ชื่อผู้ส่ง Support" value={form.support_sender_name} disabled={loading}
                onChange={(value) => set("support_sender_name", value)} />
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <Toggle
                checked={form.auto_send_store_activation}
                title="ส่งอัตโนมัติเมื่อเปิดรหัสร้าน"
                description="ส่งหนึ่งครั้งหลังเปิดร้านและสร้าง Store Code สำเร็จ"
                onChange={(value) => set("auto_send_store_activation", value)}
              />
              <Toggle
                checked={form.auto_send_payment_confirmation}
                title="ส่งอัตโนมัติเมื่อยืนยันรับชำระ"
                description="ส่งหลัง Settlement และออกใบเสร็จจริงสำเร็จเท่านั้น"
                onChange={(value) => set("auto_send_payment_confirmation", value)}
              />
            </div>
          </div>
        </section>

        <aside className="self-start rounded-2xl border border-slate-200 bg-slate-100 p-4 xl:sticky xl:top-24">
          <div className="mb-3 flex items-center justify-between">
            <strong className="text-sm text-slate-800">ตัวอย่างท้ายอีเมล</strong>
            <span className="rounded-full bg-blue-100 px-2 py-1 text-[10px] font-black text-blue-700">STYLE B</span>
          </div>
          <div className="overflow-hidden rounded-2xl border border-blue-100 bg-white shadow-lg">
            <div className="bg-gradient-to-r from-blue-900 to-blue-500 px-5 py-4 text-white">
              <div className="flex items-center justify-between gap-3">
                <strong className="text-2xl">CpIPOS</strong>
                <span className="text-right text-[10px] leading-4 text-blue-100">ระบบจัดการร้านค้า<br/>เพื่อการเติบโตของธุรกิจคุณ</span>
              </div>
            </div>
            <div className="p-5">
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-blue-50 text-3xl font-black text-blue-600">✓</div>
              <h4 className="mt-3 text-center text-xl font-black text-slate-900">ยืนยันรายการเรียบร้อย</h4>
              <div className="mt-5 rounded-xl border border-blue-100 bg-blue-50/50 p-4 text-sm">
                <div className="flex justify-between gap-4 border-b border-blue-100 py-2"><span className="text-slate-500">ร้านค้า</span><strong>ร้านตัวอย่าง</strong></div>
                <div className="flex justify-between gap-4 border-b border-blue-100 py-2"><span className="text-slate-500">แพ็กเกจ</span><strong>Growth</strong></div>
                <div className="flex justify-between gap-4 py-2"><span className="text-slate-500">ยอดรับชำระ</span><strong className="text-blue-600">฿1,000.00</strong></div>
              </div>
              <div className="mx-auto mt-5 w-2/3 rounded-lg bg-blue-600 px-4 py-3 text-center text-sm font-bold text-white">เว็บไซต์ CpIPOS ›</div>
              <div className="mt-5 rounded-xl bg-slate-50 p-3 text-center text-xs leading-5 text-slate-600">{form.email_footer_note || "—"}</div>
              <div className="mt-5 border-t border-slate-200 pt-4">
                <strong className="block text-sm text-slate-900">{form.company_thai_name || "—"}</strong>
                <span className="mt-1 block text-xs text-slate-500">{form.company_english_name || "—"}</span>
                <div className="mt-3 grid gap-1 text-xs text-slate-600">
                  <span>อีเมล: <b className="text-blue-600">{form.support_email || "—"}</b></span>
                  <span>โทรศัพท์: <b className="text-blue-600">{form.contact_phone || "—"}</b></span>
                  <span className="break-all">เว็บไซต์: <b className="text-blue-600">{form.website_url || "—"}</b></span>
                </div>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  disabled = false
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "email" | "url";
  disabled?: boolean;
}) {
  return (
    <label className="grid gap-2">
      <span className="text-sm font-bold text-slate-700">{label}</span>
      <input
        type={type}
        value={value}
        disabled={disabled}
        maxLength={500}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-11 rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 disabled:bg-slate-50"
      />
    </label>
  );
}

function Toggle({
  checked,
  title,
  description,
  onChange
}: {
  checked: boolean;
  title: string;
  description: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 h-4 w-4"
      />
      <span>
        <strong className="block text-sm text-slate-800">{title}</strong>
        <small className="mt-1 block text-xs leading-5 text-slate-500">{description}</small>
      </span>
    </label>
  );
}
