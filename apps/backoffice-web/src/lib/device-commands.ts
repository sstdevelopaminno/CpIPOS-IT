export const DEVICE_COMMAND_TYPES = [
  "request_diagnostics_bundle",
  "reload_ui",
  "clear_print_queue",
  "restart_local_bridge",
  "refresh_config",
  "disable_device",
  "enable_device"
] as const;

export type DeviceCommandType = (typeof DEVICE_COMMAND_TYPES)[number];

export type DeviceCommandStatus = "pending" | "delivered" | "expired";

// Commands that take effect immediately server-side (branch_devices.status) and
// never need to be picked up by the device itself.
export const IMMEDIATE_DEVICE_COMMAND_TYPES: readonly DeviceCommandType[] = ["disable_device", "enable_device"];

// Commands whose device-side execution requires a native local-bridge endpoint that
// does not exist yet (apps/windows-runtime-native/Cpipos.WindowsRuntime/LocalPrintBridge.cs
// only exposes /health, /capabilities, /printers, /print/status, /print/test, /print,
// /print/html, /cash-drawer/open - no queue-clear or bridge-restart route). Delivered to
// the device like any other command, but the client-side handler is a documented no-op
// until that native endpoint is added in a follow-up phase.
export const UNSUPPORTED_DEVICE_COMMAND_TYPES: readonly DeviceCommandType[] = ["clear_print_queue", "restart_local_bridge"];

export const DEVICE_COMMAND_TTL_MS = 30 * 60_000;

export function isDeviceCommandType(value: unknown): value is DeviceCommandType {
  return typeof value === "string" && (DEVICE_COMMAND_TYPES as readonly string[]).includes(value);
}

export function isImmediateDeviceCommand(commandType: DeviceCommandType): boolean {
  return IMMEDIATE_DEVICE_COMMAND_TYPES.includes(commandType);
}

export type PendingDeviceAction = {
  id: string;
  command_type: DeviceCommandType;
  issued_at: string;
};
