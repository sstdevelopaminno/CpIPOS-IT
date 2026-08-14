import "server-only";

import {
  buildDeviceMdmHealthSnapshot,
  resolveDeviceMdmTelemetryProfile,
  summarizeDeviceMdmHealth,
  type DeviceMdmHealthInput,
  type DeviceMdmStatus,
  type DeviceMdmTelemetryProfile
} from "@/lib/device-mdm-diagnostics";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

type SupportSupabase = ReturnType<typeof getSupabaseServiceClient>;
type JsonRecord = Record<string, unknown>;

type HealthRow = {
  id: string;
  tenant_id: string;
  branch_id: string;
  pos_device_id: string | null;
  pos_session_id: string | null;
  device_code: string | null;
  machine_id: string;
  runtime_version: string | null;
  app_version: string | null;
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
  captured_at: string;
  last_seen_at: string;
};

export type SupportDeviceStatus = DeviceMdmStatus | "unknown";

export type SupportDevice = {
  id: string;
  branch_id: string;
  branch_code: string | null;
  branch_name: string | null;
  device_code: string;
  device_name: string;
  device_type: string | null;
  registration_status: string;
  is_active: boolean;
  is_locked: boolean;
  telemetry_profile: DeviceMdmTelemetryProfile | "unknown";
  stored_status: string | null;
  effective_status: SupportDeviceStatus;
  connection_state: "live" | "stale" | "offline" | "never_seen";
  last_seen_at: string | null;
  last_seen_age_seconds: number | null;
  app_version: string | null;
  runtime_version: string | null;
  machine_id: string | null;
  platform: string | null;
  os_version: string | null;
  cpu_percent: number | null;
  memory_percent: number | null;
  disk_free_gb: number | null;
  battery_percent: number | null;
  primary_incident: {
    code: string;
    severity: "info" | "warning" | "critical";
    title: string;
    message: string;
  } | null;
  incidents: Array<{
    code: string;
    severity: "info" | "warning" | "critical";
    title: string;
    message: string;
    detected_at: string;
  }>;
};

export type SupportCenterSnapshot = {
  generated_at: string;
  query: string;
  access_code: string | null;
  tenant: {
    id: string;
    code: string;
    name: string;
    display_name: string | null;
    owner_name: string | null;
    owner_phone: string | null;
    contact_phone: string | null;
    is_active: boolean;
  };
  lifecycle: {
    status: string | null;
    data_home: string | null;
    migration_status: string | null;
    subscription_expires_at: string | null;
    access_locked: boolean;
    lock_reason: string | null;
  } | null;
  contract: {
    id: string;
    status: string;
    start_date: string | null;
    end_date: string | null;
    max_branches: number | null;
    max_devices: number | null;
    max_users: number | null;
  } | null;
  branches: Array<{ id: string; code: string; name: string; is_active: boolean }>;
  devices: SupportDevice[];
  incidents: Array<SupportDevice["incidents"][number] & { device_id: string; device_code: string; branch_name: string | null }>;
  operations: {
    active_sessions: number;
    open_shifts: number;
    printing: {
      jobs_24h: number;
      pending: number;
      retrying: number;
      failed: number;
      printers: number;
      printers_online: number;
      agents: number;
      agents_online: number;
      recent_failures: Array<{
        id: string;
        branch_id: string;
        printer_role: string | null;
        status: string;
        retry_count: number;
        last_error: string | null;
        created_at: string;
      }>;
    };
    kitchen: {
      tickets_24h: number;
      active_tickets: number;
    };
  };
  health: {
    registered_devices: number;
    live: number;
    stale: number;
    offline: number;
    healthy: number;
    degraded: number;
    critical: number;
    unknown: number;
  };
};

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeSecuritySignals(value: unknown): DeviceMdmHealthInput["security_signals"] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const row = asRecord(item);
      const severity = asString(row.severity);
      const code = asString(row.code);
      const message = asString(row.message);
      const capturedAt = asString(row.captured_at);
      if (!code || !message || !capturedAt || !severity || !["info", "warning", "critical"].includes(severity)) return null;
      return {
        code,
        message,
        captured_at: capturedAt,
        severity: severity as "info" | "warning" | "critical",
        metadata: asRecord(row.metadata)
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));
}

function toHealthInput(row: HealthRow): DeviceMdmHealthInput {
  const identity = asRecord(row.identity);
  const connectivity = asRecord(row.connectivity);
  const system = asRecord(row.system_health);
  const runtime = asRecord(row.runtime_health);
  const peripherals = asRecord(row.peripheral_health);
  const offlineSale = asRecord(row.offline_sale_health);
  const metadata = asRecord(row.metadata);

  return {
    identity: {
      tenant_id: asString(identity.tenant_id) ?? row.tenant_id,
      branch_id: asString(identity.branch_id) ?? row.branch_id,
      device_code: asString(identity.device_code) ?? row.device_code ?? "UNKNOWN",
      machine_id: asString(identity.machine_id) ?? row.machine_id,
      hostname: asString(identity.hostname),
      windows_username: asString(identity.windows_username),
      runtime_version: asString(identity.runtime_version) ?? row.runtime_version,
      app_version: asString(identity.app_version) ?? row.app_version
    },
    connectivity: {
      internet_online: asBoolean(connectivity.internet_online, true),
      server_reachable: typeof connectivity.server_reachable === "boolean" ? connectivity.server_reachable : null,
      dns_healthy: typeof connectivity.dns_healthy === "boolean" ? connectivity.dns_healthy : null,
      network_type: asString(connectivity.network_type),
      ip_address: asString(connectivity.ip_address),
      latency_ms: asNumber(connectivity.latency_ms),
      offline_since: asString(connectivity.offline_since),
      last_seen_at: asString(connectivity.last_seen_at) ?? row.last_seen_at
    },
    system: {
      os_name: asString(system.os_name),
      os_version: asString(system.os_version),
      uptime_seconds: asNumber(system.uptime_seconds),
      cpu_percent: asNumber(system.cpu_percent),
      memory_percent: asNumber(system.memory_percent),
      disk_total_gb: asNumber(system.disk_total_gb),
      disk_free_gb: asNumber(system.disk_free_gb),
      disk_used_percent: asNumber(system.disk_used_percent),
      clock_drift_seconds: asNumber(system.clock_drift_seconds),
      power_status: asString(system.power_status)
    },
    runtime: {
      cpi_windows_runtime_running: asBoolean(runtime.cpi_windows_runtime_running),
      local_bridge_online: asBoolean(runtime.local_bridge_online),
      bridge_version: asString(runtime.bridge_version),
      bridge_port: asNumber(runtime.bridge_port),
      token_required: typeof runtime.token_required === "boolean" ? runtime.token_required : null,
      request_slots_available: asNumber(runtime.request_slots_available),
      print_queue_busy: typeof runtime.print_queue_busy === "boolean" ? runtime.print_queue_busy : null,
      drawer_queue_busy: typeof runtime.drawer_queue_busy === "boolean" ? runtime.drawer_queue_busy : null,
      printed_jobs: asNumber(runtime.printed_jobs),
      failed_jobs: asNumber(runtime.failed_jobs),
      drawer_commands: asNumber(runtime.drawer_commands),
      last_error: asString(runtime.last_error)
    },
    peripherals: {
      default_printer: asString(peripherals.default_printer),
      selected_printer: asString(peripherals.selected_printer),
      selected_printer_valid: typeof peripherals.selected_printer_valid === "boolean" ? peripherals.selected_printer_valid : null,
      printer_status: asString(peripherals.printer_status),
      print_queue_count: asNumber(peripherals.print_queue_count),
      last_print_at: asString(peripherals.last_print_at),
      cash_drawer_supported: typeof peripherals.cash_drawer_supported === "boolean" ? peripherals.cash_drawer_supported : null,
      last_drawer_at: asString(peripherals.last_drawer_at),
      last_drawer_device: asString(peripherals.last_drawer_device)
    },
    offline_sale: {
      last_sync_at: asString(offlineSale.last_sync_at),
      offline_sale_enabled: typeof offlineSale.offline_sale_enabled === "boolean" ? offlineSale.offline_sale_enabled : null,
      offline_sale_queue_count: asNumber(offlineSale.offline_sale_queue_count),
      offline_sale_failed_count: asNumber(offlineSale.offline_sale_failed_count),
      offline_sale_total_amount: asNumber(offlineSale.offline_sale_total_amount),
      offline_since_days: asNumber(offlineSale.offline_since_days)
    },
    security_signals: normalizeSecuritySignals(row.security_signals),
    metadata,
    captured_at: row.captured_at
  };
}

function ageSeconds(value: string | null | undefined, nowMs: number): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.floor((nowMs - parsed) / 1000));
}

function connectionState(seconds: number | null): SupportDevice["connection_state"] {
  if (seconds === null) return "never_seen";
  if (seconds <= 120) return "live";
  if (seconds <= 600) return "stale";
  return "offline";
}

function effectiveStatus(status: DeviceMdmStatus, state: SupportDevice["connection_state"]): SupportDeviceStatus {
  if (state === "offline" || state === "never_seen") return "offline";
  if (state === "stale" && status === "healthy") return "degraded";
  return status;
}

function checkQuery<T>(result: { data: T | null; error: { message?: string } | null }, label: string): T {
  if (result.error) throw new Error(`${label}: ${result.error.message ?? "query failed"}`);
  return result.data as T;
}

async function resolveTenantId(supabase: SupportSupabase, rawQuery: string) {
  const query = rawQuery.trim();
  if (!query) return null;

  if (/^\d{6}$/.test(query)) {
    const result = await supabase
      .from("tenant_access_codes")
      .select("tenant_id,access_code,purpose,is_active")
      .eq("access_code", query)
      .eq("is_active", true)
      .maybeSingle();
    if (result.error) throw new Error(`store code lookup: ${result.error.message}`);
    if (result.data) return { tenantId: String(result.data.tenant_id), accessCode: String(result.data.access_code) };
  }

  const tenantResult = await supabase
    .from("tenants")
    .select("id,code")
    .ilike("code", query)
    .maybeSingle();
  if (tenantResult.error) throw new Error(`tenant code lookup: ${tenantResult.error.message}`);
  if (!tenantResult.data) return null;

  const codeResult = await supabase
    .from("tenant_access_codes")
    .select("access_code")
    .eq("tenant_id", tenantResult.data.id)
    .eq("is_active", true)
    .order("issued_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    tenantId: String(tenantResult.data.id),
    accessCode: codeResult.data?.access_code ? String(codeResult.data.access_code) : null
  };
}

export async function getSupportCenterSnapshot(supabase: SupportSupabase, rawQuery: string): Promise<SupportCenterSnapshot | null> {
  const resolved = await resolveTenantId(supabase, rawQuery);
  if (!resolved) return null;

  const tenantId = resolved.tenantId;
  const now = new Date();
  const nowMs = now.getTime();
  const since24h = new Date(nowMs - 24 * 60 * 60 * 1000).toISOString();

  const [tenantResult, lifecycleResult, contractResult, branchesResult, devicesResult, healthResult] = await Promise.all([
    supabase.from("tenants").select("id,code,name,display_name,owner_name,owner_phone,contact_phone,is_active").eq("id", tenantId).single(),
    supabase
      .from("tenant_data_lifecycle")
      .select("lifecycle_status,data_home,migration_status,subscription_expires_at,access_locked,lock_reason")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    supabase
      .from("tenant_contracts")
      .select("id,status,start_date,end_date,max_branches,max_devices,max_users")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("branches").select("id,code,name,is_active").eq("tenant_id", tenantId).order("created_at", { ascending: true }),
    supabase
      .from("branch_devices")
      .select("id,branch_id,device_code,device_name,device_type,status,is_locked,is_active,last_seen_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: true }),
    supabase
      .from("pos_device_health_latest")
      .select(
        "id,tenant_id,branch_id,pos_device_id,pos_session_id,device_code,machine_id,runtime_version,app_version,status,summary,identity,connectivity,system_health,runtime_health,peripheral_health,offline_sale_health,security_signals,metadata,captured_at,last_seen_at"
      )
      .eq("tenant_id", tenantId)
      .order("last_seen_at", { ascending: false })
      .limit(500)
  ]);

  const tenant = checkQuery(tenantResult, "tenant") as any;
  const lifecycle = checkQuery(lifecycleResult, "tenant lifecycle") as any;
  const contract = checkQuery(contractResult, "tenant contract") as any;
  const branches = (checkQuery(branchesResult, "branches") ?? []) as any[];
  const registeredDevices = (checkQuery(devicesResult, "branch devices") ?? []) as any[];
  const healthRows = (checkQuery(healthResult, "device health") ?? []) as HealthRow[];

  const branchById = new Map(branches.map((branch) => [String(branch.id), branch]));
  const latestByDevice = new Map<string, HealthRow>();
  for (const row of healthRows) {
    const key = row.pos_device_id ? `id:${row.pos_device_id}` : `code:${row.branch_id}:${row.device_code ?? ""}`;
    if (!latestByDevice.has(key)) latestByDevice.set(key, row);
  }

  const devices: SupportDevice[] = registeredDevices.map((device) => {
    const key = `id:${String(device.id)}`;
    const fallbackKey = `code:${String(device.branch_id)}:${String(device.device_code ?? "")}`;
    const row = latestByDevice.get(key) ?? latestByDevice.get(fallbackKey) ?? null;
    const branch = branchById.get(String(device.branch_id));

    if (!row) {
      return {
        id: String(device.id),
        branch_id: String(device.branch_id),
        branch_code: branch?.code ? String(branch.code) : null,
        branch_name: branch?.name ? String(branch.name) : null,
        device_code: String(device.device_code ?? "UNKNOWN"),
        device_name: String(device.device_name ?? device.device_code ?? "POS Device"),
        device_type: device.device_type ? String(device.device_type) : null,
        registration_status: String(device.status ?? "unknown"),
        is_active: Boolean(device.is_active),
        is_locked: Boolean(device.is_locked),
        telemetry_profile: "unknown",
        stored_status: null,
        effective_status: "offline",
        connection_state: "never_seen",
        last_seen_at: device.last_seen_at ? String(device.last_seen_at) : null,
        last_seen_age_seconds: ageSeconds(device.last_seen_at ? String(device.last_seen_at) : null, nowMs),
        app_version: null,
        runtime_version: null,
        machine_id: null,
        platform: null,
        os_version: null,
        cpu_percent: null,
        memory_percent: null,
        disk_free_gb: null,
        battery_percent: null,
        primary_incident: {
          code: "heartbeat_missing",
          severity: "critical",
          title: "No device heartbeat",
          message: "The registered POS device has no current MDM heartbeat."
        },
        incidents: [
          {
            code: "heartbeat_missing",
            severity: "critical",
            title: "No device heartbeat",
            message: "The registered POS device has no current MDM heartbeat.",
            detected_at: now.toISOString()
          }
        ]
      } satisfies SupportDevice;
    }

    const input = toHealthInput(row);
    const snapshot = buildDeviceMdmHealthSnapshot(input);
    const summary = summarizeDeviceMdmHealth(snapshot);
    const telemetryProfile = resolveDeviceMdmTelemetryProfile(input);
    const seconds = ageSeconds(row.last_seen_at, nowMs);
    const state = connectionState(seconds);
    const status = effectiveStatus(snapshot.status, state);
    const system = asRecord(row.system_health);
    const native = asRecord(asRecord(row.metadata).native_android_diagnostics);
    const nativeHealth = asRecord(native.health);
    const incidents = snapshot.incidents.map((incident) => ({
      code: incident.code,
      severity: incident.severity,
      title: incident.title,
      message: incident.message,
      detected_at: incident.detected_at
    }));

    if (state === "stale" || state === "offline") {
      incidents.unshift({
        code: "heartbeat_stale",
        severity: state === "offline" ? "critical" : "warning",
        title: state === "offline" ? "POS device is offline" : "POS heartbeat is stale",
        message: state === "offline" ? "No heartbeat has been received for more than 10 minutes." : "Heartbeat is older than the normal 2-minute live window.",
        detected_at: now.toISOString()
      });
    }

    const primary = incidents.find((incident) => incident.severity === "critical") ?? incidents.find((incident) => incident.severity === "warning") ?? summary.primary_incident;

    return {
      id: String(device.id),
      branch_id: String(device.branch_id),
      branch_code: branch?.code ? String(branch.code) : null,
      branch_name: branch?.name ? String(branch.name) : null,
      device_code: String(device.device_code ?? row.device_code ?? "UNKNOWN"),
      device_name: String(device.device_name ?? device.device_code ?? "POS Device"),
      device_type: device.device_type ? String(device.device_type) : null,
      registration_status: String(device.status ?? "unknown"),
      is_active: Boolean(device.is_active),
      is_locked: Boolean(device.is_locked),
      telemetry_profile: telemetryProfile,
      stored_status: row.status,
      effective_status: status,
      connection_state: state,
      last_seen_at: row.last_seen_at,
      last_seen_age_seconds: seconds,
      app_version: row.app_version,
      runtime_version: row.runtime_version,
      machine_id: row.machine_id,
      platform: asString(system.os_name),
      os_version: asString(system.os_version),
      cpu_percent: asNumber(system.cpu_percent),
      memory_percent: asNumber(system.memory_percent),
      disk_free_gb: asNumber(system.disk_free_gb),
      battery_percent: asNumber(nativeHealth.battery_percent),
      primary_incident: primary
        ? { code: primary.code, severity: primary.severity, title: primary.title, message: primary.message }
        : null,
      incidents
    } satisfies SupportDevice;
  });

  const [sessionsResult, shiftsResult, print24Result, printPendingResult, printRetryingResult, printFailedResult, printFailuresResult, printersResult, agentsResult, kitchen24Result, kitchenActiveResult] =
    await Promise.all([
      supabase.from("pos_sessions").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("status", "active").gt("expires_at", now.toISOString()),
      supabase.from("shifts").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("status", "open"),
      supabase.from("print_jobs").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).gte("created_at", since24h),
      supabase.from("print_jobs").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("status", "pending"),
      supabase.from("print_jobs").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("status", "retrying"),
      supabase.from("print_jobs").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("status", "failed").gte("created_at", since24h),
      supabase
        .from("print_jobs")
        .select("id,branch_id,printer_role,status,retry_count,last_error,created_at")
        .eq("tenant_id", tenantId)
        .in("status", ["failed", "retrying"])
        .order("created_at", { ascending: false })
        .limit(12),
      supabase.from("printer_devices").select("id,status,last_seen_at,is_active").eq("tenant_id", tenantId).eq("is_active", true),
      supabase.from("print_agents").select("id,status,last_seen_at").eq("tenant_id", tenantId),
      supabase.from("kitchen_tickets").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).gte("created_at", since24h),
      supabase
        .from("kitchen_tickets")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .not("status", "in", "(completed,cancelled,voided)")
    ]);

  const printers = printersResult.error ? [] : printersResult.data ?? [];
  const agents = agentsResult.error ? [] : agentsResult.data ?? [];
  const onlineWithinSeconds = (value: unknown, threshold: number) => {
    const seconds = ageSeconds(asString(value), nowMs);
    return seconds !== null && seconds <= threshold;
  };

  const incidents = devices
    .flatMap((device) =>
      device.incidents.map((incident) => ({
        ...incident,
        device_id: device.id,
        device_code: device.device_code,
        branch_name: device.branch_name
      }))
    )
    .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "critical" ? -1 : b.severity === "critical" ? 1 : 0))
    .slice(0, 30);

  const count = (result: { count: number | null; error: unknown }) => (result.error ? 0 : result.count ?? 0);
  const recentFailures = printFailuresResult.error ? [] : (printFailuresResult.data ?? []).map((row: any) => ({
    id: String(row.id),
    branch_id: String(row.branch_id),
    printer_role: row.printer_role ? String(row.printer_role) : null,
    status: String(row.status),
    retry_count: Number(row.retry_count ?? 0),
    last_error: row.last_error ? String(row.last_error) : null,
    created_at: String(row.created_at)
  }));

  return {
    generated_at: now.toISOString(),
    query: rawQuery.trim(),
    access_code: resolved.accessCode,
    tenant: {
      id: String(tenant.id),
      code: String(tenant.code),
      name: String(tenant.name),
      display_name: tenant.display_name ? String(tenant.display_name) : null,
      owner_name: tenant.owner_name ? String(tenant.owner_name) : null,
      owner_phone: tenant.owner_phone ? String(tenant.owner_phone) : null,
      contact_phone: tenant.contact_phone ? String(tenant.contact_phone) : null,
      is_active: Boolean(tenant.is_active)
    },
    lifecycle: lifecycle
      ? {
          status: lifecycle.lifecycle_status ? String(lifecycle.lifecycle_status) : null,
          data_home: lifecycle.data_home ? String(lifecycle.data_home) : null,
          migration_status: lifecycle.migration_status ? String(lifecycle.migration_status) : null,
          subscription_expires_at: lifecycle.subscription_expires_at ? String(lifecycle.subscription_expires_at) : null,
          access_locked: Boolean(lifecycle.access_locked),
          lock_reason: lifecycle.lock_reason ? String(lifecycle.lock_reason) : null
        }
      : null,
    contract: contract
      ? {
          id: String(contract.id),
          status: String(contract.status),
          start_date: contract.start_date ? String(contract.start_date) : null,
          end_date: contract.end_date ? String(contract.end_date) : null,
          max_branches: contract.max_branches == null ? null : Number(contract.max_branches),
          max_devices: contract.max_devices == null ? null : Number(contract.max_devices),
          max_users: contract.max_users == null ? null : Number(contract.max_users)
        }
      : null,
    branches: branches.map((branch) => ({
      id: String(branch.id),
      code: String(branch.code),
      name: String(branch.name),
      is_active: Boolean(branch.is_active)
    })),
    devices,
    incidents,
    operations: {
      active_sessions: count(sessionsResult),
      open_shifts: count(shiftsResult),
      printing: {
        jobs_24h: count(print24Result),
        pending: count(printPendingResult),
        retrying: count(printRetryingResult),
        failed: count(printFailedResult),
        printers: printers.length,
        printers_online: printers.filter((row: any) => String(row.status ?? "").toLowerCase() === "online" || onlineWithinSeconds(row.last_seen_at, 180)).length,
        agents: agents.length,
        agents_online: agents.filter((row: any) => String(row.status ?? "").toLowerCase() === "online" || onlineWithinSeconds(row.last_seen_at, 180)).length,
        recent_failures: recentFailures
      },
      kitchen: {
        tickets_24h: count(kitchen24Result),
        active_tickets: count(kitchenActiveResult)
      }
    },
    health: {
      registered_devices: devices.length,
      live: devices.filter((device) => device.connection_state === "live").length,
      stale: devices.filter((device) => device.connection_state === "stale").length,
      offline: devices.filter((device) => device.connection_state === "offline" || device.connection_state === "never_seen").length,
      healthy: devices.filter((device) => device.effective_status === "healthy").length,
      degraded: devices.filter((device) => device.effective_status === "degraded").length,
      critical: devices.filter((device) => device.effective_status === "critical").length,
      unknown: devices.filter((device) => device.effective_status === "unknown").length
    }
  };
}
