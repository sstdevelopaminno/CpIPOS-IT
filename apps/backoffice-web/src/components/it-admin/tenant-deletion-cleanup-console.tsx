"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useItAccess } from "@/components/layout/app-shell";

type PendingPrimary = {
  tenant_id: string;
  file_count: number;
  auth_user_count: number;
  storage_completed: boolean;
  auth_users_completed: boolean;
};
type PendingCommunications = {
  tenant_id: string;
  last_error: string | null;
  last_attempted_at: string | null;
};
type Queue = { pending: PendingPrimary[]; communications_pending: PendingCommunications[] };
type Envelope<T> = { data?: T; error?: { message?: string } };

export function TenantDeletionCleanupConsole() {
  const { canDelete } = useItAccess();
  const [data, setData] = useState<Queue | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/it-admin/v1/tenant-deletion-cleanup", {
        credentials: "include", cache: "no-store", signal: AbortSignal.timeout(12_000)
      });
      const json = await response.json().catch(() => null) as Envelope<Queue> | null;
      if (!response.ok || !json?.data) throw new Error(json?.error?.message ?? "โหลดรายการล้างข้อมูลไม่สำเร็จ");
      setData(json.data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "ไม่สามารถอ่านรายการล้างข้อมูลได้");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const rows = useMemo(() => {
    const map = new Map<string, { primary?: PendingPrimary; communications?: PendingCommunications }>();
    for (const primary of data?.pending ?? []) {
      map.set(primary.tenant_id, { ...map.get(primary.tenant_id), primary });
    }
    for (const communications of data?.communications_pending ?? []) {
      map.set(communications.tenant_id, { ...map.get(communications.tenant_id), communications });
    }
    return [...map.entries()].map(([id, parts]) => ({ id, ...parts }));
  }, [data]);

  async function retry(tenantId: string) {
    if (busy || !canDelete) return;
    const typed = window.prompt(
      "ยืนยันล้างข้อมูลตกค้างของร้านที่ถูกลบถาวรแล้วเท่านั้น\n" +
      "Tenant ID: " + tenantId + "\nพิมพ์ RETRY_CLEANUP เพื่อให้ IT ตรวจสอบและยืนยัน",
      ""
    );
    if (typed !== "RETRY_CLEANUP") return;
    setBusy(tenantId);
    setNotice("");
    setError("");
    try {
      const response = await fetch("/api/it-admin/v1/tenant-deletion-cleanup", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_id: tenantId, confirmation: "RETRY_CLEANUP" }),
        signal: AbortSignal.timeout(40_000)
      });
      const json = await response.json().catch(() => null) as Envelope<{ completed?: boolean }> | null;
      if (!response.ok || json?.data?.completed !== true) {
        throw new Error(json?.error?.message ?? "ล้างข้อมูลยังไม่ครบ กรุณาตรวจสอบสถานะ");
      }
      setNotice("ปิดงานล้างข้อมูลค้างของร้านที่ถูกลบถาวรแล้วเรียบร้อย");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "ตรวจสอบผลล้างข้อมูลไม่ได้");
    } finally {
      setBusy(null);
      void load(); // Refresh receipt before another confirmation; never auto-retry.
    }
  }

  return (
    <section className="mt-6 rounded-2xl border border-amber-200 bg-white p-5 shadow-sm" aria-label="งานล้างข้อมูลร้านที่ยังค้าง">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold text-slate-900">ตรวจสอบการล้างข้อมูลหลังลบร้าน</h2>
          <p className="mt-1 text-sm text-slate-600">
            งานค้างใน Primary Storage / Auth และ Communications จะแสดงแยกกัน
            ไม่รวมร้านที่ระงับชั่วคราวหรือยังอยู่ช่วงผ่อนผัน
          </p>
        </div>
        <button type="button" onClick={() => { setError(""); void load(); }} disabled={busy !== null}
          className="rounded-xl border border-blue-200 px-3 py-2 text-sm font-semibold text-blue-700 disabled:opacity-60">
          รีเฟรชสถานะ
        </button>
      </div>
      {error ? <p role="alert" className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p> : null}
      {notice ? <p role="status" className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p> : null}
      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-slate-600">{data ? "ไม่พบรายการล้างข้อมูลค้าง" : "กำลังอ่านสถานะการล้างข้อมูล..."}</p>
      ) : (
        <div className="mt-4 space-y-3">
          {rows.map((row) => (
            <article key={row.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-100 bg-amber-50/40 p-3">
              <div className="min-w-0">
                <strong className="block break-all text-sm text-slate-900">{row.id}</strong>
                {row.primary ? (
                  <p className="text-xs text-slate-600">
                    Primary: Storage {row.primary.file_count} ไฟล์ / Auth {row.primary.auth_user_count} ราย
                    {" · "}{row.primary.storage_completed ? "ไฟล์เรียบร้อย" : "รอไฟล์"}
                    {" · "}{row.primary.auth_users_completed ? "บัญชีเรียบร้อย" : "รอบัญชี"}
                  </p>
                ) : null}
                {row.communications ? (
                  <p className="text-xs text-amber-900">
                    Communications รอล้าง{row.communications.last_error ? ` · ${row.communications.last_error}` : ""}
                  </p>
                ) : null}
              </div>
              {canDelete ? (
                <button type="button" disabled={busy !== null}
                  onClick={() => void retry(row.id)}
                  className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-60">
                  {busy === row.id ? "กำลังตรวจสอบ..." : "IT ยืนยันล้างข้อมูลค้าง"}
                </button>
              ) : <span className="text-xs text-slate-500">IT Support เท่านั้น</span>}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
