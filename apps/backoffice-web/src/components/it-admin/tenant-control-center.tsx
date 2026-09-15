"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./tenant-directory-console.module.css";

type ApiEnvelope<T> = { data: T | null; error: { code?: string; message?: string } | null };

type Tenant = {
  id: string;
  tenant_code: string;
  store_code?: string;
  internal_code?: string;
  name: string;
  display_name: string | null;
  contact_phone: string | null;
  is_active: boolean;
  logo_url: string | null;
  company_address: string | null;
  package_id?: string | null;
  created_at: string;
  updated_at: string;
};

type Branch = {
  id: string;
  tenant_id: string;
  branch_code: string;
  branch_name: string;
  address: unknown;
  status: string;
  is_active: boolean;
};

type Package = {
  id: string;
  code: string;
  name: string;
  status: string;
  is_active: boolean;
  monthly_price: number | string | null;
  yearly_price: number | string | null;
  max_branches: number | null;
  max_devices: number | null;
  max_users: number | null;
};

type Contract = {
  id: string;
  package_id: string | null;
  billing_cycle: string;
  amount: number | string | null;
  currency: string;
  status: string;
  effective_status?: string;
  auto_renew?: boolean;
  activated_at: string | null;
  start_at: string | null;
  end_at: string | null;
  trial_end_at: string | null;
  cancelled_at: string | null;
  days_remaining?: number | null;
  max_branches?: number | null;
  max_devices?: number | null;
  max_users?: number | null;
  metadata: unknown;
} | null;

type Lifecycle = {
  lifecycle_status: string;
  trial_started_at: string | null;
  trial_expires_at: string | null;
  current_package_started_at: string | null;
  subscription_expires_at: string | null;
  access_locked: boolean;
  lock_reason: string | null;
} | null;

type ControlData = {
  tenant: Tenant;
  branches: Branch[];
  packages: Package[];
  contract: Contract;
  current_package: Package | null;
  lifecycle?: Lifecycle;
  usage: { active_devices: number; assigned_users: number; online_devices_5m: number };
  pos_notice: { status: string; title: string | null; message: string | null; admin_reason: string | null } | null;
};

type Tab = "profile" | "branches" | "package" | "danger";
type BillingCycle = "monthly" | "yearly";

type Props = {
  tenantId: string;
  fallbackName: string;
  onClose: () => void;
  onChanged: () => void;
  onDeleted: () => void;
};

function addressText(value: unknown) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (typeof record.text === "string") return record.text;
    return [record.address, record.line1, record.district, record.province, record.postcode]
      .filter((item) => typeof item === "string" && item.trim())
      .join(" ");
  }
  return "";
}

function money(value: number | string | null | undefined) {
  const number = Number(value ?? 0);
  return new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB", maximumFractionDigits: 0 }).format(Number.isFinite(number) ? number : 0);
}

function contractLabel(status: string | null | undefined) {
  const normalized = String(status ?? "").toLowerCase();
  if (normalized === "active") return "ใช้งาน";
  if (normalized === "trial") return "ทดลองใช้";
  if (normalized === "suspended") return "หยุดชั่วคราว";
  if (normalized === "cancelled") return "ยกเลิกแล้ว";
  if (normalized === "expired") return "หมดอายุ";
  return "ยังไม่มีสัญญา";
}

function statusClass(status: string | null | undefined) {
  const normalized = String(status ?? "").toLowerCase();
  if (normalized === "active" || normalized === "trial") return styles.controlGood;
  if (normalized === "suspended") return styles.controlWarn;
  return styles.controlMuted;
}

function dateOnly(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function todayLocal() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addBillingDate(dateValue: string, cycle: BillingCycle) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) return "";
  const source = new Date(`${dateValue}T00:00:00.000Z`);
  if (Number.isNaN(source.getTime())) return "";
  const absoluteMonth = source.getUTCMonth() + (cycle === "yearly" ? 12 : 1);
  const year = source.getUTCFullYear() + Math.floor(absoluteMonth / 12);
  const month = ((absoluteMonth % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(source.getUTCDate(), lastDay);
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("th-TH", { year: "numeric", month: "short", day: "numeric" });
}

async function parse<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (!response.ok || !body?.data) throw new Error(body?.error?.message ?? `Request failed (${response.status})`);
  return body.data;
}

export function TenantControlCenter({ tenantId, fallbackName, onClose, onChanged, onDeleted }: Props) {
  const [tab, setTab] = useState<Tab>("profile");
  const [data, setData] = useState<ControlData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [profile, setProfile] = useState({ display_name: "", legal_name: "", contact_phone: "", company_address: "", logo_url: "" });
  const [newBranch, setNewBranch] = useState({ branch_code: "", branch_name: "", branch_address: "" });
  const [branchDrafts, setBranchDrafts] = useState<Record<string, { branch_name: string; branch_address: string; branch_active: boolean }>>({});

  const [contractCycle, setContractCycle] = useState<BillingCycle>("monthly");
  const [contractStartDate, setContractStartDate] = useState("");
  const [contractEndDate, setContractEndDate] = useState("");
  const [contractAutoEnd, setContractAutoEnd] = useState(true);
  const [contractAutoRenew, setContractAutoRenew] = useState(false);

  const [packageId, setPackageId] = useState("");
  const [billingCycle, setBillingCycle] = useState<BillingCycle>("monthly");
  const [changeStartDate, setChangeStartDate] = useState(todayLocal());
  const [changeEndDate, setChangeEndDate] = useState(addBillingDate(todayLocal(), "monthly"));
  const [changeAutoEnd, setChangeAutoEnd] = useState(true);
  const [changeAutoRenew, setChangeAutoRenew] = useState(false);
  const [changeReason, setChangeReason] = useState("");
  const [notice, setNotice] = useState({ customer_title: "ระบบถูกระงับชั่วคราว", customer_message: "", admin_reason: "" });
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleteReason, setDeleteReason] = useState("");

  const applyData = useCallback((next: ControlData) => {
    setData(next);
    setProfile({
      display_name: next.tenant.display_name ?? next.tenant.name ?? "",
      legal_name: next.tenant.name ?? "",
      contact_phone: next.tenant.contact_phone ?? "",
      company_address: next.tenant.company_address ?? "",
      logo_url: next.tenant.logo_url ?? ""
    });
    setPackageId(next.current_package?.id ?? next.packages[0]?.id ?? "");

    const cycle = next.contract?.billing_cycle === "yearly" ? "yearly" : "monthly";
    const start = dateOnly(next.contract?.start_at) || todayLocal();
    const end = dateOnly(next.contract?.end_at) || addBillingDate(start, cycle);
    setContractCycle(cycle);
    setContractStartDate(start);
    setContractEndDate(end);
    setContractAutoEnd(!next.contract?.end_at);
    setContractAutoRenew(Boolean(next.contract?.auto_renew));

    const changeStart = todayLocal();
    setBillingCycle(cycle);
    setChangeStartDate(changeStart);
    setChangeEndDate(addBillingDate(changeStart, cycle));
    setChangeAutoEnd(true);
    setChangeAutoRenew(Boolean(next.contract?.auto_renew));

    setNotice({
      customer_title: next.pos_notice?.title ?? "ระบบถูกระงับชั่วคราว",
      customer_message: next.pos_notice?.message ?? "",
      admin_reason: next.pos_notice?.admin_reason ?? ""
    });
    setBranchDrafts(Object.fromEntries(next.branches.map((branch) => [branch.id, {
      branch_name: branch.branch_name,
      branch_address: addressText(branch.address),
      branch_active: branch.is_active
    }])));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/it-admin/v1/tenants/${tenantId}/control`, { cache: "no-store", credentials: "include" });
      applyData(await parse<ControlData>(response));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "โหลดข้อมูลร้านไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, [applyData, tenantId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const mutate = useCallback(async (payload: Record<string, unknown>, message: string, destructive = false) => {
    if (destructive && !window.confirm("ยืนยันการดำเนินการนี้? ระบบจะบันทึก Audit Log ทุกครั้ง")) return null;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch(`/api/it-admin/v1/tenants/${tenantId}/control`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      const next = await parse<ControlData | { deleted: true }>(response);
      if ("deleted" in next && next.deleted) {
        onDeleted();
        return next;
      }
      applyData(next as ControlData);
      setSuccess(message);
      onChanged();
      return next;
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "บันทึกข้อมูลไม่สำเร็จ");
      return null;
    } finally {
      setBusy(false);
    }
  }, [applyData, onChanged, onDeleted, tenantId]);

  const selectedPackage = useMemo(() => data?.packages.find((pkg) => pkg.id === packageId) ?? null, [data?.packages, packageId]);
  const storeName = data?.tenant.display_name || data?.tenant.name || fallbackName;
  const currentStatus = data?.contract?.effective_status ?? data?.contract?.status ?? "none";
  const canSuspend = currentStatus === "active" || currentStatus === "trial";
  const canResume = currentStatus === "suspended";
  const canCancel = Boolean(data?.contract) && !["cancelled", "expired"].includes(currentStatus);
  const canEditContract = Boolean(data?.contract) && !["cancelled", "expired"].includes(currentStatus);
  const isTrial = currentStatus === "trial";

  const changeContractCycle = (cycle: BillingCycle) => {
    setContractCycle(cycle);
    if (contractAutoEnd && contractStartDate) setContractEndDate(addBillingDate(contractStartDate, cycle));
  };
  const changeContractStart = (value: string) => {
    setContractStartDate(value);
    if (contractAutoEnd) setContractEndDate(addBillingDate(value, contractCycle));
  };
  const changePackageCycle = (cycle: BillingCycle) => {
    setBillingCycle(cycle);
    if (changeAutoEnd && changeStartDate) setChangeEndDate(addBillingDate(changeStartDate, cycle));
  };
  const changePackageStart = (value: string) => {
    setChangeStartDate(value);
    if (changeAutoEnd) setChangeEndDate(addBillingDate(value, billingCycle));
  };

  return (
    <div className={styles.modalBackdrop} onMouseDown={(event) => { if (event.currentTarget === event.target && !busy) onClose(); }}>
      <section className={`${styles.modal} ${styles.controlModal}`} role="dialog" aria-modal="true" aria-labelledby="tenant-control-title">
        <header className={styles.controlHeader}>
          <div className={styles.storeIdentity}>
            <div className={styles.storeLogo} style={profile.logo_url ? { backgroundImage: `url(${profile.logo_url})` } : undefined} aria-label="Store logo">
              {!profile.logo_url ? (storeName || "S").slice(0, 1).toUpperCase() : null}
            </div>
            <div>
              <span className={styles.modalEyebrow}>STORE CONTROL CENTER · CPIPOS-001</span>
              <h3 id="tenant-control-title">{storeName}</h3>
              <p>Store Code {data?.tenant.store_code ?? data?.tenant.tenant_code ?? "—"} · Internal {data?.tenant.internal_code ?? "—"}</p>
            </div>
          </div>
          <div className={styles.headerStatusGroup}>
            <span className={`${styles.controlPill} ${data?.tenant.is_active ? styles.controlGood : styles.controlMuted}`}>{data?.tenant.is_active ? "ร้านเปิดใช้งาน" : "ร้านปิดใช้งาน"}</span>
            <span className={`${styles.controlPill} ${statusClass(currentStatus)}`}>{contractLabel(currentStatus)}</span>
            <button type="button" className={styles.closeButton} onClick={onClose} disabled={busy} aria-label="ปิด">×</button>
          </div>
        </header>

        <nav className={styles.controlTabs} aria-label="Store control sections">
          <button type="button" className={tab === "profile" ? styles.activeTab : ""} onClick={() => setTab("profile")}>ข้อมูลร้าน</button>
          <button type="button" className={tab === "branches" ? styles.activeTab : ""} onClick={() => setTab("branches")}>สาขา <span>{data?.branches.length ?? 0}</span></button>
          <button type="button" className={tab === "package" ? styles.activeTab : ""} onClick={() => setTab("package")}>แพ็กเกจและสิทธิ์</button>
          <button type="button" className={tab === "danger" ? styles.activeDangerTab : ""} onClick={() => setTab("danger")}>พื้นที่อันตราย</button>
        </nav>

        <div className={styles.controlBody}>
          {loading ? <div className={styles.controlLoading}>กำลังโหลด Store Control Center…</div> : null}
          {error ? <div className={styles.controlAlertError}><strong>ดำเนินการไม่สำเร็จ</strong><span>{error}</span></div> : null}
          {success ? <div className={styles.controlAlertSuccess}>{success}</div> : null}

          {!loading && data && tab === "profile" ? (
            <div className={styles.controlStack}>
              <section className={styles.controlSection}>
                <div className={styles.controlSectionHeader}>
                  <div><span>STORE PROFILE</span><h4>ข้อมูลและตั้งค่าเริ่มต้นร้าน</h4></div>
                  <small>Store {data.tenant.store_code ?? data.tenant.tenant_code} · Internal {data.tenant.internal_code ?? "—"}</small>
                </div>
                <div className={styles.formGrid}>
                  <label><span>ชื่อร้านที่แสดง</span><input value={profile.display_name} onChange={(e) => setProfile((v) => ({ ...v, display_name: e.target.value }))} /></label>
                  <label><span>ชื่อทางการ / ชื่อนิติบุคคล</span><input value={profile.legal_name} onChange={(e) => setProfile((v) => ({ ...v, legal_name: e.target.value }))} /></label>
                  <label className={styles.span2}><span>โทรศัพท์ร้าน</span><input value={profile.contact_phone} onChange={(e) => setProfile((v) => ({ ...v, contact_phone: e.target.value }))} /></label>
                  <label className={styles.span2}><span>ที่อยู่ร้าน</span><textarea rows={3} value={profile.company_address} onChange={(e) => setProfile((v) => ({ ...v, company_address: e.target.value }))} /></label>
                  <label className={styles.span2}><span>โลโก้ร้าน (URL)</span><input placeholder="https://..." value={profile.logo_url} onChange={(e) => setProfile((v) => ({ ...v, logo_url: e.target.value }))} /><small>Store Profile ใช้เฉพาะคอลัมน์จริงใน CpiPOS-001 เพื่อไม่ให้การบันทึกชน schema</small></label>
                </div>
                <div className={styles.sectionActions}>
                  <button className={styles.primaryButton} type="button" disabled={busy} onClick={() => void mutate({ action: "update_profile", ...profile }, "บันทึกข้อมูลร้านเรียบร้อย")}>บันทึกข้อมูลร้าน</button>
                </div>
              </section>

              <section className={styles.quickStats}>
                <article><span>สาขา</span><strong>{data.branches.filter((branch) => branch.is_active).length} / {data.branches.length}</strong><small>เปิดใช้งาน / ทั้งหมด</small></article>
                <article><span>อุปกรณ์ Active</span><strong>{data.usage.active_devices}</strong><small>จาก CpiPOS-001</small></article>
                <article><span>Online 5 นาที</span><strong>{data.usage.online_devices_5m}</strong><small>Heartbeat ล่าสุด</small></article>
                <article><span>ผู้ใช้ในร้าน</span><strong>{data.usage.assigned_users}</strong><small>นับ User ไม่ซ้ำ</small></article>
              </section>
            </div>
          ) : null}

          {!loading && data && tab === "branches" ? (
            <div className={styles.controlStack}>
              <section className={styles.controlSection}>
                <div className={styles.controlSectionHeader}><div><span>BRANCHES</span><h4>เปิดสาขาและแก้ไขชื่อสาขา</h4></div><small>{data.branches.length} สาขา</small></div>
                <div className={styles.branchList}>
                  {data.branches.map((branch) => {
                    const draft = branchDrafts[branch.id] ?? { branch_name: branch.branch_name, branch_address: addressText(branch.address), branch_active: branch.is_active };
                    return (
                      <article className={styles.branchCard} key={branch.id}>
                        <div className={styles.branchCardTop}><div><strong>{branch.branch_code}</strong><span>{branch.is_active ? "เปิดใช้งาน" : "ปิดใช้งาน"}</span></div><label className={styles.switchLabel}><input type="checkbox" checked={draft.branch_active} onChange={(e) => setBranchDrafts((all) => ({ ...all, [branch.id]: { ...draft, branch_active: e.target.checked } }))} /><span>เปิดสาขา</span></label></div>
                        <div className={styles.formGrid}>
                          <label><span>ชื่อสาขา</span><input value={draft.branch_name} onChange={(e) => setBranchDrafts((all) => ({ ...all, [branch.id]: { ...draft, branch_name: e.target.value } }))} /></label>
                          <label><span>ที่อยู่สาขา</span><input value={draft.branch_address} onChange={(e) => setBranchDrafts((all) => ({ ...all, [branch.id]: { ...draft, branch_address: e.target.value } }))} /></label>
                        </div>
                        <div className={styles.sectionActions}><button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => void mutate({ action: "update_branch", branch_id: branch.id, ...draft }, `บันทึกสาขา ${branch.branch_code} เรียบร้อย`)}>บันทึกสาขา</button></div>
                      </article>
                    );
                  })}
                </div>
              </section>

              <section className={styles.controlSection}>
                <div className={styles.controlSectionHeader}><div><span>NEW BRANCH</span><h4>เปิดสาขาใหม่</h4></div></div>
                <div className={styles.formGrid}>
                  <label><span>Branch Code</span><input placeholder="เช่น bkk-002" value={newBranch.branch_code} onChange={(e) => setNewBranch((v) => ({ ...v, branch_code: e.target.value }))} /></label>
                  <label><span>ชื่อสาขา</span><input placeholder="สาขา..." value={newBranch.branch_name} onChange={(e) => setNewBranch((v) => ({ ...v, branch_name: e.target.value }))} /></label>
                  <label className={styles.span2}><span>ที่อยู่สาขา</span><textarea rows={2} value={newBranch.branch_address} onChange={(e) => setNewBranch((v) => ({ ...v, branch_address: e.target.value }))} /></label>
                </div>
                <div className={styles.sectionActions}><button className={styles.primaryButton} type="button" disabled={busy || !newBranch.branch_code.trim() || !newBranch.branch_name.trim()} onClick={async () => { const result = await mutate({ action: "create_branch", ...newBranch }, "เปิดสาขาใหม่เรียบร้อย"); if (result) setNewBranch({ branch_code: "", branch_name: "", branch_address: "" }); }}>เปิดสาขาใหม่</button></div>
              </section>
            </div>
          ) : null}

          {!loading && data && tab === "package" ? (
            <div className={styles.controlStack}>
              <section className={styles.packageHero}>
                <div>
                  <span>CURRENT PACKAGE</span>
                  <h4>{data.current_package?.name ?? "ยังไม่กำหนดแพ็กเกจ"}</h4>
                  <p>{data.current_package?.code ?? "—"} · {contractLabel(currentStatus)} · {data.contract?.billing_cycle === "yearly" ? "รายปี" : data.contract ? "รายเดือน" : "—"}</p>
                </div>
                <div className={styles.packageMetrics}><span>สาขา {data.contract?.max_branches ?? data.current_package?.max_branches ?? "—"}</span><span>อุปกรณ์ {data.contract?.max_devices ?? data.current_package?.max_devices ?? "—"}</span><span>ผู้ใช้ {data.contract?.max_users ?? data.current_package?.max_users ?? "—"}</span></div>
              </section>

              <section className={styles.quickStats}>
                <article><span>เปิดสัญญา</span><strong>{formatDate(data.contract?.start_at)}</strong><small>{data.contract?.billing_cycle === "yearly" ? "รอบรายปี" : "รอบรายเดือน"}</small></article>
                <article><span>หมดอายุ</span><strong>{formatDate(data.contract?.end_at)}</strong><small>{data.contract?.end_at ? "POS ตรวจ ended_at อัตโนมัติ" : "ยังไม่กำหนด"}</small></article>
                <article><span>คงเหลือ</span><strong>{data.contract?.days_remaining == null ? "—" : `${data.contract.days_remaining} วัน`}</strong><small>{contractLabel(currentStatus)}</small></article>
                <article><span>Auto renew</span><strong>{data.contract?.auto_renew ? "เปิด" : "ปิด"}</strong><small>แก้ไขด้านล่าง</small></article>
              </section>

              {data.contract ? (
                <section className={styles.controlSection}>
                  <div className={styles.controlSectionHeader}><div><span>CONTRACT PERIOD</span><h4>วันที่สัญญาและรอบบิล</h4></div><span className={`${styles.controlPill} ${statusClass(currentStatus)}`}>{contractLabel(currentStatus)}</span></div>
                  <p className={styles.sectionCopy}>เลือกวันที่เริ่มและรายเดือน/รายปี ระบบจะคำนวณวันหมดอายุให้อัตโนมัติ หรือปิด Auto calculate เพื่อกำหนดวันหมดอายุเอง</p>
                  <div className={styles.formGrid}>
                    <label><span>วันที่เปิดสัญญา</span><input type="date" value={contractStartDate} onChange={(e) => changeContractStart(e.target.value)} disabled={!canEditContract} /></label>
                    <label><span>รอบสัญญา</span><select value={contractCycle} onChange={(e) => changeContractCycle(e.target.value as BillingCycle)} disabled={!canEditContract}><option value="monthly">รายเดือน</option><option value="yearly">รายปี</option></select></label>
                    <label><span>วันหมดอายุ</span><input type="date" value={contractEndDate} onChange={(e) => setContractEndDate(e.target.value)} disabled={!canEditContract || contractAutoEnd} /></label>
                    <label className={styles.switchLabel}><input type="checkbox" checked={contractAutoEnd} disabled={!canEditContract} onChange={(e) => { const checked = e.target.checked; setContractAutoEnd(checked); if (checked) setContractEndDate(addBillingDate(contractStartDate, contractCycle)); }} /><span>คำนวณวันหมดอายุอัตโนมัติ</span></label>
                    <label className={styles.switchLabel}><input type="checkbox" checked={contractAutoRenew} disabled={!canEditContract} onChange={(e) => setContractAutoRenew(e.target.checked)} /><span>ต่ออายุอัตโนมัติ</span></label>
                  </div>
                  <div className={styles.packagePreview}><strong>{contractCycle === "yearly" ? "สัญญารายปี" : "สัญญารายเดือน"}</strong><span>{contractStartDate || "—"} → {contractEndDate || "—"}</span></div>
                  <div className={styles.sectionActions}><button className={styles.secondaryButton} type="button" disabled={busy || !canEditContract || !contractStartDate || !contractEndDate} onClick={() => void mutate({ action: "update_contract", billing_cycle: contractCycle, start_date: contractStartDate, end_date: contractAutoEnd ? undefined : contractEndDate, auto_calculate_end: contractAutoEnd, auto_renew: contractAutoRenew }, "อัปเดตวันที่สัญญาและรอบบิลแล้ว", true)}>บันทึกวันที่สัญญา</button></div>
                </section>
              ) : null}

              <section className={styles.controlSection}>
                <div className={styles.controlSectionHeader}>
                  <div><span>{isTrial ? "ACTIVATE PAID PACKAGE" : "CHANGE PACKAGE"}</span><h4>{isTrial ? "เปลี่ยนจาก Trial เป็นแพ็กเกจจริง" : "เปลี่ยนแพ็กเกจ"}</h4></div>
                  <small>{isTrial ? "เปิดแพ็กเกจจริงได้ทันที ไม่ต้องรอ Trial หมด" : "สร้างสัญญาใหม่และเก็บประวัติสัญญาเดิม"}</small>
                </div>
                <div className={styles.formGrid}>
                  <label><span>แพ็กเกจ</span><select value={packageId} onChange={(e) => setPackageId(e.target.value)}>{data.packages.map((pkg) => <option value={pkg.id} key={pkg.id}>{pkg.name} · {pkg.code}</option>)}</select></label>
                  <label><span>รอบบิล</span><select value={billingCycle} onChange={(e) => changePackageCycle(e.target.value as BillingCycle)}><option value="monthly">รายเดือน</option><option value="yearly">รายปี</option></select></label>
                  <label><span>วันที่เริ่มแพ็กเกจจริง</span><input type="date" max={todayLocal()} value={changeStartDate} onChange={(e) => changePackageStart(e.target.value)} /></label>
                  <label><span>วันหมดอายุ</span><input type="date" value={changeEndDate} onChange={(e) => setChangeEndDate(e.target.value)} disabled={changeAutoEnd} /></label>
                  <label className={styles.switchLabel}><input type="checkbox" checked={changeAutoEnd} onChange={(e) => { const checked = e.target.checked; setChangeAutoEnd(checked); if (checked) setChangeEndDate(addBillingDate(changeStartDate, billingCycle)); }} /><span>คำนวณวันหมดอายุอัตโนมัติ</span></label>
                  <label className={styles.switchLabel}><input type="checkbox" checked={changeAutoRenew} onChange={(e) => setChangeAutoRenew(e.target.checked)} /><span>ต่ออายุอัตโนมัติ</span></label>
                  <label className={styles.span2}><span>เหตุผลภายใน (Audit)</span><input placeholder={isTrial ? "เช่น ลูกค้ายืนยันเปิดแพ็กเกจจริงก่อน Trial หมด" : "เช่น ลูกค้าขออัปเกรดแพ็กเกจ"} value={changeReason} onChange={(e) => setChangeReason(e.target.value)} /></label>
                </div>
                {selectedPackage ? <div className={styles.packagePreview}><strong>{selectedPackage.name}</strong><span>{billingCycle === "yearly" ? money(selectedPackage.yearly_price) : money(selectedPackage.monthly_price)} · {changeStartDate || "—"} → {changeEndDate || "—"} · สูงสุด {selectedPackage.max_branches ?? "—"} สาขา / {selectedPackage.max_devices ?? "—"} อุปกรณ์</span></div> : null}
                <div className={styles.sectionActions}><button className={styles.primaryButton} type="button" disabled={busy || !packageId || !changeStartDate || !changeEndDate} onClick={() => void mutate({ action: "change_package", package_id: packageId, billing_cycle: billingCycle, start_date: changeStartDate, end_date: changeAutoEnd ? undefined : changeEndDate, auto_calculate_end: changeAutoEnd, auto_renew: changeAutoRenew, admin_reason: changeReason }, isTrial ? "เปิดแพ็กเกจจริงเรียบร้อย" : "เปลี่ยนแพ็กเกจเรียบร้อย", true)}>{isTrial ? "เปิดแพ็กเกจจริงตอนนี้" : "ยืนยันเปลี่ยนแพ็กเกจ"}</button></div>
              </section>

              <section className={styles.controlSection}>
                <div className={styles.controlSectionHeader}><div><span>PACKAGE ACCESS</span><h4>หยุด / เปิดแพ็กเกจและข้อความแจ้งลูกค้า</h4></div><span className={`${styles.controlPill} ${statusClass(currentStatus)}`}>{contractLabel(currentStatus)}</span></div>
                <div className={styles.noticeEditorGrid}>
                  <div className={styles.noticeFields}>
                    <label><span>หัวข้อที่ลูกค้าเห็น</span><input value={notice.customer_title} onChange={(e) => setNotice((v) => ({ ...v, customer_title: e.target.value }))} /></label>
                    <label><span>ข้อความที่ลูกค้าเห็นบน POS</span><textarea rows={4} placeholder="อธิบายสาเหตุและวิธีติดต่อ..." value={notice.customer_message} onChange={(e) => setNotice((v) => ({ ...v, customer_message: e.target.value }))} /></label>
                    <label><span>เหตุผลภายใน IT (ลูกค้าไม่เห็น)</span><textarea rows={3} placeholder="บันทึกเหตุผลสำหรับ Audit Log" value={notice.admin_reason} onChange={(e) => setNotice((v) => ({ ...v, admin_reason: e.target.value }))} /></label>
                  </div>
                  <div className={styles.posNoticePreview}>
                    <span>POS POPUP PREVIEW</span>
                    <div className={styles.previewLogo} style={profile.logo_url ? { backgroundImage: `url(${profile.logo_url})` } : undefined}>{!profile.logo_url ? "CP" : null}</div>
                    <strong>{notice.customer_title || "ระบบถูกระงับชั่วคราว"}</strong>
                    <p>{notice.customer_message || "ข้อความแจ้งลูกค้าจะแสดงตรงนี้"}</p>
                    <small>{storeName}</small>
                  </div>
                </div>
                <div className={styles.packageActionBar}>
                  <button type="button" className={styles.warningButton} disabled={busy || !canSuspend || notice.customer_message.trim().length < 4 || notice.admin_reason.trim().length < 4} onClick={() => void mutate({ action: "suspend_package", ...notice }, "หยุดแพ็กเกจชั่วคราวแล้ว", true)}>หยุดแพ็กเกจชั่วคราว</button>
                  <button type="button" className={styles.successButton} disabled={busy || !canResume} onClick={() => void mutate({ action: "resume_package" }, "เปิดแพ็กเกจกลับมาใช้งานแล้ว", true)}>เปิดใช้งานต่อ</button>
                  <button type="button" className={styles.dangerOutlineButton} disabled={busy || !canCancel || notice.admin_reason.trim().length < 4} onClick={() => void mutate({ action: "cancel_subscription", ...notice }, "ยกเลิกแพ็กเกจแล้ว", true)}>ยกเลิกแพ็กเกจ</button>
                </div>
                <div className={styles.securityNote}>POS ใช้สถานะสัญญาและ ended_at เป็น Feature Gate อยู่แล้ว ส่วนข้อความลูกค้าและเหตุผลภายใน IT แยกคนละฟิลด์เพื่อไม่ให้ข้อมูลภายในหลุดไปหน้าขาย</div>
              </section>
            </div>
          ) : null}

          {!loading && data && tab === "danger" ? (
            <div className={styles.controlStack}>
              <section className={styles.controlSection}>
                <div className={styles.controlSectionHeader}><div><span>STORE ACCESS</span><h4>เปิด / ปิดร้าน</h4></div><span className={`${styles.controlPill} ${data.tenant.is_active ? styles.controlGood : styles.controlMuted}`}>{data.tenant.is_active ? "เปิดใช้งาน" : "ปิดใช้งาน"}</span></div>
                <p className={styles.sectionCopy}>การปิดร้านเป็น Soft disable ข้อมูลยังอยู่ครบ สามารถเปิดกลับได้ภายหลัง</p>
                <div className={styles.formGrid}><label className={styles.span2}><span>เหตุผลการปิดร้าน</span><textarea rows={3} value={deleteReason} onChange={(e) => setDeleteReason(e.target.value)} placeholder="เหตุผลสำหรับ Audit Log" /></label></div>
                <div className={styles.sectionActions}>
                  {data.tenant.is_active ? <button type="button" className={styles.warningButton} disabled={busy || deleteReason.trim().length < 4} onClick={() => void mutate({ action: "deactivate_store", admin_reason: deleteReason }, "ปิดร้านชั่วคราวแล้ว", true)}>ปิดร้านชั่วคราว</button> : <button type="button" className={styles.successButton} disabled={busy} onClick={() => void mutate({ action: "reactivate_store" }, "เปิดร้านกลับมาใช้งานแล้ว", true)}>เปิดร้านกลับมาใช้งาน</button>}
                </div>
              </section>

              <section className={`${styles.controlSection} ${styles.dangerSection}`}>
                <div className={styles.controlSectionHeader}><div><span>PERMANENT DELETE</span><h4>ลบร้านค้าและข้อมูลทั้งหมด</h4></div><strong>ถาวร</strong></div>
                <div className={styles.dangerWarning}><strong>คำเตือน</strong><p>การลบร้านจะ Cascade ข้อมูลร้านจำนวนมาก คืนกลับไม่ได้ ระบบอนุญาตเมื่อปิดร้าน ปิดสัญญา และไม่มีอุปกรณ์ออนไลน์ใน 5 นาทีล่าสุดเท่านั้น</p></div>
                <div className={styles.formGrid}>
                  <label><span>พิมพ์ Store Code เพื่อยืนยัน</span><input value={deleteConfirm} onChange={(e) => setDeleteConfirm(e.target.value)} placeholder={data.tenant.store_code ?? data.tenant.tenant_code} /></label>
                  <label><span>เหตุผลการลบถาวร</span><input value={deleteReason} onChange={(e) => setDeleteReason(e.target.value)} placeholder="อย่างน้อย 8 ตัวอักษร" /></label>
                </div>
                <div className={styles.sectionActions}><button type="button" className={styles.dangerButton} disabled={busy || data.tenant.is_active || deleteConfirm !== (data.tenant.store_code ?? data.tenant.tenant_code) || deleteReason.trim().length < 8} onClick={() => void mutate({ action: "delete_store", confirmation_code: deleteConfirm, admin_reason: deleteReason }, "ลบร้านถาวรแล้ว", true)}>ลบร้านถาวร</button></div>
              </section>
            </div>
          ) : null}
        </div>

        <footer className={styles.controlFooter}>
          <div><span>Authority: CpiPOS-001</span><small>Contract authority: tenant_subscription_contracts · ทุกการเปลี่ยนแปลงสำคัญมี Audit Log</small></div>
          <div className={styles.footerLinks}><Link href={`/tenants/${tenantId}/branches`}>เมนูสาขา</Link><Link href={`/tenants/${tenantId}/devices`}>Devices / MDM</Link><button type="button" onClick={onClose} disabled={busy}>ปิด</button></div>
        </footer>
      </section>
    </div>
  );
}
