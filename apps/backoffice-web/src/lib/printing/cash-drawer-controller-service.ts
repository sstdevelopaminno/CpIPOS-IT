import type { PrinterConnectionType, PrinterProfile, PrintJob } from "@pos/shared-types";
import type { AuthContext } from "@/lib/auth-context";
import { appendAuditLog } from "@/lib/audit-log";
import { readEnv } from "@/lib/env";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import { enqueuePrintJob, processPrintJob } from "@/lib/printing/print-service";

type JsonRecord = Record<string, unknown>;

type PrinterProfileRow = PrinterProfile & {
  created_by?: string | null;
};

type PrintJobRow = PrintJob & {
  created_by?: string | null;
};

export type CashDrawerConnectionMode =
  | "printer-kick"
  | "emergency-printer-kick"
  | "external-usb-controller"
  | "external-serial-controller"
  | "external-network-controller"
  | "vendor-sdk";

export type OpenCashDrawerControllerInput = {
  triggerSource: "manual" | "cash_payment" | "emergency_manual";
  reason?: string | null;
  sessionId?: string | null;
  shiftId?: string | null;
  posDeviceId?: string | null;
  orderId?: string | null;
  paymentId?: string | null;
  requestedMode?: CashDrawerConnectionMode | null;
  metadata?: JsonRecord;
};

type CashDrawerControllerProfile = {
  enabled: boolean;
  connectionMode: CashDrawerConnectionMode;
  openSupported: boolean;
  statusSupported: boolean;
  closeSupported: false;
  allowStaffManualOpen: boolean;
  requireReason: boolean;
  kickPin: 0 | 1;
  pulseOnMs: number;
  pulseOffMs: number;
  autoOpenOnCashPayment: boolean;
  controllerPort: string | null;
  controllerUrl: string | null;
  controllerProtocol: "escpos" | "pulse" | "vendor";
};

type DrawerCandidate = {
  printer: PrinterProfileRow;
  drawer: CashDrawerControllerProfile;
};

function asRecord(value: unknown): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as JsonRecord;
}

function asBool(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") return value;
  return fallback;
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function normalizeDrawerMode(value: unknown): CashDrawerConnectionMode {
  const normalized = normalizeText(value)?.toLowerCase().replace(/_/g, "-");
  if (normalized === "emergency-printer-kick" || normalized === "emergency") return "emergency-printer-kick";
  if (normalized === "external-usb-controller" || normalized === "external-usb" || normalized === "direct-usb" || normalized === "usb-controller") return "external-usb-controller";
  if (normalized === "external-serial-controller" || normalized === "external-serial" || normalized === "direct-serial" || normalized === "serial-controller") return "external-serial-controller";
  if (normalized === "external-network-controller" || normalized === "external-network" || normalized === "lan-controller" || normalized === "wifi-controller") return "external-network-controller";
  if (normalized === "vendor-sdk" || normalized === "vendor") return "vendor-sdk";
  return "printer-kick";
}

function readCashDrawerControllerProfile(printer: PrinterProfileRow): CashDrawerControllerProfile {
  const metadata = asRecord(printer.metadata);
  const drawer = asRecord(metadata.cash_drawer);
  const connectionMode = normalizeDrawerMode(
    drawer.connectionMode ?? drawer.connection_mode ?? drawer.mode ?? metadata.drawer_connection_mode ?? metadata.cash_drawer_connection_mode
  );
  const controllerProtocol = normalizeText(drawer.controllerProtocol ?? drawer.controller_protocol ?? metadata.drawer_controller_protocol)?.toLowerCase();

  return {
    enabled: asBool(drawer.enabled ?? metadata.cash_drawer_enabled, false),
    connectionMode,
    openSupported: asBool(drawer.openSupported ?? drawer.open_supported ?? metadata.cash_drawer_open_supported, true),
    statusSupported: asBool(drawer.statusSupported ?? drawer.status_supported ?? metadata.cash_drawer_status_supported, false),
    closeSupported: false,
    allowStaffManualOpen: asBool(drawer.allowStaffManualOpen ?? drawer.allow_staff_manual_open ?? metadata.drawer_allow_staff_manual_open, false),
    requireReason: asBool(drawer.requireReason ?? drawer.require_reason ?? metadata.drawer_require_reason, true),
    kickPin: clampNumber(drawer.kickPin ?? drawer.kick_pin ?? metadata.drawer_kick_pin, 0, 0, 1) === 1 ? 1 : 0,
    pulseOnMs: clampNumber(drawer.pulseOnMs ?? drawer.pulse_on_ms ?? metadata.drawer_pulse_on_ms, 50, 20, 500),
    pulseOffMs: clampNumber(drawer.pulseOffMs ?? drawer.pulse_off_ms ?? metadata.drawer_pulse_off_ms, 250, 20, 500),
    autoOpenOnCashPayment: asBool(drawer.autoOpenOnCashPayment ?? drawer.auto_open_on_cash_payment ?? metadata.cash_drawer_auto_open_cash, false),
    controllerPort: normalizeText(drawer.controllerPort ?? drawer.controller_port ?? metadata.drawer_controller_port),
    controllerUrl: normalizeText(drawer.controllerUrl ?? drawer.controller_url ?? metadata.drawer_controller_url),
    controllerProtocol: controllerProtocol === "vendor" || controllerProtocol === "pulse" ? controllerProtocol : "escpos"
  };
}

function nowIso() {
  return new Date().toISOString();
}

function isCloudRuntime() {
  return readEnv("VERCEL") === "1" || Boolean(readEnv("VERCEL_ENV"));
}

function shouldProcessDrawerCommandOnServer(printer: PrinterProfileRow) {
  const metadata = asRecord(printer.metadata);
  if (metadata.server_direct_drawer_open === true || metadata.process_drawer_on_server === true || metadata.server_direct_print === true) return true;
  return !isCloudRuntime();
}

function canOpenDrawerManually(auth: AuthContext, drawer: CashDrawerControllerProfile) {
  if (auth.branchRole === "owner" || auth.branchRole === "manager") return true;
  return drawer.allowStaffManualOpen === true;
}

async function assertCashDrawerCooldown(auth: AuthContext, input: OpenCashDrawerControllerInput) {
  const supabase = getSupabaseServiceClient();
  const cooldownSince = new Date(Date.now() - 3000).toISOString();
  let query = supabase
    .from("cash_drawer_events")
    .select("id")
    .eq("tenant_id", auth.tenantId!)
    .eq("branch_id", auth.branchId!)
    .gte("created_at", cooldownSince)
    .in("command_status", ["queued", "sent"])
    .limit(1);

  if (input.posDeviceId) query = query.eq("pos_device_id", input.posDeviceId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  if ((data ?? []).length > 0) throw new Error("drawer_cooldown");
}

async function getEnabledReceiptPrinters(auth: AuthContext) {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("printer_profiles")
    .select("id,tenant_id,branch_id,printer_name,printer_role,connection_type,ip_address,port,paper_width_mm,enabled,metadata,created_at,updated_at")
    .eq("tenant_id", auth.tenantId!)
    .eq("branch_id", auth.branchId!)
    .eq("printer_role", "receipt")
    .eq("enabled", true)
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as PrinterProfileRow[];
}

function selectDrawerCandidate(printers: PrinterProfileRow[], input: OpenCashDrawerControllerInput): DrawerCandidate | null {
  const candidates = printers
    .map((printer) => ({ printer, drawer: readCashDrawerControllerProfile(printer) }))
    .filter((candidate) => candidate.drawer.enabled && candidate.drawer.openSupported);

  if (input.requestedMode) {
    return candidates.find((candidate) => candidate.drawer.connectionMode === input.requestedMode) ?? null;
  }

  const preferredOrder: CashDrawerConnectionMode[] = [
    "external-usb-controller",
    "external-serial-controller",
    "external-network-controller",
    "vendor-sdk",
    "emergency-printer-kick",
    "printer-kick"
  ];

  for (const mode of preferredOrder) {
    const match = candidates.find((candidate) => candidate.drawer.connectionMode === mode);
    if (match) return match;
  }

  return null;
}

async function writeCashDrawerEvent(
  auth: AuthContext,
  candidate: DrawerCandidate,
  input: OpenCashDrawerControllerInput,
  patch?: Partial<{
    print_job_id: string | null;
    command_status: "queued" | "sent" | "failed";
    physical_status: "open" | "closed" | "unknown" | "unsupported" | "offline";
    error_code: string | null;
    metadata: JsonRecord;
  }>,
  eventId?: string
) {
  const supabase = getSupabaseServiceClient();
  const base = {
    tenant_id: auth.tenantId!,
    branch_id: auth.branchId!,
    pos_device_id: input.posDeviceId ?? null,
    printer_profile_id: candidate.printer.id,
    print_job_id: patch?.print_job_id ?? null,
    user_id: auth.userId,
    session_id: input.sessionId ?? null,
    shift_id: input.shiftId ?? null,
    order_id: input.orderId ?? null,
    payment_id: input.paymentId ?? null,
    trigger_source: input.triggerSource,
    reason: normalizeText(input.reason),
    command_status: patch?.command_status ?? "queued",
    physical_status: patch?.physical_status ?? "unknown",
    error_code: patch?.error_code ?? null,
    metadata: patch?.metadata ?? input.metadata ?? {}
  };

  if (eventId) {
    const { data, error } = await supabase
      .from("cash_drawer_events")
      .update({
        print_job_id: base.print_job_id,
        command_status: base.command_status,
        physical_status: base.physical_status,
        error_code: base.error_code,
        metadata: base.metadata
      })
      .eq("id", eventId)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return data.id as string;
  }

  const { data, error } = await supabase.from("cash_drawer_events").insert(base).select("id").single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

export async function hasConfiguredCashDrawerController(auth: AuthContext) {
  const printers = await getEnabledReceiptPrinters(auth);
  const candidates = printers
    .map((printer) => ({ printer, drawer: readCashDrawerControllerProfile(printer) }))
    .filter((candidate) => candidate.drawer.enabled && candidate.drawer.openSupported);

  const selected = selectDrawerCandidate(printers, {} as OpenCashDrawerControllerInput);

  return {
    configured: candidates.length > 0,
    supported_modes: candidates.map((candidate) => candidate.drawer.connectionMode),
    selected_mode: selected?.drawer.connectionMode ?? null,
    printer: selected
      ? {
          id: selected.printer.id,
          printer_name: selected.printer.printer_name,
          connection_type: selected.printer.connection_type
        }
      : null
  };
}

export async function openCashDrawerController(auth: AuthContext, input: OpenCashDrawerControllerInput) {
  const printers = await getEnabledReceiptPrinters(auth);
  if (printers.length === 0) throw new Error("printer_not_configured");

  const candidate = selectDrawerCandidate(printers, input);
  if (!candidate) throw new Error("drawer_not_configured");

  const manualLike = input.triggerSource === "manual" || input.triggerSource === "emergency_manual";
  if (manualLike && !canOpenDrawerManually(auth, candidate.drawer)) throw new Error("permission_denied");
  if (manualLike && candidate.drawer.requireReason && !normalizeText(input.reason)) throw new Error("drawer_reason_required");

  await assertCashDrawerCooldown(auth, input);

  const eventId = await writeCashDrawerEvent(auth, candidate, input, {
    command_status: "queued",
    physical_status: candidate.drawer.statusSupported ? "unknown" : "unsupported",
    metadata: {
      ...asRecord(input.metadata),
      drawer_profile: candidate.drawer,
      controller_mode: candidate.drawer.connectionMode
    }
  });

  const job = await enqueuePrintJob({
    auth,
    printer: candidate.printer,
    orderId: normalizeText(input.orderId),
    printerRole: "receipt",
    payloadText: "OPEN_CASH_DRAWER",
    payloadJson: {},
    metadata: {
      request_source: "cash_drawer_controller",
      command: "open_cash_drawer",
      trigger_source: input.triggerSource,
      reason: normalizeText(input.reason),
      cash_drawer_event_id: eventId,
      drawer_connection_mode: candidate.drawer.connectionMode,
      drawer_controller_port: candidate.drawer.controllerPort,
      drawer_controller_url: candidate.drawer.controllerUrl,
      drawer_controller_protocol: candidate.drawer.controllerProtocol,
      drawer_kick_pin: candidate.drawer.kickPin,
      drawer_pulse_on_ms: candidate.drawer.pulseOnMs,
      drawer_pulse_off_ms: candidate.drawer.pulseOffMs,
      drawer_status_supported: candidate.drawer.statusSupported
    },
    maxRetryCount: 1
  });

  let processed: PrintJobRow | null = null;
  let commandStatus: "queued" | "sent" | "failed" = "queued";
  let errorCode: string | null = null;

  if (shouldProcessDrawerCommandOnServer(candidate.printer)) {
    processed = await processPrintJob(job.id);
    commandStatus = processed?.status === "printed" ? "sent" : processed?.status === "pending" || processed?.status === "retrying" || processed?.status === "printing" ? "queued" : "failed";
    errorCode = commandStatus === "failed" ? processed?.last_error ?? "drawer_open_failed" : null;
  }

  await writeCashDrawerEvent(
    auth,
    candidate,
    input,
    {
      print_job_id: job.id,
      command_status: commandStatus,
      physical_status: candidate.drawer.statusSupported ? "unknown" : "unsupported",
      error_code: errorCode,
      metadata: {
        ...asRecord(input.metadata),
        controller_mode: candidate.drawer.connectionMode,
        deferred_to_agent: !shouldProcessDrawerCommandOnServer(candidate.printer),
        print_job_status: processed?.status ?? job.status,
        last_error: processed?.last_error ?? null
      }
    },
    eventId
  );

  await appendAuditLog({
    tenantId: auth.tenantId!,
    branchId: auth.branchId!,
    actorUserId: auth.userId,
    actorRole: auth.branchRole ?? "staff",
    action: "open_cash_drawer",
    targetTable: "cash_drawer_events",
    targetId: eventId,
    metadata: {
      printer_profile_id: candidate.printer.id,
      print_job_id: job.id,
      trigger_source: input.triggerSource,
      reason: normalizeText(input.reason),
      controller_mode: candidate.drawer.connectionMode,
      command_status: commandStatus,
      physical_status: candidate.drawer.statusSupported ? "unknown" : "unsupported",
      error_code: errorCode
    }
  });

  if (commandStatus === "failed") throw new Error(errorCode ?? "drawer_open_failed");

  return {
    event_id: eventId,
    job: processed ?? job,
    deferred_to_agent: !shouldProcessDrawerCommandOnServer(candidate.printer),
    drawer_mode: candidate.drawer.connectionMode,
    printer: {
      id: candidate.printer.id,
      printer_name: candidate.printer.printer_name,
      connection_type: candidate.printer.connection_type as PrinterConnectionType
    },
    physical_status: candidate.drawer.statusSupported ? "unknown" : "unsupported"
  };
}
