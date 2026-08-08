import { readEnv } from "@/lib/env";
import { fetchBridgeWithTimeout, resolveBridgeTimeoutMs } from "@/lib/printing/adapters/bridge-timeout";
import type { PrinterAdapter } from "@/lib/printing/adapters/types";

function readMetadataText(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeBridgeUrl(value: string) {
  return value.replace(/\/+$/, "");
}

function resolveBridgeBaseUrl(value: string) {
  const normalized = normalizeBridgeUrl(value);
  if (normalized.endsWith("/api/print")) return normalized.slice(0, -"/api/print".length);
  if (normalized.endsWith("/print")) return normalized.slice(0, -"/print".length);
  return normalized;
}

function isCashDrawerCommand(metadata: Record<string, unknown>) {
  const command = String(metadata.command ?? metadata.action ?? "").trim().toLowerCase().replace(/-/g, "_");
  return command === "open_cash_drawer" || command === "cash_drawer_open" || command === "drawer_open";
}

// A Bluetooth-paired thermal printer shows up as an ordinary Windows printer once paired at the
// OS level, so it goes through the same local bridge (LocalPrintBridge.cs) as any USB/network
// printer — the Windows print driver abstracts the Bluetooth transport away. This adapter must
// therefore speak the exact same authenticated bridge contract as LocalBridgeAdapter (bridge
// token header, /cash-drawer/open for drawer commands); it previously used a different,
// unauthenticated request shape that the current bridge rejects with 401. The bluetooth_address/
// bluetooth_name fields are passed through only as informational metadata for diagnostics.
export class BluetoothBridgeAdapter implements PrinterAdapter {
  readonly connectionType = "BLUETOOTH_BRIDGE" as const;

  async print(ctx: Parameters<PrinterAdapter["print"]>[0]) {
    const bridgeUrlFromEnv = readEnv("PRINT_BLUETOOTH_BRIDGE_URL") ?? readEnv("PRINT_BRIDGE_URL");
    const bridgeUrl = readMetadataText(ctx.metadata, "bridge_url") ?? bridgeUrlFromEnv;
    if (!bridgeUrl) {
      throw new Error("BLUETOOTH_BRIDGE requires metadata.bridge_url or PRINT_BLUETOOTH_BRIDGE_URL.");
    }

    const bridgeToken =
      readMetadataText(ctx.metadata, "bridge_token") ?? readEnv("PRINT_BLUETOOTH_BRIDGE_TOKEN") ?? readEnv("PRINT_BRIDGE_TOKEN");
    const bluetoothAddress =
      readMetadataText(ctx.metadata, "bluetooth_address") ??
      readMetadataText(ctx.metadata, "bluetooth_mac") ??
      readMetadataText(ctx.metadata, "bt_address");
    const bluetoothName = readMetadataText(ctx.metadata, "bluetooth_name") ?? readMetadataText(ctx.metadata, "device_name");
    const payloadHtml = ctx.payloadHtml ?? readMetadataText(ctx.metadata, "payload_html");
    const drawerCommand = isCashDrawerCommand(ctx.metadata);
    const timeoutMs = resolveBridgeTimeoutMs(ctx.metadata, "PRINT_BLUETOOTH_BRIDGE_TIMEOUT_MS", 8000);
    const endpoint = drawerCommand ? `${resolveBridgeBaseUrl(bridgeUrl)}/cash-drawer/open` : bridgeUrl;

    const response = await fetchBridgeWithTimeout(
      endpoint,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(bridgeToken ? { "X-CpIPOS-Bridge-Token": bridgeToken } : {})
        },
        body: JSON.stringify({
          action: drawerCommand ? "cash_drawer_open" : "print",
          printer_id: ctx.printerId,
          printer_name: ctx.printerName,
          payload_text: ctx.payloadText,
          payload_html: payloadHtml,
          drawer_connection_mode: readMetadataText(ctx.metadata, "drawer_connection_mode"),
          drawer_controller_port: readMetadataText(ctx.metadata, "drawer_controller_port"),
          drawer_controller_url: readMetadataText(ctx.metadata, "drawer_controller_url"),
          drawer_controller_protocol: readMetadataText(ctx.metadata, "drawer_controller_protocol"),
          drawer_kick_pin: ctx.metadata.drawer_kick_pin ?? null,
          drawer_pulse_on_ms: ctx.metadata.drawer_pulse_on_ms ?? null,
          drawer_pulse_off_ms: ctx.metadata.drawer_pulse_off_ms ?? null,
          metadata: {
            ...ctx.metadata,
            transport: "bluetooth",
            bluetooth_address: bluetoothAddress,
            bluetooth_name: bluetoothName
          }
        })
      },
      timeoutMs
    );

    if (!response.ok) {
      throw new Error(`BLUETOOTH_BRIDGE request failed with status ${response.status}.`);
    }

    let responseBody: unknown = null;
    try {
      responseBody = await response.json();
    } catch {
      responseBody = null;
    }

    return {
      metadata: {
        bridge_url: endpoint,
        bluetooth_address: bluetoothAddress,
        bluetooth_name: bluetoothName,
        command: drawerCommand ? "open_cash_drawer" : "print",
        sent_as_html: Boolean(payloadHtml),
        timeout_ms: timeoutMs,
        bridge_response: responseBody && typeof responseBody === "object" ? (responseBody as Record<string, unknown>) : null
      }
    };
  }
}
