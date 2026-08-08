import type {
  DeviceMdmConnectivity,
  DeviceMdmOfflineSaleHealth,
  DeviceMdmPeripheralHealth,
  DeviceMdmRuntimeHealth,
  DeviceMdmSecuritySignal,
  DeviceMdmSystemHealth
} from "@/lib/device-mdm-diagnostics";
import { UNSUPPORTED_DEVICE_COMMAND_TYPES, type PendingDeviceAction } from "@/lib/device-commands";

type WindowsRuntimeGlobal = {
  store_code?: string;
  device_code?: string;
  native_app_version?: string;
  native_bridge_version?: string;
  bridge_health_url?: string;
};

type BridgeHealthResponse = {
  ok?: boolean;
  bridge_version?: string;
  port?: number;
  token_required?: boolean;
  request_slots_available?: number;
  print_queue_busy?: boolean;
  drawer_queue_busy?: boolean;
  printed_jobs?: number;
  failed_jobs?: number;
  drawer_commands?: number;
  last_error?: string;
  system_default_printer?: string;
  resolved_printer?: string;
  configured_printer?: string;
  selected_printer_valid?: boolean;
  supports_cash_drawer?: boolean;
  last_print_at?: string;
  last_drawer_at?: string;
  last_drawer_device?: string;
  uptime_seconds?: number;
};

export type DeviceHeartbeatSurface = "windows_runtime" | "android" | "browser";

export type DeviceHeartbeatReason = "startup" | "interval" | "online" | "offline" | "visible";

export type DeviceHeartbeatPayload = {
  identity: {
    device_code: string;
    machine_id: string;
    hostname?: string | null;
    windows_username?: string | null;
    runtime_version?: string | null;
    app_version?: string | null;
  };
  connectivity: DeviceMdmConnectivity;
  system: DeviceMdmSystemHealth;
  runtime: DeviceMdmRuntimeHealth;
  peripherals: DeviceMdmPeripheralHealth;
  offline_sale?: DeviceMdmOfflineSaleHealth | null;
  security_signals?: DeviceMdmSecuritySignal[];
  metadata: Record<string, unknown>;
  captured_at: string;
};

const WINDOWS_RUNTIME_DEVICE_CODE_KEY = "cpi_pos_device_code_v1";
const WINDOWS_RUNTIME_SELECTED_DEVICE_CODE_KEY = "cpi_selected_device_code_v1";
const WINDOWS_RUNTIME_MACHINE_ID_KEY = "cpi_windows_runtime_machine_id_v1";
const WEB_MACHINE_ID_KEY = "cpi_web_pos_machine_id_v1";

function getWindowsRuntimeGlobal(): WindowsRuntimeGlobal | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { CpIPOSWindowsRuntime?: WindowsRuntimeGlobal }).CpIPOSWindowsRuntime ?? null;
}

function getAndroidBridgeGlobal(): unknown {
  if (typeof window === "undefined") return null;
  return (window as unknown as { CpIPOSBridge?: unknown }).CpIPOSBridge ?? null;
}

export function detectSurface(): DeviceHeartbeatSurface {
  if (getWindowsRuntimeGlobal()) return "windows_runtime";
  if (getAndroidBridgeGlobal()) return "android";
  return "browser";
}

function readLocalStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocalStorage(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage unavailable (private mode, quota) - heartbeat still sends with an in-memory id.
  }
}

function randomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function resolveMachineId(surface: DeviceHeartbeatSurface): string {
  const key = surface === "windows_runtime" ? WINDOWS_RUNTIME_MACHINE_ID_KEY : WEB_MACHINE_ID_KEY;
  const existing = readLocalStorage(key);
  if (existing) return existing;
  const prefix = surface === "windows_runtime" ? "win" : surface === "android" ? "and" : "web";
  const generated = `${prefix}-${randomId()}`;
  writeLocalStorage(key, generated);
  return generated;
}

export function resolveDeviceCode(surface: DeviceHeartbeatSurface, sessionDeviceCode: string | null): string {
  if (surface === "windows_runtime") {
    const stored = readLocalStorage(WINDOWS_RUNTIME_DEVICE_CODE_KEY) ?? readLocalStorage(WINDOWS_RUNTIME_SELECTED_DEVICE_CODE_KEY);
    if (stored) return stored;
  }
  return sessionDeviceCode ?? "POS-DEVICE";
}

async function readBridgeHealth(url: string | undefined): Promise<BridgeHealthResponse | null> {
  if (!url) return null;
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return null;
    return (await response.json()) as BridgeHealthResponse;
  } catch {
    return null;
  }
}

export type BuildHeartbeatPayloadInput = {
  surface: DeviceHeartbeatSurface;
  deviceCode: string;
  machineId: string;
  startedAt: number;
  reason: DeviceHeartbeatReason;
};

export async function buildHeartbeatPayload(input: BuildHeartbeatPayloadInput): Promise<DeviceHeartbeatPayload> {
  const { surface, deviceCode, machineId, startedAt, reason } = input;
  const capturedAt = new Date().toISOString();
  const runtimeGlobal = surface === "windows_runtime" ? getWindowsRuntimeGlobal() : null;
  const bridge = runtimeGlobal ? await readBridgeHealth(runtimeGlobal.bridge_health_url) : null;
  const browserOnline = typeof navigator === "undefined" ? true : navigator.onLine;

  return {
    identity: {
      device_code: deviceCode,
      machine_id: machineId,
      hostname: null,
      windows_username: null,
      runtime_version: runtimeGlobal?.native_bridge_version ?? bridge?.bridge_version ?? null,
      app_version: runtimeGlobal?.native_app_version ?? null
    },
    connectivity: {
      internet_online: browserOnline,
      server_reachable: true,
      dns_healthy: null,
      network_type: surface,
      ip_address: null,
      latency_ms: Date.now() - startedAt,
      offline_since: null,
      last_seen_at: capturedAt
    },
    system: {
      os_name: surface === "android" ? "Android" : surface === "windows_runtime" ? "Windows" : null,
      os_version: null,
      uptime_seconds: bridge?.uptime_seconds ?? null,
      cpu_percent: null,
      memory_percent: null,
      disk_total_gb: null,
      disk_free_gb: null,
      disk_used_percent: null,
      clock_drift_seconds: null,
      power_status: null
    },
    runtime: {
      cpi_windows_runtime_running: surface === "windows_runtime",
      local_bridge_online: bridge?.ok === true,
      bridge_version: bridge?.bridge_version ?? runtimeGlobal?.native_bridge_version ?? null,
      bridge_port: bridge?.port ?? null,
      token_required: bridge?.token_required ?? null,
      request_slots_available: bridge?.request_slots_available ?? null,
      print_queue_busy: bridge?.print_queue_busy ?? null,
      drawer_queue_busy: bridge?.drawer_queue_busy ?? null,
      printed_jobs: bridge?.printed_jobs ?? null,
      failed_jobs: bridge?.failed_jobs ?? null,
      drawer_commands: bridge?.drawer_commands ?? null,
      last_error: bridge?.last_error ?? null
    },
    peripherals: {
      default_printer: bridge?.system_default_printer ?? null,
      selected_printer: bridge?.resolved_printer ?? bridge?.configured_printer ?? null,
      selected_printer_valid: bridge?.selected_printer_valid ?? null,
      printer_status: bridge?.selected_printer_valid === false ? "invalid" : bridge ? "normal" : null,
      print_queue_count: null,
      last_print_at: bridge?.last_print_at ?? null,
      cash_drawer_supported: bridge?.supports_cash_drawer ?? null,
      last_drawer_at: bridge?.last_drawer_at ?? null,
      last_drawer_device: bridge?.last_drawer_device ?? null
    },
    offline_sale: null,
    security_signals: [],
    metadata: {
      source: `web_pos_session_heartbeat_${surface}`,
      reason,
      app_url: typeof location === "undefined" ? null : location.origin
    },
    captured_at: capturedAt
  };
}

type DeviceHeartbeatResponse = {
  data?: {
    pending_actions?: PendingDeviceAction[];
  } | null;
};

export async function sendDeviceHeartbeat(payload: DeviceHeartbeatPayload): Promise<PendingDeviceAction[]> {
  try {
    const response = await fetch("/api/pos/device-heartbeat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      cache: "no-store",
      body: JSON.stringify(payload)
    });
    if (!response.ok) return [];
    const body = (await response.json().catch(() => null)) as DeviceHeartbeatResponse | null;
    return body?.data?.pending_actions ?? [];
  } catch {
    return [];
  }
}

export type ExecutedDeviceAction = {
  id: string;
  command_type: PendingDeviceAction["command_type"];
  applied: boolean;
};

async function refreshWindowsRuntimeConfig(): Promise<boolean> {
  const runtimeGlobal = getWindowsRuntimeGlobal();
  const entitlementsUrl = (runtimeGlobal as { windows_runtime_entitlements_url?: string } | null)?.windows_runtime_entitlements_url;
  if (!entitlementsUrl) return false;
  try {
    const response = await fetch(entitlementsUrl, { cache: "no-store", credentials: "include" });
    return response.ok;
  } catch {
    return false;
  }
}

// Executes the safe, fixed allowlist of device commands delivered via heartbeat
// responses. Never accepts or evaluates arbitrary code/payloads - only the known
// command_type values from DEVICE_COMMAND_TYPES are ever acted on.
export async function executePendingActions(actions: readonly PendingDeviceAction[]): Promise<ExecutedDeviceAction[]> {
  const results: ExecutedDeviceAction[] = [];

  for (const action of actions) {
    if (UNSUPPORTED_DEVICE_COMMAND_TYPES.includes(action.command_type)) {
      // Delivered and acknowledged, but no native endpoint exists yet to act on it
      // (see UNSUPPORTED_DEVICE_COMMAND_TYPES in @/lib/device-commands).
      results.push({ id: action.id, command_type: action.command_type, applied: false });
      continue;
    }

    switch (action.command_type) {
      case "reload_ui":
        results.push({ id: action.id, command_type: action.command_type, applied: true });
        if (typeof window !== "undefined") window.location.reload();
        break;
      case "request_diagnostics_bundle":
        // The heartbeat that delivered this command already carried a fresh
        // snapshot; nothing further to do beyond acknowledging delivery.
        results.push({ id: action.id, command_type: action.command_type, applied: true });
        break;
      case "refresh_config": {
        const applied = await refreshWindowsRuntimeConfig();
        results.push({ id: action.id, command_type: action.command_type, applied });
        break;
      }
      case "disable_device":
      case "enable_device":
        // Applied immediately server-side (branch_devices.status) when issued -
        // nothing for the device to do.
        results.push({ id: action.id, command_type: action.command_type, applied: true });
        break;
      default:
        results.push({ id: action.id, command_type: action.command_type, applied: false });
    }
  }

  return results;
}
