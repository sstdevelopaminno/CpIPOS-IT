"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./tenant-primary-owner-card.module.css";

type ApiEnvelope<T> = { data: T | null; error: { code?: string; message?: string } | null };

type PrimaryOwner = {
  user_id: string;
  full_name: string;
  email: string;
  phone: string;
  employee_code: string;
  pos_profile_configured: boolean;
  is_active: boolean;
  pin_configured: boolean;
  login_ready: boolean;
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
  const [draft, setDraft] = useState({ full_name: "", email: "", phone: "", employee_code: "" });
  const [ownerPin, setOwnerPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [pinModalOpen, setPinModalOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pinSaving, setPinSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const clearPinDraft = useCallback(() => {
    setOwnerPin("");
    setConfirmPin("");
    setShowPin(false);
    setPinError(null);
  }, []);

  const applyOwner = useCallback((next: PrimaryOwner | null) => {
    setOwner(next);
    setDraft({
      full_name: next?.full_name ?? "",
      email: next?.email ?? "",
      phone: next?.phone ?? "",
      employee_code: next?.employee_code ?? ""
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

  useEffect(() => {
    if (!editorOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (pinModalOpen) {
        if (pinSaving) return;
        setPinModalOpen(false);
        clearPinDraft();
        return;
      }
      if (saving) return;
      setEditorOpen(false);
      clearPinDraft();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = previousOverflow;
    };
  }, [clearPinDraft, editorOpen, pinModalOpen, pinSaving, saving]);

  const openEditor = () => {
    setError(null);
    setSuccess(null);
    clearPinDraft();
    setEditorOpen(true);
  };

  const closeEditor = () => {
    if (saving || pinSaving) return;
    setPinModalOpen(false);
    setEditorOpen(false);
    clearPinDraft();
  };

  const openPinModal = () => {
    setError(null);
    setSuccess(null);
    clearPinDraft();
    setPinModalOpen(true);
  };

  const closePinModal = () => {
    if (pinSaving) return;
    setPinModalOpen(false);
    clearPinDraft();
  };

  const pinIsValid = /^\d{4,6}$/.test(ownerPin);
  const pinMatches = ownerPin === confirmPin;
  const pinCanSave = ownerPin.length >= 4 && pinIsValid && pinMatches;
  const employeeCode = draft.employee_code.trim().toUpperCase().replace(/\s+/g, "");
  const employeeCodeIsValid = /^[A-Z0-9][A-Z0-9._-]{2,31}$/.test(employeeCode);
  const profileCanSave = draft.full_name.trim().length >= 2 && draft.email.includes("@") && employeeCodeIsValid;

  const saveProfile = async () => {
    if (!profileCanSave) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch(`/api/it-admin/v1/tenants/${tenantId}/primary-owner`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...draft, employee_code: employeeCode })
      });
      const payload = await parse<OwnerResponse>(response);
      applyOwner(payload.primary_owner);
      setSuccess("บันทึก USER เจ้าของร้านและ POS Login เรียบร้อยแล้ว");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "บันทึกข้อมูลเจ้าของร้านไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  };

  const savePin = async () => {
    if (!owner || !pinCanSave) return;
    setPinSaving(true);
    setPinError(null);
    try {
      const response = await fetch(`/api/it-admin/v1/tenants/${tenantId}/primary-owner`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          full_name: owner.full_name,
          email: owner.email,
          phone: owner.phone,
          employee_code: owner.employee_code,
          owner_pin: ownerPin
        })
      });
      const payload = await parse<OwnerResponse>(response);
      setOwner(payload.primary_owner);
      setPinModalOpen(false);
      clearPinDraft();
      setSuccess(owner.pin_configured ? "เปลี่ยนรหัส Owner/PIN เรียบร้อยแล้ว" : "ตั้งรหัส Owner/PIN เรียบร้อยแล้ว");
    } catch (saveError) {
      setPinError(saveError instanceof Error ? saveError.message : "บันทึกรหัส Owner ไม่สำเร็จ");
    } finally {
      setPinSaving(false);
    }
  };

  const ownerSince = useMemo(() => owner ? formatDate(owner.role_created_at || owner.created_at) : "—", [owner]);

  if (loading) {
    return (
      <section className={styles.compactCard} data-primary-owner-card>
        <div className={styles.loadingDot} />
        <div className={styles.summary}><span className={styles.eyebrow}>PRIMARY OWNER USER</span><strong>กำลังโหลด Owner…</strong><small>ตรวจสอบรหัสพนักงาน POS, สิทธิ์ และสถานะ PIN</small></div>
      </section>
    );
  }

  return (
    <>
      {owner ? (
        <button type="button" className={styles.compactCard} data-primary-owner-card onClick={openEditor}>
          <div className={styles.cardTop}>
            <div className={styles.ownerAvatar}>{initials(owner.full_name || "Owner")}</div>
            <div className={styles.summaryBadges}>
              <span className={owner.login_ready ? styles.goodBadge : styles.pinMissingBadge}>{owner.login_ready ? "POS พร้อม" : "POS ยังไม่พร้อม"}</span>
              <span className={owner.pin_configured ? styles.pinReadyBadge : styles.pinMissingBadge}>{owner.pin_configured ? "PIN พร้อม" : "ยังไม่มี PIN"}</span>
            </div>
          </div>
          <div className={styles.summary}>
            <span className={styles.eyebrow}>PRIMARY OWNER USER</span>
            <strong>{owner.full_name || "USER เจ้าของร้าน"}</strong>
            <small>{owner.employee_code ? `รหัสพนักงาน POS: ${owner.employee_code}` : "ยังไม่ได้กำหนดรหัสพนักงาน POS"}</small>
          </div>
          <div className={styles.cardBottom}>
            <span>Owner ตั้งแต่ {ownerSince}</span>
            <strong>จัดการ Owner →</strong>
          </div>
        </button>
      ) : (
        <section className={styles.compactCard} data-primary-owner-card>
          <div className={styles.ownerAvatar}>O</div>
          <div className={styles.summary}><span className={styles.eyebrow}>PRIMARY OWNER USER</span><strong>ยังไม่พบ USER เจ้าของร้าน</strong><small>ยังไม่ได้ผูก Owner USER กับร้าน</small></div>
          <button type="button" className={styles.reloadButton} onClick={() => void load()}>โหลดใหม่</button>
        </section>
      )}

      {error && !editorOpen ? <div className={styles.inlineError}>{error}</div> : null}

      {editorOpen && owner ? (
        <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) closeEditor(); }}>
          <section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="primary-owner-editor-title" onWheelCapture={(event) => event.stopPropagation()}>
            <header className={styles.modalHeader}>
              <div className={styles.modalIdentity}>
                <div className={styles.modalAvatar}>{initials(owner.full_name || "Owner")}</div>
                <div>
                  <span>OWNER ACCESS & IDENTITY</span>
                  <h3 id="primary-owner-editor-title">จัดการ USER เจ้าของร้าน</h3>
                  <p>ลำดับเข้า POS คือ รหัสพนักงาน POS → รหัส Owner/PIN ทั้งสองค่าเป็นคนละรายการ</p>
                </div>
              </div>
              <button type="button" className={styles.closeButton} onClick={closeEditor} disabled={saving || pinSaving} aria-label="ปิด">×</button>
            </header>

            <div className={styles.modalBody}>
              {error ? <div className={styles.errorBanner}><strong>บันทึกไม่สำเร็จ</strong><span>{error}</span></div> : null}
              {success ? <div className={styles.successBanner}>{success}</div> : null}

              <div className={styles.ownerMeta}>
                <div><span>User ID</span><strong title={owner.user_id}>{owner.user_id}</strong></div>
                <div><span>Owner ตั้งแต่</span><strong>{ownerSince}</strong></div>
                <div><span>สาขาที่เป็น Owner</span><strong>{owner.owner_branch_count}</strong></div>
                <div><span>สถานะ Login</span><strong className={owner.login_ready ? styles.goodText : styles.warnText}>{owner.login_ready ? "POS พร้อมใช้งาน" : "ต้องตรวจสอบ"}</strong></div>
              </div>

              <section className={styles.editorSection}>
                <div className={styles.sectionTitle}>
                  <div><span>POS LOGIN IDENTITY</span><h4>รหัสพนักงานสำหรับเข้าหน้าร้าน</h4></div>
                  <span className={owner.pos_profile_configured ? styles.pinReadyBadge : styles.pinMissingBadge}>{owner.pos_profile_configured ? "เชื่อมต่อแล้ว" : "ต้องกำหนด"}</span>
                </div>
                <div className={styles.formGrid}>
                  <label className={styles.fullWidth}>
                    <span>รหัสพนักงาน POS</span>
                    <input
                      value={draft.employee_code}
                      maxLength={32}
                      autoCapitalize="characters"
                      autoComplete="off"
                      spellCheck={false}
                      onChange={(event) => setDraft((value) => ({ ...value, employee_code: event.target.value.toUpperCase().replace(/\s+/g, "") }))}
                      placeholder="เช่น 591688"
                    />
                    <small>ใช้รหัสนี้ในหน้าที่เขียนว่า “รหัสพนักงาน” ก่อนเข้าสู่ขั้นตอน PIN Owner รหัสนี้ไม่ใช่รหัส Owner/PIN</small>
                  </label>
                  {!employeeCodeIsValid ? <div className={styles.pinValidation}>รหัสพนักงานต้องมี 3–32 ตัว และใช้ตัวอักษร ตัวเลข จุด ขีดล่าง หรือขีดกลาง</div> : null}
                </div>
              </section>

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
                  <div>
                    <span>OWNER PIN SECURITY</span>
                    <h4>{owner.pin_configured ? "รหัสเจ้าของร้าน" : "ตั้งรหัสเจ้าของร้านครั้งแรก"}</h4>
                    <p>PIN ใช้หลังจากระบบระบุ USER ด้วยรหัสพนักงาน POS แล้ว และใช้อนุมัติคำสั่งที่ต้องใช้สิทธิ์ Owner/Manager</p>
                  </div>
                  <div className={styles.securityActions}>
                    <span className={owner.pin_configured ? styles.pinReadyBadge : styles.pinMissingBadge}>{owner.pin_configured ? "ตั้งค่าแล้ว" : "ต้องตั้งค่า"}</span>
                    <button type="button" onClick={openPinModal}>{owner.pin_configured ? "เปลี่ยนรหัส" : "ตั้งรหัส"}</button>
                  </div>
                </div>
              </section>

              <div className={styles.securityNote}>การเข้า POS ใช้ 2 ขั้น: รหัสพนักงาน POS เพื่อระบุ USER และ PIN Owner เพื่อยืนยันสิทธิ์ ระบบไม่บันทึกรหัส PIN จริงหรือ hash ลง Audit Log แต่จะบันทึกว่าใครเป็นผู้เปลี่ยนและเมื่อใด</div>
            </div>

            <footer className={styles.modalFooter}>
              <button type="button" className={styles.cancelButton} onClick={closeEditor} disabled={saving || pinSaving}>ยกเลิก</button>
              <button type="button" className={styles.saveButton} onClick={() => void saveProfile()} disabled={saving || pinSaving || !profileCanSave}>{saving ? "กำลังบันทึก…" : "บันทึกข้อมูล Owner / POS Login"}</button>
            </footer>
          </section>
        </div>
      ) : null}

      {editorOpen && owner && pinModalOpen ? (
        <div className={styles.pinModalBackdrop} role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) closePinModal(); }}>
          <section className={styles.pinModal} role="dialog" aria-modal="true" aria-labelledby="owner-pin-dialog-title">
            <header className={styles.pinModalHeader}>
              <div>
                <span>OWNER PIN SECURITY</span>
                <h3 id="owner-pin-dialog-title">{owner.pin_configured ? "เปลี่ยนรหัส Owner/PIN" : "ตั้งรหัส Owner/PIN"}</h3>
                <p>รหัสนี้เป็นขั้นตอนยืนยันสิทธิ์หลังจากระบุรหัสพนักงาน POS แล้ว</p>
              </div>
              <button type="button" className={styles.closeButton} onClick={closePinModal} disabled={pinSaving} aria-label="ปิด">×</button>
            </header>

            <div className={styles.pinModalBody}>
              {pinError ? <div className={styles.errorBanner}><strong>บันทึกรหัสไม่สำเร็จ</strong><span>{pinError}</span></div> : null}
              <div className={styles.pinGuide}>
                <strong>{owner.pin_configured ? "กำหนดรหัสใหม่" : "กำหนดรหัสเริ่มต้น"}</strong>
                <span>ใช้ตัวเลข 4–6 หลัก ระบบเก็บเฉพาะ bcrypt hash และจะไม่แสดงรหัสเดิมกลับมา</span>
              </div>
              <div className={styles.pinGrid}>
                <label>
                  <span>รหัส Owner ใหม่</span>
                  <div className={styles.passwordField}>
                    <input type={showPin ? "text" : "password"} inputMode="numeric" autoComplete="new-password" maxLength={6} value={ownerPin} onChange={(event) => setOwnerPin(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="4–6 หลัก" autoFocus />
                    <button type="button" onClick={() => setShowPin((value) => !value)}>{showPin ? "ซ่อน" : "แสดง"}</button>
                  </div>
                </label>
                <label><span>ยืนยันรหัส Owner</span><input type={showPin ? "text" : "password"} inputMode="numeric" autoComplete="new-password" maxLength={6} value={confirmPin} onChange={(event) => setConfirmPin(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="กรอกรหัสซ้ำ" /></label>
              </div>
              {ownerPin && !pinIsValid ? <div className={styles.pinValidation}>รหัสต้องเป็นตัวเลข 4–6 หลัก</div> : null}
              {confirmPin && !pinMatches ? <div className={styles.pinValidation}>รหัสยืนยันไม่ตรงกัน</div> : null}
            </div>

            <footer className={styles.pinModalFooter}>
              <button type="button" className={styles.cancelButton} onClick={closePinModal} disabled={pinSaving}>ยกเลิก</button>
              <button type="button" className={styles.saveButton} onClick={() => void savePin()} disabled={pinSaving || !pinCanSave}>{pinSaving ? "กำลังบันทึกรหัส…" : "บันทึกรหัส Owner"}</button>
            </footer>
          </section>
        </div>
      ) : null}
    </>
  );
}
