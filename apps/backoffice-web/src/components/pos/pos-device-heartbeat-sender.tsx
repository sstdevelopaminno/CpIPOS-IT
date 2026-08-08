"use client";

import { useEffect, useRef } from "react";
import {
  buildHeartbeatPayload,
  detectSurface,
  executePendingActions,
  resolveDeviceCode,
  resolveMachineId,
  sendDeviceHeartbeat,
  type DeviceHeartbeatReason
} from "@/lib/pos/device-heartbeat-client";

type SessionCurrentResponse = {
  data?: {
    device?: { code?: string | null } | null;
  } | null;
};

const STARTUP_DELAY_MS = 15_000;
const HEARTBEAT_INTERVAL_MS = 5 * 60_000;
const HEARTBEAT_MIN_GAP_MS = 60_000;

async function loadSessionDeviceCode(): Promise<string | null> {
  try {
    const response = await fetch("/api/pos/session/current", { cache: "no-store", credentials: "include" });
    if (!response.ok) return null;
    const body = (await response.json()) as SessionCurrentResponse;
    return body.data?.device?.code ?? null;
  } catch {
    return null;
  }
}

export function PosDeviceHeartbeatSender() {
  const inFlightRef = useRef(false);
  const lastSentAtRef = useRef(0);
  const startedAtRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let deviceCode = "POS-DEVICE";
    let machineId = "";
    startedAtRef.current = Date.now();

    async function send(reason: DeviceHeartbeatReason) {
      if (cancelled || inFlightRef.current) return;
      const now = Date.now();
      if (reason !== "startup" && now - lastSentAtRef.current < HEARTBEAT_MIN_GAP_MS) return;

      inFlightRef.current = true;
      try {
        const surface = detectSurface();
        const payload = await buildHeartbeatPayload({
          surface,
          deviceCode,
          machineId,
          startedAt: startedAtRef.current,
          reason
        });
        if (!cancelled) {
          const pendingActions = await sendDeviceHeartbeat(payload);
          lastSentAtRef.current = Date.now();
          if (pendingActions.length > 0) {
            await executePendingActions(pendingActions);
          }
        }
      } finally {
        inFlightRef.current = false;
      }
    }

    let startupTimer: number | undefined;
    let intervalTimer: number | undefined;

    async function init() {
      const surface = detectSurface();
      machineId = resolveMachineId(surface);
      const sessionDeviceCode = await loadSessionDeviceCode();
      if (cancelled) return;
      deviceCode = resolveDeviceCode(surface, sessionDeviceCode);

      startupTimer = window.setTimeout(() => void send("startup"), STARTUP_DELAY_MS);
      intervalTimer = window.setInterval(() => void send("interval"), HEARTBEAT_INTERVAL_MS);
    }

    function handleOnline() {
      void send("online");
    }

    function handleOffline() {
      void send("offline");
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") void send("visible");
    }

    void init();
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      if (startupTimer !== undefined) window.clearTimeout(startupTimer);
      if (intervalTimer !== undefined) window.clearInterval(intervalTimer);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  return null;
}
