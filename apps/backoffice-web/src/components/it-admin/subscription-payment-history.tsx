"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

type PackagePrice = {
  id: string;
  code: string;
  name: string;
  monthly_price: number | null;
  yearly_price: number | null;
  quota_mode: string;
};
type PaymentRequest = {
  id: string;
  request_type: string;
  requested_package_id: string | null;
  requested_package_name: string;
  requested_package_code: string;
  amount_reported: number | null;
  currency: string | null;
  status: string;
  submitted_at: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  has_evidence: boolean;
  slip_url: string | null;
  kind: string;
  billing_interval: string;
  expected_amount: number | null;
  transfer_reference: string;
  payer_name: string;
  transfer_at: string;
  note: string;
  source: string;
};
type Receipt = {
  id: string;
  payment_request_id: string;
  billing_cycle_id: string;
  receipt_number: string;
  issued_at: string;
  amount: number;
  currency: string;
  package_id: string;
  package_code: string;
  package_name: string;
  billing_interval: string;
  period_start: string;
  period_end: string;
};
type History = {
  store: {
    id: string;
    code: string | null;
    name: string;
    display_name: string | null;
    owner_name: string | null;
    billing_email: string | null;
  };
  contract: {
    id: string;
    package_id: string;
    package_name: string;
    package_code: string;
    billing_interval: string | null;
    status: string;
    started_at: string | null;
    ended_at: string | null;
    amount_per_cycle: number | null;
    currency: string | null;
    effective_expires_at: string | null;
    lifecycle_status: string;
    access_locked: boolean;
  } | null;
  packages: PackagePrice[];
  cycles: {
    id: string;
    period_start: string;
    period_end: string;
    amount_due: number;
    amount_paid: number;
    status: string;
    created_at: string;
    package_id: string;
    package_name: string;
    package_code: string;
  }[];
  payment_requests: PaymentRequest[];
  approval_events: {
    id: string;
    payment_request_id: string | null;
    action: string;
    from_status: string | null;
    to_status: string | null;
    created_at: string;
  }[];
  receipts: Receipt[];
  summary: {
    total_paid: number;
    monthly_paid: number;
    yearly_paid: number;
    receipt_count: number;
    monthly_count: number;
    yearly_count: number;
    pending_request_count: number;
    paid_cycle_count: number;
  };
};
type Envelope = { data?: History; error?: { message?: string } };
type SettleEnvelope = { data?: { settlement?: { receipt_number?: string } }; error?: { message?: string } };
type SettlementDraft = {
  bank_transaction_reference: string;
  bank_received_at: string;
  amount_received: string;
  confirmed_bank_receipt: boolean;
};

type WorkspacePanel = "pending" | "payments" | "cycles" | "history" | "audit" | "summary" | "first-payment" | null;

function WorkspaceModal({ title, description, onClose, children }: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return <div
    className="fixed inset-0 z-[300] flex items-center justify-center bg-slate-950/50 p-3 backdrop-blur-[2px] sm:p-5"
    role="presentation"
    onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
    <section role="dialog" aria-modal="true" aria-label={title}
      className="flex max-h-[92vh] w-full max-w-[1180px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-6">
        <div className="min-w-0">
          <h2 className="text-lg font-black text-slate-900 sm:text-xl">{title}</h2>
          {description ? <p className="mt-1 text-sm leading-6 text-slate-500">{description}</p> : null}
        </div>
        <button type="button" onClick={onClose} aria-label="ปิดหน้าต่าง"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-xl font-bold text-slate-500 hover:bg-slate-50">
          ×
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">{children}</div>
      <footer className="flex shrink-0 justify-end border-t border-slate-200 px-5 py-3 sm:px-6">
        <button type="button" onClick={onClose}
          className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">
          ปิด
        </button>
      </footer>
    </section>
  </div>;
}

const REQUEST_STATUS: Record<string,string> = {
  pending: "รอตรวจสอบ",
  under_review: "กำลังตรวจสอบ",
  approved: "อนุมัติแล้ว",
  rejected: "ไม่อนุมัติ",
  cancelled: "ยกเลิก"
};
const SERVICE_STATUS: Record<string,string> = {
  trial: "ทดลองใช้",
  active: "ใช้งานอยู่",
  grace: "ช่วงผ่อนผัน",
  expired: "หมดอายุ",
  suspended: "ระงับ",
  cancelled: "ยกเลิก"
};

function formatDateTime(value: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok"
  }).format(parsed);
}
function formatDate(value: string | null) {
  if (!value) return "—";
  const parsed = new Date(value.length === 10 ? value + "T12:00:00+07:00" : value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeZone: "Asia/Bangkok"
  }).format(parsed);
}
function formatMoney(value: number | null, currency = "THB") {
  return value == null || !Number.isFinite(Number(value))
    ? "—"
    : new Intl.NumberFormat("th-TH", { style: "currency", currency: currency || "THB" }).format(Number(value));
}
function billingLabel(value: string | null) {
  return value === "yearly" ? "รายปี" : value === "monthly" ? "รายเดือน" : "—";
}
function amountDifference(row: PaymentRequest) {
  if (row.amount_reported == null || row.expected_amount == null) return null;
  return Number(row.amount_reported) - Number(row.expected_amount);
}

export function SubscriptionPaymentHistory({ tenantId }: { tenantId: string }) {
  const [history, setHistory] = useState<History | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState("");
  const [notes, setNotes] = useState<Record<string,string>>({});
  const [settlementDrafts, setSettlementDrafts] = useState<Record<string,SettlementDraft>>({});
  const [annualPriceDrafts, setAnnualPriceDrafts] = useState<Record<string,string>>({});
  const [savingPackageId, setSavingPackageId] = useState("");
  const [activePanel, setActivePanel] = useState<WorkspacePanel>(null);
  const [firstPackageId, setFirstPackageId] = useState("");
  const [firstBillingInterval, setFirstBillingInterval] = useState<"monthly" | "yearly">("monthly");
  const [firstPaymentNote, setFirstPaymentNote] = useState("");
  const [creatingFirstPayment, setCreatingFirstPayment] = useState(false);

  const reload = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(
      "/api/it-admin/v1/subscription-payments/history/" + encodeURIComponent(tenantId),
      { cache: "no-store", signal }
    );
    const json = await response.json() as Envelope;
    if (!response.ok || !json.data) throw new Error(json.error?.message || "โหลดรายละเอียดการชำระแพ็กเกจไม่สำเร็จ");
    setHistory(json.data);
    setAnnualPriceDrafts(Object.fromEntries(
      json.data.packages.map((pkg) => [pkg.id, pkg.yearly_price && pkg.yearly_price > 0 ? String(pkg.yearly_price) : ""])
    ));
    const preferredPackageId = json.data.contract?.package_id ||
      json.data.packages.find((pkg) => pkg.code !== "custom" && (pkg.monthly_price ?? 0) > 0)?.id ||
      json.data.packages[0]?.id || "";
    setFirstPackageId(preferredPackageId);
    setFirstBillingInterval(json.data.contract?.billing_interval === "yearly" ? "yearly" : "monthly");
    return json.data;
  }, [tenantId]);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        await reload(controller.signal);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : "ไม่สามารถโหลดข้อมูล");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [reload]);

  const receiptByRequest = useMemo(
    () => new Map((history?.receipts ?? []).map((row) => [row.payment_request_id, row])),
    [history?.receipts]
  );
  const openRequests = useMemo(
    () => (history?.payment_requests ?? []).filter((row) => ["pending","under_review"].includes(row.status)),
    [history?.payment_requests]
  );
  const completedRequests = useMemo(
    () => (history?.payment_requests ?? []).filter((row) => !["pending","under_review"].includes(row.status)),
    [history?.payment_requests]
  );
  const firstPackage = useMemo(
    () => history?.packages.find((pkg) => pkg.id === firstPackageId) ?? null,
    [history?.packages, firstPackageId]
  );
  const firstExpectedAmount = firstPackage
    ? Number(firstBillingInterval === "yearly" ? firstPackage.yearly_price ?? 0 : firstPackage.monthly_price ?? 0)
    : 0;
  const isInternalDemo = history?.contract?.lifecycle_status === "sales_demo";
  const canCreatePaymentRequest = Boolean(history) && !isInternalDemo && openRequests.length === 0 &&
    Boolean(firstPackageId) && Number.isFinite(firstExpectedAmount) && firstExpectedAmount > 0;

  useEffect(() => {
    if (!activePanel) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActivePanel(null);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [activePanel]);

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

  async function review(requestId: string, action: "under_review" | "reject") {
    const note = (notes[requestId] || "").trim();
    if (action === "reject" && !note) {
      setError("กรุณาระบุเหตุผลที่ไม่อนุมัติ");
      return;
    }
    setBusyId(requestId);
    setError("");
    setNotice("");
    try {
      const response = await fetch(
        "/api/it-admin/v1/subscription-payments/review/" + encodeURIComponent(requestId),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action, note })
        }
      );
      const json = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(json.error?.message || "ไม่สามารถปรับสถานะคำขอ");
      await reload();
      setNotice(action === "reject" ? "บันทึกไม่อนุมัติคำขอแล้ว" : "รับเรื่องเข้าตรวจสอบแล้ว");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "ดำเนินการไม่สำเร็จ");
    } finally {
      setBusyId("");
    }
  }

  function annualSuggestion(pkg: PackagePrice, discountPercent = 0) {
    if (!pkg.monthly_price || pkg.monthly_price <= 0) return "";
    const base = Number(pkg.monthly_price) * 12;
    const discount = Math.max(0, Math.min(100, discountPercent));
    return (base * (1 - discount / 100)).toFixed(2);
  }

  async function saveAnnualPrice(pkg: PackagePrice) {
    if (pkg.code === "custom") {
      setError("แพ็กเกจ CUSTOM ใช้ราคาตามสัญญาร้านค้า ไม่ควรกำหนดราคาปีแบบกลาง");
      return;
    }
    const raw = (annualPriceDrafts[pkg.id] || "").trim();
    const value = Number(raw);
    if (!raw || !Number.isFinite(value) || value <= 0 || value > 10_000_000) {
      setError("กรุณากรอกราคารายปีที่มากกว่า 0 บาท");
      return;
    }
    setSavingPackageId(pkg.id);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/it-admin/v1/packages/" + encodeURIComponent(pkg.id), {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          yearly_price: Number(value.toFixed(2)),
          reason: "subscription_billing_workspace_annual_price"
        })
      });
      const json = await response.json() as { data?: unknown; error?: { message?: string } };
      if (!response.ok || !json.data) {
        throw new Error(json.error?.message || "บันทึกราคารายปีไม่สำเร็จ");
      }
      await reload();
      setNotice("บันทึกราคารายปี " + pkg.name + " เป็น " + formatMoney(value) + " แล้ว · ฝั่ง CpIPOS จะอ่านราคานี้จาก CpiPOS-001");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "บันทึกราคารายปีไม่สำเร็จ");
    } finally {
      setSavingPackageId("");
    }
  }

  async function createFirstPaymentRequest() {
    if (!history || !canCreatePaymentRequest || !firstPackage) {
      if (openRequests.length > 0) {
        setError("ร้านนี้มีรายการชำระที่รอตรวจสอบอยู่แล้ว กรุณาเปิดเมนูตรวจสอบรายการรออนุมัติ");
        setActivePanel("pending");
      } else {
        setError(isInternalDemo
          ? "บัญชีทดสอบภายในไม่สร้างรายการรับชำระแพ็กเกจ"
          : "กรุณาเลือกแพ็กเกจและรอบชำระที่มีราคาก่อนสร้างรายการ");
      }
      return;
    }

    setCreatingFirstPayment(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/it-admin/v1/tenants/" + encodeURIComponent(tenantId) + "/control", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "prepare_paid_package",
          package_id: firstPackage.id,
          billing_cycle: firstBillingInterval,
          admin_reason: firstPaymentNote.trim()
        })
      });
      const json = await response.json() as { data?: unknown; error?: { message?: string } };
      if (!response.ok || !json.data) {
        throw new Error(json.error?.message || "สร้างรายการชำระไม่สำเร็จ");
      }
      await reload();
      setFirstPaymentNote("");
      setNotice((history.summary.receipt_count === 0 ? "สร้างรายการชำระรอบแรก" : "สร้างรายการชำระ") +
        "แล้ว · รอร้านแนบสลิป/แจ้งชำระ และรอ IT ตรวจเงินเข้าจริงก่อนออกใบเสร็จ");
      setActivePanel("pending");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "สร้างรายการชำระไม่สำเร็จ");
    } finally {
      setCreatingFirstPayment(false);
    }
  }

  async function settle(row: PaymentRequest) {
    const draft = draftFor(row);
    const amount = Number(draft.amount_received);
    if (row.kind !== "payment_notice") {
      setError("ยังอนุมัติไม่ได้ รายการนี้ต้องเป็นการแจ้งชำระเงินจริงก่อน");
      return;
    }
    if (!draft.confirmed_bank_receipt) {
      setError("กรุณายืนยันว่าได้ตรวจสอบเงินเข้าบัญชีบริษัทจากรายการธนาคารแล้ว");
      return;
    }
    if (!draft.bank_transaction_reference.trim() || !draft.bank_received_at ||
        !Number.isFinite(amount) || amount <= 0) {
      setError("กรอกเลขอ้างอิงธนาคาร วันเวลาเงินเข้า และยอดเงินจริงให้ครบ");
      return;
    }

    setBusyId(row.id);
    setError("");
    setNotice("");
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
        throw new Error(json.error?.message || "อนุมัติรับเงินและต่อแพ็กเกจไม่สำเร็จ");
      }
      await reload();
      const receiptNo = json.data.settlement.receipt_number || "";
      setNotice(receiptNo
        ? "อนุมัติแล้ว · ต่อแพ็กเกจและออกใบเสร็จ " + receiptNo + " สำเร็จ"
        : "อนุมัติแล้ว · ต่อแพ็กเกจและออกใบเสร็จสำเร็จ");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "ยืนยันรายการไม่สำเร็จ");
    } finally {
      setBusyId("");
    }
  }

  return (
    <section className="space-y-5 px-5 py-6 md:px-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/it-admin/subscription-payments"
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-blue-700 shadow-sm">
          ← กลับตารางชำระแพ็กเกจ
        </Link>
        <button type="button" onClick={() => void reload()} disabled={loading}
          className="rounded-lg border border-blue-200 bg-white px-4 py-2 text-sm font-semibold text-blue-700 disabled:opacity-50">
          รีเฟรชข้อมูล
        </button>
      </div>

      <header className="rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-50 to-white p-5 shadow-sm">
        <p className="text-xs font-bold tracking-[0.14em] text-blue-600">SUBSCRIPTION PAYMENT REVIEW / CpiPOS-001</p>
        <h1 className="mt-1 text-2xl font-black text-slate-900">ตรวจสอบการชำระและต่อแพ็กเกจ</h1>
        <p className="mt-2 text-sm text-slate-600">
          {history
            ? (history.store.display_name || history.store.name) + " · " + (history.store.code || "ไม่มีรหัสร้าน")
            : "โหลดข้อมูลร้านและรายการชำระจากฐานข้อมูลกลาง"}
        </p>
      </header>

      {loading ? <p className="rounded-xl bg-white p-5 text-sm text-slate-500">กำลังโหลดข้อมูล...</p> : null}
      {error ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</p> : null}
      {notice ? <p role="status" className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm font-semibold text-green-700">{notice}</p> : null}

      {history ? <>
        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold text-slate-500">แพ็กเกจปัจจุบัน</p>
            <strong className="mt-2 block text-xl text-slate-900">{history.contract?.package_name || "ยังไม่มีแพ็กเกจ"}</strong>
            <p className="mt-1 text-sm text-slate-500">{billingLabel(history.contract?.billing_interval ?? null)} · {SERVICE_STATUS[history.contract?.lifecycle_status || ""] || history.contract?.lifecycle_status || "—"}</p>
          </article>
          <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold text-slate-500">ค่าบริการต่อรอบปัจจุบัน</p>
            <strong className="mt-2 block text-xl text-slate-900">{formatMoney(history.contract?.amount_per_cycle ?? null, history.contract?.currency || "THB")}</strong>
            <p className="mt-1 text-sm text-slate-500">หมดอายุ {formatDate(history.contract?.effective_expires_at ?? null)}</p>
          </article>
          <article className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm">
            <p className="text-xs font-semibold text-emerald-700">ยอดรับชำระสะสม</p>
            <strong className="mt-2 block text-xl text-emerald-900">{formatMoney(history.summary.total_paid)}</strong>
            <p className="mt-1 text-sm text-emerald-700">{history.summary.receipt_count} ใบเสร็จ · {history.summary.paid_cycle_count} รอบบิลชำระแล้ว</p>
          </article>
          <article className="rounded-2xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
            <p className="text-xs font-semibold text-amber-700">รอตรวจสอบ</p>
            <strong className="mt-2 block text-xl text-amber-900">{history.summary.pending_request_count} รายการ</strong>
            <p className="mt-1 text-sm text-amber-700">ต้องยืนยันเงินเข้าธนาคารก่อนอนุมัติ</p>
          </article>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-lg font-black text-slate-900">ราคาแพ็กเกจ</h2>
              <p className="mt-1 text-sm text-slate-500">ใช้ตรวจสอบยอดที่ร้านแจ้งก่อนอนุมัติ รายเดือนและรายปีอ่านจากแพ็กเกจจริงใน CpiPOS-001</p>
            </div>
            <span className="text-xs font-semibold text-slate-500">เจ้าของร้าน: {history.store.owner_name || "—"} · {history.store.billing_email || "ไม่มีอีเมล"}</span>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {history.packages.map((pkg) => {
              const current = history.contract?.package_id === pkg.id;
              return <article key={pkg.id}
                className={"rounded-xl border p-4 " + (current ? "border-blue-300 bg-blue-50" : "border-slate-200 bg-slate-50/60")}>
                <div className="flex items-center justify-between gap-2">
                  <strong className="text-base text-slate-900">{pkg.name}</strong>
                  {current ? <span className="rounded-full bg-blue-600 px-2 py-1 text-[11px] font-bold text-white">แพ็กเกจปัจจุบัน</span> : null}
                </div>
                <p className="mt-1 text-xs uppercase text-slate-500">{pkg.code}</p>
                <dl className="mt-3 grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-white p-3">
                    <dt className="text-xs text-slate-500">รายเดือน</dt>
                    <dd className="mt-1 font-extrabold text-slate-900">{pkg.monthly_price && pkg.monthly_price > 0 ? formatMoney(pkg.monthly_price) : "ยังไม่กำหนด"}</dd>
                  </div>
                  <div className="rounded-lg bg-white p-3">
                    <dt className="text-xs text-slate-500">รายปี</dt>
                    <dd className="mt-1 font-extrabold text-slate-900">{pkg.yearly_price && pkg.yearly_price > 0 ? formatMoney(pkg.yearly_price) : "ยังไม่กำหนด"}</dd>
                  </div>
                </dl>
                {pkg.code !== "custom" ? <div className="mt-3 rounded-xl border border-blue-100 bg-white p-3">
                  <p className="text-xs font-bold text-blue-700">ตั้งราคารายปีสำหรับ POS</p>
                  <p className="mt-1 text-[11px] leading-5 text-slate-500">
                    ตัวเลขแนะนำด้านล่างเป็นเพียงเครื่องช่วยคำนวณ ยังไม่เปลี่ยนราคาจริงจนกด “บันทึกราคารายปี”
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button"
                      onClick={() => setAnnualPriceDrafts((current) => ({ ...current, [pkg.id]: annualSuggestion(pkg, 0) }))}
                      className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-700">
                      12 เดือน {annualSuggestion(pkg, 0) ? "· " + formatMoney(Number(annualSuggestion(pkg, 0))) : ""}
                    </button>
                    <button type="button"
                      onClick={() => setAnnualPriceDrafts((current) => ({ ...current, [pkg.id]: annualSuggestion(pkg, 10) }))}
                      className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700">
                      ตัวอย่างลด 10% {annualSuggestion(pkg, 10) ? "· " + formatMoney(Number(annualSuggestion(pkg, 10))) : ""}
                    </button>
                  </div>
                  <div className="mt-2 flex gap-2">
                    <input type="number" min="0.01" max="10000000" step="0.01"
                      aria-label={"ราคารายปี " + pkg.name}
                      value={annualPriceDrafts[pkg.id] ?? ""}
                      onChange={(event) => setAnnualPriceDrafts((current) => ({ ...current, [pkg.id]: event.target.value }))}
                      placeholder="กรอกราคารายปี (บาท)"
                      className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                    <button type="button" disabled={Boolean(savingPackageId)}
                      onClick={() => void saveAnnualPrice(pkg)}
                      className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
                      {savingPackageId === pkg.id ? "กำลังบันทึก..." : "บันทึกราคารายปี"}
                    </button>
                  </div>
                </div> : <p className="mt-3 rounded-lg bg-violet-50 p-2 text-xs text-violet-700">
                  CUSTOM ใช้ราคาตามสัญญาของแต่ละร้าน ไม่กำหนดราคารายปีแบบกลาง
                </p>}
              </article>;
            })}
          </div>
        </section>

        <section className="rounded-2xl border border-amber-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-black text-slate-900">ตรวจสอบรายการรออนุมัติ</h2>
              <p className="mt-1 text-sm text-slate-500">สลิปจากร้านเป็นเพียงหลักฐานประกอบ ต้องตรวจยอดเงินจริงในบัญชีบริษัทก่อนออกใบเสร็จ</p>
            </div>
            <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-800">{openRequests.length} รายการเปิดอยู่</span>
          </div>

          {openRequests.length === 0 ? <p className="mt-4 rounded-xl bg-slate-50 p-5 text-sm text-slate-500">ไม่มีรายการรอตรวจสอบ</p> :
            <div className="mt-4 space-y-4">{openRequests.map((row) => {
              const draft = draftFor(row);
              const diff = amountDifference(row);
              const canApprove = row.status === "under_review" && row.kind === "payment_notice";
              return <article key={row.id} className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                <div className="grid gap-4 xl:grid-cols-[1.15fr_.85fr]">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="text-base text-slate-900">{row.requested_package_name || "แพ็กเกจ"}</strong>
                      <span className="rounded-full bg-blue-50 px-2 py-1 text-xs font-bold text-blue-700">{billingLabel(row.billing_interval)}</span>
                      <span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-bold text-amber-800">{REQUEST_STATUS[row.status] || row.status}</span>
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      <div className="rounded-lg bg-white p-3"><p className="text-xs text-slate-500">ยอดตามแพ็กเกจ</p><strong>{formatMoney(row.expected_amount,row.currency || "THB")}</strong></div>
                      <div className="rounded-lg bg-white p-3"><p className="text-xs text-slate-500">ยอดที่ร้านแจ้ง</p><strong>{formatMoney(row.amount_reported,row.currency || "THB")}</strong></div>
                      <div className="rounded-lg bg-white p-3"><p className="text-xs text-slate-500">ผลต่าง</p>
                        <strong className={diff === null ? "text-slate-500" : Math.abs(diff) < 0.005 ? "text-emerald-700" : "text-red-700"}>
                          {diff === null ? "—" : Math.abs(diff) < 0.005 ? "ยอดตรงกัน" : formatMoney(diff,row.currency || "THB")}
                        </strong>
                      </div>
                    </div>
                    <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                      <div><dt className="text-xs text-slate-500">วันที่แจ้ง</dt><dd className="font-semibold">{formatDateTime(row.submitted_at)}</dd></div>
                      <div><dt className="text-xs text-slate-500">วันที่ร้านแจ้งว่าโอน</dt><dd className="font-semibold">{formatDateTime(row.transfer_at || null)}</dd></div>
                      <div><dt className="text-xs text-slate-500">ชื่อผู้โอน</dt><dd className="font-semibold">{row.payer_name || "—"}</dd></div>
                      <div><dt className="text-xs text-slate-500">อ้างอิงจากร้าน</dt><dd className="break-all font-semibold">{row.transfer_reference || "—"}</dd></div>
                    </dl>
                    {row.note ? <p className="mt-3 rounded-lg bg-white p-3 text-sm text-slate-600">หมายเหตุร้าน: {row.note}</p> : null}
                    <div className="mt-3 flex flex-wrap gap-2">
                      {row.slip_url ? <a href={row.slip_url} target="_blank" rel="noopener noreferrer"
                        className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-bold text-blue-700">
                        เปิดสลิปการชำระเงิน
                      </a> : <span className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-500">
                        {row.has_evidence ? "มีสลิป แต่สร้างลิงก์ชั่วคราวไม่สำเร็จ" : "ยังไม่มีสลิป"}
                      </span>}
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white p-4">
                    <label className="grid gap-1 text-xs font-bold text-slate-700">
                      หมายเหตุ IT / เหตุผลไม่อนุมัติ
                      <textarea rows={2} maxLength={500} value={notes[row.id] || ""}
                        onChange={(event) => setNotes((current) => ({ ...current, [row.id]: event.target.value }))}
                        className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal"
                        placeholder="ระบุข้อมูลตรวจสอบ หรือเหตุผลเมื่อไม่อนุมัติ" />
                    </label>

                    {row.status === "pending" ? <div className="mt-3 grid gap-2">
                      <button type="button" disabled={Boolean(busyId)}
                        onClick={() => void review(row.id,"under_review")}
                        className="rounded-lg bg-blue-600 px-3 py-2.5 text-sm font-bold text-white disabled:opacity-50">
                        รับเรื่องและเริ่มตรวจสอบ
                      </button>
                      <button type="button" disabled={Boolean(busyId)}
                        onClick={() => void review(row.id,"reject")}
                        className="rounded-lg border border-red-200 bg-white px-3 py-2.5 text-sm font-bold text-red-700 disabled:opacity-50">
                        ไม่อนุมัติ
                      </button>
                    </div> : null}

                    {row.status === "under_review" ? <>
                      {row.kind !== "payment_notice" ?
                        <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-900">
                          รายการนี้ยังเป็นคำขอต่ออายุ ต้องให้ร้านแจ้งชำระจากฝั่ง CpIPOS ก่อนจึงจะอนุมัติรับเงินจริงได้
                        </p> :
                        <div className="mt-3 grid gap-2">
                          {!row.has_evidence ? <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
                            รายการนี้ไม่มีไฟล์สลิปในระบบ ให้ยึดการตรวจรายการธนาคารของบริษัทเป็นหลักก่อนอนุมัติ
                          </p> : null}
                          <label className="grid gap-1 text-xs font-bold text-slate-700">เลขอ้างอิงธุรกรรมธนาคาร
                            <input maxLength={160} value={draft.bank_transaction_reference}
                              onChange={(event) => patchDraft(row,{bank_transaction_reference:event.target.value})}
                              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal"
                              placeholder="Bank Transaction Ref." />
                          </label>
                          <div className="grid gap-2 sm:grid-cols-2">
                            <label className="grid gap-1 text-xs font-bold text-slate-700">วันเวลาเงินเข้าจริง
                              <input type="datetime-local" value={draft.bank_received_at}
                                onChange={(event) => patchDraft(row,{bank_received_at:event.target.value})}
                                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal" />
                            </label>
                            <label className="grid gap-1 text-xs font-bold text-slate-700">ยอดเงินจริงที่เข้าบัญชี
                              <input type="number" min="0.01" step="0.01" value={draft.amount_received}
                                onChange={(event) => patchDraft(row,{amount_received:event.target.value})}
                                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal" />
                            </label>
                          </div>
                          <label className="flex items-start gap-2 rounded-lg bg-emerald-50 p-3 text-xs font-semibold text-emerald-950">
                            <input type="checkbox" checked={draft.confirmed_bank_receipt}
                              onChange={(event) => patchDraft(row,{confirmed_bank_receipt:event.target.checked})}
                              className="mt-0.5 h-4 w-4" />
                            <span>ตรวจสอบแล้วว่าเงินเข้าบัญชีบริษัทจริง ยอดและเลขอ้างอิงตรงกับรายการธนาคาร</span>
                          </label>
                        </div>}

                      <div className="mt-3 grid gap-2">
                        <button type="button"
                          disabled={Boolean(busyId) || !canApprove || !draft.confirmed_bank_receipt}
                          onClick={() => void settle(row)}
                          className="rounded-lg bg-emerald-600 px-3 py-2.5 text-sm font-black text-white disabled:opacity-50">
                          {busyId === row.id ? "กำลังอนุมัติ..." : "อนุมัติ + ต่อแพ็กเกจ + ออกใบเสร็จ"}
                        </button>
                        <button type="button" disabled={Boolean(busyId)}
                          onClick={() => void review(row.id,"reject")}
                          className="rounded-lg border border-red-200 bg-white px-3 py-2.5 text-sm font-bold text-red-700 disabled:opacity-50">
                          ไม่อนุมัติ
                        </button>
                      </div>
                    </> : null}
                  </div>
                </div>
              </article>;
            })}</div>}
        </section>

        <section className="grid gap-3 md:grid-cols-3">
          <article className="rounded-2xl border border-blue-200 bg-blue-50 p-5">
            <p className="text-sm font-semibold text-blue-700">ยอดชำระแบบรายเดือน</p>
            <strong className="mt-2 block text-2xl text-blue-950">{formatMoney(history.summary.monthly_paid)}</strong>
            <p className="mt-1 text-xs text-blue-700">{history.summary.monthly_count} ครั้ง</p>
          </article>
          <article className="rounded-2xl border border-violet-200 bg-violet-50 p-5">
            <p className="text-sm font-semibold text-violet-700">ยอดชำระแบบรายปี</p>
            <strong className="mt-2 block text-2xl text-violet-950">{formatMoney(history.summary.yearly_paid)}</strong>
            <p className="mt-1 text-xs text-violet-700">{history.summary.yearly_count} ครั้ง</p>
          </article>
          <article className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
            <p className="text-sm font-semibold text-emerald-700">ยอดรับชำระรวมทั้งหมด</p>
            <strong className="mt-2 block text-2xl text-emerald-950">{formatMoney(history.summary.total_paid)}</strong>
            <p className="mt-1 text-xs text-emerald-700">คำนวณจากใบเสร็จที่ออกจริง {history.summary.receipt_count} ใบ</p>
          </article>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-black text-slate-900">ตารางการชำระและต่อแพ็กเกจแต่ละครั้ง</h2>
          <p className="mt-1 text-sm text-slate-500">ข้อมูลรับเงินจริงและใบเสร็จเป็นแหล่งคำนวณยอด รายการเดียวกันจะแสดงในฝั่ง CpIPOS เมนูชำระเงินด้วย</p>
          {history.receipts.length === 0 ? <p className="mt-4 rounded-xl bg-slate-50 p-5 text-sm text-slate-500">ยังไม่มีใบเสร็จจากรายการรับเงินจริง</p> :
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[980px] text-left text-sm">
                <thead><tr className="border-b bg-slate-50 text-slate-500">
                  {["วันที่รับชำระ","เลขที่ใบเสร็จ","แพ็กเกจ","รอบ","ช่วงบริการ","ยอดรับจริง","เอกสาร"].map((label) =>
                    <th className="p-3" key={label}>{label}</th>)}
                </tr></thead>
                <tbody>{history.receipts.map((row) => <tr className="border-b" key={row.id}>
                  <td className="p-3">{formatDateTime(row.issued_at)}</td>
                  <td className="p-3 font-bold text-blue-700">{row.receipt_number}</td>
                  <td className="p-3">{row.package_name || "แพ็กเกจ"}<br/><span className="text-xs text-slate-500">{row.package_code || "—"}</span></td>
                  <td className="p-3"><span className={row.billing_interval === "yearly"
                    ? "rounded-full bg-violet-50 px-2 py-1 font-semibold text-violet-700"
                    : "rounded-full bg-blue-50 px-2 py-1 font-semibold text-blue-700"}>{billingLabel(row.billing_interval)}</span></td>
                  <td className="p-3">{formatDate(row.period_start || null)} → {formatDate(row.period_end || null)}</td>
                  <td className="p-3 font-bold">{formatMoney(row.amount,row.currency)}</td>
                  <td className="p-3"><a
                    href={"/api/it-admin/v1/subscription-payments/receipts/" + encodeURIComponent(row.id)}
                    target="_blank" rel="noopener noreferrer"
                    className="inline-flex rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700">
                    เปิดใบเสร็จ / พิมพ์ PDF
                  </a></td>
                </tr>)}</tbody>
              </table>
            </div>}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-black text-slate-900">รอบบิลแพ็กเกจ</h2>
          {history.cycles.length === 0 ? <p className="mt-4 rounded-xl bg-slate-50 p-5 text-sm text-slate-500">ยังไม่มีรอบบิลที่บันทึกไว้</p> :
            <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[820px] text-left text-sm">
              <thead><tr className="border-b text-slate-500">{["แพ็กเกจ","เริ่มรอบ","สิ้นสุดรอบ","ยอดเรียกเก็บ","ยอดชำระ","สถานะ"]
                .map((label) => <th className="p-3" key={label}>{label}</th>)}</tr></thead>
              <tbody>{history.cycles.map((row) => <tr className="border-b" key={row.id}>
                <td className="p-3">{row.package_name || "—"}</td>
                <td className="p-3">{formatDate(row.period_start)}</td>
                <td className="p-3">{formatDate(row.period_end)}</td>
                <td className="p-3">{formatMoney(row.amount_due)}</td>
                <td className="p-3">{formatMoney(row.amount_paid)}</td>
                <td className="p-3">{row.status}</td>
              </tr>)}</tbody>
            </table></div>}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-black text-slate-900">ประวัติคำขอและผลตรวจสอบ</h2>
          {completedRequests.length === 0 ? <p className="mt-4 rounded-xl bg-slate-50 p-5 text-sm text-slate-500">ยังไม่มีคำขอที่ปิดรายการ</p> :
            <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm">
              <thead><tr className="border-b text-slate-500">{["วันที่","แพ็กเกจ / รอบ","ประเภท","ยอดแจ้ง","ผลตรวจสอบ","ใบเสร็จ"]
                .map((label) => <th className="p-3" key={label}>{label}</th>)}</tr></thead>
              <tbody>{completedRequests.map((row) => {
                const receipt = receiptByRequest.get(row.id);
                return <tr className="border-b" key={row.id}>
                  <td className="p-3">{formatDateTime(row.submitted_at)}</td>
                  <td className="p-3">{row.requested_package_name || "—"} · {billingLabel(row.billing_interval)}</td>
                  <td className="p-3">{row.kind === "payment_notice" ? "แจ้งชำระเงิน" : "ขอต่ออายุ"}</td>
                  <td className="p-3">{formatMoney(row.amount_reported,row.currency || "THB")}</td>
                  <td className="p-3"><strong>{REQUEST_STATUS[row.status] || row.status}</strong>{row.review_note ? <p className="mt-1 text-xs text-slate-500">{row.review_note}</p> : null}</td>
                  <td className="p-3">{receipt ? <a
                    href={"/api/it-admin/v1/subscription-payments/receipts/" + encodeURIComponent(receipt.id)}
                    target="_blank" rel="noopener noreferrer"
                    className="font-bold text-blue-700 underline">{receipt.receipt_number}</a> : "—"}</td>
                </tr>;
              })}</tbody>
            </table></div>}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-black text-slate-900">Audit การอนุมัติ / ไม่อนุมัติ</h2>
          {history.approval_events.length === 0 ? <p className="mt-3 text-sm text-slate-500">ยังไม่มีเหตุการณ์อนุมัติแพ็กเกจ</p>
            : <ul className="mt-3 grid gap-2 md:grid-cols-2">{history.approval_events.map((item) => <li key={item.id}
              className="rounded-lg border border-slate-100 p-3 text-sm">
              <strong>{formatDateTime(item.created_at)}</strong><br/>
              {item.action} · {item.from_status || "—"} → {item.to_status || "—"}
            </li>)}</ul>}
        </section>
      </> : null}
    </section>
  );
}
