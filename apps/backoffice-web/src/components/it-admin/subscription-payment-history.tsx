"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type PaymentRequest = {
  id: string; request_type: string; amount_reported: number | null;
  currency: string | null; status: string; submitted_at: string | null;
  reviewed_at: string | null; review_note: string | null; has_evidence: boolean; slip_url: string | null;
  kind: string; billing_interval: string; expected_amount: number | null;
  transfer_reference: string; payer_name: string; transfer_at: string;
};
type Receipt = {
  id: string; payment_request_id: string; billing_cycle_id: string; receipt_number: string;
  issued_at: string; amount: number; currency: string; package_name: string;
  billing_interval: string; period_start: string; period_end: string;
};
type History = {
  store: { id: string; code: string | null; name: string; display_name: string | null };
  cycles: { id: string; period_start: string; period_end: string; amount_due: number;
    amount_paid: number; status: string; created_at: string; package_id: string }[];
  payment_requests: PaymentRequest[];
  approval_events: { id: string; payment_request_id: string | null; action: string;
    from_status: string | null; to_status: string | null; created_at: string }[];
  receipts: Receipt[];
};
type Envelope = { data?: History; error?: { message?: string } };
type SettleEnvelope = { data?: { settlement?: { receipt_number?: string } }; error?: { message?: string } };
type SettlementDraft = {
  bank_transaction_reference: string;
  bank_received_at: string;
  amount_received: string;
  confirmed_bank_receipt: boolean;
};

const formatDate = (value: string | null) => value
  ? new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(new Date(value))
  : "—";
const formatMoney = (value: number | null, currency = "THB") => value == null ? "—"
  : new Intl.NumberFormat("th-TH", { style: "currency", currency }).format(value);

export function SubscriptionPaymentHistory({ tenantId }: { tenantId: string }) {
  const [history, setHistory] = useState<History | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState("");
  const [notes, setNotes] = useState<Record<string,string>>({});
  const [settlementDrafts, setSettlementDrafts] = useState<Record<string,SettlementDraft>>({});

  const reload = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(
      "/api/it-admin/v1/subscription-payments/history/" + encodeURIComponent(tenantId),
      { cache: "no-store", signal }
    );
    const json = await response.json() as Envelope;
    if (!response.ok || !json.data) throw new Error(json.error?.message || "โหลดประวัติการชำระเงินไม่สำเร็จ");
    setHistory(json.data);
    return json.data;
  }, [tenantId]);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try { await reload(controller.signal); }
      catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "ไม่สามารถโหลดข้อมูล");
      } finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [reload]);

  const receiptByRequest = useMemo(
    () => new Map((history?.receipts ?? []).map((row) => [row.payment_request_id, row])),
    [history?.receipts]
  );

  function draftFor(row: PaymentRequest): SettlementDraft {
    return settlementDrafts[row.id] ?? {
      bank_transaction_reference: "",
      bank_received_at: row.transfer_at || "",
      amount_received: row.expected_amount != null
        ? Number(row.expected_amount).toFixed(2)
        : row.amount_reported != null ? Number(row.amount_reported).toFixed(2) : "",
      confirmed_bank_receipt: false
    };
  }

  function patchDraft(row: PaymentRequest, patch: Partial<SettlementDraft>) {
    const current = draftFor(row);
    setSettlementDrafts((value) => ({ ...value, [row.id]: { ...current, ...patch } }));
  }

  async function review(requestId:string,action:"under_review"|"reject") {
    const note=(notes[requestId]||"").trim();
    if(action==="reject" && !note) {setError("กรุณาระบุเหตุผลการปฏิเสธ");return;}
    setBusyId(requestId);setError("");setNotice("");
    try {
      const response=await fetch("/api/it-admin/v1/subscription-payments/review/"+encodeURIComponent(requestId),{
        method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({action,note})
      });
      const json=await response.json() as {error?:{message?:string}};
      if(!response.ok)throw new Error(json.error?.message||"ไม่สามารถปรับสถานะคำขอ");
      await reload();
      setNotice(action==="reject"?"ปฏิเสธคำขอแล้ว":"บันทึกสถานะกำลังตรวจสอบแล้ว");
    } catch(cause){setError(cause instanceof Error?cause.message:"ดำเนินการไม่สำเร็จ");}
    finally {setBusyId("");}
  }

  async function settle(row: PaymentRequest) {
    const draft = draftFor(row);
    const amount = Number(draft.amount_received);
    if (!draft.confirmed_bank_receipt) {
      setError("กรุณาติ๊กยืนยันว่าได้ตรวจสอบเงินเข้าบัญชีบริษัทจากรายการธนาคารแล้ว");
      return;
    }
    if (!draft.bank_transaction_reference.trim() || !draft.bank_received_at || !Number.isFinite(amount) || amount <= 0) {
      setError("กรอกเลขอ้างอิงธนาคาร วันเวลาเงินเข้า และยอดเงินจริงให้ครบ");
      return;
    }
    setBusyId(row.id); setError(""); setNotice("");
    try {
      const response = await fetch(
        "/api/it-admin/v1/subscription-payments/settle/" + encodeURIComponent(row.id),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            bank_transaction_reference: draft.bank_transaction_reference.trim(),
            bank_received_at: new Date(draft.bank_received_at).toISOString(),
            amount_received: Number(amount.toFixed(2)),
            note: (notes[row.id] || "").trim(),
            confirmed_bank_receipt: true
          })
        }
      );
      const json = await response.json() as SettleEnvelope;
      if (!response.ok || !json.data?.settlement) {
        throw new Error(json.error?.message || "ยืนยันเงินเข้าและเปิดแพ็กเกจไม่สำเร็จ");
      }
      await reload();
      const receiptNo = json.data.settlement.receipt_number || "";
      setNotice(receiptNo
        ? "ยืนยันเงินเข้า เปิดแพ็กเกจ และออกใบเสร็จ " + receiptNo + " แล้ว"
        : "ยืนยันเงินเข้า เปิดแพ็กเกจ และออกใบเสร็จแล้ว");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "ยืนยันรายการไม่สำเร็จ");
    } finally { setBusyId(""); }
  }

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
            : "แสดงรายการรอบบิล การตรวจรับเงินจริง และใบเสร็จจากฐานข้อมูลกลาง"}
        </p>
      </header>
      {loading ? <p>กำลังโหลด...</p> : null}
      {error ? <p role="alert" className="rounded-lg bg-red-50 p-4 text-red-700">{error}</p> : null}
      {notice ? <p role="status" className="rounded-lg bg-green-50 p-4 text-green-700">{notice}</p> : null}
      <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        สลิปที่ร้านแนบมาไม่ถือว่าเงินเข้าจริง ต้องตรวจรายการธนาคารของบริษัทก่อนทุกครั้ง
        · เมื่อ IT ยืนยันยอดและเลขอ้างอิงธนาคาร ระบบจะเปิด/ต่ออายุแพ็กเกจ สร้างรอบบิลชำระแล้ว
        และออกใบเสร็จเลขที่จริงในธุรกรรมเดียวกัน
      </p>

      {history ? <>
        <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-lg font-bold">รายการแจ้งชำระ ({history.payment_requests.length})</h2>
          {history.payment_requests.length === 0 ? <p className="text-sm text-slate-500">ยังไม่มีการแจ้งชำระในระบบ</p> :
            <div className="overflow-x-auto"><table className="w-full min-w-[1180px] text-left text-sm">
              <thead><tr className="border-b text-slate-500">{[
                "วันแจ้ง","ประเภท / รอบ","ยอดที่แจ้ง / ตามแพ็กเกจ","สถานะ","หลักฐาน / อ้างอิงร้าน",
                "วันตรวจ","หมายเหตุ IT","ตรวจรับเงินจริง / จัดการ"
              ].map((label) => <th className="p-3" key={label}>{label}</th>)}</tr></thead>
              <tbody>{history.payment_requests.map((row) => {
                const receipt = receiptByRequest.get(row.id);
                const draft = draftFor(row);
                return <tr className="border-b align-top" key={row.id}>
                  <td className="p-3">{formatDate(row.submitted_at)}</td>
                  <td className="p-3">{row.kind==="payment_notice"?"แจ้งโอน":"ขอต่ออายุ"}<br />
                    <span className="text-xs text-slate-500">{row.request_type} · {row.billing_interval==="yearly"?"รายปี":"รายเดือน"}</span></td>
                  <td className="p-3">{formatMoney(row.amount_reported, row.currency || "THB")}<br/>
                    <span className="text-xs text-slate-500">ตามแพ็กเกจ {formatMoney(row.expected_amount, row.currency || "THB")}</span></td>
                  <td className="p-3 font-semibold">{row.status}
                    {receipt ? <span className="mt-1 block text-xs font-bold text-emerald-700">ใบเสร็จ {receipt.receipt_number}</span> : null}
                  </td>
                  <td className="p-3">{row.slip_url ? <a className="text-blue-700 underline" href={row.slip_url} target="_blank" rel="noopener noreferrer">เปิดสลิป (ลิงก์ชั่วคราว)</a> : row.has_evidence ? "มีหลักฐาน · โหลดลิงก์ไม่สำเร็จ" : "—"}
                    {row.transfer_reference?<p className="mt-1 max-w-[180px] break-all text-xs text-slate-500">อ้างอิงร้าน {row.transfer_reference}</p>:null}
                    {row.payer_name?<p className="mt-1 text-xs text-slate-500">ผู้โอน {row.payer_name}</p>:null}</td>
                  <td className="p-3">{formatDate(row.reviewed_at)}</td>
                  <td className="p-3">{row.review_note || "—"}</td>
                  <td className="p-3">
                    {row.status === "pending" ? <div className="grid min-w-[220px] gap-2">
                      <input aria-label="หมายเหตุ IT" maxLength={500} value={notes[row.id]||""}
                        onChange={event=>setNotes(current=>({...current,[row.id]:event.target.value}))}
                        className="rounded-md border border-slate-300 px-2 py-1.5 text-xs" placeholder="หมายเหตุ / เหตุผลการปฏิเสธ" />
                      <button type="button" disabled={Boolean(busyId)}
                        onClick={()=>void review(row.id,"under_review")}
                        className="rounded-md border border-blue-200 bg-blue-50 px-2 py-1.5 text-xs font-bold text-blue-700 disabled:opacity-50">
                        รับเรื่องตรวจสอบ</button>
                      <button type="button" disabled={Boolean(busyId)} onClick={()=>void review(row.id,"reject")}
                        className="rounded-md border border-red-200 px-2 py-1.5 text-xs font-bold text-red-700 disabled:opacity-50">
                        ปฏิเสธพร้อมเหตุผล</button>
                    </div> : null}

                    {row.status === "under_review" ? <div className="grid min-w-[280px] gap-2 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
                      <strong className="text-xs text-emerald-900">ยืนยันจากรายการธนาคารของบริษัท</strong>
                      <input aria-label="เลขอ้างอิงธุรกรรมธนาคาร" maxLength={160}
                        value={draft.bank_transaction_reference}
                        onChange={(event)=>patchDraft(row,{bank_transaction_reference:event.target.value})}
                        className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs"
                        placeholder="Bank Transaction Ref." />
                      <div className="grid grid-cols-2 gap-2">
                        <input aria-label="วันเวลาเงินเข้าธนาคาร" type="datetime-local"
                          value={draft.bank_received_at}
                          onChange={(event)=>patchDraft(row,{bank_received_at:event.target.value})}
                          className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs" />
                        <input aria-label="ยอดเงินจริงที่เข้าบัญชี" type="number" min="0.01" step="0.01"
                          value={draft.amount_received}
                          onChange={(event)=>patchDraft(row,{amount_received:event.target.value})}
                          className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs"
                          placeholder="ยอดเงินจริง" />
                      </div>
                      <input aria-label="หมายเหตุ IT" maxLength={500} value={notes[row.id]||""}
                        onChange={event=>setNotes(current=>({...current,[row.id]:event.target.value}))}
                        className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs"
                        placeholder="หมายเหตุการตรวจสอบ (ถ้ามี)" />
                      <label className="flex items-start gap-2 text-xs font-semibold text-emerald-950">
                        <input type="checkbox" checked={draft.confirmed_bank_receipt}
                          onChange={(event)=>patchDraft(row,{confirmed_bank_receipt:event.target.checked})}
                          className="mt-0.5 h-4 w-4" />
                        <span>ตรวจสอบแล้วว่าเงินเข้าบัญชีบริษัทจริง และเลขอ้างอิงนี้ตรงกับรายการธนาคาร</span>
                      </label>
                      <button type="button" disabled={Boolean(busyId) || !draft.confirmed_bank_receipt}
                        onClick={()=>void settle(row)}
                        className="rounded-md bg-emerald-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
                        {busyId===row.id ? "กำลังยืนยัน..." : "ยืนยันเงินเข้า + เปิดแพ็กเกจ + ออกใบเสร็จ"}
                      </button>
                      <button type="button" disabled={Boolean(busyId)} onClick={()=>void review(row.id,"reject")}
                        className="rounded-md border border-red-200 bg-white px-2 py-1.5 text-xs font-bold text-red-700 disabled:opacity-50">
                        ปฏิเสธพร้อมเหตุผล</button>
                    </div> : null}

                    {row.status === "approved" ? <div className="min-w-[200px] rounded-lg bg-emerald-50 p-3 text-xs text-emerald-900">
                      รับเงินจริงและเปิดแพ็กเกจแล้ว
                      {receipt ? <><strong className="mt-1 block">{receipt.receipt_number}</strong>
                        <span className="block">{formatMoney(receipt.amount, receipt.currency)} · {formatDate(receipt.issued_at)}</span></> : null}
                    </div> : null}
                    {row.status === "rejected" ? <span className="text-xs text-red-700">รายการถูกปฏิเสธ</span> : null}
                  </td>
                </tr>;
              })}</tbody>
            </table></div>}
        </article>

        <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-lg font-bold">ใบเสร็จแพ็กเกจ ({history.receipts.length})</h2>
          {history.receipts.length === 0 ? <p className="text-sm text-slate-500">ยังไม่มีใบเสร็จจากรายการรับเงินจริง</p> :
            <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm">
              <thead><tr className="border-b text-slate-500">{["เลขที่ใบเสร็จ","วันที่ออก","แพ็กเกจ / รอบ","ช่วงบริการ","ยอดรับจริง","สถานะ"]
                .map((label)=><th className="p-3" key={label}>{label}</th>)}</tr></thead>
              <tbody>{history.receipts.map((row)=><tr className="border-b" key={row.id}>
                <td className="p-3 font-bold text-blue-700">{row.receipt_number}</td>
                <td className="p-3">{formatDate(row.issued_at)}</td>
                <td className="p-3">{row.package_name || "แพ็กเกจ"} · {row.billing_interval==="yearly"?"รายปี":"รายเดือน"}</td>
                <td className="p-3">{row.period_start || "—"} → {row.period_end || "—"}</td>
                <td className="p-3 font-semibold">{formatMoney(row.amount,row.currency)}</td>
                <td className="p-3 text-emerald-700">ออกแล้ว · ร้านเปิดดูได้จาก POS</td>
              </tr>)}</tbody>
            </table></div>}
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
