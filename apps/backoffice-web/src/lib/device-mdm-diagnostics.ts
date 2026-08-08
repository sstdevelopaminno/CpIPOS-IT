export type DeviceMdmSeverity = "info" | "warning" | "critical";

export type DeviceMdmStatus = "healthy" | "degraded" | "critical" | "offline";

export type DeviceMdmIncidentCode =
  | "internet_offline"
  | "server_unreachable"
  | "dns_unhealthy"
  | "disk_low"
  | "memory_high"
  | "cpu_high"
  | "clock_drift"
  | "runtime_offline"
  | "local_bridge_offline"
  | "printer_missing"
  | "printer_error"
  | "print_queue_busy"
  | "drawer_error"
  | "offline_sale_sync_required"
  | "offline_sale_grace_warning"
  | "offline_sale_grace_expired"
  | "tamper_signal";

export type DeviceMdmThresholds = {
  disk_low_percent_free: number;
  memory_high_percent: number;
  cpu_high_percent: number;
  clock_drift_seconds: number;
  print_queue_warning_count: number;
  offline_sale_warning_days: number;
  offline_sale_max_days: number;
  offline_sale_hard_block_days: number;
};

export type DeviceMdmIdentity = {
  tenant_id: string;
  branch_id: string;
  device_code: string;
  machine_id: string;
  hostname?: string | null;
  windows_username?: string | null;
  runtime_version?: string | null;
  app_version?: string | null;
};

export type DeviceMdmConnectivity = {
  internet_online: boolean;
  server_reachable?: boolean | null;
  dns_healthy?: boolean | null;
  network_type?: string | null;
  ip_address?: string | null;
  latency_ms?: number | null;
  offline_since?: string | null;
  last_seen_at?: string | null;
};

export type DeviceMdmSystemHealth = {
  os_name?: string | null;
  os_version?: string | null;
  uptime_seconds?: number | null;
  cpu_percent?: number | null;
  memory_percent?: number | null;
  disk_total_gb?: number | null;
  disk_free_gb?: number | null;
  disk_used_percent?: number | null;
  clock_drift_seconds?: number | null;
  power_status?: string | null;
};

export type DeviceMdmRuntimeHealth = {
  cpi_windows_runtime_running: boolean;
  local_bridge_online: boolean;
  bridge_version?: string | null;
  bridge_port?: number | null;
  token_required?: boolean | null;
  request_slots_available?: number | null;
  print_queue_busy?: boolean | null;
  drawer_queue_busy?: boolean | null;
  printed_jobs?: number | null;
  failed_jobs?: number | null;
  drawer_commands?: number | null;
  last_error?: string | null;
};

export type DeviceMdmPeripheralHealth = {
  default_printer?: string | null;
  selected_printer?: string | null;
  selected_printer_valid?: boolean | null;
  printer_status?: string | null;
  print_queue_count?: number | null;
  last_print_at?: string | null;
  cash_drawer_supported?: boolean | null;
  last_drawer_at?: string | null;
  last_drawer_device?: string | null;
};

export type DeviceMdmOfflineSaleHealth = {
  last_sync_at?: string | null;
  offline_sale_enabled?: boolean | null;
  offline_sale_queue_count?: number | null;
  offline_sale_failed_count?: number | null;
  offline_sale_total_amount?: number | null;
  offline_since_days?: number | null;
};

export type DeviceMdmSecuritySignal = {
  code: string;
  severity: DeviceMdmSeverity;
  message: string;
  captured_at: string;
  metadata?: Record<string, unknown> | null;
};

export type DeviceMdmHealthInput = {
  identity: DeviceMdmIdentity;
  connectivity: DeviceMdmConnectivity;
  system: DeviceMdmSystemHealth;
  runtime: DeviceMdmRuntimeHealth;
  peripherals: DeviceMdmPeripheralHealth;
  offline_sale?: DeviceMdmOfflineSaleHealth | null;
  security_signals?: readonly DeviceMdmSecuritySignal[] | null;
  metadata?: Record<string, unknown> | null;
  captured_at?: string | null;
};

export type DeviceMdmIncident = {
  code: DeviceMdmIncidentCode;
  severity: DeviceMdmSeverity;
  title: string;
  message: string;
  detected_at: string;
  metadata?: Record<string, unknown> | null;
};

export type DeviceMdmHealthSnapshot = DeviceMdmHealthInput & {
  captured_at: string;
  status: DeviceMdmStatus;
  incidents: DeviceMdmIncident[];
};

export type DeviceMdmSummary = {
  status: DeviceMdmStatus;
  critical_count: number;
  warning_count: number;
  info_count: number;
  primary_incident: DeviceMdmIncident | null;
  needs_after_sales_attention: boolean;
  can_continue_offline_sale: boolean;
};

export const DEVICE_MDM_DEFAULT_THRESHOLDS: DeviceMdmThresholds = {
  disk_low_percent_free: 10,
  memory_high_percent: 90,
  cpu_high_percent: 92,
  clock_drift_seconds: 300,
  print_queue_warning_count: 5,
  offline_sale_warning_days: 7,
  offline_sale_max_days: 30,
  offline_sale_hard_block_days: 45
};

function toFiniteNumber(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function percentFreeDisk(system: DeviceMdmSystemHealth): number | null {
  const total = toFiniteNumber(system.disk_total_gb);
  const free = toFiniteNumber(system.disk_free_gb);
  if (total === null || free === null || total <= 0) return null;
  return Math.max(0, Math.min(100, (free / total) * 100));
}

function addIncident(incidents: DeviceMdmIncident[], incident: Omit<DeviceMdmIncident, "detected_at">, detectedAt: string) {
  incidents.push({ ...incident, detected_at: detectedAt });
}

function deriveDeviceStatus(incidents: readonly DeviceMdmIncident[], connectivity: DeviceMdmConnectivity): DeviceMdmStatus {
  if (!connectivity.internet_online && incidents.some((incident) => incident.code === "internet_offline")) return "offline";
  if (incidents.some((incident) => incident.severity === "critical")) return "critical";
  if (incidents.some((incident) => incident.severity === "warning")) return "degraded";
  return "healthy";
}

export function deriveDeviceMdmIncidents(
  input: DeviceMdmHealthInput,
  thresholds: DeviceMdmThresholds = DEVICE_MDM_DEFAULT_THRESHOLDS
): DeviceMdmIncident[] {
  const detectedAt = input.captured_at ?? new Date().toISOString();
  const incidents: DeviceMdmIncident[] = [];

  if (!input.connectivity.internet_online) {
    addIncident(
      incidents,
      {
        code: "internet_offline",
        severity: "warning",
        title: "Internet is offline",
        message: "The cashier device cannot confirm internet connectivity.",
        metadata: { offline_since: input.connectivity.offline_since ?? null }
      },
      detectedAt
    );
  }

  if (input.connectivity.server_reachable === false) {
    addIncident(
      incidents,
      {
        code: "server_unreachable",
        severity: "warning",
        title: "CpIPOS server is unreachable",
        message: "The device has network connectivity but cannot reach the CpIPOS backend.",
        metadata: { latency_ms: input.connectivity.latency_ms ?? null }
      },
      detectedAt
    );
  }

  if (input.connectivity.dns_healthy === false) {
    addIncident(
      incidents,
      {
        code: "dns_unhealthy",
        severity: "warning",
        title: "DNS lookup is unhealthy",
        message: "The device may be online but DNS resolution is failing or unstable."
      },
      detectedAt
    );
  }

  const diskFreePercent = percentFreeDisk(input.system);
  if (diskFreePercent !== null && diskFreePercent <= thresholds.disk_low_percent_free) {
    addIncident(
      incidents,
      {
        code: "disk_low",
        severity: diskFreePercent <= 5 ? "critical" : "warning",
        title: "Disk space is low",
        message: "The cashier device is running low on disk space.",
        metadata: { disk_free_percent: Number(diskFreePercent.toFixed(2)), disk_free_gb: input.system.disk_free_gb ?? null }
      },
      detectedAt
    );
  }

  const memoryPercent = toFiniteNumber(input.system.memory_percent);
  if (memoryPercent !== null && memoryPercent >= thresholds.memory_high_percent) {
    addIncident(
      incidents,
      {
        code: "memory_high",
        severity: memoryPercent >= 97 ? "critical" : "warning",
        title: "Memory usage is high",
        message: "The cashier device memory usage is high and may slow down POS operations.",
        metadata: { memory_percent: memoryPercent }
      },
      detectedAt
    );
  }

  const cpuPercent = toFiniteNumber(input.system.cpu_percent);
  if (cpuPercent !== null && cpuPercent >= thresholds.cpu_high_percent) {
    addIncident(
      incidents,
      {
        code: "cpu_high",
        severity: cpuPercent >= 98 ? "critical" : "warning",
        title: "CPU usage is high",
        message: "The cashier device CPU usage is high and may cause POS delays.",
        metadata: { cpu_percent: cpuPercent }
      },
      detectedAt
    );
  }

  const clockDriftSeconds = Math.abs(toFiniteNumber(input.system.clock_drift_seconds) ?? 0);
  if (clockDriftSeconds >= thresholds.clock_drift_seconds) {
    addIncident(
      incidents,
      {
        code: "clock_drift",
        severity: clockDriftSeconds >= 1800 ? "critical" : "warning",
        title: "Windows clock drift detected",
        message: "The device clock differs from server time and can affect receipt timestamps and offline sync.",
        metadata: { clock_drift_seconds: clockDriftSeconds }
      },
      detectedAt
    );
  }

  if (!input.runtime.cpi_windows_runtime_running) {
    addIncident(
      incidents,
      {
        code: "runtime_offline",
        severity: "critical",
        title: "CpIPOS Windows Runtime is offline",
        message: "The Windows Runtime is not running, so printer, drawer, and diagnostics features may be unavailable."
      },
      detectedAt
    );
  }

  if (!input.runtime.local_bridge_online) {
    addIncident(
      incidents,
      {
        code: "local_bridge_offline",
        severity: "critical",
        title: "Local Bridge is offline",
        message: "The local bridge is unavailable. Printing and cash drawer control may fail."
      },
      detectedAt
    );
  }

  if (input.peripherals.selected_printer_valid === false || !input.peripherals.selected_printer) {
    addIncident(
      incidents,
      {
        code: "printer_missing",
        severity: "warning",
        title: "Printer is not selected or invalid",
        message: "No valid receipt printer is selected for this cashier device.",
        metadata: { selected_printer: input.peripherals.selected_printer ?? null }
      },
      detectedAt
    );
  }

  const printerStatus = String(input.peripherals.printer_status ?? "").trim().toLowerCase();
  if (printerStatus && printerStatus !== "normal" && printerStatus !== "ready") {
    addIncident(
      incidents,
      {
        code: "printer_error",
        severity: printerStatus.includes("paper") ? "critical" : "warning",
        title: "Printer reports an error",
        message: "The receipt printer is reporting an abnormal status.",
        metadata: { printer_status: input.peripherals.printer_status ?? null }
      },
      detectedAt
    );
  }

  const printQueueCount = toFiniteNumber(input.peripherals.print_queue_count);
  if (input.runtime.print_queue_busy || (printQueueCount !== null && printQueueCount >= thresholds.print_queue_warning_count)) {
    addIncident(
      incidents,
      {
        code: "print_queue_busy",
        severity: "warning",
        title: "Print queue is busy",
        message: "The Windows print queue has pending jobs and may block receipt printing.",
        metadata: { print_queue_count: printQueueCount, print_queue_busy: input.runtime.print_queue_busy ?? null }
      },
      detectedAt
    );
  }

  if (input.runtime.drawer_queue_busy || input.runtime.last_error?.toLowerCase().includes("drawer")) {
    addIncident(
      incidents,
      {
        code: "drawer_error",
        severity: "warning",
        title: "Cash drawer may be unavailable",
        message: "The runtime reported a cash drawer queue or drawer-related error.",
        metadata: { last_error: input.runtime.last_error ?? null }
      },
      detectedAt
    );
  }

  const offlineSale = input.offline_sale;
  const offlineDays = toFiniteNumber(offlineSale?.offline_since_days);
  const queueCount = toFiniteNumber(offlineSale?.offline_sale_queue_count) ?? 0;
  const failedCount = toFiniteNumber(offlineSale?.offline_sale_failed_count) ?? 0;

  if (queueCount > 0 || failedCount > 0) {
    addIncident(
      incidents,
      {
        code: "offline_sale_sync_required",
        severity: failedCount > 0 ? "critical" : "warning",
        title: "Offline sales require sync",
        message: "This cashier device has offline sales waiting to sync back to the server.",
        metadata: { queue_count: queueCount, failed_count: failedCount, total_amount: offlineSale?.offline_sale_total_amount ?? null }
      },
      detectedAt
    );
  }

  if (offlineDays !== null && offlineDays >= thresholds.offline_sale_warning_days && offlineDays <= thresholds.offline_sale_max_days) {
    addIncident(
      incidents,
      {
        code: "offline_sale_grace_warning",
        severity: "warning",
        title: "Offline grace period warning",
        message: "The device is still inside the offline sale grace period but should sync soon.",
        metadata: { offline_since_days: offlineDays, max_days: thresholds.offline_sale_max_days }
      },
      detectedAt
    );
  }

  if (offlineDays !== null && offlineDays > thresholds.offline_sale_max_days) {
    addIncident(
      incidents,
      {
        code: "offline_sale_grace_expired",
        severity: offlineDays >= thresholds.offline_sale_hard_block_days ? "critical" : "warning",
        title: "Offline grace period expired",
        message: "The device has exceeded the normal offline sale grace period and should require owner override or sync.",
        metadata: {
          offline_since_days: offlineDays,
          max_days: thresholds.offline_sale_max_days,
          hard_block_days: thresholds.offline_sale_hard_block_days
        }
      },
      detectedAt
    );
  }

  for (const signal of input.security_signals ?? []) {
    addIncident(
      incidents,
      {
        code: "tamper_signal",
        severity: signal.severity,
        title: "Device tamper signal detected",
        message: signal.message,
        metadata: { signal_code: signal.code, ...(signal.metadata ?? {}) }
      },
      signal.captured_at
    );
  }

  return incidents;
}

export function buildDeviceMdmHealthSnapshot(
  input: DeviceMdmHealthInput,
  thresholds: DeviceMdmThresholds = DEVICE_MDM_DEFAULT_THRESHOLDS
): DeviceMdmHealthSnapshot {
  const capturedAt = input.captured_at ?? new Date().toISOString();
  const incidents = deriveDeviceMdmIncidents({ ...input, captured_at: capturedAt }, thresholds);
  return {
    ...input,
    captured_at: capturedAt,
    incidents,
    status: deriveDeviceStatus(incidents, input.connectivity)
  };
}

export function summarizeDeviceMdmHealth(snapshot: DeviceMdmHealthSnapshot): DeviceMdmSummary {
  const criticalCount = snapshot.incidents.filter((incident) => incident.severity === "critical").length;
  const warningCount = snapshot.incidents.filter((incident) => incident.severity === "warning").length;
  const infoCount = snapshot.incidents.filter((incident) => incident.severity === "info").length;
  const primaryIncident =
    snapshot.incidents.find((incident) => incident.severity === "critical") ??
    snapshot.incidents.find((incident) => incident.severity === "warning") ??
    snapshot.incidents[0] ??
    null;
  const offlineDays = toFiniteNumber(snapshot.offline_sale?.offline_since_days) ?? 0;

  return {
    status: snapshot.status,
    critical_count: criticalCount,
    warning_count: warningCount,
    info_count: infoCount,
    primary_incident: primaryIncident,
    needs_after_sales_attention: criticalCount > 0 || warningCount > 0,
    can_continue_offline_sale: offlineDays <= DEVICE_MDM_DEFAULT_THRESHOLDS.offline_sale_hard_block_days
  };
}
