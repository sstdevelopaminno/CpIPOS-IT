export const DEVICE_COMMAND_TYPES = [
  "request_diagnostics_bundle",
  "request_diagnostics",
  "reload_ui",
  "restart_app",
  "test_network",
  "test_printer",
  "clear_print_queue",
  "restart_local_bridge",
  "restart_print_service",
  "refresh_config",
  "check_update",
  "disable_device",
  "enable_device"
] as const;

export type DeviceCommandType = (typeof DEVICE_COMMAND_TYPES)[number];

export type DeviceCommandStatus = "pending" | "delivered" | "expired";

export const IMMEDIATE_DEVICE_COMMAND_TYPES: readonly DeviceCommandType[] = ["disable_device", "enable_device"];

export const UNSUPPORTED_DEVICE_COMMAND_TYPES: readonly DeviceCommandType[] = [
  "clear_print_queue",
  "restart_local_bridge",
  "restart_print_service"
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
