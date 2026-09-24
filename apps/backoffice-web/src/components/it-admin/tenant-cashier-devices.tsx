"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./tenant-cashier-devices.module.css";

type Cashier = {
  id: string; branch_id: string; device_code: string; device_name: string;
  status: string; enabled: boolean; counter_name: string; location: string;
  last_seen_at: string | null;
};
type Branch = { id: string; code: string; name: string; is_active: boolean };
type Data = {
  devices: Cashier[]; branches: Branch[]; quota_per_branch: number | null;
  contract_status: string | null; active: number; total: number; package_usage: number;
};
type ApiEnvelope<T> = { data: T | null; error: { message?: string } | null };
type Draft = {
  id: string; branch_id: string; device_code: string; device_name: string;
  counter_name: string; location: string; enabled: boolean;
};
const BLANK: Draft = {
  id: "", branch_id: "", device_code: "", device_name: "",
  counter_name: "", location: "", enabled: true
};
function formatSeen(value: string | null) {
  if (!value) return "ยังไม่เคยเชื่อมต่อ";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "ยังไม่เคยเชื่อมต่อ"
    : date.toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" });
}
async function read<T>(response: Response): Promise<T> {
  const result = (await response.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (!response.ok || !result?.data) {
    throw new Error(result?.error?.message ?? `การเชื่อมต่อไม่สำเร็จ (${response.status})`);
  }
  return result.data;
}

export function TenantCashierDevices({
  tenantId, storeName, confirmAction, onChanged
}: {
  tenantId: string;
  storeName: string;
  confirmAction: (action: string, store: string) => Promise<boolean>;
  onChanged: () => void;
}) {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(BLANK);
  const [branchFilter, setBranchFilter] = useState("all");

  const endpoint = `/api/it-admin/v1/tenants/${encodeURIComponent(tenantId)}/cashier-devices`;
  const load = useCallback(async () => {
    try {
      const response = await fetch(endpoint, { credentials: "include", cache: "no-store" });
      const next = await read<Data>(response);
      setData(next);
      setDraft(current => current.id || current.branch_id ? current : {
        ...current, branch_id: next.branches.find(branch => branch.is_active)?.id ?? ""
      });
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "โหลดเครื่องแคชเชียร์ไม่สำเร็จ");
    } finally { setLoading(false); }
  }, [endpoint]);

  useEffect(() => { void load(); }, [load]);

  const activeInBranch = useMemo(() => (data?.devices ?? []).filter(
    row => row.branch_id === draft.branch_id && row.enabled
  ).length, [data?.devices, draft.branch_id]);
  const shown = useMemo(() => (data?.devices ?? []).filter(row =>
    branchFilter === "all" || row.branch_id === branchFilter
  ), [data?.devices, branchFilter]);
  const canAddActive = data?.quota_per_branch === null || data?.quota_per_branch === undefined
    || activeInBranch < data.quota_per_branch;
  const branchNames = useMemo(() =>
    new Map((data?.branches ?? []).map(branch => [branch.id, branch.name])),
  [data?.branches]);

  async function submit() {
    if (busy || !data) return;
    const code = draft.device_code.trim().toUpperCase();
    if (!draft.branch_id || !draft.device_name.trim()
      || (!draft.id && !/^[A-Z0-9][A-Z0-9_-]{1,31}$/.test(code))) {
      setError("เลือกสาขา กรอกชื่อเครื่องและรหัสเครื่อง 2–32 ตัว (อังกฤษ ตัวเลข _ -)");
      return;
    }
    if (!draft.id && draft.enabled && !canAddActive) {
      setError("โควตาเครื่อง Active ของสาขานี้เต็มตามแพ็กเกจแล้ว");
      return;
    }
    const confirmed = await confirmAction(draft.id ? "update_cashier" : "create_cashier",
      `${storeName} · ${draft.device_name.trim()}`);
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch(endpoint, {
        method: draft.id ? "PATCH" : "POST", credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft.id
          ? { id: draft.id, device_name: draft.device_name, counter_name: draft.counter_name,
              location: draft.location }
          : { branch_id: draft.branch_id, device_code: code,
              device_name: draft.device_name, counter_name: draft.counter_name,
              location: draft.location, enabled: draft.enabled })
      });
      await read<{ device: Cashier }>(response);
      setSuccess(draft.id ? "บันทึกข้อมูลเครื่องแคชเชียร์แล้ว" : "เพิ่มเครื่องแคชเชียร์แล้ว เครื่องจะแสดงใน CpIPOS ออนไลน์");
      setDraft({ ...BLANK, branch_id: draft.branch_id });
      await load();
      onChanged();
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "บันทึกเครื่องไม่สำเร็จ");
    } finally { setBusy(false); }
  }

  async function toggle(device: Cashier) {
    if (busy) return;
    const confirmed = await confirmAction(
      device.enabled ? "disable_cashier" : "enable_cashier",
      `${storeName} · ${device.device_name} (${device.device_code})`
    );
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch(endpoint, {
        method: "PATCH", credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: device.id, enabled: !device.enabled })
      });
      await read<{ device: Cashier }>(response);
      setSuccess(device.enabled
        ? "ปิดเครื่องแคชเชียร์แล้ว และยกเลิกเซสชัน POS ของเครื่องนี้"
        : "เปิดเครื่องแคชเชียร์แล้ว สามารถเข้าใช้งาน CpIPOS ตามสิทธิ์แพ็กเกจ");
      await load();
      onChanged();
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "เปลี่ยนสถานะไม่สำเร็จ");
    } finally { setBusy(false); }
  }

  async function remove(device: Cashier) {
    if (busy) return;
    const confirmed = await confirmAction("delete_cashier",
      `${storeName} · ${device.device_name} (${device.device_code})`);
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch(endpoint, {
        method: "DELETE", credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: device.id })
      });
      await read<{ deleted: boolean }>(response);
      if (draft.id === device.id) setDraft({ ...BLANK, branch_id: device.branch_id });
      setSuccess("ลบเครื่องออกจากรายการใช้งานแล้ว ประวัติบิลและกะยังคงอยู่");
      await load();
      onChanged();
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "ลบเครื่องไม่สำเร็จ");
    } finally { setBusy(false); }
  }

  return (
    <div className={styles.root}>
      <div className={styles.summary}>
        <article><span>เครื่องแคชเชียร์ Active</span><strong>{data?.active ?? "—"}</strong><small>สถานะใช้งานจริงใน CpIPOS-001</small></article>
        <article><span>เครื่องที่แสดงทั้งหมด</span><strong>{data?.total ?? "—"}</strong><small>ไม่นับเครื่องที่ลบ/เก็บประวัติ</small></article>
        <article><span>โควตาต่อสาขา</span><strong>{data?.quota_per_branch ?? "—"}</strong><small>ตามสัญญาแพ็กเกจปัจจุบัน</small></article>
      </div>
      {error ? <div className={styles.error} role="alert">{error}</div> : null}
      {success ? <div className={styles.success} role="status">{success}</div> : null}
      <section className={styles.panel}>
        <div className={styles.sectionTitle}>
          <div><strong>{draft.id ? "แก้ไขข้อมูลเครื่อง" : "เพิ่มเครื่องแคชเชียร์"}</strong>
            <small>กำหนดทะเบียนเครื่องที่หน้าขาย CpIPOS เลือกได้จริง</small></div>
          {draft.id ? <button type="button" className={styles.secondary}
            onClick={() => setDraft({ ...BLANK, branch_id: draft.branch_id })}
            disabled={busy}>ยกเลิกแก้ไข</button> : null}
        </div>
        <div className={styles.form}>
          <label>สาขา
            <select value={draft.branch_id} disabled={busy || Boolean(draft.id)}
              onChange={event => setDraft(current => ({ ...current, branch_id: event.target.value }))}>
              <option value="">เลือกสาขา</option>
              {(data?.branches ?? []).map(branch => (
                <option value={branch.id} key={branch.id}>{branch.code} · {branch.name}{!branch.is_active ? " (ปิด)" : ""}</option>
              ))}
            </select>
          </label>
          <label>รหัสเครื่อง
            <input value={draft.device_code} disabled={busy || Boolean(draft.id)}
              maxLength={32} autoCapitalize="characters" placeholder="POS-01"
              onChange={event => setDraft(current => ({ ...current, device_code: event.target.value.toUpperCase() }))} />
          </label>
          <label>ชื่อเครื่อง
            <input value={draft.device_name} disabled={busy} maxLength={100}
              placeholder="แคชเชียร์หน้าเคาน์เตอร์"
              onChange={event => setDraft(current => ({ ...current, device_name: event.target.value }))} />
          </label>
          <label>ชื่อเคาน์เตอร์
            <input value={draft.counter_name} disabled={busy} maxLength={100}
              placeholder="เคาน์เตอร์ 1" onChange={event => setDraft(current => ({
                ...current, counter_name: event.target.value
              }))} />
          </label>
          <label className={styles.wide}>ตำแหน่งเครื่อง
            <input value={draft.location} disabled={busy} maxLength={160}
              placeholder="ชั้น 1 / หน้าร้าน" onChange={event => setDraft(current => ({
                ...current, location: event.target.value
              }))} />
          </label>
          {!draft.id ? <label className={styles.check}>
            <input type="checkbox" checked={draft.enabled} disabled={busy}
              onChange={event => setDraft(current => ({ ...current, enabled: event.target.checked }))} />
            เปิดใช้งานเครื่องทันที
          </label> : null}
        </div>
        <div className={styles.formFooter}>
          <span>{draft.branch_id && data
            ? `สาขาที่เลือก: ${activeInBranch} / ${data.quota_per_branch ?? "ไม่จำกัด"} เครื่อง Active`
            : "เลือกสาขาก่อนเพิ่มเครื่อง"}</span>
          <button type="button" className={styles.primary} disabled={busy || loading}
            onClick={() => void submit()}>{busy ? "กำลังบันทึก…" : draft.id ? "บันทึกการแก้ไข" : "เพิ่มเครื่องแคชเชียร์"}</button>
        </div>
        <p className={styles.hint}>รหัสเครื่องและสาขาจะล็อกหลังสร้างเพื่อไม่ตัดการเชื่อมต่อบิล กะ และ MDM เดิม การปิดเครื่องจะตัดเซสชัน POS ของเครื่องนั้น</p>
      </section>

      <section className={styles.panel}>
        <div className={styles.sectionTitle}>
          <div><strong>รายการเครื่องแคชเชียร์</strong><small>ข้อมูลจาก branch_devices ฐาน CpiPOS-001 · ไม่ใช่ยอด Online จำลอง</small></div>
          <div className={styles.toolbar}>
            <select aria-label="กรองสาขา" value={branchFilter}
              onChange={event => setBranchFilter(event.target.value)}>
              <option value="all">ทุกสาขา</option>
              {(data?.branches ?? []).map(branch => (
                <option key={branch.id} value={branch.id}>{branch.name}</option>
              ))}
            </select>
            <button type="button" className={styles.secondary} disabled={busy || loading}
              onClick={() => { setLoading(true); void load(); }}>รีเฟรช</button>
          </div>
        </div>
        {loading ? <p className={styles.empty}>กำลังโหลดเครื่องแคชเชียร์…</p>
          : shown.length === 0 ? <p className={styles.empty}>ยังไม่มีเครื่องแคชเชียร์ในสาขาที่เลือก</p> :
          <div className={styles.list}>{shown.map(device => (
            <article key={device.id} className={styles.device}>
              <div className={styles.deviceName}>
                <div className={styles.icon}>POS</div>
                <div><strong>{device.device_name}</strong><span>{device.device_code} · {branchNames.get(device.branch_id) ?? "—"}</span>
                  <small>{device.counter_name || device.location || "ยังไม่ระบุเคาน์เตอร์"} · {formatSeen(device.last_seen_at)}</small></div>
              </div>
              <span className={device.enabled ? styles.on : styles.off}>
                {device.enabled ? "เปิดใช้งาน" : "ปิดใช้งาน"}</span>
              <div className={styles.actions}>
                <button type="button" disabled={busy} onClick={() => setDraft({
                  id: device.id, branch_id: device.branch_id, device_code: device.device_code,
                  device_name: device.device_name, counter_name: device.counter_name,
                  location: device.location, enabled: device.enabled
                })}>แก้ไข</button>
                <button type="button" disabled={busy} onClick={() => void toggle(device)}>
                  {device.enabled ? "ปิดเครื่อง" : "เปิดเครื่อง"}</button>
                <button type="button" className={styles.danger} disabled={busy}
                  onClick={() => void remove(device)}>ลบ</button>
              </div>
            </article>
          ))}</div>}
      </section>
      <p className={styles.note}>การลบใช้การเก็บรายการถาวรออกจากหน้าร้านโดยคงประวัติบิล กะ และ Audit Log; หากยังมีกะเปิดอยู่ ระบบจะไม่อนุญาตให้ลบก่อนปิดกะ</p>
    </div>
  );
}
