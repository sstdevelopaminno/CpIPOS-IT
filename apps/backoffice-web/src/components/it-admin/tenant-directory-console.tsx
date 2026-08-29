"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./tenant-directory-console.module.css";

type TenantRow = {
  id: string;
  store_code?: string;
  name?: string;
  internal_code?: string;
  package?: string;
  branches?: number;
  devices?: number;
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
      return [row.store_code, row.name, row.internal_code, row.package]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalized));
    });
  }, [data?.rows, query, statusFilter]);

  const summary = data?.summary ?? {};
  const total = numberValue(summary.total);
  const active = numberValue(summary.active);
  const inactive = numberValue(summary.inactive);
  const branches = numberValue(summary.branches);
  const devices = numberValue(summary.devices);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <div className={styles.eyebrow}>CUSTOMERS & STORES · CPIPOS-001</div>
          <h2>ร้านค้า / Tenants</h2>
          <p>ศูนย์รวมร้านค้า SaaS จาก Business Authority จริง พร้อม Store Code, แพ็กเกจ, สาขา และอุปกรณ์ที่ลงทะเบียน</p>
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
        <article><span>เปิดใช้งาน</span><strong>{loading ? "—" : active}</strong><small>พร้อมใช้งานตาม authority</small></article>
        <article><span>ปิดใช้งาน</span><strong>{loading ? "—" : inactive}</strong><small>ไม่เปิดใช้งานในระบบ</small></article>
        <article><span>สาขาทั้งหมด</span><strong>{loading ? "—" : branches}</strong><small>ทุก Tenant รวมกัน</small></article>
        <article><span>อุปกรณ์ลงทะเบียน</span><strong>{loading ? "—" : devices}</strong><small>Registry ไม่เท่ากับ Online</small></article>
      </section>

      <section className={styles.panel}>
        <div className={styles.toolbar}>
          <label className={styles.searchBox}>
            <span>ค้นหา</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="ชื่อร้าน, Store Code, Internal Code, Package"
            />
          </label>
          <label className={styles.filterBox}>
            <span>สถานะ</span>
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
                <th>แพ็กเกจ</th>
                <th>สาขา</th>
                <th>อุปกรณ์</th>
                <th>สถานะ</th>
                <th>อัปเดตล่าสุด</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8}><div className={styles.loadingState}>กำลังโหลดข้อมูลจริงจาก CpiPOS-001…</div></td></tr>
              ) : filteredRows.length === 0 ? (
                <tr><td colSpan={8}><div className={styles.emptyState}>ไม่พบร้านค้าที่ตรงกับตัวกรอง</div></td></tr>
              ) : filteredRows.map((row) => {
                const activeRow = String(row.status ?? "").toLowerCase() === "active";
                return (
                  <tr key={row.id}>
                    <td><span className={styles.code}>{row.store_code || "—"}</span></td>
                    <td>
                      <div className={styles.storeCell}>
                        <strong>{row.name || "—"}</strong>
                        <span>{row.internal_code || "—"}</span>
                      </div>
                    </td>
                    <td>{row.package || "—"}</td>
                    <td>{numberValue(row.branches)}</td>
                    <td>{numberValue(row.devices)}</td>
                    <td><span className={`${styles.status} ${activeRow ? styles.active : styles.inactive}`}>{statusLabel(row.status)}</span></td>
                    <td>{formatDate(row.updated_at)}</td>
                    <td><button className={styles.detailButton} type="button" onClick={() => setSelected(row)}>รายละเอียด</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <footer className={styles.panelFooter}>
          <span>Source: CpiPOS-001 · authenticated read-only Control Plane</span>
          <span>อัปเดต: {data?.checked_at ? formatDate(data.checked_at) : "—"}</span>
        </footer>
      </section>

      {selected ? (
        <div className={styles.modalBackdrop} onMouseDown={(event) => { if (event.currentTarget === event.target) setSelected(null); }}>
          <section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="tenant-detail-title">
            <header className={styles.modalHeader}>
              <div>
                <span className={styles.modalEyebrow}>TENANT DETAIL</span>
                <h3 id="tenant-detail-title">{selected.name || "ร้านค้า"}</h3>
                <p>{selected.store_code || "—"} · {selected.internal_code || "—"}</p>
              </div>
              <button type="button" className={styles.closeButton} onClick={() => setSelected(null)} aria-label="ปิด">×</button>
            </header>

            <div className={styles.detailGrid}>
              <article><span>Store Code</span><strong>{selected.store_code || "—"}</strong></article>
              <article><span>Internal Code</span><strong>{selected.internal_code || "—"}</strong></article>
              <article><span>Package</span><strong>{selected.package || "—"}</strong></article>
              <article><span>สถานะร้าน</span><strong>{statusLabel(selected.status)}</strong></article>
              <article><span>จำนวนสาขา</span><strong>{numberValue(selected.branches)}</strong></article>
              <article><span>อุปกรณ์ลงทะเบียน</span><strong>{numberValue(selected.devices)}</strong></article>
              <article className={styles.wideDetail}><span>อัปเดตล่าสุด</span><strong>{formatDate(selected.updated_at)}</strong></article>
            </div>

            <div className={styles.modalNotice}>
              หน้านี้เป็นข้อมูลอ่านอย่างเดียว ข้อมูล Online/Health จะอ้างอิง telemetry จาก CpiPOS-002 ในเมนู Devices / MDM และจะไม่ตีความ Registry Active เป็น Online เอง
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
