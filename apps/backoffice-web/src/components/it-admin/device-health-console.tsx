"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import type { DeviceCommandType } from "@/lib/device-commands";
import styles from "./device-health-console.module.css";

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
  return date.toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
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

function tone(status: string | null | undefined) {
  const normalized = String(status ?? "").toLowerCase();
  if (["active", "online", "ready", "healthy", "ok", "enabled"].includes(normalized)) return styles.badgeGood;
  if (["disabled", "offline", "failed", "error", "critical", "revoked"].includes(normalized)) return styles.badgeBad;
  return styles.badgeWarn;
}

function GaugeMetric({ label, value, suffix = "%" }: { label: string; value: number | null; suffix?: string }) {
  const safe = value === null ? 0 : Math.max(0, Math.min(100, value));
  const style = { "--value": safe } as CSSProperties;
  return (
    <div className={styles.gaugeCard}>
      <div className={styles.gauge} style={style}>
        <div className={styles.gaugeValue}>
          <strong>{value === null ? "—" : Math.round(value)}</strong>
          <span>{value === null ? "no data" : suffix}</span>
        </div>
      </div>
      <div className={styles.gaugeLabel}>{label}</div>
    </div>
  );
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (!response.ok || !payload || payload.error) {
    throw new Error(payload?.error?.message ?? "Request failed.");
  }
  return payload.data;
}

export function DeviceHealthConsole({ tenantId, deviceId }: { tenantId: string; deviceId: string }) {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/it-admin/v1/devices/${deviceId}/health`, { cache: "no-store" });
      const result = await parseResponse<HealthResponse>(response);
      setData(result);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load device health.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [deviceId]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(true);
    }, 30_000);
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
      setSuccess(commandType === "enable_device" ? "ส่งคำสั่งเปิดใช้งานเครื่องแล้ว" : "ส่งคำสั่งปิดใช้งานเครื่องแล้ว");
      await load(true);
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

    const cpuValue = numberValue(system, "cpu_percent");
    const memoryValue = numberValue(system, "memory_percent");
    const batteryValue = numberValue(nativeHealth, "battery_percent");
    const diskFree = numberValue(system, "disk_free_gb") ?? (() => {
      const mb = numberValue(nativeHealth, "available_storage_mb");
      return mb === null ? null : mb / 1024;
    })();

    return {
      os: [textValue(system, "os_name") ?? textValue(nativeDevice, "manufacturer"), textValue(system, "os_version") ?? textValue(nativeDevice, "android_release")]
        .filter(Boolean)
        .join(" ") || "Not reported",
      model: [textValue(nativeDevice, "brand") ?? textValue(nativeDevice, "manufacturer"), textValue(nativeDevice, "model")].filter(Boolean).join(" ") || "Not reported",
      cpuValue,
      memoryValue,
      batteryValue,
      cpu: formatMetric(cpuValue, "%"),
      memory: formatMetric(memoryValue, "%"),
      appMemory: formatMetric(numberValue(nativeHealth, "app_memory_mb"), " MB"),
      storageFree: formatMetric(diskFree, " GB"),
      battery: formatMetric(batteryValue, "%"),
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
    return <section className={styles.loading}>Loading device health...</section>;
  }

  if (!data) {
    return <section className={styles.loading}><p className={styles.noticeBad}>{error ?? "Device not found."}</p></section>;
  }

  const { device, health, latest_heartbeat: latestHeartbeat, incidents, commands } = data;
  const compatibilityMode = data.integration?.compatibility?.mode ?? "native_it_plane";
  const compatibilityWarning = data.integration?.compatibility?.warning;
  const isDisabled = device.status.toLowerCase() === "disabled";

  return (
    <section className={styles.console}>
      <header className={styles.hero}>
        <div>
          <h2>{device.device_name} <small>({device.device_code})</small></h2>
          <p>
            Monitoring path: {compatibilityMode === "legacy_bridge" ? "Legacy compatibility bridge (CpiPOS-001 → CpiPOS-002)" : "Native IT plane"}
            {compatibilityWarning ? ` · Warning: ${compatibilityWarning}` : ""}
          </p>
        </div>
        <div className={styles.heroMeta}>
          <span className={`${styles.badge} ${tone(device.status)}`}><span className={styles.dot}/>{device.status}</span>
          <span className={`${styles.badge} ${tone(health?.status)}`}><span className={styles.dot}/>Agent {health?.status ?? "unknown"}</span>
        </div>
      </header>

      {success ? <p className={`${styles.notice} ${styles.noticeGood}`}>{success}</p> : null}
      {error ? <p className={`${styles.notice} ${styles.noticeBad}`}>{error}</p> : null}

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div>
            <h3>สถานะและการเปิด–ปิดเครื่อง</h3>
            <p>ส่วนนี้ใช้ดูสถานะล่าสุดและสั่งเปิด/ปิดการใช้งานเท่านั้น เพื่อลดคำสั่งเทคนิคที่ไม่จำเป็นบนหน้าหลัก</p>
          </div>
          <div className={styles.controlActions}>
            <button type="button" className={styles.button} disabled={busy || loading} onClick={() => void load()}>ตรวจสอบสถานะ</button>
            <button type="button" className={`${styles.button} ${styles.buttonPrimary}`} disabled={busy || !isDisabled} onClick={() => void issueCommand("enable_device")}>เปิดใช้งาน</button>
            <button type="button" className={`${styles.button} ${styles.buttonDanger}`} disabled={busy || isDisabled} onClick={() => void issueCommand("disable_device")}>ปิดใช้งาน</button>
          </div>
        </div>
        <div className={styles.summaryGrid}>
          <div className={styles.summaryCard}><span>Runtime status</span><strong>{device.status}</strong></div>
          <div className={styles.summaryCard}><span>Latest heartbeat</span><strong>{latestHeartbeat ? formatDateTime(latestHeartbeat.last_seen_at) : "No heartbeat"}</strong></div>
          <div className={styles.summaryCard}><span>Agent health</span><strong>{health?.status ?? "No telemetry"}</strong></div>
          <div className={styles.summaryCard}><span>Last captured</span><strong>{formatDateTime(health?.captured_at)}</strong></div>
        </div>
      </section>

      {diagnostics ? (
        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <h3>Live diagnostics</h3>
              <p>ค่าหลักแสดงเป็นตัวเลขและกราฟเพื่อดูภาระเครื่องได้ทันที</p>
            </div>
          </div>
          <div className={styles.gaugeGrid}>
            <GaugeMetric label="CPU" value={diagnostics.cpuValue}/>
            <GaugeMetric label="RAM" value={diagnostics.memoryValue}/>
            <GaugeMetric label="Battery" value={diagnostics.batteryValue}/>
            <div className={styles.gaugeCard}>
              <div className={styles.gaugeValue}><strong>{diagnostics.storageFree}</strong><span>Storage free</span></div>
              <div className={styles.gaugeLabel}>พื้นที่ว่าง</div>
            </div>
          </div>
          <div className={styles.diagnosticGrid}>
            {[
              ["Device", diagnostics.model],
              ["OS", diagnostics.os],
              ["App", health?.app_version ?? "Not reported"],
              ["Runtime", health?.runtime_version ?? "Not reported"],
              ["App memory", diagnostics.appMemory],
              ["Uptime", diagnostics.uptime],
              ["Network", `${diagnostics.network} · ${diagnostics.internet}`],
              ["MDM bridge", diagnostics.bridge],
              ["Update", `${diagnostics.updateStatus}${diagnostics.updateTarget !== "-" ? ` → ${diagnostics.updateTarget}` : ""}`]
            ].map(([label, value]) => (
              <div className={styles.metricCard} key={label}><span>{label}</span><strong>{value}</strong></div>
            ))}
          </div>
        </section>
      ) : null}

      {diagnostics ? (
        <section className={styles.panel}>
          <div className={styles.panelHeader}><div><h3>Printer / Print Agent</h3><p>ตรวจเครื่องพิมพ์และคิวงานล่าสุด</p></div></div>
          <div className={styles.printerGrid}>
            <div className={styles.metricCard}><span>Status</span><strong>{diagnostics.printerStatus}</strong></div>
            <div className={styles.metricCard}><span>Selected printer</span><strong>{diagnostics.selectedPrinter}</strong></div>
            <div className={styles.metricCard}><span>Queue count</span><strong>{diagnostics.printQueue ?? "Not reported"}</strong></div>
            <div className={styles.metricCard}><span>Detected hardware</span><strong>{diagnostics.detectedPrinters.length > 0 ? diagnostics.detectedPrinters.join(", ") : "None reported"}</strong></div>
            <div className={styles.metricCard}><span>Last print</span><strong>{formatDateTime(diagnostics.lastPrintAt)}</strong></div>
            <div className={styles.metricCard}><span>Last error</span><strong>{health?.last_error ?? textValue(asRecord(health?.runtime_health), "last_error") ?? "None reported"}</strong></div>
          </div>
        </section>
      ) : null}

      <section className={styles.panel}>
        <div className={styles.panelHeader}><div><h3>Recent incidents</h3><p>เหตุการณ์ที่ระบบตรวจพบล่าสุด</p></div></div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>Severity</th><th>Title</th><th>Message</th><th>Detected</th><th>Resolved</th></tr></thead>
            <tbody>
              {incidents.length === 0 ? <tr><td colSpan={5} className={styles.empty}>No incidents recorded.</td></tr> : incidents.map((incident) => (
                <tr key={incident.id}><td>{incident.severity}</td><td>{incident.title}</td><td>{incident.message}</td><td>{formatDateTime(incident.detected_at)}</td><td>{formatDateTime(incident.resolved_at)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeader}><div><h3>Command history / ACK</h3><p>ประวัติคำสั่งและผลตอบกลับจากเครื่อง</p></div></div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>Command</th><th>Status</th><th>Issued</th><th>Delivered</th><th>Result</th><th>Expires</th></tr></thead>
            <tbody>
              {commands.length === 0 ? <tr><td colSpan={6} className={styles.empty}>No commands issued yet.</td></tr> : commands.map((command) => (
                <tr key={command.id}><td>{command.command_type}</td><td>{command.status}</td><td>{formatDateTime(command.issued_at)}</td><td>{formatDateTime(command.delivered_at)}</td><td className={styles.result}>{compactResult(command.result)}</td><td>{formatDateTime(command.expires_at)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
