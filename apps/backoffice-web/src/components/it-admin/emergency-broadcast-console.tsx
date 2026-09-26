"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";

type Severity = "info" | "warning" | "danger" | "emergency";
type Settings = {
  id: string;
  enabled: boolean;
  severity: Severity;
  title_th: string;
  title_en: string;
  message_th: string;
  message_en: string;
  action_label_th: string;
  action_label_en: string;
  action_url: string | null;
  bar_color: string;
  text_color: string;
  button_color: string;
  button_text_color: string;
  target_company_web: boolean;
  target_pos: boolean;
  dismissible: boolean;
  starts_at: string | null;
  ends_at: string | null;
};

const fallback: Settings = {
  id: "global",
  enabled: false,
  severity: "warning",
  title_th: "แจ้งเตือนฉุกเฉิน",
  title_en: "Emergency alert",
  message_th: "",
  message_en: "",
  action_label_th: "ดูรายละเอียด",
  action_label_en: "View details",
  action_url: null,
  bar_color: "#FACC15",
  text_color: "#111827",
  button_color: "#B91C1C",
  button_text_color: "#FFFFFF",
  target_company_web: true,
  target_pos: false,
  dismissible: true,
  starts_at: null,
  ends_at: null
};

function toLocalDateTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function fromLocalDateTime(value: string) {
  return value ? new Date(value).toISOString() : null;
}

export function EmergencyBroadcastConsole() {
  const [settings, setSettings] = useState<Settings>(fallback);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/it-admin/v1/emergency-broadcast", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload) => {
        if (!active) return;
        setSettings(payload?.data?.settings ?? fallback);
      })
      .catch(() => {
        if (active) setMessage("โหลดข้อมูลไม่สำเร็จ");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  const previewTitle = settings.title_th || settings.title_en || "แจ้งเตือน";
  const previewMessage = settings.message_th || settings.message_en || "ข้อความแจ้งเตือนจะแสดงที่นี่";
  const previewAction = settings.action_label_th || settings.action_label_en;
  const enabledTargets = useMemo(() => {
    const targets = [];
    if (settings.target_company_web) targets.push("เว็บไซต์บริษัท");
    if (settings.target_pos) targets.push("CpIPOS");
    return targets.join(" + ") || "ยังไม่ได้เลือกปลายทาง";
  }, [settings.target_company_web, settings.target_pos]);

  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((current) => ({ ...current, [key]: value }));
  };

  const persist = async (next: Settings) => {
    const response = await fetch("/api/it-admin/v1/emergency-broadcast", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...next, dismissible: true })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error?.message || "บันทึกไม่สำเร็จ");
    setSettings(payload.data.settings);
    return payload.data.settings as Settings;
  };

  const save = async () => {
    setSaving(true);
    setMessage("");
    try {
      await persist(settings);
      setMessage(settings.enabled ? "บันทึกและเผยแพร่การตั้งค่าแล้ว" : "บันทึกและปิดแถบแจ้งเตือนแล้ว");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  };

  const disableNow = async () => {
    if (!settings.enabled) {
      setMessage("แถบแจ้งเตือนถูกปิดอยู่แล้ว");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      await persist({ ...settings, enabled: false });
      setMessage("ปิดแถบแจ้งเตือนทันทีแล้ว");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "ปิดแถบไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div style={{ padding: 24 }}>กำลังโหลดระบบส่งข้อความฉุกเฉิน…</div>;
  }

  const field: CSSProperties = {
    width: "100%",
    minHeight: 42,
    border: "1px solid #d8e0eb",
    borderRadius: 10,
    padding: "10px 12px",
    background: "#fff",
    color: "#14213d",
    font: "inherit"
  };
  const label: CSSProperties = {
    display: "grid",
    gap: 7,
    fontSize: 13,
    fontWeight: 700,
    color: "#334155"
  };
  const card: CSSProperties = {
    background: "#fff",
    border: "1px solid #dce4ef",
    borderRadius: 16,
    padding: 20,
    boxShadow: "0 8px 28px rgba(15,23,42,.05)"
  };

  return (
    <div style={{ display: "grid", gap: 18, maxWidth: 1180, margin: "0 auto" }}>
      <section style={{ ...card, display: "grid", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 24, color: "#10213e" }}>ส่งข้อความฉุกเฉิน</h2>
            <p style={{ margin: "6px 0 0", color: "#64748b", fontSize: 14 }}>
              ควบคุมแถบแจ้งเตือนส่วนกลางสำหรับเว็บไซต์บริษัทและระบบ CpIPOS โดยไม่ต้องแก้โค้ดทุกครั้ง
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 800, color: settings.enabled ? "#047857" : "#64748b" }}>
              <input type="checkbox" checked={settings.enabled} onChange={(event) => update("enabled", event.target.checked)} />
              {settings.enabled ? "กำลังเปิดใช้งาน" : "ปิดการแจ้งเตือน"}
            </label>
            <button
              type="button"
              disabled={saving || !settings.enabled}
              onClick={disableNow}
              style={{
                border: "1px solid #fecaca",
                borderRadius: 10,
                background: settings.enabled ? "#fff1f2" : "#f8fafc",
                color: settings.enabled ? "#b91c1c" : "#94a3b8",
                padding: "8px 12px",
                fontWeight: 900,
                cursor: saving || !settings.enabled ? "not-allowed" : "pointer"
              }}
            >
              ปิดแถบแจ้งเตือนทันที
            </button>
          </div>
        </div>
        <div style={{ fontSize: 13, color: "#64748b" }}>ปลายทาง: {enabledTargets}</div>
      </section>

      <section style={{ ...card, display: "grid", gap: 16 }}>
        <h3 style={{ margin: 0, color: "#10213e" }}>ตัวอย่างแถบแจ้งเตือน</h3>
        <div style={{
          borderRadius: 14,
          padding: "13px 16px",
          background: settings.bar_color,
          color: settings.text_color,
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          border: "1px solid rgba(15,23,42,.12)"
        }}>
          <strong style={{ whiteSpace: "nowrap" }}>⚠ {previewTitle}</strong>
          <span style={{ flex: "1 1 420px", fontWeight: 700 }}>{previewMessage}</span>
          {settings.action_url && previewAction ? (
            <span style={{
              background: settings.button_color,
              color: settings.button_text_color,
              padding: "8px 13px",
              borderRadius: 9,
              fontWeight: 800,
              whiteSpace: "nowrap"
            }}>{previewAction}</span>
          ) : null}
          <span style={{ fontWeight: 900 }}>×</span>
        </div>
      </section>

      <section style={{ ...card, display: "grid", gap: 18 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 14 }}>
          <label style={label}>ระดับความสำคัญ
            <select style={field} value={settings.severity} onChange={(event) => update("severity", event.target.value as Severity)}>
              <option value="info">ข้อมูลทั่วไป</option>
              <option value="warning">เฝ้าระวัง</option>
              <option value="danger">อันตราย</option>
              <option value="emergency">ฉุกเฉิน</option>
            </select>
          </label>
          <label style={label}>ปลายทาง
            <span style={{ display: "flex", minHeight: 42, alignItems: "center", gap: 18 }}>
              <span><input type="checkbox" checked={settings.target_company_web} onChange={(event) => update("target_company_web", event.target.checked)} /> เว็บไซต์บริษัท</span>
              <span><input type="checkbox" checked={settings.target_pos} onChange={(event) => update("target_pos", event.target.checked)} /> CpIPOS</span>
            </span>
          </label>
          <label style={label}>การปิดแถบโดยผู้ใช้
            <span style={{ display: "flex", minHeight: 42, alignItems: "center", gap: 8, color: "#047857" }}>
              ✓ ผู้ใช้กด × ปิดแถบได้เสมอ
            </span>
          </label>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 14 }}>
          <label style={label}>หัวข้อภาษาไทย
            <input style={field} value={settings.title_th} onChange={(event) => update("title_th", event.target.value)} />
          </label>
          <label style={label}>หัวข้อภาษาอังกฤษ
            <input style={field} value={settings.title_en} onChange={(event) => update("title_en", event.target.value)} />
          </label>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 14 }}>
          <label style={label}>ข้อความภาษาไทย
            <textarea style={{ ...field, minHeight: 110, resize: "vertical" }} value={settings.message_th} onChange={(event) => update("message_th", event.target.value)} />
          </label>
          <label style={label}>ข้อความภาษาอังกฤษ
            <textarea style={{ ...field, minHeight: 110, resize: "vertical" }} value={settings.message_en} onChange={(event) => update("message_en", event.target.value)} />
          </label>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 14 }}>
          <label style={label}>ข้อความปุ่มภาษาไทย
            <input style={field} value={settings.action_label_th} onChange={(event) => update("action_label_th", event.target.value)} />
          </label>
          <label style={label}>ข้อความปุ่มภาษาอังกฤษ
            <input style={field} value={settings.action_label_en} onChange={(event) => update("action_label_en", event.target.value)} />
          </label>
          <label style={label}>ลิงก์ปุ่ม (HTTPS)
            <input style={field} placeholder="https://..." value={settings.action_url ?? ""} onChange={(event) => update("action_url", event.target.value || null)} />
          </label>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 14 }}>
          {([
            ["bar_color", "สีแถบ"],
            ["text_color", "สีข้อความ"],
            ["button_color", "สีปุ่ม"],
            ["button_text_color", "สีข้อความปุ่ม"]
          ] as const).map(([key, title]) => (
            <label key={key} style={label}>{title}
              <span style={{ display: "flex", gap: 8 }}>
                <input type="color" value={settings[key]} onChange={(event) => update(key, event.target.value.toUpperCase())} style={{ width: 52, minHeight: 42, border: "1px solid #d8e0eb", borderRadius: 9, background: "#fff" }} />
                <input style={field} value={settings[key]} onChange={(event) => update(key, event.target.value.toUpperCase())} />
              </span>
            </label>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 14 }}>
          <label style={label}>เริ่มแสดง
            <input type="datetime-local" style={field} value={toLocalDateTime(settings.starts_at)} onChange={(event) => update("starts_at", fromLocalDateTime(event.target.value))} />
          </label>
          <label style={label}>สิ้นสุด
            <input type="datetime-local" style={field} value={toLocalDateTime(settings.ends_at)} onChange={(event) => update("ends_at", fromLocalDateTime(event.target.value))} />
          </label>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <button type="button" disabled={saving} onClick={save} style={{
            border: 0,
            borderRadius: 11,
            background: "#0f5bd8",
            color: "#fff",
            padding: "11px 18px",
            fontWeight: 900,
            cursor: saving ? "wait" : "pointer",
            opacity: saving ? .65 : 1
          }}>
            {saving ? "กำลังบันทึก…" : "บันทึก / เผยแพร่"}
          </button>
          {message ? <span style={{ fontSize: 14, fontWeight: 700, color: message.includes("แล้ว") ? "#047857" : "#b42318" }}>{message}</span> : null}
        </div>
      </section>
    </div>
  );
}
