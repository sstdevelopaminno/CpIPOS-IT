"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./tenant-daily-sales-email-settings.module.css";

type ApiEnvelope<T> = { data: T | null; error: { message?: string } | null };

type State = {
  tenant: { id: string; name: string; is_active: boolean };
  enabled: boolean;
  owner: {
    user_id: string | null;
    full_name: string;
    email: string;
    is_active: boolean;
    email_valid: boolean;
    email_problem: string | null;
  };
  schedule: {
    timezone: string;
    cutoff: string;
    send_at: string;
    business_day_rule: string;
    only_when_completed_sales: boolean;
  };
  last_delivery: {
    id: string;
    recipient_email: string;
    status: string;
    attempt_count: number;
    last_attempt_at: string | null;
    sent_at: string | null;
    last_error: string | null;
    created_at: string;
    updated_at: string;
  } | null;
  updated_at: string | null;
};

function when(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("th-TH", {
    timeZone: "Asia/Bangkok",
    dateStyle: "medium",
    timeStyle: "short"
  });
}

function deliveryLabel(status: string | null | undefined) {
  if (status === "sent") return "ส่งสำเร็จ";
  if (status === "sending") return "กำลังส่ง";
  if (status === "blocked") return "ถูกบล็อก";
  if (status === "failed") return "ส่งไม่สำเร็จ";
  if (status === "pending") return "รอส่ง";
  return status || "ยังไม่เคยส่ง";
}

export function TenantDailySalesEmailSettings({ tenantId }: { tenantId: string }) {
  const [state, setState] = useState<State | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const response = await fetch(`/api/it-admin/v1/tenants/${tenantId}/daily-sales-email`, {
        cache: "no-store",
        credentials: "include"
      });
      const body = await response.json().catch(() => null) as ApiEnvelope<State> | null;
      if (!response.ok || !body?.data) throw new Error(body?.error?.message || "โหลดการตั้งค่าไม่สำเร็จ");
      setState(body.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "โหลดการตั้งค่าไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => { void load(); }, [load]);

  async function toggle() {
    if (!state || busy) return;
    const next = !state.enabled;
    if (next && !window.confirm("เปิดการส่งสรุปยอดขายรายวันไปยังอีเมล Owner ของร้านนี้?")) return;
    if (!next && !window.confirm("ปิดการส่งสรุปยอดขายรายวันของร้านนี้?")) return;

    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const response = await fetch(`/api/it-admin/v1/tenants/${tenantId}/daily-sales-email`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: next })
      });
      const body = await response.json().catch(() => null) as ApiEnvelope<State> | null;
      if (!response.ok || !body?.data) throw new Error(body?.error?.message || "บันทึกการตั้งค่าไม่สำเร็จ");
      setState(body.data);
      setSuccess(next ? "เปิดการส่งสรุปยอดขายรายวันแล้ว" : "ปิดการส่งสรุปยอดขายรายวันแล้ว");
    } catch (e) {
      setError(e instanceof Error ? e.message : "บันทึกการตั้งค่าไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className={styles.loading}>กำลังโหลดการตั้งค่าการส่งสรุปยอดขาย…</div>;
  if (!state) return <div className={styles.error}>{error || "ไม่พบข้อมูลร้าน"}</div>;

  const recipientReady = state.owner.is_active && state.owner.email_valid;
  const last = state.last_delivery;

  return (
    <div className={styles.stack}>
      {error ? <div className={styles.error}>{error}</div> : null}
      {success ? <div className={styles.success}>{success}</div> : null}

      <section className={styles.hero}>
        <div>
          <div className={styles.eyebrow}>DAILY SALES EMAIL</div>
          <h3>แจ้งสรุปยอดขายไปอีเมล์</h3>
          <p>ส่งตาราง HTML สรุปยอดขายของ “เมื่อวาน” ไปยังอีเมล Owner ปัจจุบันของร้าน โดยส่งเฉพาะวันที่มีบิลขายสำเร็จ</p>
        </div>
        <button
          type="button"
          className={state.enabled ? styles.toggleOn : styles.toggleOff}
          onClick={() => void toggle()}
          disabled={busy}
          aria-pressed={state.enabled}
        >
          <span className={styles.toggleTrack}><span /></span>
          <strong>{busy ? "กำลังบันทึก…" : state.enabled ? "เปิดการแจ้งส่ง" : "ปิดการแจ้งส่ง"}</strong>
        </button>
      </section>

      <section className={styles.grid}>
        <article className={styles.card}>
          <span>RECIPIENT</span>
          <h4>อีเมลเจ้าของร้าน</h4>
          <div className={styles.value}>{state.owner.email || "ยังไม่มีอีเมล"}</div>
          <div className={recipientReady ? styles.good : styles.warn}>
            {recipientReady ? `พร้อมส่ง · ${state.owner.full_name}` : state.owner.email_problem || "Owner ยังไม่พร้อมใช้งาน"}
          </div>
          <p>ระบบอ่านอีเมลสดจาก Owner/Login ทุกครั้งก่อนส่ง หาก IT เปลี่ยนอีเมล Owner ระบบจะใช้อีเมลใหม่อัตโนมัติในรอบถัดไป</p>
        </article>

        <article className={styles.card}>
          <span>SCHEDULE</span>
          <h4>รอบตัดยอดและเวลาส่ง</h4>
          <div className={styles.value}>ตัดวัน 00:00 · ส่ง 00:15 น.</div>
          <div className={styles.good}>Asia/Bangkok</div>
          <p>ช่วงยอดคือ 00:00 ของวันนั้น ถึงก่อน 00:00 ของวันถัดไป ไม่ยึดเวลาปิดกะ เพราะกะสามารถข้ามเที่ยงคืนได้</p>
        </article>

        <article className={styles.card}>
          <span>CONDITION</span>
          <h4>เงื่อนไขการส่ง</h4>
          <div className={styles.value}>ต้องมีบิลขายสำเร็จ ≥ 1 บิล</div>
          <div className={styles.good}>ไม่มีขาย = ไม่ส่งอีเมล</div>
          <p>บิลยกเลิกอย่างเดียวไม่ถือว่ามียอดขาย ระบบจะไม่ส่งอีเมลของวันนั้น</p>
        </article>

        <article className={styles.card}>
          <span>LAST DELIVERY</span>
          <h4>การส่งล่าสุด</h4>
          <div className={styles.value}>{deliveryLabel(last?.status)}</div>
          <div className={last?.status === "sent" ? styles.good : last ? styles.warn : styles.muted}>
            {last?.sent_at ? when(last.sent_at) : "ยังไม่มีประวัติการส่ง"}
          </div>
          <p>{last?.recipient_email ? `ส่งไปที่ ${last.recipient_email}` : "เมื่อเริ่มส่ง ระบบจะบันทึกผู้รับและสถานะไว้ใน Email Delivery Ledger"}</p>
          {last?.last_error ? <div className={styles.lastError}>{last.last_error}</div> : null}
        </article>
      </section>

      <section className={styles.metrics}>
        <div><span>ยอดก่อนส่วนลด</span><strong>รวมจากบิล completed</strong></div>
        <div><span>จำนวนบิลขายสำเร็จ</span><strong>Completed Bills</strong></div>
        <div><span>ยอดขายสุทธิ</span><strong>Net Sales</strong></div>
        <div><span>บิลยกเลิก</span><strong>Cancelled Bills</strong></div>
        <div><span>การชำระ</span><strong>เงินสด · เงินโอน</strong></div>
        <div><span>สินค้าขายดี</span><strong>อันดับ 1 · 2 · 3</strong></div>
      </section>

      <div className={styles.note}>
        อีเมลใช้ระบบส่งของบริษัท CUTTING POINT INNOVATION และออกแบบ Responsive สำหรับคอมพิวเตอร์ แท็บเล็ต และมือถือ
      </div>
    </div>
  );
}
