"use client";

import { useEffect } from "react";

const BROWSER_PRINT_AGENT_CONFIG_EVENT = "cpi-browser-print-agent-config";
const BROWSER_PRINT_AGENT_RESET_EVENT = "cpi-browser-print-agent-reset";
const BROWSER_PRINT_AGENT_FORGET_PORTS_EVENT = "cpi-browser-print-agent-forget-ports";
const BROWSER_PRINT_AGENT_STATUS_EVENT = "cpi-browser-print-agent-status";
const BROWSER_PRINT_AGENT_ENABLED_KEY = "cpi_browser_print_agent_enabled_v1";
const BROWSER_PRINT_AGENT_SETUP_GUARD_ACTIVE_KEY = "cpi_browser_print_agent_setup_guard_active_until_v1";
const BROWSER_PRINT_AGENT_SETUP_GUARD_PREVIOUS_ENABLED_KEY = "cpi_browser_print_agent_setup_guard_previous_enabled_v1";
const DISABLE_DIRECT_WEB_SERIAL_KEY = "cpi_disable_direct_web_serial_v1";

const MANUAL_SETUP_PAUSE_MS = 25000;

type SerialPortLike = {
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  writable: WritableStream<Uint8Array> | null;
  forget?: () => Promise<void>;
};

type SerialLike = {
  getPorts(): Promise<SerialPortLike[]>;
  requestPort(options?: unknown): Promise<SerialPortLike>;
};

type NavigatorWithOptionalSerial = Navigator & {
  serial?: SerialLike;
};

function getSerial() {
  return (window.navigator as NavigatorWithOptionalSerial).serial;
}

function nowPlus(ms: number) {
  return String(Date.now() + ms);
}

function dispatchConfigReload(delayMs = 0) {
  window.setTimeout(() => window.dispatchEvent(new CustomEvent(BROWSER_PRINT_AGENT_CONFIG_EVENT)), delayMs);
}

function dispatchReset(delayMs = 0) {
  window.setTimeout(() => window.dispatchEvent(new CustomEvent(BROWSER_PRINT_AGENT_RESET_EVENT)), delayMs);
}

function dispatchForgetPorts(delayMs = 0) {
  window.setTimeout(() => window.dispatchEvent(new CustomEvent(BROWSER_PRINT_AGENT_FORGET_PORTS_EVENT)), delayMs);
}

function dispatchStatus(code: string, message: string) {
  window.dispatchEvent(
    new CustomEvent(BROWSER_PRINT_AGENT_STATUS_EVENT, {
      detail: {
        enabled: false,
        supported: Boolean(getSerial()),
        connected: false,
        code,
        message,
        jobsPrinted: 0,
        lastJobId: null,
        updatedAt: new Date().toISOString()
      }
    })
  );
}

function directWebSerialDisabled() {
  // Default to disabled because this hardware/browser combination repeatedly locks SerialPort.open().
  // A technician can explicitly re-enable direct Web Serial in DevTools with:
  // localStorage.setItem("cpi_disable_direct_web_serial_v1", "0")
  return window.localStorage.getItem(DISABLE_DIRECT_WEB_SERIAL_KEY) !== "0";
}

function rememberAndPauseAgent() {
  const currentlyEnabled = window.localStorage.getItem(BROWSER_PRINT_AGENT_ENABLED_KEY);
  window.localStorage.setItem(BROWSER_PRINT_AGENT_SETUP_GUARD_PREVIOUS_ENABLED_KEY, currentlyEnabled ?? "");
  window.localStorage.setItem(BROWSER_PRINT_AGENT_SETUP_GUARD_ACTIVE_KEY, nowPlus(MANUAL_SETUP_PAUSE_MS));
  window.localStorage.setItem(BROWSER_PRINT_AGENT_ENABLED_KEY, "0");
  dispatchReset();
  dispatchForgetPorts(150);
  dispatchConfigReload(250);
}

function resumeAgentLater() {
  const previousEnabled = window.localStorage.getItem(BROWSER_PRINT_AGENT_SETUP_GUARD_PREVIOUS_ENABLED_KEY);
  window.setTimeout(() => {
    window.localStorage.removeItem(BROWSER_PRINT_AGENT_SETUP_GUARD_ACTIVE_KEY);
    window.localStorage.removeItem(BROWSER_PRINT_AGENT_SETUP_GUARD_PREVIOUS_ENABLED_KEY);
    if (previousEnabled === "1" || previousEnabled === "true") {
      window.localStorage.setItem(BROWSER_PRINT_AGENT_ENABLED_KEY, "1");
    }
    dispatchConfigReload();
    dispatchConfigReload(1500);
  }, MANUAL_SETUP_PAUSE_MS);
}

async function forgetAuthorizedPorts(serial: SerialLike) {
  const ports = await serial.getPorts().catch(() => []);
  await Promise.allSettled(
    ports.map(async (port) => {
      try {
        await port.close();
      } catch {
        // ignore stale close errors
      }
      if (typeof port.forget === "function") {
        await port.forget().catch(() => undefined);
      }
    })
  );
}

function looksLikeDirectSerialButton(target: EventTarget | null) {
  const element = target instanceof Element ? target.closest("button,a,[role='button']") : null;
  const text = element?.textContent?.replace(/\s+/g, " ").trim() ?? "";
  return /เลือกเครื่องจาก Windows|ทดสอบ Web Serial|Use Browser Agent|Browser Agent|Web Serial/i.test(text);
}

function blockDirectSerialUi(event: Event) {
  if (!directWebSerialDisabled()) return;
  if (!looksLikeDirectSerialButton(event.target)) return;

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  rememberAndPauseAgent();
  dispatchStatus(
    "direct_web_serial_disabled_use_bridge",
    "ปิดการเชื่อมต่อ Web Serial โดยตรงแล้ว ให้ใช้ Local Bridge http://127.0.0.1:3210/print เป็นเส้นหลักเพื่อหลีกเลี่ยง SerialPort.open ค้าง"
  );
}

export function BrowserPrintAgentSerialSetupGuard() {
  useEffect(() => {
    const serial = getSerial();

    window.addEventListener("click", blockDirectSerialUi, true);
    window.addEventListener("pointerdown", blockDirectSerialUi, true);

    if (!serial) {
      return () => {
        window.removeEventListener("click", blockDirectSerialUi, true);
        window.removeEventListener("pointerdown", blockDirectSerialUi, true);
      };
    }

    const originalRequestPort = serial.requestPort.bind(serial);
    let patched = true;

    serial.requestPort = async (options?: unknown) => {
      if (directWebSerialDisabled()) {
        rememberAndPauseAgent();
        await forgetAuthorizedPorts(serial);
        dispatchStatus(
          "direct_web_serial_disabled_use_bridge",
          "ปิดการเลือกพอร์ต Web Serial โดยตรงแล้ว กรุณาใช้ Local Bridge / Print Station แทน"
        );
        throw new DOMException("Direct Web Serial is disabled. Use Local Bridge instead.", "NotAllowedError");
      }

      rememberAndPauseAgent();
      await forgetAuthorizedPorts(serial);
      await new Promise((resolve) => window.setTimeout(resolve, 450));
      try {
        const port = await originalRequestPort(options);
        window.localStorage.setItem(BROWSER_PRINT_AGENT_SETUP_GUARD_ACTIVE_KEY, nowPlus(MANUAL_SETUP_PAUSE_MS));
        return port;
      } finally {
        resumeAgentLater();
      }
    };

    return () => {
      window.removeEventListener("click", blockDirectSerialUi, true);
      window.removeEventListener("pointerdown", blockDirectSerialUi, true);
      if (!patched) return;
      patched = false;
      serial.requestPort = originalRequestPort;
    };
  }, []);

  return null;
}
