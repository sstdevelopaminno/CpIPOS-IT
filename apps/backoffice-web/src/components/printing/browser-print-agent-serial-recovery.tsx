"use client";

import { useEffect, useRef } from "react";

const BROWSER_PRINT_AGENT_STATUS_EVENT = "cpi-browser-print-agent-status";
const BROWSER_PRINT_AGENT_CONFIG_EVENT = "cpi-browser-print-agent-config";
const BROWSER_PRINT_AGENT_RESET_EVENT = "cpi-browser-print-agent-reset";
export const BROWSER_PRINT_AGENT_ALERT_SNOOZE_UNTIL_KEY = "cpi_browser_print_agent_alert_snooze_until_v1";

const SERIAL_RECOVERY_COOLDOWN_MS = 8000;
const SERIAL_TRANSIENT_SNOOZE_MS = 30000;

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

type SerialEventTarget = EventTarget & {
  addEventListener(type: "connect" | "disconnect", listener: EventListener): void;
  removeEventListener(type: "connect" | "disconnect", listener: EventListener): void;
};

type NavigatorWithSerial = Navigator & {
  serial?: SerialEventTarget;
};

function setAlertSnooze(ms = SERIAL_TRANSIENT_SNOOZE_MS) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(BROWSER_PRINT_AGENT_ALERT_SNOOZE_UNTIL_KEY, String(Date.now() + ms));
}

function clearAlertSnooze() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(BROWSER_PRINT_AGENT_ALERT_SNOOZE_UNTIL_KEY);
}

function dispatchAgentReset() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(BROWSER_PRINT_AGENT_RESET_EVENT));
}

function dispatchAgentConfigReload() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(BROWSER_PRINT_AGENT_CONFIG_EVENT));
}

function looksLikeSerialOpenFailure(status: BrowserPrintAgentStatus) {
  const text = `${status.code} ${status.message}`.toLowerCase();
  return (
    status.code === "serial_port_not_writable" ||
    status.code === "printer_offline" ||
    (status.code === "agent_error" && (text.includes("serialport") || text.includes("serial port") || text.includes("failed to open")))
  );
}

export function BrowserPrintAgentSerialRecovery() {
  const lastRecoveryAtRef = useRef(0);

  useEffect(() => {
    const serial = (navigator as NavigatorWithSerial).serial;
    if (!serial) return undefined;

    const requestRecovery = (options: { snooze?: boolean; immediate?: boolean } = {}) => {
      const now = Date.now();
      if (!options.immediate && now - lastRecoveryAtRef.current < SERIAL_RECOVERY_COOLDOWN_MS) return;
      lastRecoveryAtRef.current = now;
      if (options.snooze) setAlertSnooze();
      dispatchAgentReset();
      window.setTimeout(dispatchAgentConfigReload, 250);
      window.setTimeout(dispatchAgentConfigReload, 2500);
      window.setTimeout(dispatchAgentConfigReload, 8000);
    };

    const handleDisconnect = () => {
      requestRecovery({ snooze: true, immediate: true });
    };

    const handleConnect = () => {
      clearAlertSnooze();
      requestRecovery({ immediate: true });
    };

    const handleStatus = (event: Event) => {
      const detail = (event as CustomEvent<BrowserPrintAgentStatus>).detail;
      if (!detail || !detail.enabled) return;
      if (detail.code === "ready" || detail.code === "printed") {
        clearAlertSnooze();
        return;
      }
      if (!looksLikeSerialOpenFailure(detail)) return;
      requestRecovery({ snooze: true });
    };

    serial.addEventListener("disconnect", handleDisconnect);
    serial.addEventListener("connect", handleConnect);
    window.addEventListener(BROWSER_PRINT_AGENT_STATUS_EVENT, handleStatus);

    return () => {
      serial.removeEventListener("disconnect", handleDisconnect);
      serial.removeEventListener("connect", handleConnect);
      window.removeEventListener(BROWSER_PRINT_AGENT_STATUS_EVENT, handleStatus);
    };
  }, []);

  return null;
}
