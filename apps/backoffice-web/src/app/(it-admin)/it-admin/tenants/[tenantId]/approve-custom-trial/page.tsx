"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

type View = {
  tenant_name: string;
  contract: { status: string; billing_interval: string; amount_per_cycle: number; currency: string; max_branches: number; max_devices: number; max_users: number };
  terms: { status: string; version: number; max_branches: number; max_devices: number; max_users: number; yearly_price: number };
  stats: { active_branches: number; active_devices: number; assigned_users: number; open_payment_requests: number; settled_payments: number };
  applied: boolean;
};
const style = { padding: 22, border: "1px solid #ccd7ed", borderRadius: 12, background: "#fff" };
export default function ApproveImdcCustomTrialPage() {
  const params = useParams<{ tenantId: string }>();
  const tenantId = params.tenantId;
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState("");
  const endpoint = `/api/it-admin/v1/tenants/${tenantId}/approve-custom-trial`;
  async function load() {
    const res = await fetch(endpoint, { credentials: "include", cache: "no-store" });
    const json = await res.json();
    if (!res.ok || json.error) throw new Error(json.error?.message ?? "ไม่สามารถตรวจข้อมูลอนุมัติได้");
    setView(json.data as View);
  }
  useEffect(() => {
    if (!tenantId) return;
    void load().catch(e => setError(e instanceof Error ? e.message : "โหลดข้อมูลไม่สำเร็จ"));
  // The tenant id is stable for this emergency control.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);
  async function approve() {
    if (!view || busy || view.applied) return;
    const message = `ยืนยันอนุมัติร่างเวอร์ชัน ${view.terms.version} ของ ${view.tenant_name}\nโควตา 2 สาขา / 2 เครื่อง / 8 ผู้ใช้\nคงสัญญา 5,000 บาท/ปี และทดลองใช้ฟรีเดิม\nไม่มีการรับชำระเงินหรือเปลี่ยนระยะสัญญา ใช่หรือไม่?`;
    if (!window.confirm(message)) return;
    setBusy(true); setError(""); setSuccess("");
    try {
      const res = await fetch(endpoint, {
        method: "POST", credentials: "include", headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: view.terms.version, confirm: "APPROVE_IMDC_CUSTOM_2_2_8" })
      });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error?.message ?? "อนุมัติไม่สำเร็จ");
      await load();
      setSuccess("อนุมัติและตรวจสอบโควตาในสัญญาจริงแล้ว");
    } catch (e) {
      setError(e instanceof Error ? e.message : "เกิดข้อผิดพลาด");
      // Reload after partial failure to show whether the draft was already approved.
      try { await load(); } catch { /* keep the first error */ }
    } finally { setBusy(false); }
  }
  return (
    <main style={{ maxWidth: 780, margin: "20px auto", padding: 20, display: "grid", gap: 16 }}>
      <h1>IT Control Plane · อนุมัติโควตา CUSTOM ทดลองใช้</h1>
      <p>รายการอนุมัติเฉพาะ IMDC OPTICAL · ไม่มีการคิดเงินหรือสร้างรายการชำระ</p>
      {error ? <p role="alert" style={{ color: "#b42318" }}>{error}</p> : null}
      {success ? <p role="status" style={{ color: "#166534" }}>{success}</p> : null}
      {!view ? <div style={style}>กำลังตรวจสอบสัญญาและร่าง CUSTOM ผ่านบัญชี IT...</div> : (
        <section style={{ ...style, display: "grid", gap: 14 }}>
          <h2>{view.tenant_name}</h2>
          <p><strong>สัญญา:</strong> {view.contract.status} · {view.contract.billing_interval === "yearly" ? "รายปี" : "รายเดือน"} · {view.contract.amount_per_cycle.toLocaleString("th-TH")} {view.contract.currency}</p>
          <p><strong>โควตาปัจจุบัน:</strong> {view.contract.max_branches} สาขา · {view.contract.max_devices} เครื่อง · {view.contract.max_users} ผู้ใช้</p>
          <p><strong>ร่างเวอร์ชัน {view.terms.version}:</strong> {view.terms.status} · {view.terms.max_branches} สาขา · {view.terms.max_devices} เครื่อง · {view.terms.max_users} ผู้ใช้ · {view.terms.yearly_price.toLocaleString("th-TH")} บาท/ปี</p>
          <p><strong>ใช้งานจริง:</strong> {view.stats.active_branches} สาขา · {view.stats.active_devices} เครื่อง · {view.stats.assigned_users} ผู้ใช้</p>
          <p><strong>รายการชำระที่รอ / รับชำระแล้ว:</strong> {view.stats.open_payment_requests} / {view.stats.settled_payments}</p>
          <button type="button" disabled={view.applied || busy || view.terms.status !== "draft"} onClick={() => void approve()}
            style={{ background: view.applied ? "#64748b" : "#1750ad", color: "#fff", border: 0, borderRadius: 8, padding: "14px 18px", cursor: "pointer" }}>
            {view.applied ? "ตรวจแล้ว: โควตา 2 / 2 / 8 มีผลแล้ว" : busy ? "กำลังอนุมัติ..." : "ยืนยันอนุมัติร่างและใช้โควตา 2 / 2 / 8"}
          </button>
          <p style={{ fontSize: 13 }}>ใช้บัญชี IT ที่มีสิทธิ์เท่านั้น การเปลี่ยนแปลงจะผูกผู้อนุมัติลง Audit Log และตรวจสัญญาใหม่หลังบันทึก</p>
        </section>
      )}
      <a href="/it-admin/tenants">กลับ Tenants / Stores</a>
    </main>
  );
}
