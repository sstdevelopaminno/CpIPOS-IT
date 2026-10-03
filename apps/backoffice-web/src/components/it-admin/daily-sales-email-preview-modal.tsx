"use client";

import { useCallback, useEffect, useState } from "react";
import type { Language } from "@/lib/i18n";

type DeviceMode = "desktop" | "tablet" | "mobile";

type PreviewData = {
  tenant_id: string;
  store_name: string;
  business_date: string;
  subject: string;
  html_body: string;
  text_body: string;
  company_test_email: string;
  metrics: {
    gross_total: number;
    completed_count: number;
    net_total: number;
    cancelled_count: number;
    cash_total: number;
    bank_transfer_total: number;
    top_products: Array<{
      rank: number;
      name: string;
      quantity: number;
      sales_amount: number;
    }>;
  };
};

const COPY = {
  th: {
    title: "Preview Daily Sales Email",
    subtitle: "ตรวจหน้าตาและตัวเลขจากข้อมูลขายจริงก่อนเปิดส่งให้ลูกค้า",
    date: "วันที่ยอดขาย",
    load: "โหลด Preview",
    loading: "กำลังโหลด…",
    desktop: "คอม",
    tablet: "แท็บเล็ต",
    mobile: "มือถือ",
    subject: "หัวข้ออีเมล",
    testTo: "ส่งทดสอบไปที่",
    sendTest: "ส่งทดสอบ",
    sending: "กำลังส่ง…",
    close: "ปิด",
    loadFailed: "โหลด Preview ไม่สำเร็จ",
    sendFailed: "ส่งอีเมลทดสอบไม่สำเร็จ",
    sendSuccess: "ส่งอีเมลทดสอบไปยังอีเมลบริษัทสำเร็จแล้ว",
    confirm: "ยืนยันส่งอีเมลทดสอบไปยังอีเมลบริษัทเท่านั้น? ระบบจะไม่ส่งไปยังอีเมลลูกค้า",
    supportOnly: "ส่งทดสอบได้เฉพาะ IT Support",
    noPreview: "เลือกวันที่แล้วกดโหลด Preview",
    dataNote: "ข้อมูล Preview ใช้ยอดจริงของร้านในวันที่เลือก และไม่เปลี่ยนสถานะการส่งจริงของลูกค้า",
    completed: "บิลสำเร็จ",
    net: "ยอดสุทธิ"
  },
  en: {
    title: "Preview Daily Sales Email",
    subtitle: "Inspect the real-data email layout before enabling customer delivery.",
    date: "Sales date",
    load: "Load preview",
    loading: "Loading…",
    desktop: "Desktop",
    tablet: "Tablet",
    mobile: "Mobile",
    subject: "Subject",
    testTo: "Test recipient",
    sendTest: "Send test",
    sending: "Sending…",
    close: "Close",
    loadFailed: "Unable to load preview",
    sendFailed: "Unable to send test email",
    sendSuccess: "Test email sent to the company email",
    confirm: "Send this test email to the company email only? No customer email will be used.",
    supportOnly: "Test send requires IT Support",
    noPreview: "Choose a date and load the preview",
    dataNote: "Preview uses real sales data for the selected date and does not change customer delivery state.",
    completed: "Completed bills",
    net: "Net sales"
  }
} as const;

const DEVICE_WIDTH: Record<DeviceMode, number> = {
  desktop: 720,
  tablet: 600,
  mobile: 390
};

function money(value: number, language: Language) {
  return new Intl.NumberFormat(language === "th" ? "th-TH" : "en-US", {
    style: "currency",
    currency: "THB"
  }).format(Number(value || 0));
}

export function DailySalesEmailPreviewModal({
  language,
  tenantId,
  tenantName,
  defaultDate,
  canSendTest,
  onClose
}: {
  language: Language;
  tenantId: string;
  tenantName: string;
  defaultDate: string;
  canSendTest: boolean;
  onClose: () => void;
}) {
  const t = COPY[language];
  const [businessDate, setBusinessDate] = useState(defaultDate);
  const [device, setDevice] = useState<DeviceMode>("desktop");
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadPreview = useCallback(async () => {
    if (!businessDate) return;
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/it-admin/v1/maintenance/daily-sales-email", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "preview_daily_sales_email",
          tenant_id: tenantId,
          business_date: businessDate
        })
      });
      const body = await response.json().catch(() => null) as {
        data?: PreviewData;
        error?: { message?: string };
      } | null;
      if (!response.ok || !body?.data) throw new Error(body?.error?.message || t.loadFailed);
      setPreview(body.data);
    } catch (e) {
      setPreview(null);
      setError(e instanceof Error ? e.message : t.loadFailed);
    } finally {
      setLoading(false);
    }
  }, [businessDate, t.loadFailed, tenantId]);

  useEffect(() => {
    void loadPreview();
  }, [loadPreview]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function sendTest() {
    if (!preview || !canSendTest || sending) return;
    if (!window.confirm(t.confirm)) return;

    setSending(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/it-admin/v1/maintenance/daily-sales-email", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "send_daily_sales_email_test",
          tenant_id: tenantId,
          business_date: businessDate,
          confirmation: "SEND_DAILY_SALES_TEST"
        })
      });
      const body = await response.json().catch(() => null) as {
        data?: { recipient_email?: string };
        error?: { message?: string };
      } | null;
      if (!response.ok) throw new Error(body?.error?.message || t.sendFailed);
      setMessage(
        body?.data?.recipient_email
          ? `${t.sendSuccess}: ${body.data.recipient_email}`
          : t.sendSuccess
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : t.sendFailed);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/55 p-3 backdrop-blur-[2px]">
      <div className="flex max-h-[95vh] w-full max-w-[1180px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="border-b border-slate-200 px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-[10px] font-black tracking-[0.18em] text-blue-600">EMAIL PREVIEW · {tenantName}</div>
              <h3 className="mt-1 text-xl font-black text-slate-950">{t.title}</h3>
              <p className="mt-1 text-xs text-slate-500">{t.subtitle}</p>
            </div>
            <button type="button" onClick={onClose}
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-black text-slate-700">
              {t.close}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 bg-slate-50 px-5 py-3">
          <label className="grid gap-1 text-xs font-bold text-slate-600">
            {t.date}
            <input type="date" value={businessDate} max={defaultDate}
              onChange={(event) => setBusinessDate(event.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800" />
          </label>
          <button type="button" onClick={() => void loadPreview()} disabled={loading || !businessDate}
            className="rounded-xl border border-blue-300 bg-blue-50 px-4 py-2 text-sm font-black text-blue-700 disabled:opacity-40">
            {loading ? t.loading : t.load}
          </button>

          <div className="ml-auto flex gap-1 rounded-xl border border-slate-200 bg-white p-1">
            {([
              ["desktop", t.desktop],
              ["tablet", t.tablet],
              ["mobile", t.mobile]
            ] as Array<[DeviceMode, string]>).map(([key, label]) => (
              <button key={key} type="button" onClick={() => setDevice(key)}
                className={"rounded-lg px-3 py-1.5 text-xs font-black " + (device === key
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:bg-slate-100")}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {message ? <div className="mx-5 mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">{message}</div> : null}
        {error ? <div className="mx-5 mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</div> : null}

        {preview ? (
          <>
            <div className="grid gap-3 border-b border-slate-200 px-5 py-4 md:grid-cols-[1fr_auto_auto]">
              <div className="min-w-0">
                <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{t.subject}</div>
                <div className="mt-1 truncate text-sm font-black text-slate-900">{preview.subject}</div>
                <div className="mt-2 text-[11px] text-slate-500">{t.dataNote}</div>
              </div>
              <div className="rounded-xl bg-slate-50 px-4 py-2">
                <div className="text-[10px] font-bold text-slate-500">{t.completed}</div>
                <div className="mt-1 text-lg font-black text-slate-900">{preview.metrics.completed_count.toLocaleString()}</div>
              </div>
              <div className="rounded-xl bg-slate-50 px-4 py-2">
                <div className="text-[10px] font-bold text-slate-500">{t.net}</div>
                <div className="mt-1 text-lg font-black text-emerald-700">{money(preview.metrics.net_total, language)}</div>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto bg-slate-100 p-4">
              <div className="mx-auto transition-[width] duration-200" style={{ width: `${DEVICE_WIDTH[device]}px`, maxWidth: "100%" }}>
                <iframe
                  title={`Daily sales email preview for ${tenantName}`}
                  sandbox=""
                  srcDoc={preview.html_body}
                  className="h-[680px] w-full rounded-xl border border-slate-300 bg-white shadow-sm"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-5 py-4">
              <div className="text-xs text-slate-500">
                <strong className="text-slate-700">{t.testTo}:</strong> {preview.company_test_email || "—"}
              </div>
              <button type="button" onClick={() => void sendTest()}
                disabled={!canSendTest || sending || !preview.company_test_email}
                className="rounded-xl border border-blue-300 bg-blue-600 px-4 py-2 text-sm font-black text-white disabled:border-slate-200 disabled:bg-slate-200 disabled:text-slate-500">
                {sending ? t.sending : canSendTest ? t.sendTest : t.supportOnly}
              </button>
            </div>
          </>
        ) : (
          <div className="flex min-h-[420px] flex-1 items-center justify-center p-6 text-sm font-bold text-slate-400">
            {loading ? t.loading : t.noPreview}
          </div>
        )}
      </div>
    </div>
  );
}
