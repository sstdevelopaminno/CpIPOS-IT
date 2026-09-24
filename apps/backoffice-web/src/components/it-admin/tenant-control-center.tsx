"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { POS_SALES_MODE_KEYS, type PosSalesModeKey, type PosSalesModeView } from "@/lib/pos-sales-modes";
import { useTenantActionConfirm } from "./tenant-action-confirm";
import { TenantPrimaryOwnerCard } from "./tenant-primary-owner-card";
import { TenantSalesSummary } from "./tenant-sales-summary";
import { TenantCashierDevices } from "./tenant-cashier-devices";
import dashboardStyles from "./tenant-control-center-dashboard.module.css";
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
  metadata?: Record<string, unknown> | null;
} | null;

type ControlData = {
  tenant: Tenant;
  branches: Branch[];
  packages: Package[];
  contract: Contract;
  current_package: Package | null;
  lifecycle?: Lifecycle;
  usage: { active_devices: number; cashier_active: number; assigned_users: number; online_devices_5m: number };
  sales_modes: PosSalesModeView[];
  pos_notice: { status: string; title: string | null; message: string | null; admin_reason: string | null } | null;
};

type Tab = "overview" | "profile" | "branches" | "cashiers" | "salesModes" | "package" | "salesSummary" | "danger";
type BillingCycle = "monthly" | "yearly";

const DEFAULT_SALES_MODE_DRAFTS = Object.fromEntries(POS_SALES_MODE_KEYS.map((key) => [key, true])) as Record<PosSalesModeKey, boolean>;

function salesModeDraftFromViews(views: PosSalesModeView[] | undefined): Record<PosSalesModeKey, boolean> {
  return Object.fromEntries(POS_SALES_MODE_KEYS.map((key) => [key, views?.find((mode) => mode.key === key)?.enabled ?? true])) as Record<PosSalesModeKey, boolean>;
}
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

function packageAllowsYearly(pkg: Package | null | undefined) {
  if (!pkg) return false;
  const monthly = Number(pkg.monthly_price ?? 0);
  const yearly = Number(pkg.yearly_price ?? 0);
  if (!Number.isFinite(monthly) || !Number.isFinite(yearly)) return false;
  return monthly <= 0 || yearly > 0;
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
  const [tab, setTab] = useState<Tab>("overview");
  const [data, setData] = useState<ControlData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const { confirmAction, confirmationDialog, isConfirming } = useTenantActionConfirm();

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
  const [salesModeDrafts, setSalesModeDrafts] = useState<Record<PosSalesModeKey, boolean>>(DEFAULT_SALES_MODE_DRAFTS);
  const [salesModeReason, setSalesModeReason] = useState("");
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
    const changeCycle: BillingCycle = cycle === "yearly" && !packageAllowsYearly(next.current_package) ? "monthly" : cycle;
    setBillingCycle(changeCycle);
    setChangeStartDate(changeStart);
    setChangeEndDate(addBillingDate(changeStart, changeCycle));
    setChangeAutoEnd(true);
    setChangeAutoRenew(Boolean(next.contract?.auto_renew));

    setNotice({
      customer_title: next.pos_notice?.title ?? "ระบบถูกระงับชั่วคราว",
      customer_message: next.pos_notice?.message ?? "",
      admin_reason: next.pos_notice?.admin_reason ?? ""
    });
    setSalesModeDrafts(salesModeDraftFromViews(next.sales_modes));
    setSalesModeReason("");
    setBranchDrafts(Object.fromEntries(next.branches.map((branch) => [branch.id, {
      branch_name: branch.branch_name,
      branch_address: addressText(branch.address),
      branch_active: branch.is_active
    }])));
  }, []);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/it-admin/v1/tenants/${tenantId}/control`, { cache: "no-store", credentials: "include" });
      applyData(await parse<ControlData>(response));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "โหลดข้อมูลร้านไม่สำเร็จ");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [applyData, tenantId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || busy || isConfirming) return;
      if (tab !== "overview") {
        event.preventDefault();
        setTab("overview");
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, isConfirming, onClose, tab]);

  const mutate = useCallback(async (payload: Record<string, unknown>, message: string, confirmBeforeSave = true) => {
    if (confirmBeforeSave) {
      const storeLabel = data?.tenant.display_name || data?.tenant.name || fallbackName;
      const confirmed = await confirmAction(String(payload.action ?? ""), storeLabel);
      if (!confirmed) return null;
    }
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
      const next = await parse<ControlData | { deleted: true; storage_cleanup_pending?: boolean }>(response);
      if ("deleted" in next && next.deleted) {
        if (next.storage_cleanup_pending) {
          window.alert("ลบร้านและข้อมูลฐานข้อมูลแล้ว แต่ยังมีไฟล์สื่อที่รอลบซ้ำในระบบ IT กรุณาให้ผู้ดูแลตรวจสอบรายการ Storage Cleanup ก่อนถือว่าลบครบ");
        }
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
  }, [applyData, confirmAction, data, fallbackName, onChanged, onDeleted, tenantId]);

  const selectedPackage = useMemo(() => data?.packages.find((pkg) => pkg.id === packageId) ?? null, [data?.packages, packageId]);
  const storeName = data?.tenant.display_name || data?.tenant.name || fallbackName;
  const currentStatus = data?.contract?.effective_status ?? data?.contract?.status ?? "none";
  const canSuspend = currentStatus === "active" || currentStatus === "trial";
  const canResume = currentStatus === "suspended";
  const canCancel = Boolean(data?.contract) && !["cancelled", "expired"].includes(currentStatus);
  const isTrial = currentStatus === "trial";
  const lifecycleMeta = data?.lifecycle?.metadata ?? {};
  const isPrepaidPendingTrial = isTrial && lifecycleMeta.prepaid_activation_state === "pending_trial_completion" &&
    typeof lifecycleMeta.prepaid_payment_reference === "string";
  const canEditContract = Boolean(data?.contract) && !["cancelled", "expired"].includes(currentStatus) && !isPrepaidPendingTrial;
  const currentPackageYearlyAvailable = data?.contract?.billing_cycle === "yearly" || packageAllowsYearly(data?.current_package);
  const selectedPackageYearlyAvailable = packageAllowsYearly(selectedPackage);
  const salesModeEnabledCount = data?.sales_modes.filter((mode) => mode.enabled).length ?? 0;
  const salesModeTotal = data?.sales_modes.length || POS_SALES_MODE_KEYS.length;
  const hasSalesModeEnabled = Object.values(salesModeDrafts).some(Boolean);

  const changeContractCycle = (cycle: BillingCycle) => {
    if (cycle === "yearly" && !currentPackageYearlyAvailable) return;
    setContractCycle(cycle);
    if (contractAutoEnd && contractStartDate) setContractEndDate(addBillingDate(contractStartDate, cycle));
  };
  const changeContractStart = (value: string) => {
    setContractStartDate(value);
    if (contractAutoEnd) setContractEndDate(addBillingDate(value, contractCycle));
  };
  const changePackageCycle = (cycle: BillingCycle) => {
    if (cycle === "yearly" && !selectedPackageYearlyAvailable) return;
    setBillingCycle(cycle);
    if (changeAutoEnd && changeStartDate) setChangeEndDate(addBillingDate(changeStartDate, cycle));
  };
  const changePackageStart = (value: string) => {
    setChangeStartDate(value);
    if (changeAutoEnd) setChangeEndDate(addBillingDate(value, billingCycle));
  };
  const selectPackage = (nextPackageId: string) => {
    setPackageId(nextPackageId);
    const nextPackage = data?.packages.find((pkg) => pkg.id === nextPackageId) ?? null;
    if (billingCycle === "yearly" && !packageAllowsYearly(nextPackage)) {
      setBillingCycle("monthly");
      if (changeAutoEnd) setChangeEndDate(addBillingDate(changeStartDate, "monthly"));
    }
  };

  const detailCopy = tab === "salesSummary"
    ? { eyebrow: "STORE SALES INTELLIGENCE", title: "สรุปยอดขาย", description: "รายวัน · รายเดือน · รายปี · รายบิล · รายสินค้า · ทุกสาขาหรือเฉพาะสาขา" }
    : tab === "profile"
    ? { eyebrow: "STORE PROFILE", title: "ข้อมูลร้าน", description: "แก้ไขชื่อร้าน ข้อมูลติดต่อ ที่อยู่ และโลโก้" }
    : tab === "branches"
      ? { eyebrow: "BRANCH MANAGEMENT", title: "สาขา", description: "จัดการสาขาปัจจุบันและเปิดสาขาใหม่" }
      : tab === "cashiers"
        ? { eyebrow: "CASHIER TERMINALS", title: "เครื่องแคชเชียร์", description: "เพิ่ม แก้ไข เปิด–ปิด และลบเครื่องตามโควตาแพ็กเกจ เชื่อม CpIPOS ออนไลน์" }
      : tab === "salesModes"
        ? { eyebrow: "POS SALES MODES", title: "โหมดขาย", description: "เปิดหรือปิดโหมดหน้าขาย POS ของร้านนี้" }
        : tab === "package"
          ? { eyebrow: "PACKAGE & CONTRACT", title: "แพ็กเกจและสิทธิ์", description: "จัดการสัญญา รอบบิล แพ็กเกจ และสิทธิ์การใช้งาน" }
          : tab === "danger"
            ? { eyebrow: "STORE SECURITY", title: "พื้นที่อันตราย", description: "ปิดร้านชั่วคราวหรือดำเนินการลบร้านแบบถาวร" }
          : null;

  return (
    <div className={styles.modalBackdrop} onMouseDown={(event) => { if (event.currentTarget === event.target && !busy && !isConfirming && tab === "overview") onClose(); }}>
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

        <div className={dashboardStyles.overviewBody}>
          {loading ? <div className={styles.controlLoading}>กำลังโหลด Store Control Center…</div> : null}
          {error && tab === "overview" ? <div className={styles.controlAlertError}><strong>ดำเนินการไม่สำเร็จ</strong><span>{error}</span></div> : null}
          {success && tab === "overview" ? <div className={styles.controlAlertSuccess}>{success}</div> : null}

          {!loading && data ? (
            <>
              <div className={dashboardStyles.overviewIntro}>
                <div>
                  <span>STORE SETTINGS</span>
                  <h4>ตั้งค่าและจัดการร้าน</h4>
                  <p>เลือกเมนูที่ต้องการ ระบบจะเปิดเป็นหน้าต่างย่อย โดยหน้าหลักไม่ต้องเลื่อนยาวลงด้านล่าง</p>
                </div>
                <small>Store {data.tenant.store_code ?? data.tenant.tenant_code} · {contractLabel(currentStatus)}</small>
              </div>

              <div className={dashboardStyles.settingsGrid}>
                <button type="button" className={dashboardStyles.settingsCard} onClick={() => setTab("profile")}>
                  <div className={dashboardStyles.cardTop}><div className={dashboardStyles.cardIcon}>ร้าน</div><span className={dashboardStyles.cardBadge}>PROFILE</span></div>
                  <div className={dashboardStyles.cardText}><span>STORE PROFILE</span><strong>ข้อมูลร้าน</strong><small>ชื่อร้าน ข้อมูลติดต่อ ที่อยู่ และโลโก้ร้าน</small></div>
                  <div className={dashboardStyles.cardBottom}><span>{profile.contact_phone || "ยังไม่มีโทรศัพท์"}</span><strong>เปิดตั้งค่า →</strong></div>
                </button>

                <TenantPrimaryOwnerCard tenantId={tenantId} />

                <button type="button" className={dashboardStyles.settingsCard} onClick={() => setTab("branches")}>
                  <div className={dashboardStyles.cardTop}><div className={dashboardStyles.cardIcon}>สาขา</div><span className={dashboardStyles.cardBadge}>{data.branches.length} แห่ง</span></div>
                  <div className={dashboardStyles.cardText}><span>BRANCH MANAGEMENT</span><strong>สาขา</strong><small>แก้ไขชื่อ ที่อยู่ สถานะ และเปิดสาขาใหม่</small></div>
                  <div className={dashboardStyles.cardBottom}><span>เปิด {data.branches.filter((branch) => branch.is_active).length} / {data.branches.length}</span><strong>จัดการสาขา →</strong></div>
                </button>

                <button type="button" className={dashboardStyles.settingsCard} onClick={() => setTab("cashiers")}>
                  <div className={dashboardStyles.cardTop}><div className={dashboardStyles.cardIcon}>POS</div><span className={dashboardStyles.cardBadge}>ตามแพ็กเกจ</span></div>
                  <div className={dashboardStyles.cardText}><span>CASHIER TERMINALS</span><strong>เครื่องแคชเชียร์</strong><small>เพิ่ม แก้ไข ลบ และเปิด–ปิดเครื่องที่ใช้ขายจริง</small></div>
                  <div className={dashboardStyles.cardBottom}>
                    <span>Active {data.usage.cashier_active} / {data.contract?.max_devices ?? data.current_package?.max_devices ?? "∞"}</span>
                    <strong>จัดการเครื่อง →</strong>
                  </div>
                </button>

                <button type="button" className={dashboardStyles.settingsCard} onClick={() => setTab("package")}>
                  <div className={dashboardStyles.cardTop}><div className={dashboardStyles.cardIcon}>แพ็ก</div><span className={dashboardStyles.cardBadge}>{contractLabel(currentStatus)}</span></div>
                  <div className={dashboardStyles.cardText}><span>PACKAGE & CONTRACT</span><strong>แพ็กเกจและสิทธิ์</strong><small>สัญญา รอบบิล การระงับ และสิทธิ์การใช้งาน</small></div>
                  <div className={dashboardStyles.cardBottom}><span>{data.current_package?.name ?? "ยังไม่กำหนดแพ็กเกจ"}</span><strong>เปิดแพ็กเกจ →</strong></div>
                </button>

                <button type="button" className={dashboardStyles.settingsCard} onClick={() => setTab("salesModes")}>
                  <div className={dashboardStyles.cardTop}><div className={dashboardStyles.cardIcon}>ขาย</div><span className={dashboardStyles.cardBadge}>{salesModeEnabledCount}/{salesModeTotal} เปิด</span></div>
                  <div className={dashboardStyles.cardText}><span>POS SALES MODES</span><strong>โหมดขาย</strong><small>เปิดหรือปิดโหมดหน้าขายสำหรับร้านนี้</small></div>
                  <div className={dashboardStyles.cardBottom}><span>{data.sales_modes.filter((mode) => mode.enabled).map((mode) => mode.short_label).join(" · ") || "ยังไม่เปิดโหมด"}</span><strong>ตั้งค่าโหมด →</strong></div>
                </button>

                <button type="button" className={dashboardStyles.settingsCard} onClick={() => setTab("salesSummary")}>
                  <div className={dashboardStyles.cardTop}><div className={dashboardStyles.cardIcon}>฿</div><span className={dashboardStyles.cardBadge}>POS LIVE DATA</span></div>
                  <div className={dashboardStyles.cardText}><span>SALES REPORT</span><strong>สรุปยอดขาย</strong><small>รายวัน เดือน ปี · บิลขาย · สินค้า · แยกสาขา</small></div>
                  <div className={dashboardStyles.cardBottom}><span>ข้อมูลจาก CpiPOS-001 · อ่านอย่างเดียว</span><strong>ดูรายงาน →</strong></div>
                </button>

                <Link className={dashboardStyles.settingsCard} href={`/tenants/${tenantId}/devices`}>
                  <div className={dashboardStyles.cardTop}><div className={dashboardStyles.cardIcon}>MDM</div><span className={dashboardStyles.cardBadge}>{data.usage.online_devices_5m} online</span></div>
                  <div className={dashboardStyles.cardText}><span>DEVICES / MDM</span><strong>อุปกรณ์ POS</strong><small>ดูอุปกรณ์ที่ผูกกับร้าน สถานะ Active และ Heartbeat</small></div>
                  <div className={dashboardStyles.cardBottom}><span>Active {data.usage.active_devices}</span><strong>เปิด Devices →</strong></div>
                </Link>

                <button type="button" className={`${dashboardStyles.settingsCard} ${dashboardStyles.settingsCardDanger}`} onClick={() => setTab("danger")}>
                  <div className={dashboardStyles.cardTop}><div className={dashboardStyles.cardIcon}>!</div><span className={dashboardStyles.cardBadge}>SECURITY</span></div>
                  <div className={dashboardStyles.cardText}><span>STORE SECURITY</span><strong>พื้นที่อันตราย</strong><small>ปิดร้านชั่วคราว หรือดำเนินการลบร้านถาวร</small></div>
                  <div className={dashboardStyles.cardBottom}><span>{data.tenant.is_active ? "ร้านกำลังเปิดใช้งาน" : "ร้านถูกปิดใช้งาน"}</span><strong>เปิดเมนู →</strong></div>
                </button>
              </div>

              <section className={`${styles.quickStats} ${dashboardStyles.overviewStats}`}>
                <article><span>สาขา</span><strong>{data.branches.filter((branch) => branch.is_active).length} / {data.branches.length}</strong><small>เปิดใช้งาน / ทั้งหมด</small></article>
                <article><span>อุปกรณ์ Active</span><strong>{data.usage.active_devices}</strong><small>จาก CpiPOS-001</small></article>
                <article><span>Online 5 นาที</span><strong>{data.usage.online_devices_5m}</strong><small>Heartbeat ล่าสุด</small></article>
                <article><span>ผู้ใช้ที่ผูกสาขา</span><strong>{data.usage.assigned_users}</strong><small>นับ User ไม่ซ้ำ</small></article>
              </section>
            </>
          ) : null}
        </div>

        <footer className={styles.controlFooter}>
          <div><span>Authority: CpiPOS-001</span><small>Contract authority: tenant_subscription_contracts · ทุกการเปลี่ยนแปลงสำคัญมี Audit Log</small></div>
          <div className={styles.footerLinks}><Link href={`/tenants/${tenantId}/branches`}>เมนูสาขา</Link><Link href={`/tenants/${tenantId}/devices`}>Devices / MDM</Link><button type="button" onClick={onClose} disabled={busy}>ปิด</button></div>
        </footer>
      </section>

      {!loading && data && detailCopy ? (
        <div className={dashboardStyles.sectionBackdrop} role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !busy && !isConfirming) setTab("overview"); }}>
          <section className={dashboardStyles.sectionDialog} role="dialog" aria-modal="true" aria-labelledby="tenant-section-title" onWheelCapture={(event) => event.stopPropagation()}>
            <header className={dashboardStyles.sectionHeader}>
              <div className={dashboardStyles.sectionHeading}>
                <span className={dashboardStyles.sectionEyebrow}>{detailCopy.eyebrow}</span>
                <h4 id="tenant-section-title">{detailCopy.title}</h4>
                <p>{detailCopy.description}</p>
              </div>
              <button type="button" className={dashboardStyles.sectionClose} onClick={() => setTab("overview")} disabled={busy} aria-label="กลับหน้าตั้งค่า">×</button>
            </header>

            <div className={dashboardStyles.sectionBody}>
              {error ? <div className={styles.controlAlertError}><strong>ดำเนินการไม่สำเร็จ</strong><span>{error}</span></div> : null}
              {success ? <div className={styles.controlAlertSuccess}>{success}</div> : null}

              {tab === "salesSummary" ? <TenantSalesSummary tenantId={tenantId} /> : null}
              {tab === "cashiers" ? (
                <TenantCashierDevices tenantId={tenantId} storeName={storeName}
                  confirmAction={confirmAction}
                  onChanged={() => { void load(true); onChanged(); }} />
              ) : null}

              {tab === "profile" ? (
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
                </div>
              ) : null}

              {tab === "branches" ? (
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

              {tab === "salesModes" ? (
                <div className={styles.controlStack}>
                  <section className={styles.controlSection}>
                    <div className={styles.controlSectionHeader}>
                      <div><span>POS SALES MODES</span><h4>โหมดขายหน้าร้าน</h4><small>เปิด/ปิดได้เฉพาะร้านนี้ โดย Feature Gate ของแพ็กเกจยังทำงานร่วมกัน</small></div>
                      <span className={`${styles.controlPill} ${hasSalesModeEnabled ? styles.controlGood : styles.controlWarn}`}>{salesModeEnabledCount}/{salesModeTotal} เปิดใช้งาน</span>
                    </div>
                    <div className={dashboardStyles.salesModeGrid}>
                      {data.sales_modes.map((mode) => {
                        const enabled = salesModeDrafts[mode.key];
                        return (
                          <label className={`${dashboardStyles.salesModeCard} ${enabled ? dashboardStyles.salesModeCardOn : dashboardStyles.salesModeCardOff}`} key={mode.key}>
                            <input type="checkbox" checked={enabled} onChange={(event) => setSalesModeDrafts((current) => ({ ...current, [mode.key]: event.target.checked }))} />
                            <span className={dashboardStyles.salesModeToggle} aria-hidden="true" />
                            <span className={dashboardStyles.salesModeCopy}>
                              <strong>{mode.label}</strong>
                              <small>{mode.description}</small>
                            </span>
                            <em>{enabled ? "เปิด" : "ปิด"}</em>
                          </label>
                        );
                      })}
                    </div>
                    {!hasSalesModeEnabled ? <div className={styles.dangerWarning}><strong>ต้องเปิดอย่างน้อย 1 โหมด</strong><p>ระบบไม่อนุญาตให้ปิดทุกโหมดพร้อมกัน เพื่อป้องกันหน้าขายไม่มีทางรับออเดอร์</p></div> : null}
                    <div className={styles.formGrid}>
                      <label className={styles.span2}><span>เหตุผลภายใน (Audit)</span><textarea rows={3} value={salesModeReason} onChange={(event) => setSalesModeReason(event.target.value)} placeholder="เช่น ร้านนี้ยังไม่รับเดลิเวอรี่ หรือปิดโต๊ะบุฟเฟ่ชั่วคราว" /></label>
                    </div>
                    <div className={styles.sectionActions}>
                      <button className={styles.primaryButton} type="button" disabled={busy || !hasSalesModeEnabled} onClick={async () => { const result = await mutate({ action: "update_sales_modes", sales_modes: salesModeDrafts, admin_reason: salesModeReason }, "บันทึกโหมดขายเรียบร้อย", true); if (result) setSalesModeReason(""); }}>บันทึกโหมดขาย</button>
                    </div>
                    <div className={styles.securityNote}>เมื่อปิดโหมด ระบบจะล็อกปุ่มเลือกโหมดบนหน้าขาย POS ของร้านนี้ และยังคงเคารพสิทธิ์จากแพ็กเกจ/ฟีเจอร์เดิมอีกชั้นหนึ่ง</div>
                  </section>
                </div>
              ) : null}
              {tab === "package" ? (
                <div className={styles.controlStack}>
                  <section className={styles.packageHero}>
                    <div>
                      <span>CURRENT PACKAGE</span>
                      <h4>{data.current_package?.name ?? "ยังไม่กำหนดแพ็กเกจ"}</h4>
                      <p>{data.current_package?.code ?? "—"} · {contractLabel(currentStatus)} · {data.contract?.billing_cycle === "yearly" ? "รายปี" : data.contract ? "รายเดือน" : "—"}</p>
                    </div>
                    <div className={styles.packageMetrics}><span>สาขา {data.contract?.max_branches ?? data.current_package?.max_branches ?? "—"}</span><span>อุปกรณ์ {data.contract?.max_devices ?? data.current_package?.max_devices ?? "—"}</span><span>ผู้ใช้ {data.contract?.max_users ?? data.current_package?.max_users ?? "—"}</span></div>
                  </section>

                  {isPrepaidPendingTrial ? (
                    <div className={styles.securityNote} role="status" style={{ display: "grid", gap: 5 }}>
                      <strong>ยืนยันรับชำระเงินล่วงหน้า {money(Number(lifecycleMeta.prepaid_amount_thb ?? 0))}</strong>
                      <span>สิทธิ์ทดลองใช้: {formatDate(data.lifecycle?.trial_started_at)} – {formatDate(data.lifecycle?.trial_expires_at)}</span>
                      <span>แพ็กเกจที่ชำระแล้วจะเริ่มหลังครบทดลองใช้: {formatDate(String(lifecycleMeta.prepaid_activation_due_at ?? data.lifecycle?.trial_expires_at ?? ""))}</span>
                      <small>ระยะเวลาแพ็กเกจที่ชำระแล้ว 30 วันนับจากการเปิดใช้แพ็กเกจจริง โดยไม่เรียกเก็บเงินซ้ำระหว่างทดลองใช้</small>
                    </div>
                  ) : null}

                  <section className={styles.quickStats}>
                    <article><span>{isTrial ? "เริ่มทดลองใช้" : "เปิดสัญญา"}</span><strong>{formatDate(data.contract?.start_at)}</strong><small>{isTrial ? "ยังไม่เริ่มนับแพ็กเกจชำระเงิน" : data.contract?.billing_cycle === "yearly" ? "รอบรายปี" : "รอบรายเดือน"}</small></article>
                    <article><span>{isTrial ? "หมดทดลองใช้" : "หมดอายุ"}</span><strong>{formatDate(data.contract?.end_at)}</strong><small>{isTrial ? "ตามเวลาสิทธิ์ทดลองใช้ในฐานข้อมูล" : data.contract?.end_at ? "POS ตรวจ ended_at อัตโนมัติ" : "ยังไม่กำหนด"}</small></article>
                    <article><span>คงเหลือ</span><strong>{data.contract?.days_remaining == null ? "—" : `${data.contract.days_remaining} วัน`}</strong><small>{contractLabel(currentStatus)}</small></article>
                    <article><span>Auto renew</span><strong>{data.contract?.auto_renew ? "เปิด" : "ปิด"}</strong><small>{isPrepaidPendingTrial ? "คงค่าไว้หลังครบ Trial" : "แก้ไขด้านล่าง"}</small></article>
                  </section>

                  {data.contract ? (
                    <section className={styles.controlSection}>
                      <div className={styles.controlSectionHeader}><div><span>CONTRACT PERIOD</span><h4>วันที่สัญญาและรอบบิล</h4></div><span className={`${styles.controlPill} ${statusClass(currentStatus)}`}>{contractLabel(currentStatus)}</span></div>
                      <p className={styles.sectionCopy}>เลือกวันที่เริ่มและรายเดือน/รายปี ระบบจะคำนวณวันหมดอายุให้อัตโนมัติ หรือปิด Auto calculate เพื่อกำหนดวันหมดอายุเอง</p>
                      <div className={styles.formGrid}>
                        <label><span>วันที่เปิดสัญญา</span><input type="date" value={contractStartDate} onChange={(e) => changeContractStart(e.target.value)} disabled={!canEditContract} /></label>
                        <label><span>รอบสัญญา</span><select value={contractCycle} onChange={(e) => changeContractCycle(e.target.value as BillingCycle)} disabled={!canEditContract}><option value="monthly">รายเดือน</option><option value="yearly" disabled={!currentPackageYearlyAvailable}>รายปี{!currentPackageYearlyAvailable ? " · ยังไม่ตั้งราคา" : ""}</option></select></label>
                        <label><span>วันหมดอายุ</span><input type="date" value={contractEndDate} onChange={(e) => setContractEndDate(e.target.value)} disabled={!canEditContract || contractAutoEnd} /></label>
                        <label className={styles.switchLabel}><input type="checkbox" checked={contractAutoEnd} disabled={!canEditContract} onChange={(e) => { const checked = e.target.checked; setContractAutoEnd(checked); if (checked) setContractEndDate(addBillingDate(contractStartDate, contractCycle)); }} /><span>คำนวณวันหมดอายุอัตโนมัติ</span></label>
                        <label className={styles.switchLabel}><input type="checkbox" checked={contractAutoRenew} disabled={!canEditContract} onChange={(e) => setContractAutoRenew(e.target.checked)} /><span>ต่ออายุอัตโนมัติ</span></label>
                      </div>
                      {isPrepaidPendingTrial ? <div className={styles.securityNote}>แพ็กเกจชำระล่วงหน้ารอเริ่มหลังครบ Trial ระบบปิดการแก้วันสัญญาชั่วคราวเพื่อไม่ให้สิทธิ์ลูกค้าหาย</div> : null}
                      {!currentPackageYearlyAvailable ? <div className={styles.securityNote}>แพ็กเกจนี้ยังไม่ได้กำหนดราคารายปีใน Package / Subscription จึงไม่เปิดให้เปลี่ยนเป็นรายปี เพื่อป้องกันสัญญาราคา 0 บาทโดยไม่ตั้งใจ</div> : null}
                      <div className={styles.packagePreview}><strong>{contractCycle === "yearly" ? "สัญญารายปี" : "สัญญารายเดือน"}</strong><span>{contractStartDate || "—"} → {contractEndDate || "—"}</span></div>
                      <div className={styles.sectionActions}><button className={styles.secondaryButton} type="button" disabled={busy || !canEditContract || !contractStartDate || !contractEndDate || (contractCycle === "yearly" && !currentPackageYearlyAvailable)} onClick={() => void mutate({ action: "update_contract", billing_cycle: contractCycle, start_date: contractStartDate, end_date: contractAutoEnd ? undefined : contractEndDate, auto_calculate_end: contractAutoEnd, auto_renew: contractAutoRenew }, "อัปเดตวันที่สัญญาและรอบบิลแล้ว", true)}>บันทึกวันที่สัญญา</button></div>
                    </section>
                  ) : null}

                  <section className={styles.controlSection}>
                    <div className={styles.controlSectionHeader}>
                      <div><span>{isTrial ? "ACTIVATE PAID PACKAGE" : "CHANGE PACKAGE"}</span><h4>{isTrial ? "เปลี่ยนจาก Trial เป็นแพ็กเกจจริง" : "เปลี่ยนแพ็กเกจ"}</h4></div>
                      <small>{isPrepaidPendingTrial ? "รับเงินล่วงหน้าแล้ว ระบบจะเปิดแพ็กเกจจริงเมื่อครบ Trial" : isTrial ? "เปิดแพ็กเกจจริงได้ทันที ไม่ต้องรอ Trial หมด" : "สร้างสัญญาใหม่และเก็บประวัติสัญญาเดิม"}</small>
                    </div>
                    <div className={styles.formGrid}>
                      <label><span>แพ็กเกจ</span><select value={packageId} onChange={(e) => selectPackage(e.target.value)}>{data.packages.map((pkg) => <option value={pkg.id} key={pkg.id}>{pkg.name} · {pkg.code}</option>)}</select></label>
                      <label><span>รอบบิล</span><select value={billingCycle} onChange={(e) => changePackageCycle(e.target.value as BillingCycle)}><option value="monthly">รายเดือน</option><option value="yearly" disabled={!selectedPackageYearlyAvailable}>รายปี{!selectedPackageYearlyAvailable ? " · ยังไม่ตั้งราคา" : ""}</option></select></label>
                      <label><span>วันที่เริ่มแพ็กเกจจริง</span><input type="date" max={todayLocal()} value={changeStartDate} onChange={(e) => changePackageStart(e.target.value)} /></label>
                      <label><span>วันหมดอายุ</span><input type="date" value={changeEndDate} onChange={(e) => setChangeEndDate(e.target.value)} disabled={changeAutoEnd} /></label>
                      <label className={styles.switchLabel}><input type="checkbox" checked={changeAutoEnd} onChange={(e) => { const checked = e.target.checked; setChangeAutoEnd(checked); if (checked) setChangeEndDate(addBillingDate(changeStartDate, billingCycle)); }} /><span>คำนวณวันหมดอายุอัตโนมัติ</span></label>
                      <label className={styles.switchLabel}><input type="checkbox" checked={changeAutoRenew} onChange={(e) => setChangeAutoRenew(e.target.checked)} /><span>ต่ออายุอัตโนมัติ</span></label>
                      <label className={styles.span2}><span>เหตุผลภายใน (Audit)</span><input placeholder={isTrial ? "เช่น ลูกค้ายืนยันเปิดแพ็กเกจจริงก่อน Trial หมด" : "เช่น ลูกค้าขออัปเกรดแพ็กเกจ"} value={changeReason} onChange={(e) => setChangeReason(e.target.value)} /></label>
                    </div>
                    {!selectedPackageYearlyAvailable ? <div className={styles.securityNote}>แพ็กเกจที่เลือกยังไม่มีราคารายปี ระบบจะใช้รายเดือนเท่านั้นจนกว่าจะตั้งราคารายปีในเมนู Package / Subscription</div> : null}
                    {selectedPackage ? <div className={styles.packagePreview}><strong>{selectedPackage.name}</strong><span>{billingCycle === "yearly" ? money(selectedPackage.yearly_price) : money(selectedPackage.monthly_price)} · {changeStartDate || "—"} → {changeEndDate || "—"} · สูงสุด {selectedPackage.max_branches ?? "—"} สาขา / {selectedPackage.max_devices ?? "—"} อุปกรณ์</span></div> : null}
                    <div className={styles.sectionActions}><button className={styles.primaryButton} type="button" disabled={busy || isPrepaidPendingTrial || !packageId || !changeStartDate || !changeEndDate || (billingCycle === "yearly" && !selectedPackageYearlyAvailable)} onClick={() => void mutate({ action: "change_package", package_id: packageId, billing_cycle: billingCycle, start_date: changeStartDate, end_date: changeAutoEnd ? undefined : changeEndDate, auto_calculate_end: changeAutoEnd, auto_renew: changeAutoRenew, admin_reason: changeReason }, isTrial ? "เปิดแพ็กเกจจริงเรียบร้อย" : "เปลี่ยนแพ็กเกจเรียบร้อย", true)}>{isTrial ? "เปิดแพ็กเกจจริงตอนนี้" : "ยืนยันเปลี่ยนแพ็กเกจ"}</button></div>
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
                    <div className={styles.securityNote}>POS ใช้สถานะสัญญาและ ended_at เป็น Feature Gate อยู่แล้ว ส่วนข้อความลูกค้าและเหตุผลภายใน IT แยกคนละฟิลด์เพื่อป้องกันข้อมูลภายใน IT หลุดไปยังหน้าขาย POS</div>
                  </section>
                </div>
              ) : null}

              {tab === "danger" ? (
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
                    <div className={styles.dangerWarning}><strong>คำเตือน · ลบถาวรและย้อนกลับไม่ได้</strong><p>ลบข้อมูลร้าน สาขา เมนู สต๊อก ยอดขาย บิล การชำระเงิน กะ อุปกรณ์ และสิทธิ์ผู้ใช้ของร้านนี้ รวมถึงบัญชีเข้าสู่ระบบที่ใช้เฉพาะร้านนี้ โดยไม่กระทบผู้ใช้ร่วมร้านอื่นหรือผู้ดูแล IT · ต้องปิดร้านและไม่มีอุปกรณ์ออนไลน์ใน 5 นาทีล่าสุด (Trial จะสิ้นสุดพร้อมร้าน ไม่ต้องยกเลิกแยก)</p></div>
                    <div className={styles.formGrid}>
                      <label><span>พิมพ์ Store Code เพื่อยืนยัน</span><input value={deleteConfirm} onChange={(e) => setDeleteConfirm(e.target.value)} placeholder={data.tenant.store_code ?? data.tenant.tenant_code} /></label>
                      <label><span>เหตุผลการลบถาวร</span><input value={deleteReason} onChange={(e) => setDeleteReason(e.target.value)} placeholder="อย่างน้อย 8 ตัวอักษร" /></label>
                    </div>
                    <div className={styles.sectionActions}><button type="button" className={styles.dangerButton} disabled={busy || data.tenant.is_active || deleteConfirm !== (data.tenant.store_code ?? data.tenant.tenant_code) || deleteReason.trim().length < 8} onClick={() => void mutate({ action: "delete_store", confirmation_code: deleteConfirm, admin_reason: deleteReason }, "ลบร้านถาวรแล้ว", true)}>ลบร้านถาวร</button></div>
                  </section>
                </div>
              ) : null}
            </div>

            <footer className={dashboardStyles.sectionFooter}>
              <span>กด Esc หรือปุ่มกลับเพื่อกลับหน้าตั้งค่าหลัก</span>
              <button type="button" className={dashboardStyles.backButton} onClick={() => setTab("overview")} disabled={busy}>กลับหน้าตั้งค่า</button>
            </footer>
          </section>
        </div>
      ) : null}

      {confirmationDialog}
    </div>
  );
}
