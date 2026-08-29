"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DEVICE_COMMAND_TYPES, type DeviceCommandType } from "@/lib/device-commands";

type ApiEnvelope<T> = {
  data: T;
  error: { code?: string; message?: string } | null;
};

type DeviceRow = {
  id: string;
  tenant_id: string;
  branch_id: string;
  device_code: string;
  device_name: string;
  status: string;
};

type HealthRow = {
  status: string;
  summary: unknown;
  identity: unknown;
  connectivity: unknown;
  system_health: unknown;
  runtime_health: unknown;
  peripheral_health: unknown;
  offline_sale_health: unknown;
  security_signals: unknown;
  metadata: unknown;
  last_error: string | null;
  machine_id: string;
  app_version: string | null;
  runtime_version: string | null;
  last_seen_at: string;
  captured_at: string;
  synced_at: string | null;
} | null;

type HeartbeatRow = {
  machine_id: string;
  runtime_version: string | null;
  app_version: string | null;
  last_seen_at: string;
} | null;

type IncidentRow = {
  id: string;
  code: string;
  severity: string;
  title: string;
  message: string;
  detected_at: string;
  resolved_at: string | null;
};

type CommandRow = {
  id: string;
  command_type: string;
  status: string;
  issued_at: string;
  delivered_at: string | null;
  expires_at: string;
  result: unknown;
};

type HealthResponse = {
  device: DeviceRow;
  health: HealthRow;
  latest_heartbeat: HeartbeatRow;
  incidents: IncidentRow[];
  commands: CommandRow[];
  integration?: {
    compatibility?: {
      mode?: string;
      warning?: string;
    };
  };
};

const thStyle = { textAlign: "left" as const, padding: "8px 10px", borderBottom: "1px solid #e2e8f0", fontSize: 13, color: "#475569" };
const tdStyle = { padding: "8px 10px", borderBottom: "1px solid #f1f5f9", fontSize: 13, verticalAlign: "top" as const };
const metricStyle = { border: "1px solid #e2e8f0", borderRadius: 8, padding: 10, minWidth: 150, background: "#fff" };

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function textValue(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return date.toLocaleString("en-US", { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}

function formatMetric(value: number | null, suffix: string) {
  return value === null ? "Not reported" : `${Number.isInteger(value) ? value : value.toFixed(1)}${suffix}`;
}

function compactResult(value: unknown) {
  if (value === null || value === undefined) return "-";
  try {
    const encoded = JSON.stringify(value);
    return encoded.length > 120 ? `${encoded.slice(0, 117)}...` : encoded;
  } catch {
    return String(value);
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as ApiEnvelope<T>;
  if (!response.ok || payload.error) {
    throw new Error(payload.error?.message ?? "Request failed.");
  }
  return payload.data;
}

export function DeviceHealthConsole({ tenantId, deviceId }: { tenantId: string; deviceId: string }) {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/it-admin/v1/devices/${deviceId}/health`, { cache: "no-store" });
      const result = await parseResponse<HealthResponse>(response);
      setData(result);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load device health.");
    } finally {
      setLoading(false);
    }
  }, [deviceId]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function issueCommand(commandType: DeviceCommandType) {
    if (!data) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch("/api/it-admin/v1/device-commands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenant_id: tenantId,
          branch_id: data.device.branch_id,
          pos_device_id: deviceId,
          command_type: commandType
        })
      });
      await parseResponse(response);
      setSuccess(`Command "${commandType}" issued.`);
      await load();
    } catch (commandError) {
      setError(commandError instanceof Error ? commandError.message : "Failed to issue command.");
    } finally {
      setBusy(false);
    }
  }

  const diagnostics = useMemo(() => {
    const health = data?.health;
    if (!health) return null;
    const system = asRecord(health.system_health);
    const runtime = asRecord(health.runtime_health);
    const peripherals = asRecord(health.peripheral_health);
    const connectivity = asRecord(health.connectivity);
    const metadata = asRecord(health.metadata);
    const native = asRecord(metadata.native_android_diagnostics);
    const nativeDevice = asRecord(native.device);
    const nativeHealth = asRecord(native.health);
    const nativePrinter = asRecord(native.printer);
    const nativeInventory = asRecord(nativePrinter.inventory);
    const usbInventory = asRecord(nativeInventory.usb);
    const usbDevices = Array.isArray(usbInventory.devices) ? usbInventory.devices.map(asRecord) : [];
    const detectedPrinters = usbDevices
      .filter((item) => item.printer_name_hint === true || item.usb_printer_class === true)
      .map((item) => textValue(item, "product_name") ?? textValue(item, "manufacturer_name") ?? "USB printer");
    const updateState = asRecord(native.update_state);

    const diskFree = numberValue(system, "disk_free_gb") ?? (() => {
      const mb = numberValue(nativeHealth, "available_storage_mb");
      return mb === null ? null : mb / 1024;
    })();

    return {
      os: [textValue(system, "os_name") ?? textValue(nativeDevice, "manufacturer"), textValue(system, "os_version") ?? textValue(nativeDevice, "android_release")]
        .filter(Boolean)
        .join(" ") || "Not reported",
      model: [textValue(nativeDevice, "brand") ?? textValue(nativeDevice, "manufacturer"), textValue(nativeDevice, "model")].filter(Boolean).join(" ") || "Not reported",
      cpu: formatMetric(numberValue(system, "cpu_percent"), "%"),
      memory: formatMetric(numberValue(system, "memory_percent"), "%"),
      appMemory: formatMetric(numberValue(nativeHealth, "app_memory_mb"), " MB"),
      storageFree: formatMetric(diskFree, " GB"),
      battery: formatMetric(numberValue(nativeHealth, "battery_percent"), "%"),
      uptime: formatMetric(numberValue(system, "uptime_seconds"), " sec"),
      network: textValue(connectivity, "network_type") ?? "Not reported",
      internet: connectivity.internet_online === true ? "Online" : connectivity.internet_online === false ? "Offline" : "Not reported",
      bridge: textValue(runtime, "bridge_version") ?? "Not reported",
      printerStatus: textValue(peripherals, "printer_status") ?? "Not reported",
      selectedPrinter: textValue(peripherals, "selected_printer") ?? "Not configured",
      detectedPrinters,
      lastPrintAt: textValue(peripherals, "last_print_at"),
      printQueue: numberValue(peripherals, "print_queue_count"),
      updateStatus: textValue(updateState, "status") ?? "Not reported",
      updateTarget: textValue(updateState, "target_version_name") ?? "-"
    };
  }, [data]);

  if (loading && !data) {
    return <section className="surface"><p>Loading device health...</p></section>;
  }

  if (!data) {
    return <section className="surface"><p style={{ color: "#b91c1c" }}>{error ?? "Device not found."}</p></section>;
  }

  const { device, health, latest_heartbeat: latestHeartbeat, incidents, commands } = data;
  const compatibilityMode = data.integration?.compatibility?.mode ?? "native_it_plane";
  const compatibilityWarning = data.integration?.compatibility?.warning;

  return (
    <section className="surface" style={{ display: "grid", gap: 16 }}>
      <div>
        <h2 style={{ margin: 0 }}>{device.device_name} ({device.device_code})</h2>
        <p style={{ margin: "4px 0 0", color: "#475569" }}>
          Status: <strong>{device.status}</strong>
          {latestHeartbeat ? ` · Latest heartbeat: ${formatDateTime(latestHeartbeat.last_seen_at)}` : " · No heartbeat received yet"}
          {health ? ` · Agent health: ${health.status}` : ""}
        </p>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: compatibilityMode === "legacy_bridge" ? "#92400e" : "#475569" }}>
          Monitoring path: {compatibilityMode === "legacy_bridge" ? "Legacy compatibility bridge (CpiPOS-001 → CpiPOS-002)" : "Native IT plane"}
          {compatibilityWarning ? ` · Warning: ${compatibilityWarning}` : ""}
        </p>
      </div>

      {success ? <p style={{ margin: 0, color: "#047857" }}>{success}</p> : null}
      {error ? <p style={{ margin: 0, color: "#b91c1c" }}>{error}</p> : null}

      {diagnostics ? (
        <div>
          <h3 style={{ margin: "0 0 8px" }}>Live diagnostics</h3>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {[
              ["Device", diagnostics.model], ["OS", diagnostics.os], ["App", health?.app_version ?? "Not reported"],
              ["Runtime", health?.runtime_version ?? "Not reported"], ["CPU", diagnostics.cpu], ["RAM", diagnostics.memory],
              ["App memory", diagnostics.appMemory], ["Storage free", diagnostics.storageFree], ["Battery", diagnostics.battery],
              ["Network", `${diagnostics.network} · ${diagnostics.internet}`], ["MDM bridge", diagnostics.bridge],
              ["Update", `${diagnostics.updateStatus}${diagnostics.updateTarget !== "-" ? ` → ${diagnostics.updateTarget}` : ""}`]
            ].map(([label, value]) => (
              <div key={label} style={metricStyle}>
                <div style={{ fontSize: 12, color: "#64748b" }}>{label}</div>
                <strong style={{ display: "block", marginTop: 3, fontSize: 14 }}>{value}</strong>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {diagnostics ? (
        <div>
          <h3 style={{ margin: "0 0 8px" }}>Printer / Print Agent</h3>
          <div style={{ display: "grid", gap: 4, fontSize: 13 }}>
            <div>Status: <strong>{diagnostics.printerStatus}</strong></div>
            <div>Selected printer: <strong>{diagnostics.selectedPrinter}</strong></div>
            <div>Detected printer hardware: <strong>{diagnostics.detectedPrinters.length > 0 ? diagnostics.detectedPrinters.join(", ") : "None reported"}</strong></div>
            <div>Queue count: <strong>{diagnostics.printQueue ?? "Not reported"}</strong></div>
            <div>Last print: <strong>{formatDateTime(diagnostics.lastPrintAt)}</strong></div>
            <div>Last error: <strong>{health?.last_error ?? textValue(asRecord(health?.runtime_health), "last_error") ?? "None reported"}</strong></div>
          </div>
        </div>
      ) : null}

      <div>
        <h3 style={{ margin: "0 0 8px" }}>Issue command</h3>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {DEVICE_COMMAND_TYPES.map((commandType) => (
            <button key={commandType} type="button" className="pos-monitor-btn" disabled={busy} onClick={() => void issueCommand(commandType)}>
              {commandType}
            </button>
          ))}
          <button type="button" className="pos-monitor-btn" disabled={busy || loading} onClick={() => void load()}>Refresh now</button>
        </div>
      </div>

      <div>
        <h3 style={{ margin: "0 0 8px" }}>Recent incidents</h3>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr><th style={thStyle}>Severity</th><th style={thStyle}>Title</th><th style={thStyle}>Message</th><th style={thStyle}>Detected</th><th style={thStyle}>Resolved</th></tr></thead>
            <tbody>
              {incidents.length === 0 ? <tr><td style={tdStyle} colSpan={5}>No incidents recorded.</td></tr> : incidents.map((incident) => (
                <tr key={incident.id}><td style={tdStyle}>{incident.severity}</td><td style={tdStyle}>{incident.title}</td><td style={tdStyle}>{incident.message}</td><td style={tdStyle}>{formatDateTime(incident.detected_at)}</td><td style={tdStyle}>{formatDateTime(incident.resolved_at)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h3 style={{ margin: "0 0 8px" }}>Command history / ACK</h3>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr><th style={thStyle}>Command</th><th style={thStyle}>Status</th><th style={thStyle}>Issued</th><th style={thStyle}>Delivered</th><th style={thStyle}>Result</th><th style={thStyle}>Expires</th></tr></thead>
            <tbody>
              {commands.length === 0 ? <tr><td style={tdStyle} colSpan={6}>No commands issued yet.</td></tr> : commands.map((command) => (
                <tr key={command.id}><td style={tdStyle}>{command.command_type}</td><td style={tdStyle}>{command.status}</td><td style={tdStyle}>{formatDateTime(command.issued_at)}</td><td style={tdStyle}>{formatDateTime(command.delivered_at)}</td><td style={{ ...tdStyle, fontFamily: "monospace", overflowWrap: "anywhere" }}>{compactResult(command.result)}</td><td style={tdStyle}>{formatDateTime(command.expires_at)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
