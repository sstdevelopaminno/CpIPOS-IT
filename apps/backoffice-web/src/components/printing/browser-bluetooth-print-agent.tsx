"use client";

import { useEffect, useRef, useState } from "react";
import {
  BROWSER_PRINT_AGENT_CONFIG_EVENT,
  BROWSER_PRINT_AGENT_KEY,
  BROWSER_PRINT_AGENT_RESET_EVENT,
  BROWSER_PRINT_AGENT_STATUS_EVENT,
  type BrowserPrintAgentStatus
} from "@/components/printing/browser-print-agent";
import {
  bytesForCashDrawer,
  bytesForReceipt,
  dispatchStatus as dispatchSharedStatus,
  isCashDrawerJob,
  postAgentApi,
  sleep,
  type ClaimResponse
} from "@/components/printing/browser-print-shared";

export const BROWSER_PRINT_AGENT_BLUETOOTH_ENABLED_KEY = "cpi_browser_print_agent_bluetooth_enabled_v1";
export const BROWSER_PRINT_AGENT_BLUETOOTH_SERVICE_UUID_KEY = "cpi_browser_print_agent_bluetooth_service_uuid_v1";
export const BROWSER_PRINT_AGENT_BLUETOOTH_CHARACTERISTIC_UUID_KEY = "cpi_browser_print_agent_bluetooth_characteristic_uuid_v1";
export const BROWSER_PRINT_AGENT_BLUETOOTH_DEVICE_NAME_KEY = "cpi_browser_print_agent_bluetooth_device_name_v1";
export const BROWSER_PRINT_AGENT_BLUETOOTH_CONNECT_EVENT = "cpi-browser-print-agent-bluetooth-connect";

// There is no single standard GATT profile for ESC/POS thermal printers over Bluetooth Low
// Energy. These are the service/write-characteristic UUID pairs most commonly reused by
// low-cost thermal printer BLE modules. When the operator has not entered an explicit override
// for their exact printer model, the agent probes this list in order and keeps whichever pair
// resolves successfully.
const DEFAULT_UUID_CANDIDATES: Array<{ service: string; characteristic: string }> = [
  { service: "000018f0-0000-1000-8000-00805f9b34fb", characteristic: "00002af1-0000-1000-8000-00805f9b34fb" },
  { service: "0000ffe0-0000-1000-8000-00805f9b34fb", characteristic: "0000ffe1-0000-1000-8000-00805f9b34fb" },
  { service: "49535343-fe7d-4ae5-8fa9-9fafd205e455", characteristic: "49535343-8841-43f4-a8d4-ecbe34729bb3" },
  { service: "6e400001-b5a3-f393-e0a9-e50e24dcca9e", characteristic: "6e400002-b5a3-f393-e0a9-e50e24dcca9e" }
];

// Cheap BLE printer modules often drop bytes if flooded, especially without a negotiated MTU.
// Writing in small chunks with a short delay between them is the standard practical workaround.
const WRITE_CHUNK_BYTES = 100;
const WRITE_CHUNK_DELAY_MS = 20;

const POLL_MS = 4000;
const HIDDEN_POLL_MS = 15000;
const MAX_ERROR_BACKOFF_MS = 60000;
const APP_VERSION = "browser-web-bluetooth-1.0.0";

type BluetoothRemoteGATTCharacteristicLike = {
  properties?: { writeWithoutResponse?: boolean; write?: boolean };
  writeValueWithoutResponse?: (value: BufferSource) => Promise<void>;
  writeValue: (value: BufferSource) => Promise<void>;
};

type BluetoothRemoteGATTServiceLike = {
  getCharacteristic(characteristic: string): Promise<BluetoothRemoteGATTCharacteristicLike>;
};

type BluetoothRemoteGATTServerLike = {
  connected: boolean;
  connect(): Promise<BluetoothRemoteGATTServerLike>;
  disconnect(): void;
  getPrimaryService(service: string): Promise<BluetoothRemoteGATTServiceLike>;
};

type BluetoothDeviceLike = {
  id: string;
  name?: string;
  gatt?: BluetoothRemoteGATTServerLike;
  addEventListener(type: "gattserverdisconnected", listener: EventListener): void;
  removeEventListener(type: "gattserverdisconnected", listener: EventListener): void;
};

type RequestDeviceOptions = {
  acceptAllDevices?: boolean;
  filters?: Array<{ services?: string[]; name?: string; namePrefix?: string }>;
  optionalServices?: string[];
};

type BluetoothLike = {
  getAvailability?: () => Promise<boolean>;
  getDevices?: () => Promise<BluetoothDeviceLike[]>;
  requestDevice(options: RequestDeviceOptions): Promise<BluetoothDeviceLike>;
};

declare global {
  interface Navigator {
    bluetooth?: BluetoothLike;
  }
}

function readConfig() {
  if (typeof window === "undefined") {
    return { enabled: false, agentKey: "", serviceUuid: "", characteristicUuid: "" };
  }
  return {
    enabled: window.localStorage.getItem(BROWSER_PRINT_AGENT_BLUETOOTH_ENABLED_KEY) === "1",
    agentKey: window.localStorage.getItem(BROWSER_PRINT_AGENT_KEY)?.trim() ?? "",
    serviceUuid: window.localStorage.getItem(BROWSER_PRINT_AGENT_BLUETOOTH_SERVICE_UUID_KEY)?.trim() ?? "",
    characteristicUuid: window.localStorage.getItem(BROWSER_PRINT_AGENT_BLUETOOTH_CHARACTERISTIC_UUID_KEY)?.trim() ?? ""
  };
}

function dispatchStatus(status: Omit<BrowserPrintAgentStatus, "updatedAt">) {
  dispatchSharedStatus(BROWSER_PRINT_AGENT_STATUS_EVENT, status);
}

function candidateUuidPairs(configured: { serviceUuid: string; characteristicUuid: string }) {
  if (configured.serviceUuid && configured.characteristicUuid) {
    return [{ service: configured.serviceUuid, characteristic: configured.characteristicUuid }];
  }
  return DEFAULT_UUID_CANDIDATES;
}

async function resolveWriteCharacteristic(
  server: BluetoothRemoteGATTServerLike,
  configured: { serviceUuid: string; characteristicUuid: string }
): Promise<BluetoothRemoteGATTCharacteristicLike> {
  const candidates = candidateUuidPairs(configured);
  let lastError: unknown = null;
  for (const candidate of candidates) {
    try {
      const service = await server.getPrimaryService(candidate.service);
      const characteristic = await service.getCharacteristic(candidate.characteristic);
      return characteristic;
    } catch (error) {
      lastError = error;
    }
  }
  const hint =
    candidates.length > 1
      ? "ลองรูปแบบ UUID ที่พบบ่อยแล้วไม่พบ กรุณาระบุ Service/Characteristic UUID ของเครื่องพิมพ์รุ่นนี้ในหน้าตั้งค่า"
      : "ไม่พบ Service/Characteristic UUID ที่ระบุไว้บนเครื่องพิมพ์นี้";
  throw new Error(`bluetooth_gatt_service_not_found: ${hint}${lastError instanceof Error ? ` (${lastError.message})` : ""}`);
}

async function writeBytesInChunks(characteristic: BluetoothRemoteGATTCharacteristicLike, bytes: Uint8Array) {
  const canWriteWithoutResponse = Boolean(characteristic.properties?.writeWithoutResponse && characteristic.writeValueWithoutResponse);
  for (let offset = 0; offset < bytes.length; offset += WRITE_CHUNK_BYTES) {
    const chunk = bytes.slice(offset, offset + WRITE_CHUNK_BYTES);
    if (canWriteWithoutResponse && characteristic.writeValueWithoutResponse) {
      await characteristic.writeValueWithoutResponse(chunk);
    } else {
      await characteristic.writeValue(chunk);
    }
    if (offset + WRITE_CHUNK_BYTES < bytes.length) {
      await sleep(WRITE_CHUNK_DELAY_MS);
    }
  }
}

type EnsureConnectionResult =
  | { ok: true; characteristic: BluetoothRemoteGATTCharacteristicLike; deviceName: string }
  | { ok: false; code: string; message: string };

export function BrowserBluetoothPrintAgent() {
  const [config, setConfig] = useState(readConfig);
  const [needsPairing, setNeedsPairing] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const deviceRef = useRef<BluetoothDeviceLike | null>(null);
  const characteristicRef = useRef<BluetoothRemoteGATTCharacteristicLike | null>(null);
  const jobsPrintedRef = useRef(0);
  const lastJobIdRef = useRef<string | null>(null);

  useEffect(() => {
    const reload = () => setConfig(readConfig());
    const onStorage = (event: StorageEvent) => {
      if (
        event.key === BROWSER_PRINT_AGENT_BLUETOOTH_ENABLED_KEY ||
        event.key === BROWSER_PRINT_AGENT_KEY ||
        event.key === BROWSER_PRINT_AGENT_BLUETOOTH_SERVICE_UUID_KEY ||
        event.key === BROWSER_PRINT_AGENT_BLUETOOTH_CHARACTERISTIC_UUID_KEY
      ) {
        reload();
      }
    };
    window.addEventListener(BROWSER_PRINT_AGENT_CONFIG_EVENT, reload);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(BROWSER_PRINT_AGENT_CONFIG_EVENT, reload);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    const reset = () => {
      const device = deviceRef.current;
      deviceRef.current = null;
      characteristicRef.current = null;
      jobsPrintedRef.current = 0;
      lastJobIdRef.current = null;
      if (device?.gatt?.connected) {
        try {
          device.gatt.disconnect();
        } catch {
          // Ignore disconnect errors on an already-torn-down device.
        }
      }
    };
    window.addEventListener(BROWSER_PRINT_AGENT_RESET_EVENT, reset);
    return () => window.removeEventListener(BROWSER_PRINT_AGENT_RESET_EVENT, reset);
  }, []);

  useEffect(() => {
    let active = true;
    let timer: number | null = null;
    let errorStreak = 0;
    const supported = typeof navigator !== "undefined" && Boolean(navigator.bluetooth);

    const publish = (code: string, message: string, connected: boolean) => {
      dispatchStatus({
        enabled: config.enabled,
        supported,
        connected,
        code,
        message,
        jobsPrinted: jobsPrintedRef.current,
        lastJobId: lastJobIdRef.current
      });
    };

    const scheduleNext = (delayMs: number) => {
      if (!active) return;
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(tick, delayMs);
    };

    const handleDisconnected = () => {
      characteristicRef.current = null;
    };

    const ensureConnection = async (): Promise<EnsureConnectionResult> => {
      if (characteristicRef.current && deviceRef.current?.gatt?.connected) {
        return { ok: true, characteristic: characteristicRef.current, deviceName: deviceRef.current.name ?? "Bluetooth printer" };
      }

      const bluetooth = navigator.bluetooth;
      if (!bluetooth) {
        return { ok: false, code: "bluetooth_unsupported", message: "เบราว์เซอร์นี้ไม่รองรับ Web Bluetooth" };
      }

      let device = deviceRef.current;
      if (!device || !device.gatt) {
        const known = (await bluetooth.getDevices?.().catch(() => [])) ?? [];
        device = known[0] ?? null;
        if (device) {
          device.addEventListener("gattserverdisconnected", handleDisconnected);
          deviceRef.current = device;
        }
      }

      if (!device || !device.gatt) {
        setNeedsPairing(true);
        return {
          ok: false,
          code: "bluetooth_permission_required",
          message: "ยังไม่ได้จับคู่เครื่องพิมพ์ Bluetooth กรุณากดปุ่มเชื่อมต่อเครื่องพิมพ์"
        };
      }

      setNeedsPairing(false);
      try {
        const server = device.gatt.connected ? device.gatt : await device.gatt.connect();
        const characteristic = await resolveWriteCharacteristic(server, config);
        characteristicRef.current = characteristic;
        if (device.name) {
          window.localStorage.setItem(BROWSER_PRINT_AGENT_BLUETOOTH_DEVICE_NAME_KEY, device.name);
        }
        return { ok: true, characteristic, deviceName: device.name ?? "Bluetooth printer" };
      } catch (error) {
        const message = error instanceof Error ? error.message : "bluetooth_gatt_connect_failed";
        return { ok: false, code: "bluetooth_gatt_connect_failed", message };
      }
    };

    const tick = async () => {
      if (!active) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        scheduleNext(HIDDEN_POLL_MS);
        return;
      }
      try {
        if (!config.enabled) {
          publish("disabled", "Bluetooth Print Agent is disabled.", false);
          return;
        }
        if (!supported) {
          publish("bluetooth_unsupported", "เบราว์เซอร์นี้ไม่รองรับ Web Bluetooth", false);
          return;
        }
        if (!config.agentKey) {
          publish("agent_key_missing", "Print Agent secret is missing.", false);
          return;
        }

        const connection = await ensureConnection();
        if (!connection.ok) {
          publish(connection.code, connection.message, false);
          return;
        }

        const claim = await postAgentApi<ClaimResponse>("/api/print-agent/v1/jobs/claim", config.agentKey, {
          limit: 3,
          lease_seconds: 45,
          app_version: APP_VERSION
        });
        if (!claim.response.ok || claim.body?.error) throw new Error(claim.body?.error?.message ?? `claim_failed_${claim.response.status}`);

        const jobs = claim.body?.data?.jobs ?? [];
        for (const job of jobs) {
          try {
            const bytes = isCashDrawerJob(job) ? bytesForCashDrawer() : await bytesForReceipt(job);
            await writeBytesInChunks(connection.characteristic, bytes);
            await postAgentApi(`/api/print-agent/v1/jobs/${encodeURIComponent(job.id)}/ack`, config.agentKey, {
              provider_job_id: `bluetooth:${Date.now()}`,
              bytes_sent: bytes.length,
              metadata: { provider: "browser_web_bluetooth", device_name: connection.deviceName, app_version: APP_VERSION }
            });
            jobsPrintedRef.current += 1;
            lastJobIdRef.current = job.id;
          } catch (jobError) {
            lastJobIdRef.current = job.id;
            const message = jobError instanceof Error ? jobError.message : "browser_bluetooth_print_failed";
            characteristicRef.current = null;
            await postAgentApi(`/api/print-agent/v1/jobs/${encodeURIComponent(job.id)}/fail`, config.agentKey, {
              error_message: message,
              error_code: "browser_bluetooth_print_failed",
              retryable: true,
              metadata: { provider: "browser_web_bluetooth", app_version: APP_VERSION }
            });
            publish("browser_bluetooth_print_failed", message, false);
          }
        }

        errorStreak = 0;
        publish(jobs.length > 0 ? "printed" : "ready", jobs.length > 0 ? `Printed ${jobs.length} job(s).` : "Ready.", true);
      } catch (error) {
        errorStreak = Math.min(errorStreak + 1, 10);
        publish("agent_error", error instanceof Error ? error.message : "Bluetooth Print Agent failed.", false);
      } finally {
        const backoffDelay = errorStreak > 0 ? Math.min(POLL_MS * 2 ** errorStreak, MAX_ERROR_BACKOFF_MS) : POLL_MS;
        scheduleNext(backoffDelay);
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void tick();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    void tick();
    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      deviceRef.current?.removeEventListener("gattserverdisconnected", handleDisconnected);
    };
  }, [config]);

  async function handleConnectClick() {
    const bluetooth = navigator.bluetooth;
    if (!bluetooth) return;
    setConnecting(true);
    try {
      const allServices = Array.from(new Set(DEFAULT_UUID_CANDIDATES.flatMap((pair) => [pair.service, pair.characteristic])));
      if (config.serviceUuid) allServices.push(config.serviceUuid);
      if (config.characteristicUuid) allServices.push(config.characteristicUuid);

      const device = await bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: allServices
      });
      device.addEventListener("gattserverdisconnected", () => {
        characteristicRef.current = null;
      });
      deviceRef.current = device;
      characteristicRef.current = null;
      setNeedsPairing(false);
      window.dispatchEvent(new Event(BROWSER_PRINT_AGENT_CONFIG_EVENT));
    } catch {
      // User cancelled the device chooser, or the browser rejected the request. Leave state as-is.
    } finally {
      setConnecting(false);
    }
  }

  if (!config.enabled || !needsPairing) return null;

  return (
    <button
      type="button"
      onClick={() => void handleConnectClick()}
      disabled={connecting}
      style={{
        position: "fixed",
        right: 18,
        bottom: 18,
        zIndex: 2147483646,
        border: 0,
        borderRadius: 999,
        padding: "14px 20px",
        background: "#0f172a",
        color: "#ffffff",
        fontWeight: 900,
        fontSize: 14,
        boxShadow: "0 12px 40px rgba(15, 23, 42, 0.35)",
        cursor: connecting ? "wait" : "pointer"
      }}
    >
      {connecting ? "กำลังเชื่อมต่อ..." : "เชื่อมต่อเครื่องพิมพ์ Bluetooth"}
    </button>
  );
}
