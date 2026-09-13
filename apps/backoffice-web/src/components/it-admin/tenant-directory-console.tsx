"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
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
  contract_started_at?: string | null;
  contract_ended_at?: string | null;
  branches?: number;
  active_branches?: number;
  devices?: number;
  active_devices?: number;
  users?: number;
  owner_users?: number;
  manager_users?: number;
  staff_users?: number;
  active_sessions?: number;
  open_shifts?: number;
  quota_mode?: string;
  max_branches?: number | null;
  max_devices?: number | null;
  max_users?: number | null;
  monthly_bill_limit?: number | null;
  storage_limit_gb?: number | string | null;
  retention_months?: number | null;
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
  if (normalized === "cancelled") return "ยกเลิกแล้ว";
  if (normalized === "expired") return "หมดอายุ";
  return normalized ? normalized : "ยังไม่ระบุ";
}

function quotaLabel(value?: number | string | null, suffix = "") {
  if (value === null || value === undefined || value === "") return "ไม่ระบุ";
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return String(value);
  if (parsed >= 999999) return "Custom";
  return `${new Intl.NumberFormat("th-TH").format(parsed)}${suffix}`;
}

function usageLabel(current: unknown, max: unknown) {
  const currentValue = numberValue(current);
  if (max === null || max === undefined || max === "") return `${currentValue} / ไม่ระบุ`;
  const maxValue = Number(max);
  if (!Number.isFinite(maxValue)) return `${currentValue} / ${String(max)}`;
  if (maxValue >= 999999) return `${currentValue} / Custom`;
  return `${currentValue} / ${new Intl.NumberFormat("th-TH").format(maxValue)}`;
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
      const response = await fetch("/api/it-admin/v1/modules/tenants", {
        cache: "no-store",
        credentials: "include"
      });
      const body = (await response.json().catch(() => null)) as ApiEnvelope | null;
      if (!response.ok || !body?.data) {
        throw new Error(body?.error?.message ?? `โหลดข้อมูลร้านค้าไม่สำเร็จ (${response.status})`);
      }
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

  useEffect(() => {
    if (!selected) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selected]);

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
  const total = numberValue(summary.total);
  const active = numberValue(summary.active);
  const trials = numberValue(summary.trials);
  const branches = numberValue(summary.branches);
  const devices = numberValue(summary.devices);
  const users = numberValue(summary.users);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <div className={styles.eyebrow}>CUSTOMERS & STORES · CPIPOS-001</div>
          <h2>ร้านค้า / Tenants</h2>
          <p>ศูนย์รวมร้านค้า SaaS จาก Business Authority จริง พร้อมสถานะสัญญา แพ็กเกจ โควตา สาขา อุปกรณ์ ผู้ใช้ และ Runtime snapshot</p>
        </div>
        <div className={styles.headerActions}>
          <Link className={styles.secondaryButton} href="/it-admin/store-provisioning">เปิดร้านใหม่</Link>
          <button className={styles.primaryButton} type="button" onClick={() => void load(true)} disabled={refreshing}>
            {refreshing ? "กำลังรีเฟรช…" : "รีเฟรช"}
          </button>
        </div>
      </header>

      <section className={styles.summaryGrid} aria-label="Tenant summary">
        <article><span>ร้านทั้งหมด</span><strong>{loading ? "—" : total}</strong><small>Tenant records</small></article>
        <article><span>เปิดใช้งาน</span><strong>{loading ? "—" : active}</strong><small>Authority active</small></article>
        <article><span>กำลัง Trial</span><strong>{loading ? "—" : trials}</strong><small>Contract status = trial</small></article>
        <article><span>สาขาทั้งหมด</span><strong>{loading ? "—" : branches}</strong><small>{numberValue(summary.active_branches)} active</small></article>
        <article><span>อุปกรณ์ลงทะเบียน</span><strong>{loading ? "—" : devices}</strong><small>{numberValue(summary.active_devices)} active registry</small></article>
        <article><span>ผู้ใช้ในร้าน</span><strong>{loading ? "—" : users}</strong><small>นับ user ไม่ซ้ำต่อ Tenant</small></article>
      </section>

      <section className={styles.panel}>
        <div className={styles.toolbar}>
          <label className={styles.searchBox}>
            <span>ค้นหา</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="ชื่อร้าน, Store Code, Internal Code, Owner, Package, Contract"
            />
          </label>
          <label className={styles.filterBox}>
            <span>สถานะร้าน</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
              <option value="all">ทั้งหมด</option>
              <option value="active">เปิดใช้งาน</option>
              <option value="inactive">ปิดใช้งาน</option>
            </select>
          </label>
          <div className={styles.resultCount}>
            <strong>{filteredRows.length}</strong>
            <span>รายการที่แสดง</span>
          </div>
        </div>

        {error ? (
          <div className={styles.errorState} role="alert">
            <div>
              <strong>เชื่อมข้อมูลร้านค้าไม่สำเร็จ</strong>
              <p>{error}</p>
            </div>
            <button type="button" onClick={() => void load(false)}>ลองใหม่</button>
          </div>
        ) : null}

        <div className={styles.tableWrap}>
          <table>
            <thead>
              <tr>
                <th>Store Code</th>
                <th>ร้านค้า</th>
                <th>แพ็กเกจ / สัญญา</th>
                <th>สาขา</th>
                <th>อุปกรณ์</th>
                <th>ผู้ใช้</th>
                <th>Runtime</th>
                <th>สถานะ</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
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
                    <td>
                      <div className={styles.storeCell}>
                        <strong>{row.name || "—"}</strong>
                        <span>{row.internal_code || "—"}{row.owner_name && row.owner_name !== "—" ? ` · ${row.owner_name}` : ""}</span>
                      </div>
                    </td>
                    <td>
                      <div className={styles.packageCell}>
                        <strong>{row.package || "—"}</strong>
                        <span className={`${styles.contractBadge} ${contract === "trial" ? styles.contractTrial : contract === "active" ? styles.contractActive : styles.contractMuted}`}>
                          {contractLabel(row.contract_status)}
                        </span>
                      </div>
                    </td>
                    <td><strong className={styles.ratio}>{numberValue(row.active_branches)}</strong> / {numberValue(row.branches)}</td>
                    <td><strong className={styles.ratio}>{numberValue(row.active_devices)}</strong> / {numberValue(row.devices)}</td>
                    <td>{numberValue(row.users)}</td>
                    <td>
                      <div className={styles.runtimeCell}>
                        <span>Session {numberValue(row.active_sessions)}</span>
                        <span>กะเปิด {numberValue(row.open_shifts)}</span>
                      </div>
                    </td>
                    <td><span className={`${styles.status} ${activeRow ? styles.active : styles.inactive}`}>{statusLabel(row.status)}</span></td>
                    <td><button className={styles.detailButton} type="button" onClick={() => setSelected(row)}>รายละเอียด</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <footer className={styles.panelFooter}>
          <span>Source: CpiPOS-001 · it_admin_tenant_summary_v · authenticated read-only Control Plane</span>
          <span>อัปเดต: {data?.checked_at ? formatDate(data.checked_at) : "—"}</span>
        </footer>
      </section>

      {selected ? (
        <div className={styles.modalBackdrop} onMouseDown={(event) => { if (event.currentTarget === event.target) setSelected(null); }}>
          <section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="tenant-detail-title">
            <header className={styles.modalHeader}>
              <div>
                <span className={styles.modalEyebrow}>TENANT DETAIL · READ ONLY</span>
                <h3 id="tenant-detail-title">{selected.name || "ร้านค้า"}</h3>
                <p>{selected.store_code || "—"} · {selected.internal_code || "—"}</p>
              </div>
              <button type="button" className={styles.closeButton} onClick={() => setSelected(null)} aria-label="ปิด">×</button>
            </header>

            <div className={styles.modalBody}>
              <section className={styles.detailSection}>
                <div className={styles.sectionHeading}>
                  <div><span>STORE PROFILE</span><h4>ข้อมูลร้าน</h4></div>
                  <span className={`${styles.status} ${String(selected.status).toLowerCase() === "active" ? styles.active : styles.inactive}`}>{statusLabel(selected.status)}</span>
                </div>
                <div className={styles.detailGrid}>
                  <article><span>Store Code</span><strong>{selected.store_code || "—"}</strong></article>
                  <article><span>Internal Code</span><strong>{selected.internal_code || "—"}</strong></article>
                  <article><span>Owner / ผู้ดูแล</span><strong>{selected.owner_name || "—"}</strong></article>
                  <article><span>อัปเดตล่าสุด</span><strong>{formatDate(selected.updated_at)}</strong></article>
                </div>
              </section>

              <section className={styles.detailSection}>
                <div className={styles.sectionHeading}>
                  <div><span>SUBSCRIPTION</span><h4>แพ็กเกจและสัญญา</h4></div>
                  <span className={`${styles.contractBadge} ${String(selected.contract_status).toLowerCase() === "trial" ? styles.contractTrial : String(selected.contract_status).toLowerCase() === "active" ? styles.contractActive : styles.contractMuted}`}>{contractLabel(selected.contract_status)}</span>
                </div>
                <div className={styles.detailGrid}>
                  <article><span>Package</span><strong>{selected.package || "—"}</strong><small>{selected.package_code || "—"}</small></article>
                  <article><span>Quota mode</span><strong>{selected.quota_mode || "—"}</strong></article>
                  <article><span>เริ่มสัญญา</span><strong>{formatDate(selected.contract_started_at)}</strong></article>
                  <article><span>สิ้นสุดสัญญา</span><strong>{formatDate(selected.contract_ended_at)}</strong></article>
                </div>
              </section>

              <section className={styles.detailSection}>
                <div className={styles.sectionHeading}><div><span>CAPACITY</span><h4>การใช้งานเทียบโควตา</h4></div></div>
                <div className={styles.capacityGrid}>
                  <article><span>สาขา Active / ทั้งหมด / Quota</span><strong>{numberValue(selected.active_branches)} / {numberValue(selected.branches)} / {quotaLabel(selected.max_branches)}</strong></article>
                  <article><span>อุปกรณ์ Active / ทั้งหมด / Quota</span><strong>{numberValue(selected.active_devices)} / {numberValue(selected.devices)} / {quotaLabel(selected.max_devices)}</strong></article>
                  <article><span>ผู้ใช้ / Quota</span><strong>{usageLabel(selected.users, selected.max_users)}</strong><small>Owner {numberValue(selected.owner_users)} · Manager {numberValue(selected.manager_users)} · Staff {numberValue(selected.staff_users)}</small></article>
                  <article><span>บิลต่อเดือน</span><strong>{quotaLabel(selected.monthly_bill_limit)}</strong></article>
                  <article><span>Storage package</span><strong>{quotaLabel(selected.storage_limit_gb, " GB")}</strong></article>
                  <article><span>Retention</span><strong>{quotaLabel(selected.retention_months, " เดือน")}</strong></article>
                </div>
              </section>

              <section className={styles.detailSection}>
                <div className={styles.sectionHeading}><div><span>RUNTIME SNAPSHOT</span><h4>การใช้งานขณะนี้</h4></div></div>
                <div className={styles.runtimeGrid}>
                  <article><span>Active POS sessions</span><strong>{numberValue(selected.active_sessions)}</strong></article>
                  <article><span>Open shifts</span><strong>{numberValue(selected.open_shifts)}</strong></article>
                </div>
              </section>

              <div className={styles.modalNotice}>
                Active Device ในหน้านี้คือสถานะทะเบียนอุปกรณ์จาก CpiPOS-001 ไม่ใช่ Online/Health telemetry; สถานะออนไลน์จริงต้องอ้างอิง CpiPOS-002 ในเมนู Devices / MDM เท่านั้น
              </div>
            </div>

            <div className={styles.modalActions}>
              <Link href="/it-admin/branches">เปิดเมนูสาขา</Link>
              <Link href="/it-admin/devices">เปิด Devices / MDM</Link>
              <button type="button" onClick={() => setSelected(null)}>ปิด</button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
