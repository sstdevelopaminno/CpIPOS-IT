"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./tenant-directory-console.module.css";

type ApiEnvelope<T> = { data: T | null; error: { code?: string; message?: string } | null };

type Tenant = {
  id: string;
  tenant_code: string;
  name: string;
  display_name: string | null;
  tax_id: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  is_active: boolean;
  logo_url: string | null;
  company_address: string | null;
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
  activated_at: string | null;
  start_at: string | null;
  end_at: string | null;
  trial_end_at: string | null;
  cancelled_at: string | null;
  metadata: unknown;
} | null;

type ControlData = {
  tenant: Tenant;
  branches: Branch[];
  packages: Package[];
  contract: Contract;
  current_package: Package | null;
  usage: { active_devices: number; assigned_users: number; online_devices_5m: number };
  pos_notice: { status: string; title: string | null; message: string | null; admin_reason: string | null } | null;
};

type Tab = "profile" | "branches" | "package" | "danger";

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

  const [profile, setProfile] = useState({ display_name: "", legal_name: "", tax_id: "", contact_email: "", contact_phone: "", company_address: "", logo_url: "" });
  const [newBranch, setNewBranch] = useState({ branch_code: "", branch_name: "", branch_address: "" });
  const [branchDrafts, setBranchDrafts] = useState<Record<string, { branch_name: string; branch_address: string; branch_active: boolean }>>({});
  const [packageId, setPackageId] = useState("");
  const [billingCycle, setBillingCycle] = useState("monthly");
  const [changeReason, setChangeReason] = useState("");
  const [notice, setNotice] = useState({ customer_title: "ระบบถูกระงับชั่วคราว", customer_message: "", admin_reason: "" });
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleteReason, setDeleteReason] = useState("");

  const applyData = useCallback((next: ControlData) => {
    setData(next);
    setProfile({
      display_name: next.tenant.display_name ?? next.tenant.name ?? "",
      legal_name: next.tenant.name ?? "",
      tax_id: next.tenant.tax_id ?? "",
      contact_email: next.tenant.contact_email ?? "",
      contact_phone: next.tenant.contact_phone ?? "",
      company_address: next.tenant.company_address ?? "",
      logo_url: next.tenant.logo_url ?? ""
    });
    setPackageId(next.current_package?.id ?? next.packages[0]?.id ?? "");
    setBillingCycle(next.contract?.billing_cycle ?? "monthly");
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
  const currentStatus = data?.contract?.status ?? "none";
  const canSuspend = currentStatus === "active" || currentStatus === "trial";
  const canResume = currentStatus === "suspended";
  const canCancel = Boolean(data?.contract) && !["cancelled", "expired"].includes(currentStatus);

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
              <p>{data?.tenant.tenant_code ?? "—"} · ควบคุมข้อมูลร้าน สาขา แพ็กเกจ และสิทธิ์การใช้งาน</p>
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
                <div className={styles.controlSectionHeader}><div><span>STORE PROFILE</span><h4>ข้อมูลและตั้งค่าเริ่มต้นร้าน</h4></div><small>Store Code: {data.tenant.tenant_code}</small></div>
                <div className={styles.formGrid}>
                  <label><span>ชื่อร้านที่แสดง</span><input value={profile.display_name} onChange={(e) => setProfile((v) => ({ ...v, display_name: e.target.value }))} /></label>
                  <label><span>ชื่อทางการ / ชื่อนิติบุคคล</span><input value={profile.legal_name} onChange={(e) => setProfile((v) => ({ ...v, legal_name: e.target.value }))} /></label>
                  <label><span>เลขประจำตัวผู้เสียภาษี</span><input value={profile.tax_id} onChange={(e) => setProfile((v) => ({ ...v, tax_id: e.target.value }))} /></label>
                  <label><span>โทรศัพท์ร้าน</span><input value={profile.contact_phone} onChange={(e) => setProfile((v) => ({ ...v, contact_phone: e.target.value }))} /></label>
                  <label className={styles.span2}><span>อีเมลร้าน</span><input type="email" value={profile.contact_email} onChange={(e) => setProfile((v) => ({ ...v, contact_email: e.target.value }))} /></label>
                  <label className={styles.span2}><span>ที่อยู่ร้าน</span><textarea rows={3} value={profile.company_address} onChange={(e) => setProfile((v) => ({ ...v, company_address: e.target.value }))} /></label>
                  <label className={styles.span2}><span>โลโก้ร้าน (URL)</span><input placeholder="https://..." value={profile.logo_url} onChange={(e) => setProfile((v) => ({ ...v, logo_url: e.target.value }))} /><small>รอบนี้ใช้ URL ที่มีอยู่ก่อน การอัปโหลดไฟล์จะเพิ่มเมื่อกำหนด Storage bucket ชัดเจน</small></label>
                </div>
                <div className={styles.sectionActions}>
                  <button className={styles.primaryButton} type="button" disabled={busy} onClick={() => void mutate({ action: "update_profile", ...profile }, "บันทึกข้อมูลร้านเรียบร้อย")}>บันทึกข้อมูลร้าน</button>
                </div>
              </section>

              <section className={styles.quickStats}>
                <article><span>สาขา</span><strong>{data.branches.filter((branch) => branch.is_active).length} / {data.branches.length}</strong><small>เปิดใช้งาน / ทั้งหมด</small></article>
                <article><span>อุปกรณ์ Active</span><strong>{data.usage.active_devices}</strong><small>จาก CpiPOS-001</small></article>
                <article><span>Online 5 นาที</span><strong>{data.usage.online_devices_5m}</strong><small>Heartbeat ล่าสุด</small></article>
                <article><span>ผู้ใช้ที่ผูกสาขา</span><strong>{data.usage.assigned_users}</strong><small>User-role assignments</small></article>
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
                  <label><span>Branch Code</span><input placeholder="เช่น BKK-002" value={newBranch.branch_code} onChange={(e) => setNewBranch((v) => ({ ...v, branch_code: e.target.value }))} /></label>
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
                <div><span>CURRENT PACKAGE</span><h4>{data.current_package?.name ?? "ยังไม่กำหนดแพ็กเกจ"}</h4><p>{data.current_package?.code ?? "—"} · {contractLabel(currentStatus)} · {data.contract?.billing_cycle ?? "—"}</p></div>
                <div className={styles.packageMetrics}><span>สาขา {data.current_package?.max_branches ?? "—"}</span><span>อุปกรณ์ {data.current_package?.max_devices ?? "—"}</span><span>ผู้ใช้ {data.current_package?.max_users ?? "—"}</span></div>
              </section>

              <section className={styles.controlSection}>
                <div className={styles.controlSectionHeader}><div><span>CHANGE PACKAGE</span><h4>เปลี่ยนแพ็กเกจ</h4></div><small>สร้างสัญญาใหม่และเก็บประวัติสัญญาเดิม</small></div>
                <div className={styles.formGrid}>
                  <label><span>แพ็กเกจ</span><select value={packageId} onChange={(e) => setPackageId(e.target.value)}>{data.packages.map((pkg) => <option value={pkg.id} key={pkg.id}>{pkg.name} · {pkg.code}</option>)}</select></label>
                  <label><span>รอบบิล</span><select value={billingCycle} onChange={(e) => setBillingCycle(e.target.value)}><option value="monthly">รายเดือน</option><option value="yearly">รายปี</option><option value="custom">Custom</option></select></label>
                  <label className={styles.span2}><span>เหตุผลภายใน (Audit)</span><input placeholder="เช่น ลูกค้าขออัปเกรดแพ็กเกจ" value={changeReason} onChange={(e) => setChangeReason(e.target.value)} /></label>
                </div>
                {selectedPackage ? <div className={styles.packagePreview}><strong>{selectedPackage.name}</strong><span>{billingCycle === "yearly" ? money(selectedPackage.yearly_price) : money(selectedPackage.monthly_price)} · สูงสุด {selectedPackage.max_branches ?? "—"} สาขา / {selectedPackage.max_devices ?? "—"} อุปกรณ์</span></div> : null}
                <div className={styles.sectionActions}><button className={styles.primaryButton} type="button" disabled={busy || !packageId} onClick={() => void mutate({ action: "change_package", package_id: packageId, billing_cycle: billingCycle, admin_reason: changeReason }, "เปลี่ยนแพ็กเกจเรียบร้อย", true)}>ยืนยันเปลี่ยนแพ็กเกจ</button></div>
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
                <div className={styles.securityNote}>ข้อความลูกค้าและเหตุผลภายในถูกแยกคนละฟิลด์ เพื่อไม่ให้ข้อมูลภายใน IT หลุดไปยังหน้าขาย POS</div>
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
                <div className={styles.dangerWarning}><strong>คำเตือน</strong><p>การลบร้านจะ Cascade ข้อมูลร้านจำนวนมาก เช่น สาขา อุปกรณ์ สินค้า ออเดอร์ การชำระเงิน สต๊อก กะ และประวัติอื่น ๆ คืนกลับไม่ได้ ระบบจึงอนุญาตเมื่อปิดร้านแล้ว ปิดสัญญาแล้ว และไม่มีอุปกรณ์ออนไลน์ใน 5 นาทีล่าสุดเท่านั้น</p></div>
                <div className={styles.formGrid}>
                  <label><span>พิมพ์ Store Code เพื่อยืนยัน</span><input value={deleteConfirm} onChange={(e) => setDeleteConfirm(e.target.value)} placeholder={data.tenant.tenant_code} /></label>
                  <label><span>เหตุผลการลบถาวร</span><input value={deleteReason} onChange={(e) => setDeleteReason(e.target.value)} placeholder="อย่างน้อย 8 ตัวอักษร" /></label>
                </div>
                <div className={styles.sectionActions}><button type="button" className={styles.dangerButton} disabled={busy || data.tenant.is_active || deleteConfirm !== data.tenant.tenant_code || deleteReason.trim().length < 8} onClick={() => void mutate({ action: "delete_store", confirmation_code: deleteConfirm, admin_reason: deleteReason }, "ลบร้านถาวรแล้ว", true)}>ลบร้านถาวร</button></div>
              </section>
            </div>
          ) : null}
        </div>

        <footer className={styles.controlFooter}>
          <div><span>Authority: CpiPOS-001</span><small>ทุกการเปลี่ยนแปลงสำคัญมี Audit Log</small></div>
          <div className={styles.footerLinks}><Link href={`/it-admin/tenants/${tenantId}/branches`}>เมนูสาขา</Link><Link href={`/it-admin/tenants/${tenantId}/devices`}>Devices / MDM</Link><button type="button" onClick={onClose} disabled={busy}>ปิด</button></div>
        </footer>
      </section>
    </div>
  );
}
