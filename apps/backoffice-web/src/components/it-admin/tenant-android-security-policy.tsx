"use client";

import { useEffect, useState } from "react";

type Reply<T> = { data: T | null; error: { message?: string } | null };
type Policy = { tenant_id: string; enforce_developer_options_off: boolean; updated_at: string | null };

export function TenantAndroidSecurityPolicy({ tenantId }: { tenantId: string }) {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError("");
    fetch(`/api/it-admin/v1/tenants/${encodeURIComponent(tenantId)}/android-security`, {
      cache: "no-store", credentials: "include"
    }).then(async (response) => {
      const body = await response.json() as Reply<Policy>;
      if (!response.ok || !body.data) throw new Error(body.error?.message || "โหลดนโยบายไม่สำเร็จ");
      if (mounted) setPolicy(body.data);
    }).catch((failure: unknown) => {
      if (mounted) setError(failure instanceof Error ? failure.message : "เชื่อมต่อ IT ไม่สำเร็จ");
    }).finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [tenantId]);

  async function save(enabled: boolean) {
    if (saving || !policy) return;
    const message = enabled
      ? "เปิดการป้องกัน Developer Options/USB Debugging ของร้านนี้ใช่หรือไม่? เครื่อง Android ที่เปิดตัวเลือกดังกล่าวจะถูกระงับการใช้งาน POS จนกว่าจะปิด"
      : "ปิดระบบตรวจสอบของร้านนี้ใช่หรือไม่? เหมาะสำหรับร้านทดสอบที่ IT ต้องใช้เครื่องมือพัฒนา";
    if (!window.confirm(message)) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/it-admin/v1/tenants/${encodeURIComponent(tenantId)}/android-security`, {
        method: "PATCH", credentials: "include", cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enforce_developer_options_off: enabled })
      });
      const body = await response.json() as Reply<Policy>;
      if (!response.ok || !body.data) throw new Error(body.error?.message || "บันทึกนโยบายไม่สำเร็จ");
      setPolicy(body.data);
      setNotice(enabled ? "เปิดระบบป้องกันให้ร้านนี้แล้ว" : "ปิดระบบป้องกันสำหรับร้านนี้แล้ว");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "บันทึกไม่สำเร็จ");
    } finally { setSaving(false); }
  }

  return <div className="mx-auto grid max-w-3xl gap-5 rounded-2xl border border-slate-200 bg-white p-5 text-slate-900">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="grid gap-1">
        <strong className="text-lg">ตรวจ Developer Options / USB Debugging</strong>
        <p className="text-sm text-slate-600">กำหนดเฉพาะร้านนี้ · ไม่กระทบร้านอื่น · รองรับ Android Native POS</p>
      </div>
      <label className="flex items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 font-semibold">
        <span>{policy?.enforce_developer_options_off ? "เปิดการป้องกัน" : "ปิดการป้องกัน"}</span>
        <input
          aria-label="เปิดหรือปิดการตรวจ Developer Options ของร้านนี้"
          type="checkbox" role="switch"
          className="h-6 w-11 accent-emerald-600"
          checked={policy?.enforce_developer_options_off === true}
          disabled={loading || saving || !policy}
          onChange={(event) => void save(event.target.checked)}
        />
      </label>
    </div>
    <p className="text-sm leading-7 text-slate-600">
      เมื่อเปิด: แอปจะแจ้งเตือนและระงับหน้าใช้งานขายหากพบ Developer Options หรือ USB Debugging
      และตรวจซ้ำเมื่อกลับเข้าแอปหรือระหว่างใช้งาน ร้านทดสอบสามารถปิดนโยบายนี้จาก IT ได้
      (การตรวจของ Android ไม่รับรองการป้องกันการดัดแปลง APK ได้ทั้งหมด)
    </p>
    {loading ? <p role="status">กำลังโหลดนโยบายของร้าน…</p> : null}
    {error ? <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
    {notice ? <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p> : null}
    <small className="text-slate-500">
      {policy?.updated_at ? `แก้ไขล่าสุด ${new Date(policy.updated_at).toLocaleString("th-TH")}` : "ค่าเริ่มต้น: ปิด จนกว่าฝั่ง IT จะเปิด"}
    </small>
  </div>;
}
