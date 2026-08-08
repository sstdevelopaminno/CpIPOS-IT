import type { PrinterAdapter } from "@/lib/printing/adapters/types";
import { readEnv } from "@/lib/env";
import { fetchBridgeWithTimeout, resolveBridgeTimeoutMs } from "@/lib/printing/adapters/bridge-timeout";

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

function readString(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export class LocalBridgeAdapter implements PrinterAdapter {
  readonly connectionType = "LOCAL_BRIDGE" as const;

  async print(ctx: Parameters<PrinterAdapter["print"]>[0]) {
    const envBridgeUrl = readEnv("PRINT_BRIDGE_URL");
    const bridgeUrl =
      typeof ctx.metadata.bridge_url === "string"
        ? ctx.metadata.bridge_url
        : typeof envBridgeUrl === "string"
          ? envBridgeUrl
          : null;

    if (!bridgeUrl) {
      throw new Error("LOCAL_BRIDGE requires metadata.bridge_url or PRINT_BRIDGE_URL.");
    }

    const bridgeToken =
      typeof ctx.metadata.bridge_token === "string"
        ? ctx.metadata.bridge_token
        : typeof readEnv("PRINT_BRIDGE_TOKEN") === "string"
          ? readEnv("PRINT_BRIDGE_TOKEN")
          : null;
    const drawerCommand = isCashDrawerCommand(ctx.metadata);
    const timeoutMs = resolveBridgeTimeoutMs(ctx.metadata, "PRINT_LOCAL_BRIDGE_TIMEOUT_MS");
    const endpoint = drawerCommand ? `${resolveBridgeBaseUrl(bridgeUrl)}/cash-drawer/open` : bridgeUrl;
    const response = await fetchBridgeWithTimeout(endpoint, {
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
        payload_html: ctx.payloadHtml ?? null,
        drawer_connection_mode: readString(ctx.metadata, "drawer_connection_mode"),
        drawer_controller_port: readString(ctx.metadata, "drawer_controller_port"),
        drawer_controller_url: readString(ctx.metadata, "drawer_controller_url"),
        drawer_controller_protocol: readString(ctx.metadata, "drawer_controller_protocol"),
        drawer_kick_pin: ctx.metadata.drawer_kick_pin ?? null,
        drawer_pulse_on_ms: ctx.metadata.drawer_pulse_on_ms ?? null,
        drawer_pulse_off_ms: ctx.metadata.drawer_pulse_off_ms ?? null,
        metadata: ctx.metadata
      })
    }, timeoutMs);

    if (!response.ok) {
      throw new Error(`LOCAL_BRIDGE request failed with status ${response.status}.`);
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
        command: drawerCommand ? "open_cash_drawer" : "print",
        drawer_connection_mode: drawerCommand ? readString(ctx.metadata, "drawer_connection_mode") : null,
        timeout_ms: timeoutMs,
        bridge_response: responseBody && typeof responseBody === "object" ? (responseBody as Record<string, unknown>) : null
      }
    };
  }
}
