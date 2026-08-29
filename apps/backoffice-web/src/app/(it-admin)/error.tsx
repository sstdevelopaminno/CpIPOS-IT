"use client";

import { useEffect } from "react";

export default function ItAdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[it-admin-page] render failed", error);
  }, [error]);

  return (
    <section className="surface" role="alert" style={{ display: "grid", gap: 12, minHeight: 220, alignContent: "center", justifyItems: "center", textAlign: "center" }}>
      <div style={{ fontSize: 34 }}>⚠</div>
      <h2 style={{ margin: 0, fontSize: 22 }}>หน้านี้โหลดข้อมูลไม่สำเร็จ</h2>
      <p style={{ margin: 0, maxWidth: 620, color: "#64748b", fontSize: 14, lineHeight: 1.6 }}>
        Control Plane ยังทำงานต่อได้ หน้านี้จะไม่พาแอปทั้งระบบล้ม กรุณาลองโหลดโมดูลนี้ใหม่อีกครั้ง
      </p>
      {error.digest ? <small style={{ color: "#94a3b8" }}>Error reference: {error.digest}</small> : null}
      <button type="button" className="pos-monitor-btn pos-monitor-btn--primary" onClick={reset}>ลองใหม่</button>
    </section>
  );
}
