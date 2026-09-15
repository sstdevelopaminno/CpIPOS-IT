"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./tenant-action-confirm.module.css";

type Tone = "info" | "warning" | "danger";
type PendingConfirmation = {
  action: string;
  storeName: string;
  resolve: (value: boolean) => void;
};

type Copy = {
  eyebrow: string;
  title: string;
  description: string;
  confirmLabel: string;
  tone: Tone;
};

const actionCopy: Record<string, Copy> = {
  update_profile: {
    eyebrow: "STORE PROFILE",
    title: "ยืนยันการบันทึกข้อมูลร้าน",
    description: "ชื่อร้าน เบอร์ติดต่อ ที่อยู่ หรือโลโก้ร้านจะถูกอัปเดตและบันทึก Audit Log",
    confirmLabel: "ยืนยันบันทึกข้อมูลร้าน",
    tone: "info"
  },
  create_branch: {
    eyebrow: "BRANCH CREATE",
    title: "ยืนยันการเปิดสาขาใหม่",
    description: "ระบบจะสร้างสาขาใหม่ให้ร้านนี้ และบันทึกผู้ดำเนินการไว้ใน Audit Log",
    confirmLabel: "ยืนยันเปิดสาขา",
    tone: "info"
  },
  update_branch: {
    eyebrow: "BRANCH UPDATE",
    title: "ยืนยันการบันทึกข้อมูลสาขา",
    description: "ชื่อสาขา ที่อยู่ หรือสถานะสาขาจะถูกอัปเดตทันทีหลังยืนยัน",
    confirmLabel: "ยืนยันบันทึกสาขา",
    tone: "info"
  },
  update_owner_profile: {
    eyebrow: "OWNER LOGIN",
    title: "ยืนยันการบันทึก Owner / POS Login",
    description: "ข้อมูลเจ้าของร้าน อีเมล Login และรหัสพนักงาน POS จะถูกอัปเดตพร้อม Audit Log",
    confirmLabel: "ยืนยันบันทึก Owner",
    tone: "info"
  },
  update_owner_pin: {
    eyebrow: "OWNER PIN",
    title: "ยืนยันการบันทึกรหัสเจ้าของร้าน",
    description: "PIN ใหม่จะถูกเข้ารหัสและใช้ยืนยันสิทธิ์ Owner/Manager หลังจากบันทึก",
    confirmLabel: "ยืนยันบันทึกรหัส",
    tone: "warning"
  },
  update_contract: {
    eyebrow: "CONTRACT UPDATE",
    title: "ยืนยันการแก้ไขสัญญา",
    description: "วันที่เริ่ม รอบสัญญา หรือวันหมดอายุจะเปลี่ยนทันที และระบบจะบันทึก Audit Log",
    confirmLabel: "ยืนยันการแก้ไข",
    tone: "info"
  },
  change_package: {
    eyebrow: "PACKAGE CHANGE",
    title: "ยืนยันการเปลี่ยนแพ็กเกจ",
    description: "ระบบจะสร้างสัญญาใหม่ ปิดสัญญาเดิม และเปลี่ยนสิทธิ์ของร้านตามแพ็กเกจที่เลือก",
    confirmLabel: "ยืนยันเปลี่ยนแพ็กเกจ",
    tone: "warning"
  },
  suspend_package: {
    eyebrow: "PACKAGE SUSPEND",
    title: "หยุดแพ็กเกจชั่วคราว?",
    description: "ลูกค้าจะถูกระงับสิทธิ์ตาม Feature Gate และข้อความที่กำหนดจะถูกใช้แจ้งบน POS",
    confirmLabel: "หยุดแพ็กเกจ",
    tone: "warning"
  },
  resume_package: {
    eyebrow: "PACKAGE RESUME",
    title: "เปิดแพ็กเกจกลับมาใช้งาน?",
    description: "ระบบจะคืนสถานะสัญญาก่อนถูกระงับและปลดการล็อกสิทธิ์ของร้าน",
    confirmLabel: "เปิดใช้งานต่อ",
    tone: "info"
  },
  cancel_subscription: {
    eyebrow: "CANCEL SUBSCRIPTION",
    title: "ยืนยันการยกเลิกแพ็กเกจ",
    description: "การยกเลิกจะปิดสัญญาปัจจุบันและหยุดสิทธิ์ของร้าน กรุณาตรวจสอบข้อความลูกค้าก่อนดำเนินการ",
    confirmLabel: "ยกเลิกแพ็กเกจ",
    tone: "danger"
  },
  deactivate_store: {
    eyebrow: "STORE ACCESS",
    title: "ปิดร้านชั่วคราว?",
    description: "ข้อมูลร้านยังคงอยู่ครบ แต่ Store Control Plane จะถือว่าร้านนี้ไม่เปิดใช้งานจนกว่าจะเปิดกลับ",
    confirmLabel: "ปิดร้านชั่วคราว",
    tone: "warning"
  },
  reactivate_store: {
    eyebrow: "STORE ACCESS",
    title: "เปิดร้านกลับมาใช้งาน?",
    description: "ระบบจะเปิดสถานะร้านอีกครั้ง โดยสัญญาและสิทธิ์แพ็กเกจยังคงเป็นไปตามสถานะปัจจุบัน",
    confirmLabel: "เปิดร้าน",
    tone: "info"
  },
  delete_store: {
    eyebrow: "PERMANENT DELETE",
    title: "ยืนยันการลบร้านถาวร",
    description: "การดำเนินการนี้ย้อนกลับไม่ได้ และข้อมูลที่ผูกกับร้านอาจถูกลบตาม Foreign Key Cascade",
    confirmLabel: "ลบร้านถาวร",
    tone: "danger"
  }
};

const defaultCopy: Copy = {
  eyebrow: "CONFIRM ACTION",
  title: "ยืนยันการดำเนินการ",
  description: "ระบบจะบันทึกการเปลี่ยนแปลงและ Audit Log ทุกครั้ง",
  confirmLabel: "ยืนยัน",
  tone: "info"
};

export function useTenantActionConfirm() {
  const [pending, setPending] = useState<PendingConfirmation | null>(null);

  const confirmAction = useCallback((action: string, storeName: string) => new Promise<boolean>((resolve) => {
    setPending({ action, storeName, resolve });
  }), []);

  const finish = useCallback((result: boolean) => {
    setPending((current) => {
      current?.resolve(result);
      return null;
    });
  }, []);

  useEffect(() => {
    if (!pending) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        finish(false);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [finish, pending]);

  const copy = useMemo(() => pending ? (actionCopy[pending.action] ?? defaultCopy) : defaultCopy, [pending]);

  const confirmationDialog = pending && typeof document !== "undefined" ? createPortal(
    <div className={styles.backdrop} data-tenant-action-confirm role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) finish(false); }}>
      <section className={styles.dialog} role="alertdialog" aria-modal="true" aria-labelledby="tenant-confirm-title" aria-describedby="tenant-confirm-description">
        <div className={`${styles.icon} ${styles[copy.tone]}`}>{copy.tone === "danger" ? "!" : copy.tone === "warning" ? "!" : "✓"}</div>
        <div className={styles.content}>
          <span className={styles.eyebrow}>{copy.eyebrow}</span>
          <h3 id="tenant-confirm-title">{copy.title}</h3>
          <p id="tenant-confirm-description">{copy.description}</p>
          <div className={styles.storeBox}>
            <span>ร้านที่กำลังดำเนินการ</span>
            <strong>{pending.storeName || "—"}</strong>
          </div>
          <div className={styles.auditNote}>ทุกการเปลี่ยนแปลงสำคัญจะถูกบันทึกลง Audit Log พร้อมผู้ดำเนินการและเวลา</div>
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.cancel} onClick={() => finish(false)}>ยกเลิก</button>
          <button type="button" className={`${styles.confirm} ${styles[`${copy.tone}Button`]}`} onClick={() => finish(true)} autoFocus>{copy.confirmLabel}</button>
        </div>
      </section>
    </div>
  , document.body) : null;

  return {
    confirmAction,
    confirmationDialog,
    isConfirming: Boolean(pending)
  };
}
