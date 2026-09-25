"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type History = {
  store: { id: string; code: string | null; name: string; display_name: string | null };
  cycles: { id: string; period_start: string; period_end: string; amount_due: number;
    amount_paid: number; status: string; created_at: string; package_id: string }[];
  payment_requests: { id: string; request_type: string; amount_reported: number | null;
    currency: string | null; status: string; submitted_at: string | null;
    reviewed_at: string | null; review_note: string | null; has_evidence: boolean }[];
  approval_events: { id: string; payment_request_id: string | null; action: string;
    from_status: string | null; to_status: string | null; created_at: string }[];
};
type Envelope = { data?: History; error?: { message?: string } };
const formatDate = (value: string | null) => value
  ? new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(new Date(value))
  : "—";
const formatMoney = (value: number | null, currency = "THB") => value == null ? "—"
  : new Intl.NumberFormat("th-TH", { style: "currency", currency }).format(value);

export function SubscriptionPaymentHistory({ tenantId }: { tenantId: string }) {
  const [history, setHistory] = useState<History | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(
          "/api/it-admin/v1/subscription-payments/history/" + encodeURIComponent(tenantId),
          { cache: "no-store", signal: controller.signal }
        );
        const json = await response.json() as Envelope;
        if (!response.ok || !json.data) throw new Error(json.error?.message || "โหลดประวัติการชำระเงินไม่สำเร็จ");
        setHistory(json.data);
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "ไม่สามารถโหลดข้อมูล");
      } finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [tenantId]);

  return (
    <section className="space-y-5 px-5 py-6 md:px-7">
      <Link href="/it-admin/subscription-payments" className="text-sm font-semibold text-blue-700 underline">
        ← ตารางชำระแพ็กเกจ
      </Link>
      <header>
        <p className="text-xs font-bold tracking-widest text-blue-600">BILLING HISTORY / IT CONTROL PLANE</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">ประวัติการชำระแพ็กเกจ</h1>
        <p className="mt-2 text-sm text-slate-600">
          {history ? (history.store.display_name || history.store.name) + " · " + (history.store.code || "ไม่มีรหัสร้าน")
            : "แสดงรายการรอบบิลและการแจ้งชำระจากฐานข้อมูลกลาง"}
        </p>
      </header>
      {loading ? <p>กำลังโหลด...</p> : null}
      {error ? <p role="alert" className="rounded-lg bg-red-50 p-4 text-red-700">{error}</p> : null}
      <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        การแจ้งชำระและไฟล์สลิปไม่ใช่หลักฐานว่าธนาคารรับเงินจริงแล้ว
        · รอบบิลที่ระบุชำระครบไม่ใช่ใบเสร็จ PDF ที่ออกแล้ว
        · ยังไม่เปิดปุ่มออกใบเสร็จจนกว่าจะผูกกับธุรกรรมที่ยืนยันและเลขที่เอกสารจริง
      </p>
      {history ? <>
        <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-lg font-bold">รายการแจ้งชำระ ({history.payment_requests.length})</h2>
          {history.payment_requests.length === 0 ? <p className="text-sm text-slate-500">ยังไม่มีการแจ้งชำระในระบบ</p> :
            <div className="overflow-x-auto"><table className="w-full min-w-[740px] text-left text-sm">
              <thead><tr className="border-b text-slate-500">{["วันแจ้ง","ประเภท","ยอดที่แจ้ง","สถานะตรวจสอบ","หลักฐาน","วันตรวจ","หมายเหตุ IT"]
                .map((label) => <th className="p-3" key={label}>{label}</th>)}</tr></thead>
              <tbody>{history.payment_requests.map((row) => <tr className="border-b" key={row.id}>
                <td className="p-3">{formatDate(row.submitted_at)}</td><td className="p-3">{row.request_type}</td>
                <td className="p-3">{formatMoney(row.amount_reported, row.currency || "THB")}</td>
                <td className="p-3 font-semibold">{row.status}</td>
                <td className="p-3">{row.has_evidence ? "มีการแนบหลักฐาน" : "—"}</td>
                <td className="p-3">{formatDate(row.reviewed_at)}</td><td className="p-3">{row.review_note || "—"}</td>
              </tr>)}</tbody></table></div>}
        </article>
        <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-lg font-bold">รอบบิลแพ็กเกจ ({history.cycles.length})</h2>
          {history.cycles.length === 0 ? <p className="text-sm text-slate-500">ยังไม่มีรอบบิลที่บันทึกไว้</p> :
            <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-sm">
              <thead><tr className="border-b text-slate-500">{["เริ่มรอบ","สิ้นสุดรอบ","ยอดเรียกเก็บ","ยอดบันทึกชำระ","สถานะรอบบิล"]
                .map((label) => <th className="p-3" key={label}>{label}</th>)}</tr></thead>
              <tbody>{history.cycles.map((row) => <tr className="border-b" key={row.id}>
                <td className="p-3">{row.period_start}</td><td className="p-3">{row.period_end}</td>
                <td className="p-3">{formatMoney(row.amount_due)}</td><td className="p-3">{formatMoney(row.amount_paid)}</td>
                <td className="p-3">{row.status}</td>
              </tr>)}</tbody></table></div>}
        </article>
        <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-lg font-bold">ประวัติการอนุมัติ / ปฏิเสธ ({history.approval_events.length})</h2>
          {history.approval_events.length === 0 ? <p className="text-sm text-slate-500">ยังไม่มีเหตุการณ์อนุมัติแพ็กเกจ</p>
            : <ul className="space-y-2">{history.approval_events.map((item) => <li key={item.id}
              className="rounded-lg border border-slate-100 p-3 text-sm">
              {formatDate(item.created_at)} · {item.action} · {item.from_status || "—"} → {item.to_status || "—"}
            </li>)}</ul>}
        </article>
      </> : null}
    </section>
  );
}
