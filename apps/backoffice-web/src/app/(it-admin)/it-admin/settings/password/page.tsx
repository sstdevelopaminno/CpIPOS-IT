"use client";

import { useState } from "react";

export default function ItAdminPasswordSettingsPage() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [recoveryNotice, setRecoveryNotice] = useState("");

  async function requestTemporaryPassword() {
    if (recoveryBusy || busy) return;
    setRecoveryBusy(true);
    setError("");
    setSuccess("");
    setRecoveryNotice("");

    try {
      const response = await fetch("/api/it-admin/auth/request-temporary-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store"
      });
      const body = await response.json().catch(() => null) as {
        code?: string;
        masked_email?: string;
      } | null;

      if (!response.ok) {
        const message = body?.code === "rate_limited"
          ? "มีการขอรหัสผ่านชั่วคราวถี่เกินไป กรุณารอสักครู่"
          : body?.code === "account_inactive"
            ? "บัญชี IT นี้ถูกปิดการใช้งาน"
            : body?.code === "not_authorized"
              ? "บัญชีนี้ไม่มีสิทธิ์ IT Admin หรือ IT Support"
              : "ไม่สามารถส่งรหัสผ่านชั่วคราวได้ในขณะนี้";
        setError(message);
        return;
      }

      const target = body?.masked_email ? ` ไปที่ ${body.masked_email}` : "";
      setRecoveryNotice(
        `ส่งรหัสผ่านชั่วคราว${target} แล้ว กรุณานำรหัสจากอีเมลมาใส่ในช่อง “รหัสผ่านปัจจุบัน” จากนั้นกำหนดรหัสใหม่ รหัสชั่วคราวมีอายุ 30 นาที`
      );
      setCurrentPassword("");
    } catch {
      setError("ไม่สามารถส่งรหัสผ่านชั่วคราวได้ในขณะนี้");
    } finally {
      setRecoveryBusy(false);
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError("");
    setSuccess("");

    if (!currentPassword || !newPassword || !confirmPassword) {
      setError("กรุณากรอกรหัสผ่านให้ครบทุกช่อง");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("รหัสผ่านใหม่และการยืนยันรหัสผ่านไม่ตรงกัน");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/it-admin/auth/change-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword
        }),
        cache: "no-store"
      });
      const body = await response.json().catch(() => null) as { code?: string } | null;
      if (!response.ok) {
        const message = body?.code === "current_password_invalid"
          ? "รหัสผ่านปัจจุบันไม่ถูกต้อง"
          : body?.code === "weak_password"
            ? "รหัสผ่านใหม่ต้องยาวอย่างน้อย 12 ตัว และมีตัวพิมพ์ใหญ่ ตัวพิมพ์เล็ก ตัวเลข และอักขระพิเศษ"
            : body?.code === "password_unchanged"
              ? "รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านปัจจุบัน"
              : body?.code === "rate_limited"
                ? "มีการลองเปลี่ยนรหัสผ่านถี่เกินไป กรุณารอสักครู่"
                : "ไม่สามารถเปลี่ยนรหัสผ่านได้ในขณะนี้";
        setError(message);
        return;
      }

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setSuccess("เปลี่ยนรหัสผ่านเรียบร้อยแล้ว สามารถใช้รหัสใหม่ในการเข้าสู่ระบบครั้งถัดไป");
    } catch {
      setError("ไม่สามารถเปลี่ยนรหัสผ่านได้ในขณะนี้");
    } finally {
      setBusy(false);
    }
  }

  const inputType = showPassword ? "text" : "password";
  return (
    <section className="surface" style={{ maxWidth: 760 }}>
      <h2>เปลี่ยนรหัสผ่าน</h2>
      <p style={{ color: "#64748b", lineHeight: 1.7 }}>
        หากเข้าสู่ระบบด้วยรหัสผ่านชั่วคราวจากเมนู “ลืมรหัสผ่าน” ให้กำหนดรหัสใหม่ที่นี่ทันที
      </p>

      <form onSubmit={submit} style={{ display: "grid", gap: 14, marginTop: 20 }}>
        <label style={{ display: "grid", gap: 7, fontWeight: 800 }}>
          <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <span>รหัสผ่านปัจจุบัน</span>
            <button
              type="button"
              onClick={() => void requestTemporaryPassword()}
              disabled={recoveryBusy || busy}
              style={{
                border: 0,
                background: "transparent",
                padding: 0,
                color: "#176fe8",
                fontSize: 12,
                fontWeight: 900,
                cursor: recoveryBusy || busy ? "wait" : "pointer"
              }}
            >
              {recoveryBusy ? "กำลังส่งรหัสชั่วคราว..." : "จำรหัสปัจจุบันไม่ได้?"}
            </button>
          </span>
          <input
            type={inputType}
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            autoComplete="current-password"
            placeholder="กรอกรหัสปัจจุบัน หรือรหัสชั่วคราวจากอีเมล"
            style={{ minHeight: 46, border: "1px solid #cbd5e1", borderRadius: 10, padding: "0 13px" }}
          />
        </label>
        <label style={{ display: "grid", gap: 7, fontWeight: 800 }}>
          รหัสผ่านใหม่
          <input
            type={inputType}
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            autoComplete="new-password"
            style={{ minHeight: 46, border: "1px solid #cbd5e1", borderRadius: 10, padding: "0 13px" }}
          />
        </label>
        <label style={{ display: "grid", gap: 7, fontWeight: 800 }}>
          ยืนยันรหัสผ่านใหม่
          <input
            type={inputType}
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            autoComplete="new-password"
            style={{ minHeight: 46, border: "1px solid #cbd5e1", borderRadius: 10, padding: "0 13px" }}
          />
        </label>

        <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, color: "#64748b" }}>
          <input type="checkbox" checked={showPassword} onChange={(event) => setShowPassword(event.target.checked)} />
          แสดงรหัสผ่าน
        </label>

        <div style={{ borderRadius: 10, background: "#f8fafc", padding: 12, color: "#64748b", fontSize: 12, lineHeight: 1.65 }}>
          รหัสใหม่ต้องมีอย่างน้อย 12 ตัวอักษร และประกอบด้วยตัวพิมพ์ใหญ่ ตัวพิมพ์เล็ก ตัวเลข และอักขระพิเศษ
        </div>

        {recoveryNotice ? (
          <div role="status" style={{ borderRadius: 10, background: "#eff6ff", border: "1px solid #bfdbfe", padding: 12, color: "#1d4ed8", fontSize: 12, lineHeight: 1.65 }}>
            {recoveryNotice}
          </div>
        ) : null}
        {success ? <p role="status" style={{ color: "#15803d", fontWeight: 800 }}>{success}</p> : null}
        {error ? <p role="alert" style={{ color: "#b91c1c", fontWeight: 800 }}>{error}</p> : null}

        <button
          type="submit"
          disabled={busy || recoveryBusy}
          style={{
            minHeight: 46,
            border: 0,
            borderRadius: 10,
            background: "#176fe8",
            color: "#fff",
            fontWeight: 900,
            cursor: busy ? "wait" : "pointer",
            opacity: busy ? 0.7 : 1
          }}
        >
          {busy ? "กำลังบันทึก..." : "บันทึกรหัสผ่านใหม่"}
        </button>
      </form>
    </section>
  );
}
