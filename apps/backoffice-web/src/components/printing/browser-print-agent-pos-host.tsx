"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { BrowserBluetoothPrintAgent, BROWSER_PRINT_AGENT_BLUETOOTH_ENABLED_KEY } from "@/components/printing/browser-bluetooth-print-agent";
import { BrowserPrintAgent } from "@/components/printing/browser-print-agent";
import { BrowserPrintAgentAlert } from "@/components/printing/browser-print-agent-alert";
import { BrowserPrintAgentDeployReset } from "@/components/printing/browser-print-agent-deploy-reset";
import { BrowserPrintAgentSerialRecovery } from "@/components/printing/browser-print-agent-serial-recovery";
import { BrowserPrintAgentSerialSetupGuard } from "@/components/printing/browser-print-agent-serial-setup-guard";

const POS_PATH_PREFIX = "/preview/pos";
const WEB_SERIAL_EXPERIMENTAL_KEY = "cpi_browser_print_agent_web_serial_experimental_v1";
const LEGACY_MOBILE_DIRECT_AGENT_KEY = "cpi_browser_print_agent_mobile_direct_v1";
const PRINT_AGENT_MODE_EVENT = "cpi-browser-print-agent-mode";

type PrintAgentMode =
  | "bridge_print_station"
  | "mobile_remote_station"
  | "web_serial_experimental"
  | "bluetooth_experimental"
  | "unsupported_remote_station";

type PlatformInfo = {
  isMobile: boolean;
  isIos: boolean;
  isAndroid: boolean;
  isDesktop: boolean;
  webSerialSupported: boolean;
  webBluetoothSupported: boolean;
  userAgent: string;
};

function readWebSerialExperimentalOverride() {
  if (typeof window === "undefined") return false;
  return (
    window.localStorage.getItem(WEB_SERIAL_EXPERIMENTAL_KEY) === "1" ||
    window.localStorage.getItem(LEGACY_MOBILE_DIRECT_AGENT_KEY) === "1"
  );
}

function readBluetoothExperimentalOverride() {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(BROWSER_PRINT_AGENT_BLUETOOTH_ENABLED_KEY) === "1";
}

function detectPlatform(): PlatformInfo {
  if (typeof window === "undefined") {
    return {
      isMobile: false,
      isIos: false,
      isAndroid: false,
      isDesktop: true,
      webSerialSupported: false,
      webBluetoothSupported: false,
      userAgent: ""
    };
  }

  const userAgent = window.navigator.userAgent || "";
  const platform = window.navigator.platform || "";
  const maxTouchPoints = window.navigator.maxTouchPoints ?? 0;
  const isAndroid = /Android/i.test(userAgent);
  const isIpadOs = platform === "MacIntel" && maxTouchPoints > 1;
  const isIos = /iPad|iPhone|iPod/i.test(userAgent) || isIpadOs;
  const isMobile = isAndroid || isIos || /Mobile|Tablet/i.test(userAgent);
  const webSerialSupported = "serial" in window.navigator;
  const webBluetoothSupported = "bluetooth" in window.navigator;

  return {
    isMobile,
    isIos,
    isAndroid,
    isDesktop: !isMobile,
    webSerialSupported,
    webBluetoothSupported,
    userAgent
  };
}

function resolveMode(platform: PlatformInfo, allowWebSerialExperimental: boolean, allowBluetoothExperimental: boolean): PrintAgentMode {
  if (allowBluetoothExperimental && platform.webBluetoothSupported) return "bluetooth_experimental";
  if (allowWebSerialExperimental && platform.webSerialSupported) return "web_serial_experimental";
  if (platform.isDesktop) return "bridge_print_station";
  if (platform.isMobile) return "mobile_remote_station";
  return "unsupported_remote_station";
}

function publishMode(mode: PrintAgentMode, platform: PlatformInfo) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(PRINT_AGENT_MODE_EVENT, {
      detail: {
        mode,
        platform: platform.isIos ? "ios" : platform.isAndroid ? "android" : platform.isDesktop ? "desktop" : "unknown",
        webSerialSupported: platform.webSerialSupported,
        webBluetoothSupported: platform.webBluetoothSupported,
        recommendedAdapter:
          mode === "web_serial_experimental"
            ? "WEB_SERIAL_EXPERIMENTAL"
            : mode === "bluetooth_experimental"
              ? "WEB_BLUETOOTH_EXPERIMENTAL"
              : platform.isAndroid
                ? "ANDROID_PRINT_BRIDGE"
                : platform.isIos
                  ? "AIRPRINT_OR_LAN_BRIDGE"
                  : "LOCAL_BRIDGE_WINDOWS",
        updatedAt: new Date().toISOString()
      }
    })
  );
}

export function BrowserPrintAgentPosHost() {
  const pathname = usePathname();
  const [allowWebSerialExperimental, setAllowWebSerialExperimental] = useState(false);
  const [allowBluetoothExperimental, setAllowBluetoothExperimental] = useState(false);
  const platform = useMemo(() => detectPlatform(), []);
  const mode = resolveMode(platform, allowWebSerialExperimental, allowBluetoothExperimental);
  const isPosPath = Boolean(pathname?.startsWith(POS_PATH_PREFIX));
  const shouldRunWebSerialAgent = mode === "web_serial_experimental";
  const shouldRunBluetoothAgent = mode === "bluetooth_experimental";

  useEffect(() => {
    setAllowWebSerialExperimental(readWebSerialExperimentalOverride());
    setAllowBluetoothExperimental(readBluetoothExperimentalOverride());

    function handleStorage(event: StorageEvent) {
      if (event.key === WEB_SERIAL_EXPERIMENTAL_KEY || event.key === LEGACY_MOBILE_DIRECT_AGENT_KEY) {
        setAllowWebSerialExperimental(readWebSerialExperimentalOverride());
      }
      if (event.key === BROWSER_PRINT_AGENT_BLUETOOTH_ENABLED_KEY) {
        setAllowBluetoothExperimental(readBluetoothExperimentalOverride());
      }
    }

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  useEffect(() => {
    if (!isPosPath) return;
    publishMode(mode, platform);
  }, [isPosPath, mode, platform]);

  if (!isPosPath) {
    return null;
  }

  return (
    <>
      {shouldRunWebSerialAgent ? <BrowserPrintAgentSerialSetupGuard /> : null}
      {shouldRunWebSerialAgent ? <BrowserPrintAgentDeployReset /> : null}
      {shouldRunWebSerialAgent ? <BrowserPrintAgentSerialRecovery /> : null}
      {shouldRunWebSerialAgent ? <BrowserPrintAgent /> : null}
      {shouldRunBluetoothAgent ? <BrowserBluetoothPrintAgent /> : null}
      {shouldRunWebSerialAgent || shouldRunBluetoothAgent ? <BrowserPrintAgentAlert /> : null}
    </>
  );
}
