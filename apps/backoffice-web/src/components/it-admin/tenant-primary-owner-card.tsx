"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./tenant-primary-owner-card.module.css";

type ApiEnvelope<T> = { data: T | null; error: { code?: string; message?: string } | null };

type PrimaryOwner = {
  user_id: string;
  full_name: string;
  email: string;
  phone: string;
  is_active: boolean;
  pin_configured: boolean;
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

function initials(name: string) {
  const trimmed = name.trim();
  if (!trimmed) return "O";
  return trimmed.slice(0, 2).toUpperCase();
}

export function TenantPrimaryOwnerCard({ tenantId }: { tenantId: string }) {
  const [owner, setOwner] = useState<PrimaryOwner | null>(null);
  const [draft, setDraft] = useState({ full_name: "", email: "", phone: "" });
  const [ownerPin, setOwnerPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [pinEditorOpen, setPinEditorOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
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
    setOwnerPin("");
    setConfirmPin("");
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

  const openEditor = (focusPin = false) => {
    setError(null);
    setSuccess(null);
    setOwnerPin("");
    setConfirmPin("");
    setPinEditorOpen(focusPin || !owner?.pin_configured);
    setEditorOpen(true);
  };

  const closeEditor = () => {
    if (saving) return;
    setEditorOpen(false);
    setPinEditorOpen(false);
    setOwnerPin("");
    setConfirmPin("");
    setShowPin(false);
  };

  const pinIsValid = ownerPin === "" || /^\d{4,6}$/.test(ownerPin);
  const pinMatches = ownerPin === confirmPin;
  const pinCanSave = !pinEditorOpen || (ownerPin.length >= 4 && pinIsValid && pinMatches);
  const profileCanSave = draft.full_name.trim().length >= 2 && draft.email.includes("@");

  const save = async () => {
    if (!profileCanSave || !pinCanSave) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const payloadBody: Record<string, string> = { ...draft };
      if (pinEditorOpen && ownerPin) payloadBody.owner_pin = ownerPin;
      const response = await fetch(`/api/it-admin/v1/tenants/${tenantId}/primary-owner`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payloadBody)
      });
      const payload = await parse<OwnerResponse>(response);
      applyOwner(payload.primary_owner);
      setSuccess(pinEditorOpen && ownerPin ? "บันทึกข้อมูลและรหัส Owner เรียบร้อยแล้ว" : "บันทึก USER เจ้าของร้านเรียบร้อยแล้ว");
      setPinEditorOpen(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "บันทึกข้อมูลเจ้าของร้านไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  };

  const ownerSince = useMemo(() => owner ? formatDate(owner.role_created_at || owner.created_at) : "—", [owner]);

  if (loading) {
    return <section className={styles.compactCard} data-primary-owner-card><div className={styles.loadingDot} /><div><strong>USER เจ้าของร้าน</strong><span>กำลังโหลดข้อมูล Owner…</span></div></section>;
  }

  return (
    <>
      <section className={styles.compactCard} data-primary-owner-card>
        <div className={styles.ownerAvatar}>{initials(owner?.full_name ?? "Owner")}</div>
        <div className={styles.summary}>
          <span className={styles.eyebrow}>PRIMARY OWNER USER</span>
          <strong>{owner?.full_name || "ยังไม่พบ USER เจ้าของร้าน"}</strong>
          <small>{owner?.email || "ยังไม่ได้ผูก Owner USER กับร้าน"}</small>
        </div>
        {owner ? (
          <div className={styles.summaryBadges}>
            <span className={owner.is_active ? styles.goodBadge : styles.mutedBadge}>{owner.is_active ? "ใช้งาน" : "ปิดใช้งาน"}</span>
            <span className={owner.pin_configured ? styles.pinReadyBadge : styles.pinMissingBadge}>{owner.pin_configured ? "PIN พร้อม" : "ยังไม่มี PIN"}</span>
          </div>
        ) : null}
        <div className={styles.compactActions}>
          {owner ? <button type="button" className={styles.secondaryButton} onClick={() => openEditor(false)}>จัดการ Owner</button> : null}
          {owner ? <button type="button" className={owner.pin_configured ? styles.pinButton : styles.primaryButton} onClick={() => openEditor(true)}>{owner.pin_configured ? "เปลี่ยนรหัส Owner" : "ตั้งรหัส Owner ครั้งแรก"}</button> : null}
          {!owner ? <button type="button" className={styles.secondaryButton} onClick={() => void load()}>โหลดใหม่</button> : null}
        </div>
      </section>

      {error && !editorOpen ? <div className={styles.inlineError}>{error}</div> : null}

      {editorOpen && owner ? (
        <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) closeEditor(); }}>
          <section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="primary-owner-editor-title">
            <header className={styles.modalHeader}>
              <div className={styles.modalIdentity}>
                <div className={styles.modalAvatar}>{initials(owner.full_name || "Owner")}</div>
                <div>
                  <span>OWNER ACCESS & IDENTITY</span>
                  <h3 id="primary-owner-editor-title">จัดการ USER เจ้าของร้าน</h3>
                  <p>แก้ข้อมูล Login และตั้งรหัส Owner สำหรับการอนุมัติคำสั่งใน POS</p>
                </div>
              </div>
              <button type="button" className={styles.closeButton} onClick={closeEditor} disabled={saving} aria-label="ปิด">×</button>
            </header>

            <div className={styles.modalBody}>
              {error ? <div className={styles.errorBanner}><strong>บันทึกไม่สำเร็จ</strong><span>{error}</span></div> : null}
              {success ? <div className={styles.successBanner}>{success}</div> : null}

              <div className={styles.ownerMeta}>
                <div><span>User ID</span><strong title={owner.user_id}>{owner.user_id}</strong></div>
                <div><span>Owner ตั้งแต่</span><strong>{ownerSince}</strong></div>
                <div><span>สาขาที่เป็น Owner</span><strong>{owner.owner_branch_count}</strong></div>
                <div><span>สถานะ PIN</span><strong className={owner.pin_configured ? styles.goodText : styles.warnText}>{owner.pin_configured ? "ตั้งรหัสแล้ว" : "ยังไม่ได้ตั้งรหัส"}</strong></div>
              </div>

              <section className={styles.editorSection}>
                <div className={styles.sectionTitle}><div><span>OWNER PROFILE</span><h4>ข้อมูลเจ้าของร้านและ Login</h4></div></div>
                <div className={styles.formGrid}>
                  <label><span>ชื่อเจ้าของร้าน</span><input value={draft.full_name} onChange={(event) => setDraft((value) => ({ ...value, full_name: event.target.value }))} /></label>
                  <label><span>อีเมล Login</span><input type="email" value={draft.email} onChange={(event) => setDraft((value) => ({ ...value, email: event.target.value }))} /><small>เปลี่ยนอีเมลแล้วระบบจะอัปเดต Supabase Auth ของ USER นี้ด้วย</small></label>
                  <label className={styles.fullWidth}><span>โทรศัพท์เจ้าของร้าน</span><input value={draft.phone} onChange={(event) => setDraft((value) => ({ ...value, phone: event.target.value }))} /></label>
                </div>
              </section>

              <section className={`${styles.editorSection} ${styles.securitySection}`}>
                <div className={styles.securityHeader}>
                  <div><span>OWNER PIN SECURITY</span><h4>{owner.pin_configured ? "รหัสเจ้าของร้าน" : "ตั้งรหัสเจ้าของร้านครั้งแรก"}</h4><p>ใช้สำหรับอนุมัติรายการที่ต้องใช้สิทธิ์ Owner/Manager ใน POS</p></div>
                  <div className={styles.securityActions}>
                    <span className={owner.pin_configured ? styles.pinReadyBadge : styles.pinMissingBadge}>{owner.pin_configured ? "ตั้งค่าแล้ว" : "ต้องตั้งค่า"}</span>
                    {!pinEditorOpen ? <button type="button" onClick={() => setPinEditorOpen(true)}>{owner.pin_configured ? "เปลี่ยนรหัส" : "ตั้งรหัส"}</button> : null}
                  </div>
                </div>

                {pinEditorOpen ? (
                  <div className={styles.pinEditor}>
                    <div className={styles.pinGuide}><strong>{owner.pin_configured ? "กำหนดรหัสใหม่" : "กำหนดรหัสเริ่มต้น"}</strong><span>ใช้ตัวเลข 4–6 หลัก ระบบเก็บเฉพาะ bcrypt hash และจะไม่แสดงรหัสเดิมกลับมา</span></div>
                    <div className={styles.pinGrid}>
                      <label><span>รหัส Owner ใหม่</span><div className={styles.passwordField}><input type={showPin ? "text" : "password"} inputMode="numeric" autoComplete="new-password" maxLength={6} value={ownerPin} onChange={(event) => setOwnerPin(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="4–6 หลัก" /><button type="button" onClick={() => setShowPin((value) => !value)}>{showPin ? "ซ่อน" : "แสดง"}</button></div></label>
                      <label><span>ยืนยันรหัส Owner</span><input type={showPin ? "text" : "password"} inputMode="numeric" autoComplete="new-password" maxLength={6} value={confirmPin} onChange={(event) => setConfirmPin(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="กรอกรหัสซ้ำ" /></label>
                    </div>
                    {ownerPin && !pinIsValid ? <div className={styles.pinValidation}>รหัสต้องเป็นตัวเลข 4–6 หลัก</div> : null}
                    {confirmPin && !pinMatches ? <div className={styles.pinValidation}>รหัสยืนยันไม่ตรงกัน</div> : null}
                  </div>
                ) : null}
              </section>

              <div className={styles.securityNote}>User ID และสิทธิ์ Owner ถูกล็อกในหน้าต่างนี้ การเปลี่ยนรหัสจะไม่บันทึกรหัสจริงหรือ hash ลง Audit Log แต่จะบันทึกว่าใครเป็นผู้เปลี่ยนและเมื่อใด</div>
            </div>

            <footer className={styles.modalFooter}>
              <button type="button" className={styles.cancelButton} onClick={closeEditor} disabled={saving}>ยกเลิก</button>
              <button type="button" className={styles.saveButton} onClick={() => void save()} disabled={saving || !profileCanSave || !pinCanSave}>{saving ? "กำลังบันทึก…" : pinEditorOpen && ownerPin ? "บันทึกข้อมูลและรหัส Owner" : "บันทึกข้อมูล Owner"}</button>
            </footer>
          </section>
        </div>
      ) : null}
    </>
  );
}
