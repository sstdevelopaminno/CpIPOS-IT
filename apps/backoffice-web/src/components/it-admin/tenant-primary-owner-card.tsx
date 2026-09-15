"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./tenant-primary-owner-card.module.css";

type ApiEnvelope<T> = { data: T | null; error: { code?: string; message?: string } | null };

type PrimaryOwner = {
  user_id: string;
  full_name: string;
  email: string;
  phone: string;
  is_active: boolean;
  created_at: string;
  role_created_at: string;
  owner_branch_count: number;
};

type OwnerResponse = { primary_owner: PrimaryOwner | null };

async function parse<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (!response.ok || !body?.data) throw new Error(body?.error?.message ?? `Request failed (${response.status})`);
  return body.data;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("th-TH", { year: "numeric", month: "short", day: "numeric" });
}

export function TenantPrimaryOwnerCard({ tenantId }: { tenantId: string }) {
  const [owner, setOwner] = useState<PrimaryOwner | null>(null);
  const [draft, setDraft] = useState({ full_name: "", email: "", phone: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const applyOwner = useCallback((next: PrimaryOwner | null) => {
    setOwner(next);
    setDraft({
      full_name: next?.full_name ?? "",
      email: next?.email ?? "",
      phone: next?.phone ?? ""
    });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/it-admin/v1/tenants/${tenantId}/primary-owner`, {
        cache: "no-store",
        credentials: "include"
      });
      const payload = await parse<OwnerResponse>(response);
      applyOwner(payload.primary_owner);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "โหลดข้อมูลเจ้าของร้านไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, [applyOwner, tenantId]);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch(`/api/it-admin/v1/tenants/${tenantId}/primary-owner`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft)
      });
      const payload = await parse<OwnerResponse>(response);
      applyOwner(payload.primary_owner);
      setSuccess("บันทึก USER เจ้าของร้านคนแรกเรียบร้อยแล้ว");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "บันทึกข้อมูลเจ้าของร้านไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className={styles.card}>
      <div className={styles.header}>
        <div>
          <span>PRIMARY OWNER USER</span>
          <h4>USER เจ้าของร้านคนแรก</h4>
          <p>บัญชี Owner แรกที่ผูกกับร้าน ใช้เป็นข้อมูลอ้างอิงหลักของ Store Control Center</p>
        </div>
        {owner ? <span className={`${styles.status} ${owner.is_active ? styles.active : styles.inactive}`}>{owner.is_active ? "ใช้งาน" : "ปิดใช้งาน"}</span> : null}
      </div>

      {loading ? <div className={styles.state}>กำลังโหลดข้อมูล Owner…</div> : null}
      {error ? <div className={styles.error}>{error}</div> : null}
      {success ? <div className={styles.success}>{success}</div> : null}

      {!loading && !owner ? (
        <div className={styles.empty}>
          <strong>ยังไม่พบ USER ที่มีสิทธิ์ Owner</strong>
          <span>ระบบจะเลือก USER Owner คนแรกตามวันที่ผูกสิทธิ์กับร้าน ไม่สร้างบัญชีใหม่อัตโนมัติเพื่อป้องกันการผูกผู้ใช้ผิดร้าน</span>
        </div>
      ) : null}

      {!loading && owner ? (
        <>
          <div className={styles.metaGrid}>
            <div><span>User ID</span><strong>{owner.user_id}</strong></div>
            <div><span>Owner ตั้งแต่</span><strong>{formatDate(owner.role_created_at || owner.created_at)}</strong></div>
            <div><span>สาขาที่เป็น Owner</span><strong>{owner.owner_branch_count}</strong></div>
          </div>

          <div className={styles.formGrid}>
            <label>
              <span>ชื่อเจ้าของร้าน</span>
              <input value={draft.full_name} onChange={(event) => setDraft((value) => ({ ...value, full_name: event.target.value }))} />
            </label>
            <label>
              <span>อีเมล Login</span>
              <input type="email" value={draft.email} onChange={(event) => setDraft((value) => ({ ...value, email: event.target.value }))} />
              <small>เมื่อแก้อีเมล ระบบจะอัปเดต Supabase Auth ของ USER นี้ด้วย</small>
            </label>
            <label className={styles.fullWidth}>
              <span>โทรศัพท์เจ้าของร้าน</span>
              <input value={draft.phone} onChange={(event) => setDraft((value) => ({ ...value, phone: event.target.value }))} />
            </label>
          </div>

          <div className={styles.actions}>
            <div className={styles.note}>สิทธิ์ Owner และ User ID ถูกล็อกไว้ ไม่สามารถเปลี่ยนเจ้าของเป็นคนอื่นจากฟอร์มนี้ได้ ทุกการแก้ไขถูกบันทึก Audit Log</div>
            <button type="button" onClick={() => void save()} disabled={saving || draft.full_name.trim().length < 2 || !draft.email.includes("@")}>{saving ? "กำลังบันทึก…" : "บันทึก USER เจ้าของร้าน"}</button>
          </div>
        </>
      ) : null}
    </section>
  );
}
