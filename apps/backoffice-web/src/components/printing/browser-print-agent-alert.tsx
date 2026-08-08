"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BROWSER_PRINT_AGENT_ALERT_SNOOZE_UNTIL_KEY } from "@/components/printing/browser-print-agent-serial-recovery";

const BROWSER_PRINT_AGENT_STATUS_EVENT = "cpi-browser-print-agent-status";
const BROWSER_PRINT_AGENT_RESET_EVENT = "cpi-browser-print-agent-reset";
const BROWSER_PRINT_AGENT_CONFIG_EVENT = "cpi-browser-print-agent-config";
const POS_PATH_PREFIX = "/preview/pos";
const MANUAL_SNOOZE_MS = 5 * 60 * 1000;

type BrowserPrintAgentStatus = {
  enabled: boolean;
  supported: boolean;
  connected: boolean;
  code: string;
  message: string;
  jobsPrinted: number;
  lastJobId: string | null;
  updatedAt: string;
};

type AlertCopy = {
  title: string;
  detail: string;
  actionHint: string;
  severity: "warning" | "danger";
};

const OK_STATUS_CODES = new Set(["ready", "printed", "reset", "disabled", "serial_reconnect_waiting"]);
const PROBLEM_STATUS_CODES = new Set([
  "direct_web_serial_disabled_use_bridge",
  "web_serial_unsupported",
  "agent_key_missing",
  "serial_permission_required",
  "serial_reselect_required",
  "print_failed",
  "browser_serial_print_failed",
  "serial_port_not_writable",
  "paper_out",
  "cover_open",
  "paper_jam",
  "printer_offline",
  "bluetooth_unsupported",
  "bluetooth_permission_required",
  "bluetooth_gatt_connect_failed",
  "browser_bluetooth_print_failed"
]);
const SNOOZABLE_STATUS_CODES = new Set([
  "direct_web_serial_disabled_use_bridge",
  "serial_permission_required",
  "serial_reselect_required",
  "serial_port_not_writable",
  "printer_offline",
  "bluetooth_permission_required",
  "bluetooth_gatt_connect_failed"
]);

function isPosPath() {
  if (typeof window === "undefined") return false;
  return window.location.pathname.startsWith(POS_PATH_PREFIX);
}

function isSnoozed(status: BrowserPrintAgentStatus) {
  if (typeof window === "undefined") return false;
  if (!SNOOZABLE_STATUS_CODES.has(status.code)) return false;
  if (status.lastJobId) return false;
  const until = Number(window.localStorage.getItem(BROWSER_PRINT_AGENT_ALERT_SNOOZE_UNTIL_KEY) ?? 0);
  return Number.isFinite(until) && until > Date.now();
}

function copyForStatus(status: BrowserPrintAgentStatus): AlertCopy {
  if (status.code === "direct_web_serial_disabled_use_bridge") {
    return {
      title: "ปิด Web Serial โดยตรงแล้ว",
      detail: "เครื่องนี้เปิดพอร์ต Serial จาก Chrome ไม่เสถียร ระบบจึงหยุดปุ่มเลือกพอร์ต/ทดสอบ Web Serial เพื่อไม่ให้ค้าง Error เดิม",
      actionHint: "ให้ใช้ Local Bridge / Print Station ที่ Bridge URL เช่น http://127.0.0.1:3210/print แทน",
      severity: "warning"
    };
  }
  if (status.code === "paper_out") {
    return {
      title: "เครื่องพิมพ์กระดาษหมด",
      detail: "ระบบตรวจพบสถานะกระดาษหมดจากเครื่องพิมพ์ กรุณาใส่กระดาษใหม่แล้วลองพิมพ์อีกครั้ง",
      actionHint: "ตรวจสอบม้วนกระดาษและปิดฝาเครื่องให้สนิท",
      severity: "danger"
    };
  }
  if (status.code === "cover_open") {
    return {
      title: "ฝาเครื่องพิมพ์เปิดอยู่",
      detail: "ระบบตรวจพบว่าฝาเครื่องพิมพ์ยังไม่ปิด จึงอาจพิมพ์ใบเสร็จไม่ได้",
      actionHint: "ปิดฝาเครื่องพิมพ์ แล้วลองพิมพ์อีกครั้ง",
      severity: "danger"
    };
  }
  if (status.code === "paper_jam") {
    return {
      title: "เครื่องพิมพ์อาจมีกระดาษติด",
      detail: "ระบบตรวจพบปัญหาระหว่างพิมพ์ อาจเกิดจากกระดาษติด หัวพิมพ์ หรือ cutter ค้าง",
      actionHint: "ตรวจสอบกระดาษ หัวพิมพ์ และช่องทางออกกระดาษ",
      severity: "danger"
    };
  }
  if (status.code === "bluetooth_unsupported") {
    return {
      title: "เบราว์เซอร์นี้ไม่รองรับ Bluetooth",
      detail: "ระบบไม่สามารถเชื่อมต่อเครื่องพิมพ์ Bluetooth ผ่านเบราว์เซอร์นี้ได้",
      actionHint: "ใช้ Chrome บน Android หรือ Windows/Mac ที่รองรับ Web Bluetooth",
      severity: "danger"
    };
  }
  if (status.code === "bluetooth_permission_required") {
    return {
      title: "ยังไม่ได้จับคู่เครื่องพิมพ์ Bluetooth",
      detail: "ระบบยังไม่ได้รับสิทธิ์เชื่อมต่อเครื่องพิมพ์ Bluetooth เครื่องนี้",
      actionHint: "กดปุ่ม \"เชื่อมต่อเครื่องพิมพ์ Bluetooth\" ที่มุมจอ แล้วเลือกเครื่องพิมพ์จากรายการ",
      severity: "warning"
    };
  }
  if (status.code === "bluetooth_gatt_connect_failed") {
    return {
      title: "เชื่อมต่อเครื่องพิมพ์ Bluetooth ไม่สำเร็จ",
      detail: "ระบบเชื่อมต่ออุปกรณ์ Bluetooth ได้แต่คุยกับเครื่องพิมพ์ผ่าน GATT ไม่สำเร็จ",
      actionHint: "ตรวจสอบว่าเครื่องพิมพ์เปิดอยู่และอยู่ใกล้พอ หรือระบุ Service/Characteristic UUID ของรุ่นเครื่องพิมพ์นี้ในหน้าตั้งค่า",
      severity: "danger"
    };
  }
  if (status.code === "browser_bluetooth_print_failed") {
    return {
      title: "พิมพ์ผ่าน Bluetooth ไม่สำเร็จ",
      detail: "ระบบส่งข้อมูลพิมพ์ผ่าน Bluetooth ไม่สำเร็จ อาจเกิดจากเครื่องพิมพ์หลุดการเชื่อมต่อหรืออยู่ไกลเกินไป",
      actionHint: "ตรวจสอบระยะห่างและแบตเตอรี่เครื่องพิมพ์ แล้วลองพิมพ์ซ้ำ",
      severity: "danger"
    };
  }
  if (status.code === "web_serial_unsupported") {
    return {
      title: "เบราว์เซอร์นี้ไม่รองรับ Web Serial",
      detail: "ระบบไม่สามารถเชื่อมต่อเครื่องพิมพ์ผ่าน Browser Print Agent ได้จากเบราว์เซอร์นี้",
      actionHint: "ใช้ Chrome หรือ Edge บนเครื่องที่ต่อเครื่องพิมพ์ หรือให้เครื่องนี้เป็น POS แล้วให้ print station เครื่องอื่นพิมพ์",
      severity: "danger"
    };
  }
  if (status.code === "agent_key_missing") {
    return {
      title: "ยังไม่ได้ตั้งค่า Print Agent Secret",
      detail: "Browser Print Agent ยังไม่มีรหัสเชื่อมต่อ จึงรับงานพิมพ์จากระบบไม่ได้",
      actionHint: "ตั้งค่า Agent Secret ให้ตรงกับระบบหลังบ้าน หรือปิด Agent หากยังไม่ต้องการพิมพ์จากเครื่องนี้",
      severity: "warning"
    };
  }
  if (status.code === "serial_permission_required" || status.code === "serial_reselect_required") {
    return {
      title: "ไม่ใช้ Web Serial เป็นเส้นหลักแล้ว",
      detail: "Chrome/Windows เปิดพอร์ตเครื่องพิมพ์เดิมไม่ได้ซ้ำ ๆ จึงไม่ควรใช้ปุ่มเลือกพอร์ต Web Serial กับเครื่องนี้",
      actionHint: "ตั้งค่า Bridge URL เป็น Local Bridge แล้วให้ bridge เป็นตัวคุยกับเครื่องพิมพ์แทน",
      severity: "warning"
    };
  }
  if (status.code === "serial_port_not_writable" || status.code === "printer_offline") {
    return {
      title: "เครื่องพิมพ์ไม่พร้อมใช้งาน",
      detail: "ระบบเชื่อมต่อพอร์ตได้แต่ไม่สามารถส่งข้อมูลเข้าเครื่องพิมพ์ได้ อาจเกิดจากเครื่องปิด พอร์ตค้าง หรือสายหลุด",
      actionHint: "เปิดเครื่องพิมพ์ใหม่ รอ 5-10 วินาที ถ้ายังไม่กลับมาให้ใช้ Local Bridge แทน Web Serial",
      severity: "danger"
    };
  }
  if (status.code === "browser_serial_print_failed" || status.code === "print_failed") {
    return {
      title: "พิมพ์ใบเสร็จไม่สำเร็จ",
      detail: "ระบบส่งงานพิมพ์ไม่สำเร็จ อาจเกิดจากกระดาษหมด กระดาษติด เครื่องหลุด หรือเครื่องไม่ตอบสนอง",
      actionHint: "ตรวจสอบกระดาษ ฝาเครื่อง สายเชื่อมต่อ แล้วลองพิมพ์ซ้ำจากใบเสร็จ หรือใช้ Local Bridge",
      severity: "danger"
    };
  }
  return {
    title: "เครื่องพิมพ์มีปัญหา",
    detail: status.message || "ระบบตรวจพบปัญหาจาก Browser Print Agent",
    actionHint: "ตรวจสอบกระดาษ ฝาเครื่อง สายเชื่อมต่อ และสถานะ Browser Print Agent",
    severity: "warning"
  };
}

function shouldShowStatus(status: BrowserPrintAgentStatus) {
  if (!isPosPath()) return false;
  if (OK_STATUS_CODES.has(status.code)) return false;
  if (isSnoozed(status)) return false;
  if (PROBLEM_STATUS_CODES.has(status.code)) return true;
  return status.enabled && status.supported && !status.connected && status.lastJobId !== null;
}

function setSnooze(ms = MANUAL_SNOOZE_MS) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(BROWSER_PRINT_AGENT_ALERT_SNOOZE_UNTIL_KEY, String(Date.now() + ms));
}

export function BrowserPrintAgentAlert() {
  const [status, setStatus] = useState<BrowserPrintAgentStatus | null>(null);
  const dismissedSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    function handleStatus(event: Event) {
      const detail = (event as CustomEvent<BrowserPrintAgentStatus>).detail;
      if (!detail || typeof detail.code !== "string") return;

      if (!shouldShowStatus(detail)) {
        setStatus(null);
        return;
      }

      const signature = `${detail.code}:${detail.lastJobId ?? "none"}:${detail.message}`;
      if (dismissedSignatureRef.current === signature) return;
      setStatus(detail);
    }

    window.addEventListener(BROWSER_PRINT_AGENT_STATUS_EVENT, handleStatus);
    return () => window.removeEventListener(BROWSER_PRINT_AGENT_STATUS_EVENT, handleStatus);
  }, []);

  const copy = useMemo(() => (status ? copyForStatus(status) : null), [status]);

  if (!status || !copy) return null;

  const signature = `${status.code}:${status.lastJobId ?? "none"}:${status.message}`;
  const borderColor = copy.severity === "danger" ? "#dc2626" : "#f59e0b";
  const badgeBg = copy.severity === "danger" ? "#fee2e2" : "#fef3c7";
  const badgeText = copy.severity === "danger" ? "#991b1b" : "#92400e";

  return (
    <div
      role="alertdialog"
      aria-modal="false"
      aria-label={copy.title}
      style={{
        position: "fixed",
        right: 18,
        bottom: 18,
        zIndex: 2147483647,
        width: "min(430px, calc(100vw - 32px))",
        border: `2px solid ${borderColor}`,
        borderRadius: 18,
        background: "#ffffff",
        boxShadow: "0 22px 70px rgba(15, 23, 42, 0.28)",
        color: "#0f172a",
        overflow: "hidden",
        fontFamily: "Tahoma, 'Noto Sans Thai', system-ui, sans-serif"
      }}
    >
      <div style={{ padding: "16px 18px 14px", display: "grid", gap: 10 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start", justifyContent: "space-between" }}>
          <div style={{ display: "grid", gap: 6 }}>
            <span
              style={{
                display: "inline-flex",
                width: "fit-content",
                borderRadius: 999,
                padding: "4px 10px",
                background: badgeBg,
                color: badgeText,
                fontSize: 12,
                fontWeight: 900
              }}
            >
              แจ้งเตือนเครื่องพิมพ์
            </span>
            <strong style={{ fontSize: 18, lineHeight: 1.2 }}>{copy.title}</strong>
          </div>
          <button
            type="button"
            aria-label="ปิดแจ้งเตือนเครื่องพิมพ์"
            onClick={() => {
              dismissedSignatureRef.current = signature;
              setStatus(null);
            }}
            style={{
              border: 0,
              background: "#f1f5f9",
              color: "#334155",
              width: 34,
              height: 34,
              borderRadius: 999,
              fontSize: 20,
              fontWeight: 900,
              cursor: "pointer",
              lineHeight: "30px"
            }}
          >
            ×
          </button>
        </div>

        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: "#334155", fontWeight: 700 }}>{copy.detail}</p>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.45, color: "#475569" }}>{copy.actionHint}</p>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap", marginTop: 4 }}>
          <button
            type="button"
            onClick={() => {
              window.dispatchEvent(new CustomEvent(BROWSER_PRINT_AGENT_RESET_EVENT));
              window.setTimeout(() => window.dispatchEvent(new CustomEvent(BROWSER_PRINT_AGENT_CONFIG_EVENT)), 500);
              dismissedSignatureRef.current = signature;
              setStatus(null);
            }}
            style={{
              border: "1px solid #cbd5e1",
              background: "#ffffff",
              color: "#0f172a",
              borderRadius: 12,
              padding: "9px 12px",
              fontWeight: 900,
              cursor: "pointer"
            }}
          >
            รีเซ็ต Agent
          </button>
          <button
            type="button"
            onClick={() => {
              setSnooze();
              dismissedSignatureRef.current = signature;
              setStatus(null);
            }}
            style={{
              border: "1px solid #cbd5e1",
              background: "#ffffff",
              color: "#0f172a",
              borderRadius: 12,
              padding: "9px 12px",
              fontWeight: 900,
              cursor: "pointer"
            }}
          >
            ปิดเตือน 5 นาที
          </button>
          <button
            type="button"
            onClick={() => {
              dismissedSignatureRef.current = signature;
              setStatus(null);
            }}
            style={{
              border: 0,
              background: "#0f172a",
              color: "#ffffff",
              borderRadius: 12,
              padding: "9px 12px",
              fontWeight: 900,
              cursor: "pointer"
            }}
          >
            รับทราบ
          </button>
        </div>
      </div>
    </div>
  );
}
