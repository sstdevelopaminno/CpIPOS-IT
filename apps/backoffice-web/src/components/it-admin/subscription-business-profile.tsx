"use client";

import { useEffect, useState } from "react";

type BillingIdentity = {
  billing_legal_name_th: string;
  billing_legal_name_en: string;
  billing_registered_address: string;
  billing_registration_no: string;
  billing_bank_name: string;
  billing_bank_account_name: string;
  billing_bank_account_number: string;
  billing_promptpay_id: string;
  billing_vat_registered: boolean;
};
type Envelope = {
  data?: { profile: BillingIdentity };
  error?: { message?: string };
};
const ENDPOINT = "/api/it-admin/v1/subscription-payments/business";
const inputs: { key: Exclude<keyof BillingIdentity, "billing_vat_registered">; label: string; maxLength: number; placeholder?: string }[] = [
  { key: "billing_legal_name_th", label: "ชื่อนิติบุคคล (ภาษาไทย)", maxLength: 180 },
  { key: "billing_legal_name_en", label: "Legal company name (English)", maxLength: 180 },
  { key: "billing_registration_no", label: "เลขทะเบียนนิติบุคคล / เลขประจำตัวผู้เสียภาษี", maxLength: 13, placeholder: "13 หลัก (เว้นว่างไว้ก่อนได้)" },
  { key: "billing_bank_name", label: "ธนาคารรับชำระ", maxLength: 120 },
  { key: "billing_bank_account_name", label: "ชื่อบัญชีรับชำระ", maxLength: 180 },
  { key: "billing_bank_account_number", label: "เลขบัญชีรับชำระ", maxLength: 40 },
  { key: "billing_promptpay_id", label: "พร้อมเพย์รับชำระ (ถ้ามี)", maxLength: 40 }
];

export function SubscriptionBusinessProfile() {
  const [profile, setProfile] = useState<BillingIdentity | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(ENDPOINT, { cache: "no-store", signal: controller.signal });
        const json = await response.json() as Envelope;
        if (!response.ok || !json.data) throw new Error(json.error?.message || "ไม่สามารถโหลดข้อมูลบริษัท");
        setProfile(json.data.profile);
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "โหลดข้อมูลบริษัทไม่สำเร็จ");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, []);

  async function save() {
    if (!profile) return;
    setSaving(true);
    setNotice("");
    setError("");
    try {
      // No client request is permitted to change VAT registration status.
      const { billing_vat_registered: _vatStatus, ...payload } = profile;
      void _vatStatus;
      const response = await fetch(ENDPOINT, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      const json = await response.json() as Envelope;
      if (!response.ok || !json.data) throw new Error(json.error?.message || "บันทึกข้อมูลบริษัทไม่สำเร็จ");
      setProfile(json.data.profile);
      setNotice("บันทึกข้อมูลผู้ออกเอกสารและบัญชีรับชำระแล้ว");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-900">ข้อมูลบริษัท / บัญชีรับชำระ</h2>
          <p className="mt-1 text-sm text-slate-500">
            ใช้เป็นข้อมูลต้นทางสำหรับใบเสนอราคาและใบเสร็จแพ็กเกจในอนาคต ไม่ใช่บัญชีรับเงินหน้าร้าน POS
          </p>
        </div>
        <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}
          className="rounded-lg border border-blue-200 px-4 py-2 text-sm font-semibold text-blue-700">
          {open ? "ซ่อนข้อมูล" : "แก้ไขข้อมูลบริษัท"}
        </button>
      </div>
      {error ? <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {notice ? <p role="status" className="mt-3 rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p> : null}
      <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        สถานะปัจจุบัน: ยังไม่จดทะเบียน VAT · ห้ามใช้ข้อมูลส่วนนี้สร้างใบกำกับภาษี VAT อัตโนมัติ
        · การแจ้งชำระไม่ใช่ใบเสร็จรับเงิน
      </p>
      {open && (loading || !profile) ? <p className="mt-3 text-sm text-slate-500">
        {loading ? "กำลังโหลดข้อมูล..." : "ไม่พบข้อมูลบริษัท กรุณาตรวจสอบการเชื่อมต่อ"}
      </p> : null}
      {open && profile ? <div className="mt-4 grid gap-4 md:grid-cols-2">
        {inputs.map(({ key, label, maxLength, placeholder }) => (
          <label key={key} className="grid gap-1 text-sm font-semibold text-slate-700">
            {label}
            <input type="text" value={profile[key]} maxLength={maxLength} placeholder={placeholder}
              onChange={(event) => setProfile((current) => current ? { ...current, [key]: event.target.value } : current)}
              className="rounded-lg border border-slate-300 px-3 py-2 font-normal" />
          </label>
        ))}
        <label className="grid gap-1 text-sm font-semibold text-slate-700 md:col-span-2">
          ที่อยู่ตามเอกสารทะเบียนบริษัท
          <textarea value={profile.billing_registered_address} maxLength={900} rows={3}
            onChange={(event) => setProfile((current) => current ? {
              ...current, billing_registered_address: event.target.value
            } : current)}
            className="rounded-lg border border-slate-300 px-3 py-2 font-normal" />
        </label>
        <div className="flex flex-wrap items-center gap-3 md:col-span-2">
          <button type="button" disabled={saving} onClick={() => void save()}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
            {saving ? "กำลังบันทึก..." : "บันทึกข้อมูลบริษัท"}
          </button>
          <span className="text-xs text-slate-500">
            ชื่อและเลขบัญชีที่แก้ไขจะใช้กับเอกสารที่ออกใหม่เท่านั้น เอกสารย้อนหลังต้องคงข้อมูล ณ วันออกเอกสาร
          </span>
        </div>
      </div> : null}
    </section>
  );
}
