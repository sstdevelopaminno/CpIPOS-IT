export const DEVICE_COMMAND_TYPES = [
  "request_diagnostics_bundle",
  "reload_ui",
  "clear_print_queue",
  "restart_local_bridge",
  "refresh_config",
  "disable_device",
  "enable_device",
  "test_printer"
] as const;

export type DeviceCommandType = (typeof DEVICE_COMMAND_TYPES)[number];

export type DeviceCommandStatus = "pending" | "delivered" | "expired";

export const IMMEDIATE_DEVICE_COMMAND_TYPES: readonly DeviceCommandType[] = ["disable_device", "enable_device"];

export const UNSUPPORTED_DEVICE_COMMAND_TYPES: readonly DeviceCommandType[] = [
  "clear_print_queue",
  "restart_local_bridge"
];

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
