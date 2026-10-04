"use client";

import { useEffect, useMemo, useState } from "react";

type PaymentSettings = {
  billing_bank_name: string;
  billing_bank_account_name: string;
  billing_bank_account_number: string;
  billing_promptpay_id: string;
};

type Envelope = {
  data?: { settings: PaymentSettings };
  error?: { message?: string };
};

const empty: PaymentSettings = {
  billing_bank_name: "",
  billing_bank_account_name: "",
  billing_bank_account_number: "",
  billing_promptpay_id: ""
};

export function PaymentAccountSettings() {
  const [settings, setSettings] = useState<PaymentSettings>(empty);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/it-admin/v1/payment-settings", {
          cache: "no-store",
          signal: controller.signal
        });
        const json = await response.json() as Envelope;
        if (!response.ok || !json.data) throw new Error(json.error?.message || "โหลดข้อมูลบัญชีรับชำระไม่สำเร็จ");
        setSettings(json.data.settings);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : "โหลดข้อมูลไม่สำเร็จ");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, []);

  const status = useMemo(() => {
    const bankReady = Boolean(
      settings.billing_bank_name.trim()
      && settings.billing_bank_account_name.trim()
      && settings.billing_bank_account_number.trim()
    );
    const promptPay = settings.billing_promptpay_id.replace(/\D/g, "");
    const promptPayReady = /^(?:\d{10}|\d{13})$/.test(promptPay);
    return { bankReady, promptPayReady };
  }, [settings]);

  async function save() {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/it-admin/v1/payment-settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(settings)
      });
      const json = await response.json() as Envelope;
      if (!response.ok || !json.data) throw new Error(json.error?.message || "บันทึกไม่สำเร็จ");
      setSettings(json.data.settings);
      setNotice("บันทึกบัญชีรับชำระแล้ว ระบบ LINE จะใช้ข้อมูลชุดนี้ทันที");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-5 px-5 py-6 md:px-7">
      <header>
        <p className="text-xs font-black tracking-[0.16em] text-blue-600">PAYMENT CONFIGURATION</p>
        <h1 className="mt-1 text-2xl font-black text-slate-900">ตั้งค่าบัญชีชำระเงิน</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
          ข้อมูลนี้เป็นบัญชีรับชำระของบริษัทสำหรับหน้า LINE Payment Center
          และ QR แพ็กเกจ CpIPOS จะใช้พร้อมเพย์จากหน้านี้ร่วมกับยอดค้างจริงของแต่ละร้าน
        </p>
      </header>

      <div className="grid gap-3 md:grid-cols-2">
        <div className={"rounded-2xl border p-4 " + (status.bankReady ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50")}>
          <div className="text-sm font-black text-slate-900">บัญชีธนาคาร</div>
          <div className="mt-1 text-xs text-slate-600">
            {status.bankReady ? "พร้อมแสดงในเมนูชำระเงินทั่วไป" : "ข้อมูลยังไม่ครบ"}
          </div>
        </div>
        <div className={"rounded-2xl border p-4 " + (status.promptPayReady ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50")}>
          <div className="text-sm font-black text-slate-900">PromptPay QR</div>
          <div className="mt-1 text-xs text-slate-600">
            {status.promptPayReady ? "พร้อมสร้าง QR ตามยอด Billing ของร้าน" : "ยังไม่ได้ตั้งค่าพร้อมเพย์ที่ถูกต้อง"}
          </div>
        </div>
      </div>

      {error ? <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</div> : null}
      {notice ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">{notice}</div> : null}

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        {loading ? <p className="text-sm text-slate-500">กำลังโหลดข้อมูล...</p> : (
          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-1.5 text-sm font-bold text-slate-700">
              ธนาคาร
              <input
                value={settings.billing_bank_name}
                maxLength={120}
                placeholder="เช่น กสิกรไทย"
                onChange={(event) => setSettings((current) => ({ ...current, billing_bank_name: event.target.value }))}
                className="rounded-xl border border-slate-300 px-4 py-3 font-normal outline-none focus:border-blue-500"
              />
            </label>

            <label className="grid gap-1.5 text-sm font-bold text-slate-700">
              ชื่อบัญชี
              <input
                value={settings.billing_bank_account_name}
                maxLength={180}
                placeholder="ชื่อบัญชีรับชำระ"
                onChange={(event) => setSettings((current) => ({ ...current, billing_bank_account_name: event.target.value }))}
                className="rounded-xl border border-slate-300 px-4 py-3 font-normal outline-none focus:border-blue-500"
              />
            </label>

            <label className="grid gap-1.5 text-sm font-bold text-slate-700">
              เลขที่บัญชีธนาคาร
              <input
                value={settings.billing_bank_account_number}
                maxLength={40}
                inputMode="numeric"
                placeholder="เลขบัญชีธนาคาร"
                onChange={(event) => setSettings((current) => ({ ...current, billing_bank_account_number: event.target.value }))}
                className="rounded-xl border border-slate-300 px-4 py-3 font-normal outline-none focus:border-blue-500"
              />
            </label>

            <label className="grid gap-1.5 text-sm font-bold text-slate-700">
              หมายเลขพร้อมเพย์
              <input
                value={settings.billing_promptpay_id}
                maxLength={20}
                inputMode="numeric"
                placeholder="เบอร์โทร 10 หลัก หรือเลขประจำตัว 13 หลัก"
                onChange={(event) => setSettings((current) => ({
                  ...current,
                  billing_promptpay_id: event.target.value.replace(/[^\d -]/g, "")
                }))}
                className="rounded-xl border border-slate-300 px-4 py-3 font-normal outline-none focus:border-blue-500"
              />
            </label>

            <div className="md:col-span-2 rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm leading-6 text-blue-900">
              <strong>การสร้าง QR แพ็กเกจ:</strong> ระบบจะไม่บันทึกยอดเงินไว้ในหน้านี้
              แต่จะอ่านยอดค้างล่าสุดจาก Billing Cycle ของร้าน แล้วสร้าง URL ในรูปแบบ
              <code className="mx-1 rounded bg-white px-1.5 py-0.5 text-xs">promptpay.io/พร้อมเพย์/ยอด.png</code>
              อัตโนมัติ หากยังไม่ถึงรอบหรือไม่มียอดค้าง จะไม่แสดง QR
            </div>

            <div className="md:col-span-2 flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={saving}
                onClick={() => void save()}
                className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-black text-white disabled:opacity-50"
              >
                {saving ? "กำลังบันทึก..." : "บันทึกบัญชีชำระเงิน"}
              </button>
              <span className="text-xs text-slate-500">การแก้ไขจะมีผลกับหน้า LINE Payment Center ทันที</span>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
