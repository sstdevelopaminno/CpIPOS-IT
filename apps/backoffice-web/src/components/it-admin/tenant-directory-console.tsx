"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { TenantControlCenter } from "./tenant-control-center";
import styles from "./tenant-directory-console.module.css";

type TenantRow = {
  id: string;
  store_code?: string;
  name?: string;
  internal_code?: string;
  owner_name?: string;
  package?: string;
  package_code?: string;
  contract_status?: string;
  branches?: number;
  active_branches?: number;
  devices?: number;
  active_devices?: number;
  users?: number;
  active_sessions?: number;
  open_shifts?: number;
  status?: string;
  updated_at?: string | null;
};

type TenantPayload = {
  plane: "primary";
  module: "tenants";
  checked_at: string;
  summary: Record<string, number | string>;
  rows: TenantRow[];
  note: string | null;
};

type ApiEnvelope = {
  data?: TenantPayload;
  error?: { message?: string };
};

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
}

function statusLabel(status?: string) {
  return String(status ?? "").toLowerCase() === "active" ? "เปิดใช้งาน" : "ปิดใช้งาน";
}

function contractLabel(status?: string) {
  const normalized = String(status ?? "").toLowerCase();
  if (normalized === "trial") return "ทดลองใช้";
  if (normalized === "active") return "สัญญาใช้งาน";
  if (normalized === "suspended") return "หยุดชั่วคราว";
  if (normalized === "cancelled") return "ยกเลิกแล้ว";
  if (normalized === "expired") return "หมดอายุ";
  return normalized || "ยังไม่ระบุ";
}

export function TenantDirectoryConsole() {
  const [data, setData] = useState<TenantPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [selected, setSelected] = useState<TenantRow | null>(null);

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/it-admin/v1/modules/tenants", { cache: "no-store", credentials: "include" });
      const body = (await response.json().catch(() => null)) as ApiEnvelope | null;
      if (!response.ok || !body?.data) throw new Error(body?.error?.message ?? `โหลดข้อมูลร้านค้าไม่สำเร็จ (${response.status})`);
      setData(body.data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "ข้อมูลร้านค้าไม่พร้อมใช้งานชั่วคราว");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
    const timer = window.setInterval(() => void load(true), 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const filteredRows = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return (data?.rows ?? []).filter((row) => {
      const active = String(row.status ?? "").toLowerCase() === "active";
      if (statusFilter === "active" && !active) return false;
      if (statusFilter === "inactive" && active) return false;
      if (!normalized) return true;
      return [row.store_code, row.name, row.internal_code, row.owner_name, row.package, row.package_code, row.contract_status]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalized));
    });
  }, [data?.rows, query, statusFilter]);

  const summary = data?.summary ?? {};

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <div className={styles.eyebrow}>CUSTOMERS & STORES · CPIPOS-001</div>
          <h2>ร้านค้า / Tenants</h2>
          <p>จัดการร้าน สาขา แพ็กเกจ สิทธิ์การใช้งาน และสถานะ POS จากฐานข้อมูล CpiPOS-001 โดยตรง</p>
        </div>
        <div className={styles.headerActions}>
          <Link className={styles.secondaryButton} href="/it-admin/store-provisioning">เปิดร้านใหม่</Link>
          <button className={styles.primaryButton} type="button" onClick={() => void load(true)} disabled={refreshing}>
            {refreshing ? "กำลังรีเฟรช…" : "รีเฟรช"}
          </button>
        </div>
      </header>

      <section className={styles.summaryGrid} aria-label="Tenant summary">
        <article><span>ร้านทั้งหมด</span><strong>{loading ? "—" : numberValue(summary.total)}</strong><small>Tenant records</small></article>
        <article><span>เปิดใช้งาน</span><strong>{loading ? "—" : numberValue(summary.active)}</strong><small>Authority active</small></article>
        <article><span>กำลัง Trial</span><strong>{loading ? "—" : numberValue(summary.trials)}</strong><small>Contract status = trial</small></article>
        <article><span>สาขาทั้งหมด</span><strong>{loading ? "—" : numberValue(summary.branches)}</strong><small>{numberValue(summary.active_branches)} active</small></article>
        <article><span>อุปกรณ์ลงทะเบียน</span><strong>{loading ? "—" : numberValue(summary.devices)}</strong><small>{numberValue(summary.active_devices)} active registry</small></article>
        <article><span>ผู้ใช้ในร้าน</span><strong>{loading ? "—" : numberValue(summary.users)}</strong><small>นับ user ไม่ซ้ำต่อ Tenant</small></article>
      </section>

      <section className={styles.panel}>
        <div className={styles.toolbar}>
          <label className={styles.searchBox}>
            <span>ค้นหา</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ชื่อร้าน, Store Code, Owner, Package, Contract" />
          </label>
          <label className={styles.filterBox}>
            <span>สถานะร้าน</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
              <option value="all">ทั้งหมด</option>
              <option value="active">เปิดใช้งาน</option>
              <option value="inactive">ปิดใช้งาน</option>
            </select>
          </label>
          <div className={styles.resultCount}><strong>{filteredRows.length}</strong><span>รายการที่แสดง</span></div>
        </div>

        {error ? (
          <div className={styles.errorState} role="alert">
            <div><strong>เชื่อมข้อมูลร้านค้าไม่สำเร็จ</strong><p>{error}</p></div>
            <button type="button" onClick={() => void load(false)}>ลองใหม่</button>
          </div>
        ) : null}

        <div className={styles.tableWrap}>
          <table>
            <thead><tr><th>Store Code</th><th>ร้านค้า</th><th>แพ็กเกจ / สัญญา</th><th>สาขา</th><th>อุปกรณ์</th><th>ผู้ใช้</th><th>Runtime</th><th>สถานะ</th><th aria-label="Actions" /></tr></thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9}><div className={styles.loadingState}>กำลังโหลดข้อมูลจริงจาก CpiPOS-001…</div></td></tr>
              ) : filteredRows.length === 0 ? (
                <tr><td colSpan={9}><div className={styles.emptyState}>ไม่พบร้านค้าที่ตรงกับตัวกรอง</div></td></tr>
              ) : filteredRows.map((row) => {
                const activeRow = String(row.status ?? "").toLowerCase() === "active";
                const contract = String(row.contract_status ?? "").toLowerCase();
                return (
                  <tr key={row.id}>
                    <td><span className={styles.code}>{row.store_code || "—"}</span></td>
                    <td><div className={styles.storeCell}><strong>{row.name || "—"}</strong><span>{row.internal_code || "—"}{row.owner_name && row.owner_name !== "—" ? ` · ${row.owner_name}` : ""}</span></div></td>
                    <td><div className={styles.packageCell}><strong>{row.package || "—"}</strong><span className={`${styles.contractBadge} ${contract === "trial" ? styles.contractTrial : contract === "active" ? styles.contractActive : styles.contractMuted}`}>{contractLabel(row.contract_status)}</span></div></td>
                    <td><strong className={styles.ratio}>{numberValue(row.active_branches)}</strong> / {numberValue(row.branches)}</td>
                    <td><strong className={styles.ratio}>{numberValue(row.active_devices)}</strong> / {numberValue(row.devices)}</td>
                    <td>{numberValue(row.users)}</td>
                    <td><div className={styles.runtimeCell}><span>Session {numberValue(row.active_sessions)}</span><span>กะเปิด {numberValue(row.open_shifts)}</span></div></td>
                    <td><span className={`${styles.status} ${activeRow ? styles.active : styles.inactive}`}>{statusLabel(row.status)}</span></td>
                    <td><button className={styles.detailButton} type="button" onClick={() => setSelected(row)}>จัดการ</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <footer className={styles.panelFooter}>
          <span>Source: CpiPOS-001 · Store Control authority · authenticated IT Admin</span>
          <span>อัปเดต: {data?.checked_at ? formatDate(data.checked_at) : "—"}</span>
        </footer>
      </section>

      {selected ? (
        <TenantControlCenter
          tenantId={selected.id}
          fallbackName={selected.name || "ร้านค้า"}
          onClose={() => setSelected(null)}
          onChanged={() => void load(true)}
          onDeleted={() => { setSelected(null); void load(true); }}
        />
      ) : null}
    </div>
  );
}
