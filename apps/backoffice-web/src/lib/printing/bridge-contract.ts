export type BridgeAction = "health" | "discover_bluetooth_printers" | "connect_bluetooth_printer" | "print";

export type BridgeDevice = {
  id: string;
  name: string;
  address: string | null;
  rssi: number | null;
  paired: boolean;
  connected: boolean;
};

export type BridgeEnvelope<TData = Record<string, unknown>> = {
  ok: boolean;
  code: string;
  message: string;
  action: BridgeAction;
  timestamp: string;
  data: TData;
};

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toNumber(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export function normalizeBridgeDevices(raw: unknown): BridgeDevice[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item, index) => {
      const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const name = normalizeText(row.name) ?? normalizeText(row.device_name) ?? `Bluetooth Device ${index + 1}`;
      const address = normalizeText(row.address) ?? normalizeText(row.mac) ?? normalizeText(row.bluetooth_address);
      return {
        id: `${address ?? "unknown"}-${index}`,
        name,
        address,
        rssi: toNumber(row.rssi),
        paired: row.paired === true || row.bonded === true,
        connected: row.connected === true
      } satisfies BridgeDevice;
    })
    .filter((device) => Boolean(device.address || device.name));
}

export function parseBridgePayload(rawText: string): Record<string, unknown> {
  if (!rawText) return {};
  try {
    return JSON.parse(rawText) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function buildBridgeEnvelope<TData extends Record<string, unknown>>(args: {
  ok: boolean;
  code: string;
  message: string;
  action: BridgeAction;
  data: TData;
}): BridgeEnvelope<TData> {
  return {
    ok: args.ok,
    code: args.code,
    message: args.message,
    action: args.action,
    timestamp: new Date().toISOString(),
    data: args.data
  };
}
