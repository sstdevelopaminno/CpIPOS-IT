import type {
  CreateManualDeliveryOrderInput,
  KitchenTicketTemplate,
  PaymentMethod,
  PrintJob,
  PrintJobStatus,
  PrinterConnectionType,
  PrinterProfile,
  ReceiptTemplate
} from "@pos/shared-types";
import type { AuthContext } from "@/lib/auth-context";
import { appendAuditLog } from "@/lib/audit-log";
import { readEnv } from "@/lib/env";
import { loadReceiptStoreProfile, type ReceiptStoreProfile } from "@/lib/services/store-profile-service";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import { BluetoothBridgeAdapter } from "@/lib/printing/adapters/bluetooth-bridge-adapter";
import { LocalBridgeAdapter } from "@/lib/printing/adapters/local-bridge-adapter";
import { NetworkEscPosAdapter } from "@/lib/printing/adapters/network-escpos-adapter";
import { StarWebPrntAdapter } from "@/lib/printing/adapters/star-webprnt-adapter";
import type { PrinterAdapter } from "@/lib/printing/adapters/types";

const DEFAULT_MAX_RETRY_COUNT = 3;
const BROWSER_AGENT_BRIDGE_URL = "browser-agent://web-serial";

type JsonRecord = Record<string, unknown>;

type PrinterProfileRow = PrinterProfile & {
  created_by?: string | null;
};

type PrintJobRow = PrintJob & {
  created_by?: string | null;
};

type PrintJobWithPrinter = PrintJobRow & {
  printer_profiles: PrinterProfileRow | null;
};

type EnqueuePrintJobInput = {
  auth: AuthContext;
  printer: PrinterProfileRow;
  orderId: string | null;
  printerRole: "receipt" | "kitchen" | "report";
  payloadText: string;
  payloadJson?: JsonRecord;
  metadata?: JsonRecord;
  maxRetryCount?: number;
};

type CreatePrinterInput = {
  printer_name: string;
  printer_role: "receipt" | "kitchen" | "report";
  connection_type: PrinterConnectionType;
  ip_address?: string | null;
  port?: number | null;
  paper_width_mm: 58 | 80;
  enabled?: boolean;
  metadata?: JsonRecord;
};

type ReprintResult = {
  mode: "retried_failed_job" | "created_new_job";
  jobs: PrintJobRow[];
};

type ReprintDeps = {
  processJob?: (jobId: string) => Promise<PrintJobRow | null>;
};

type QueueBluetoothReceiptInput = {
  orderId?: string | null;
  orderNo?: string | null;
  receiptHtml: string;
};

type CashDrawerProfile = {
  enabled: boolean;
  connectionMode: "printer-kick" | "vendor-sdk" | "direct-usb";
  openSupported: boolean;
  statusSupported: boolean;
  closeSupported: false;
  kickPin: 0 | 1;
  pulseOnMs: number;
  pulseOffMs: number;
  autoOpenOnCashPayment: boolean;
};

type OpenCashDrawerInput = {
  triggerSource: "manual" | "cash_payment";
  reason?: string | null;
  sessionId?: string | null;
  shiftId?: string | null;
  posDeviceId?: string | null;
  orderId?: string | null;
  paymentId?: string | null;
  metadata?: JsonRecord;
};

const adapters: Record<PrinterConnectionType, PrinterAdapter> = {
  NETWORK_ESC_POS: new NetworkEscPosAdapter(),
  STAR_WEBPRNT: new StarWebPrntAdapter(),
  LOCAL_BRIDGE: new LocalBridgeAdapter(),
  BLUETOOTH_BRIDGE: new BluetoothBridgeAdapter()
};

function asRecord(value: unknown): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as JsonRecord;
}

function asBool(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") return value;
  return fallback;
}

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function readCashDrawerProfile(printer: PrinterProfileRow): CashDrawerProfile {
  const metadata = asRecord(printer.metadata);
  const drawer = asRecord(metadata.cash_drawer);
  const connectionMode = drawer.connectionMode === "vendor-sdk" || drawer.connectionMode === "direct-usb" ? drawer.connectionMode : "printer-kick";
  return {
    enabled: asBool(drawer.enabled ?? metadata.cash_drawer_enabled, false),
    connectionMode,
    openSupported: asBool(drawer.openSupported ?? metadata.cash_drawer_open_supported, true),
    statusSupported: asBool(drawer.statusSupported ?? metadata.cash_drawer_status_supported, false),
    closeSupported: false,
    kickPin: clampNumber(drawer.kickPin ?? metadata.drawer_kick_pin, 0, 0, 1) === 1 ? 1 : 0,
    pulseOnMs: clampNumber(drawer.pulseOnMs ?? metadata.drawer_pulse_on_ms, 50, 20, 500),
    pulseOffMs: clampNumber(drawer.pulseOffMs ?? metadata.drawer_pulse_off_ms, 250, 20, 500),
    autoOpenOnCashPayment: asBool(drawer.autoOpenOnCashPayment ?? metadata.cash_drawer_auto_open_cash, false)
  };
}

function normalizeText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
function readStringArray(value: unknown): string[] {
  if (typeof value === "string") return [value.trim()].filter(Boolean);
  if (!Array.isArray(value)) return [];
  return value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
}

function printerHasAgentRoute(printer: PrinterProfileRow) {
  const metadata = asRecord(printer.metadata);
  return (
    readStringArray(metadata.agent_device_code ?? metadata.agent_device_codes ?? metadata.device_code ?? metadata.device_codes).length > 0 ||
    readStringArray(metadata.assigned_agent_id ?? metadata.assigned_agent_ids ?? metadata.agent_id ?? metadata.agent_ids).length > 0 ||
    metadata.print_mode === "agent" ||
    metadata.processing_mode === "print_agent" ||
    metadata.queue_only === true
  );
}

function isCloudRuntime() {
  return readEnv("VERCEL") === "1" || Boolean(readEnv("VERCEL_ENV"));
}

function shouldDeferPrintJobToAgent(printer: PrinterProfileRow) {
  const metadata = asRecord(printer.metadata);
  if (metadata.server_direct_print === true || metadata.process_on_server === true || metadata.print_mode === "server") return false;
  if (printerHasAgentRoute(printer)) return true;
  return isCloudRuntime();
}

async function processOrQueuePrintJob(job: PrintJobRow, printer: PrinterProfileRow) {
  if (shouldDeferPrintJobToAgent(printer)) {
    return job;
  }
  return (await processPrintJob(job.id)) ?? job;
}

function ensureManagerOrOwner(auth: AuthContext) {
  if (auth.branchRole !== "manager" && auth.branchRole !== "owner") {
    throw new Error("forbidden_role");
  }
}

function nowIso() {
  return new Date().toISOString();
}

function money(value: number): string {
  return value.toFixed(2);
}

function line(char: string, width: number): string {
  return char.repeat(width);
}

function center(value: string, width: number): string {
  const safe = value.length > width ? value.slice(0, width) : value;
  const left = Math.floor((width - safe.length) / 2);
  const right = width - safe.length - left;
  return `${" ".repeat(Math.max(0, left))}${safe}${" ".repeat(Math.max(0, right))}`;
}

function row(left: string, right: string, width: number): string {
  const available = Math.max(0, width - right.length - 1);
  const safeLeft = left.length > available ? left.slice(0, available) : left;
  const spaces = " ".repeat(Math.max(1, width - safeLeft.length - right.length));
  return `${safeLeft}${spaces}${right}`;
}

export function renderReceiptTemplate(template: ReceiptTemplate, paperWidthMm: 58 | 80): string {
  const width = paperWidthMm === 58 ? 32 : 42;
  const storeName = normalizeText(template.store_name) ?? template.branch_name;
  const storeAddress = normalizeText(template.store_address);
  const storePhone = normalizeText(template.store_phone);
  const paidAt = new Date(template.paid_at_iso);
  const paidAtText = Number.isNaN(paidAt.getTime())
    ? template.paid_at_iso.slice(0, 16).replace("T", " ")
    : new Intl.DateTimeFormat("th-TH", { dateStyle: "short", timeStyle: "medium", timeZone: "Asia/Bangkok" }).format(paidAt);
  const paymentLabel = template.payment_method === "cash" ? "??????????" : "???????";
  const modeLabel = normalizeText(template.mode_label) ?? "????????";
  const memberLabel = normalizeText(template.member_label) ?? "0 ????? / 0 ????";
  const lines = [
    center("CpIPOS", width),
    center(storeName, width),
    ...(storePhone ? [center(storePhone, width)] : []),
    ...(storeAddress ? [center(storeAddress.slice(0, width * 2), width)] : []),
    line("-", width),
    row("??????????", template.cashier_name, width),
    row("??", "open", width),
    row("????", modeLabel, width),
    row("?????????", template.order_no, width),
    row("??????", memberLabel, width),
    row("??????", paidAtText, width),
    line("-", width)
  ];

  for (const item of template.items) {
    const qty = money(item.qty).replace(/\.00$/, "");
    const name = item.name.length > 18 ? item.name.slice(0, 18) : item.name;
    lines.push(row(name, `${qty} ${money(item.line_total)}`, width));
    lines.push(`x ${money(item.unit_price)}`);
  }

  lines.push(line("-", width));
  lines.push(row("???????????", paymentLabel, width));
  lines.push(row("??????", `?${money(template.discount_amount)}`, width));
  if (template.tax_amount) lines.push(row("????", `?${money(template.tax_amount)}`, width));
  lines.push(row("??????????????", `?${money(template.total_amount)}`, width));
  if (template.payment_method === "cash") {
    lines.push(row("????????????????", `?${money(template.cash_received ?? template.total_amount)}`, width));
    lines.push(row("???????", `?${money(template.change_amount ?? 0)}`, width));
  }
  if (template.note) {
    lines.push(line("-", width));
    lines.push(template.note.slice(0, width));
  }
  lines.push(line("-", width));
  lines.push(center("CpIPOS", width));
  lines.push("");
  return lines.join("\n");
}

function escapeReceiptHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[char] ?? char));
}

function renderReceiptPrintHtmlFromText(template: ReceiptTemplate, paperWidthMm: 58 | 80, textBody: string): string {
  const logo = normalizeText(template.store_logo_url);
  const pageHeightMm = Math.min(700, Math.max(125, 80 + template.items.length * 14));
  const width = paperWidthMm === 58 ? 48 : 70;
  return "<!doctype html><html lang=\"th\"><head><meta charset=\"utf-8\"><style>@page{size:" + paperWidthMm + "mm " + pageHeightMm + "mm;margin:0}body{width:" + paperWidthMm + "mm;margin:0;background:#fff;color:#000;font-family:Tahoma,sans-serif}.r{width:" + width + "mm;margin:0 auto;padding:2mm 0;font-size:17px;font-weight:800;line-height:1.34;white-space:pre-wrap}.logo{text-align:center;margin-bottom:1mm}.logo img{max-width:28mm;max-height:9mm;object-fit:contain}</style></head><body><main class=\"r\"><div class=\"logo\">" + (logo ? "<img src=\"" + escapeReceiptHtml(logo) + "\">" : "CpIPOS") + "</div>" + escapeReceiptHtml(textBody) + "</main></body></html>";
}
function receiptStoreTemplateFields(storeProfile: ReceiptStoreProfile | null) {
  return {
    store_name: storeProfile?.display_name || storeProfile?.name,
    store_logo_url: storeProfile?.logo_url,
    store_address: storeProfile?.company_address,
    store_phone: storeProfile?.contact_phone
  };
}

function receiptStorePayload(storeProfile: ReceiptStoreProfile | null): JsonRecord {
  return {
    store_name: storeProfile?.display_name ?? null,
    store_logo_url: storeProfile?.logo_url ?? null,
    store_address: storeProfile?.company_address ?? null,
    store_phone: storeProfile?.contact_phone ?? null,
    store_code: storeProfile?.code ?? null
  };
}

async function loadReceiptBranchName(auth: AuthContext, fallbackName?: string | null) {
  const fallback = normalizeText(fallbackName) ?? normalizeText(auth.branchId) ?? "Branch POS";
  if (!auth.tenantId || !auth.branchId) return fallback;
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("branches")
    .select("name")
    .eq("tenant_id", auth.tenantId)
    .eq("id", auth.branchId)
    .maybeSingle<{ name: string | null }>();
  if (error) return fallback;
  return normalizeText(data?.name) ?? fallback;
}

export function renderKitchenTicketTemplate(template: KitchenTicketTemplate, paperWidthMm: 58 | 80): string {
  const width = paperWidthMm === 58 ? 32 : 42;
  const lines = [
    center(template.branch_name, width),
    center("KITCHEN TICKET", width),
    line("-", width),
    row(`Order: ${template.order_no}`, template.ticket_at_iso.slice(11, 19), width),
    row("Station", template.station, width),
    line("-", width)
  ];

  for (const item of template.items) {
    lines.push(`${item.qty}x ${item.name}`.slice(0, width));
    if (item.note) {
      lines.push(`  * ${item.note}`.slice(0, width));
    }
  }
  lines.push(line("-", width));
  lines.push("");

  return lines.join("\n");
}

export async function listPrinterProfiles(auth: AuthContext) {
  ensureManagerOrOwner(auth);
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("printer_profiles")
    .select("id,tenant_id,branch_id,printer_name,printer_role,connection_type,ip_address,port,paper_width_mm,enabled,metadata,created_at,updated_at")
    .eq("tenant_id", auth.tenantId!)
    .eq("branch_id", auth.branchId!)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as PrinterProfileRow[];
}

export async function createPrinterProfile(auth: AuthContext, input: CreatePrinterInput) {
  ensureManagerOrOwner(auth);
  const supabase = getSupabaseServiceClient();
  const ipAddress = normalizeText(input.ip_address);
  const metadata = asRecord(input.metadata);

  if (input.connection_type === "NETWORK_ESC_POS" && !ipAddress) {
    throw new Error("ip_address_required_for_network_esc_pos");
  }
  if (input.connection_type === "STAR_WEBPRNT" && !normalizeText(String(metadata.webprnt_url ?? ""))) {
    throw new Error("star_webprnt_url_required");
  }
  if (input.connection_type === "LOCAL_BRIDGE") {
    const metadataBridgeUrl = normalizeText(String(metadata.bridge_url ?? ""));
    const envBridgeUrl = readEnv("PRINT_BRIDGE_URL") ?? null;
    if (!metadataBridgeUrl && !envBridgeUrl) {
      throw new Error("local_bridge_url_required");
    }
  }
  if (input.connection_type === "BLUETOOTH_BRIDGE") {
    const metadataBluetoothAddress = normalizeText(String(metadata.bluetooth_address ?? metadata.bluetooth_mac ?? metadata.bt_address ?? ""));
    const metadataBluetoothName = normalizeText(String(metadata.bluetooth_name ?? metadata.device_name ?? ""));
    const metadataBridgeUrl = normalizeText(String(metadata.bridge_url ?? ""));
    const envBridgeUrl = readEnv("PRINT_BLUETOOTH_BRIDGE_URL") ?? readEnv("PRINT_BRIDGE_URL") ?? null;
    if (!metadataBluetoothAddress && !metadataBluetoothName) {
      throw new Error("bluetooth_target_required");
    }
    if (!metadataBridgeUrl && !envBridgeUrl) {
      throw new Error("bluetooth_bridge_url_required");
    }
  }

  const { data, error } = await supabase
    .from("printer_profiles")
    .insert({
      tenant_id: auth.tenantId,
      branch_id: auth.branchId,
      printer_name: input.printer_name.trim(),
      printer_role: input.printer_role,
      connection_type: input.connection_type,
      ip_address: ipAddress,
      port: input.port ?? null,
      paper_width_mm: input.paper_width_mm,
      enabled: input.enabled ?? true,
      metadata,
      created_by: auth.userId
    })
    .select("id,tenant_id,branch_id,printer_name,printer_role,connection_type,ip_address,port,paper_width_mm,enabled,metadata,created_at,updated_at")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  await appendAuditLog({
    tenantId: auth.tenantId!,
    branchId: auth.branchId!,
    actorUserId: auth.userId,
    actorRole: auth.branchRole!,
    action: "printer_profile_created",
    targetTable: "printer_profiles",
    targetId: data.id,
    metadata: {
      printer_role: input.printer_role,
      connection_type: input.connection_type,
      paper_width_mm: input.paper_width_mm
    }
  });

  return data as PrinterProfileRow;
}


export async function updatePrinterProfile(auth: AuthContext, printerId: string, input: CreatePrinterInput) {
  ensureManagerOrOwner(auth);
  const normalizedPrinterId = normalizeText(printerId);
  if (!normalizedPrinterId) throw new Error("printer_id_required");

  const supabase = getSupabaseServiceClient();
  const ipAddress = normalizeText(input.ip_address);
  const metadata = asRecord(input.metadata);

  if (input.connection_type === "NETWORK_ESC_POS" && !ipAddress) {
    throw new Error("ip_address_required_for_network_esc_pos");
  }
  if (input.connection_type === "STAR_WEBPRNT" && !normalizeText(String(metadata.webprnt_url ?? ""))) {
    throw new Error("star_webprnt_url_required");
  }
  if (input.connection_type === "LOCAL_BRIDGE") {
    const metadataBridgeUrl = normalizeText(String(metadata.bridge_url ?? ""));
    const envBridgeUrl = readEnv("PRINT_BRIDGE_URL") ?? null;
    if (!metadataBridgeUrl && !envBridgeUrl) {
      throw new Error("local_bridge_url_required");
    }
  }
  if (input.connection_type === "BLUETOOTH_BRIDGE") {
    const metadataBluetoothAddress = normalizeText(String(metadata.bluetooth_address ?? metadata.bluetooth_mac ?? metadata.bt_address ?? ""));
    const metadataBluetoothName = normalizeText(String(metadata.bluetooth_name ?? metadata.device_name ?? ""));
    const metadataBridgeUrl = normalizeText(String(metadata.bridge_url ?? ""));
    const envBridgeUrl = readEnv("PRINT_BLUETOOTH_BRIDGE_URL") ?? readEnv("PRINT_BRIDGE_URL") ?? null;
    if (!metadataBluetoothAddress && !metadataBluetoothName) {
      throw new Error("bluetooth_target_required");
    }
    if (!metadataBridgeUrl && !envBridgeUrl) {
      throw new Error("bluetooth_bridge_url_required");
    }
  }

  const { data, error } = await supabase
    .from("printer_profiles")
    .update({
      printer_name: input.printer_name.trim(),
      printer_role: input.printer_role,
      connection_type: input.connection_type,
      ip_address: ipAddress,
      port: input.port ?? null,
      paper_width_mm: input.paper_width_mm,
      enabled: input.enabled ?? true,
      metadata,
      updated_at: nowIso()
    })
    .eq("id", normalizedPrinterId)
    .eq("tenant_id", auth.tenantId!)
    .eq("branch_id", auth.branchId!)
    .select("id,tenant_id,branch_id,printer_name,printer_role,connection_type,ip_address,port,paper_width_mm,enabled,metadata,created_at,updated_at")
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("printer_not_found");

  await appendAuditLog({
    tenantId: auth.tenantId!,
    branchId: auth.branchId!,
    actorUserId: auth.userId,
    actorRole: auth.branchRole!,
    action: "printer_profile_updated",
    targetTable: "printer_profiles",
    targetId: data.id,
    metadata: {
      printer_role: input.printer_role,
      connection_type: input.connection_type,
      paper_width_mm: input.paper_width_mm,
      enabled: input.enabled ?? true
    }
  });

  return data as PrinterProfileRow;
}

export async function deletePrinterProfile(auth: AuthContext, printerId: string) {
  ensureManagerOrOwner(auth);
  const normalizedPrinterId = normalizeText(printerId);
  if (!normalizedPrinterId) throw new Error("printer_id_required");

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("printer_profiles")
    .delete()
    .eq("id", normalizedPrinterId)
    .eq("tenant_id", auth.tenantId!)
    .eq("branch_id", auth.branchId!)
    .select("id,printer_name,printer_role,connection_type,paper_width_mm")
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("printer_not_found");

  await appendAuditLog({
    tenantId: auth.tenantId!,
    branchId: auth.branchId!,
    actorUserId: auth.userId,
    actorRole: auth.branchRole!,
    action: "printer_profile_deleted",
    targetTable: "printer_profiles",
    targetId: normalizedPrinterId,
    metadata: data as JsonRecord
  });

  return data as JsonRecord;
}

export async function enqueuePrintJob(input: EnqueuePrintJobInput): Promise<PrintJobRow> {
  const supabase = getSupabaseServiceClient();
  const retryLimit = Number.isFinite(input.maxRetryCount) ? Math.max(0, Number(input.maxRetryCount)) : DEFAULT_MAX_RETRY_COUNT;

  const { data, error } = await supabase
    .from("print_jobs")
    .insert({
      tenant_id: input.auth.tenantId,
      branch_id: input.auth.branchId,
      order_id: input.orderId,
      printer_id: input.printer.id,
      printer_role: input.printerRole,
      connection_type: input.printer.connection_type,
      status: "pending",
      payload_text: input.payloadText,
      payload_json: input.payloadJson ?? {},
      retry_count: 0,
      max_retry_count: retryLimit,
      created_by: input.auth.userId,
      metadata: input.metadata ?? {}
    })
    .select(
      "id,tenant_id,branch_id,order_id,printer_id,printer_role,connection_type,status,payload_text,payload_json,retry_count,max_retry_count,last_error,printed_at,failed_at,created_at,updated_at,metadata"
    )
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as PrintJobRow;
}

async function updatePrintJobStatus(
  jobId: string,
  patch: {
    status: PrintJobStatus;
    retry_count?: number;
    last_error?: string | null;
    printed_at?: string | null;
    failed_at?: string | null;
    metadata?: JsonRecord;
  }
) {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("print_jobs")
    .update({
      ...patch,
      metadata: patch.metadata,
      updated_at: nowIso()
    })
    .eq("id", jobId)
    .select(
      "id,tenant_id,branch_id,order_id,printer_id,printer_role,connection_type,status,payload_text,payload_json,retry_count,max_retry_count,last_error,printed_at,failed_at,created_at,updated_at,metadata"
    )
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as PrintJobRow;
}

async function getPrintJobWithPrinter(jobId: string) {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("print_jobs")
    .select(
      "id,tenant_id,branch_id,order_id,printer_id,printer_role,connection_type,status,payload_text,payload_json,retry_count,max_retry_count,last_error,printed_at,failed_at,created_at,updated_at,metadata,printer_profiles(id,tenant_id,branch_id,printer_name,printer_role,connection_type,ip_address,port,paper_width_mm,enabled,metadata,created_at,updated_at)"
    )
    .eq("id", jobId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? null) as PrintJobWithPrinter | null;
}

export async function processPrintJob(jobId: string): Promise<PrintJobRow | null> {
  const job = await getPrintJobWithPrinter(jobId);
  if (!job) {
    return null;
  }

  const printer = job.printer_profiles;
  if (!printer || !printer.enabled) {
    return updatePrintJobStatus(jobId, {
      status: "failed",
      failed_at: nowIso(),
      last_error: "printer_not_found_or_disabled"
    });
  }

  const adapter = adapters[job.connection_type];
  if (!adapter) {
    return updatePrintJobStatus(jobId, {
      status: "failed",
      failed_at: nowIso(),
      last_error: `adapter_not_registered:${job.connection_type}`
    });
  }

  let retries = job.retry_count;
  const maxRetryCount = job.max_retry_count;
  let lastError = "";

  while (retries < maxRetryCount) {
    retries += 1;
    await updatePrintJobStatus(jobId, {
      status: "printing",
      retry_count: retries,
      last_error: null,
      failed_at: null
    });

    try {
      const mergedMetadata = {
        ...asRecord(printer.metadata),
        ...asRecord(job.metadata)
      };
      const payloadHtml = typeof mergedMetadata.payload_html === "string" ? String(mergedMetadata.payload_html) : null;
      const result = await adapter.print({
        printerId: printer.id,
        printerName: printer.printer_name,
        connectionType: job.connection_type,
        ipAddress: printer.ip_address,
        port: printer.port,
        payloadText: job.payload_text,
        payloadHtml,
        metadata: mergedMetadata
      });

      return updatePrintJobStatus(jobId, {
        status: "printed",
        printed_at: nowIso(),
        last_error: null,
        failed_at: null,
        metadata: {
          ...asRecord(job.metadata),
          print_result: asRecord(result.metadata),
          bytes_sent: result.bytesSent ?? null,
          provider_job_id: result.providerJobId ?? null
        }
      });
    } catch (error) {
      lastError = error instanceof Error ? error.message : "print_failed";
      if (retries < maxRetryCount) {
        await updatePrintJobStatus(jobId, {
          status: "retrying",
          retry_count: retries,
          last_error: lastError
        });
        continue;
      }
    }
  }

  return updatePrintJobStatus(jobId, {
    status: "failed",
    retry_count: retries,
    last_error: lastError || "print_failed",
    failed_at: nowIso()
  });
}

async function getEnabledPrintersByRole(auth: AuthContext, role: "receipt" | "kitchen" | "report") {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("printer_profiles")
    .select("id,tenant_id,branch_id,printer_name,printer_role,connection_type,ip_address,port,paper_width_mm,enabled,metadata,created_at,updated_at")
    .eq("tenant_id", auth.tenantId!)
    .eq("branch_id", auth.branchId!)
    .eq("printer_role", role)
    .eq("enabled", true)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as PrinterProfileRow[];
}

export async function queueAndProcessTestPrint(auth: AuthContext, printerId: string) {
  ensureManagerOrOwner(auth);
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("printer_profiles")
    .select("id,tenant_id,branch_id,printer_name,printer_role,connection_type,ip_address,port,paper_width_mm,enabled,metadata,created_at,updated_at")
    .eq("tenant_id", auth.tenantId!)
    .eq("branch_id", auth.branchId!)
    .eq("id", printerId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    throw new Error("printer_not_found");
  }

  const printer = data as PrinterProfileRow;
  const receiptText = renderReceiptTemplate(
    {
      order_id: "00000000-0000-0000-0000-000000000000",
      order_no: "TEST-PRINT",
      branch_name: "Printer Test",
      cashier_name: "System",
      paid_at_iso: nowIso(),
      currency: "THB",
      items: [{ name: "Connectivity check", qty: 1, unit_price: 0, line_total: 0 }],
      subtotal: 0,
      discount_amount: 0,
      tax_amount: 0,
      total_amount: 0,
      payment_method: "cash",
      note: `Adapter: ${printer.connection_type}`
    },
    printer.paper_width_mm
  );

  const job = await enqueuePrintJob({
    auth,
    printer,
    orderId: null,
    printerRole: printer.printer_role,
    payloadText: receiptText,
    metadata: { test_print: true }
  });

  return processOrQueuePrintJob(job, printer);
}

export async function queueAndProcessBluetoothReceiptHtml(auth: AuthContext, input: QueueBluetoothReceiptInput) {
  const normalizedHtml = input.receiptHtml?.trim();
  if (!normalizedHtml) {
    throw new Error("bluetooth_receipt_html_required");
  }
  if (normalizedHtml.length > 300_000) {
    throw new Error("bluetooth_receipt_html_too_large");
  }

  const supabase = getSupabaseServiceClient();
  const { data: printers, error: printerError } = await supabase
    .from("printer_profiles")
    .select("id,tenant_id,branch_id,printer_name,printer_role,connection_type,ip_address,port,paper_width_mm,enabled,metadata,created_at,updated_at")
    .eq("tenant_id", auth.tenantId!)
    .eq("branch_id", auth.branchId!)
    .eq("printer_role", "receipt")
    .eq("enabled", true)
    .order("created_at", { ascending: true });

  if (printerError) {
    throw new Error(printerError.message);
  }

  const bluetoothPrinters = ((printers ?? []) as PrinterProfileRow[]).filter((printer) => {
    const metadata = asRecord(printer.metadata);
    return printer.connection_type === "BLUETOOTH_BRIDGE" || printerHasAgentRoute(printer) || metadata.bridge_url === BROWSER_AGENT_BRIDGE_URL;
  });
  if (bluetoothPrinters.length === 0) {
    throw new Error("bluetooth_receipt_printer_not_configured");
  }

  const orderNo = normalizeText(input.orderNo ?? undefined) ?? "RECEIPT";
  const jobs: PrintJobRow[] = [];
  for (const printer of bluetoothPrinters) {
    const job = await enqueuePrintJob({
      auth,
      printer,
      orderId: normalizeText(input.orderId ?? undefined),
      printerRole: "receipt",
      payloadText: `[HTML58] ${orderNo}`,
      metadata: {
        request_source: "pos_receipt_modal",
        html_paper_width_mm: 58,
        print_format: "html_58mm",
        auto_connect: true,
        connect_before_print: true,
        payload_html: normalizedHtml
      }
    });
    const processedJob = await processOrQueuePrintJob(job, printer);
    jobs.push(processedJob ?? job);
  }

  return jobs;
}

async function assertCashDrawerCooldown(auth: AuthContext, input: OpenCashDrawerInput) {
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

  if (input.posDeviceId) {
    query = query.eq("pos_device_id", input.posDeviceId);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  if ((data ?? []).length > 0) throw new Error("drawer_cooldown");
}

async function writeCashDrawerEvent(
  auth: AuthContext,
  printer: PrinterProfileRow,
  input: OpenCashDrawerInput,
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
    printer_profile_id: printer.id,
    print_job_id: patch?.print_job_id ?? null,
    user_id: auth.userId,
    session_id: input.sessionId ?? null,
    shift_id: input.shiftId ?? null,
    order_id: input.orderId ?? null,
    payment_id: input.paymentId ?? null,
    trigger_source: input.triggerSource,
    reason: normalizeText(input.reason ?? undefined),
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

export async function queueAndProcessCashDrawerOpen(auth: AuthContext, input: OpenCashDrawerInput) {
  if (auth.branchRole !== "manager" && auth.branchRole !== "owner" && input.triggerSource === "manual") {
    throw new Error("permission_denied");
  }
  if (input.triggerSource === "manual" && !normalizeText(input.reason ?? undefined)) {
    throw new Error("drawer_reason_required");
  }

  await assertCashDrawerCooldown(auth, input);

  const receiptPrinters = await getEnabledPrintersByRole(auth, "receipt");
  const printer = receiptPrinters.find((candidate) => {
    const profile = readCashDrawerProfile(candidate);
    return profile.enabled && profile.openSupported && profile.connectionMode === "printer-kick";
  });
  if (!printer) {
    throw new Error(receiptPrinters.length > 0 ? "drawer_not_configured" : "printer_not_configured");
  }

  const drawerProfile = readCashDrawerProfile(printer);
  const eventId = await writeCashDrawerEvent(auth, printer, input, {
    command_status: "queued",
    physical_status: drawerProfile.statusSupported ? "unknown" : "unsupported",
    metadata: {
      ...asRecord(input.metadata),
      drawer_profile: {
        enabled: drawerProfile.enabled,
        connectionMode: drawerProfile.connectionMode,
        openSupported: drawerProfile.openSupported,
        statusSupported: drawerProfile.statusSupported,
        closeSupported: false,
        kickPin: drawerProfile.kickPin,
        pulseOnMs: drawerProfile.pulseOnMs,
        pulseOffMs: drawerProfile.pulseOffMs,
        autoOpenOnCashPayment: drawerProfile.autoOpenOnCashPayment
      }
    }
  });

  const job = await enqueuePrintJob({
    auth,
    printer,
    orderId: normalizeText(input.orderId ?? undefined),
    printerRole: "receipt",
    payloadText: "OPEN_CASH_DRAWER",
    payloadJson: {},
    metadata: {
      request_source: "cash_drawer",
      command: "open_cash_drawer",
      trigger_source: input.triggerSource,
      reason: normalizeText(input.reason ?? undefined),
      cash_drawer_event_id: eventId,
      drawer_kick_pin: drawerProfile.kickPin,
      drawer_pulse_on_ms: drawerProfile.pulseOnMs,
      drawer_pulse_off_ms: drawerProfile.pulseOffMs,
      drawer_status_supported: drawerProfile.statusSupported
    },
    maxRetryCount: 1
  });

  const processed = await processOrQueuePrintJob(job, printer);
  const commandStatus = processed?.status === "printed" ? "sent" : processed?.status === "pending" || processed?.status === "retrying" || processed?.status === "printing" ? "queued" : "failed";
  const errorCode = commandStatus === "failed" ? processed?.last_error ?? "drawer_open_failed" : null;
  await writeCashDrawerEvent(
    auth,
    printer,
    input,
    {
      print_job_id: job.id,
      command_status: commandStatus,
      physical_status: drawerProfile.statusSupported ? "unknown" : "unsupported",
      error_code: errorCode,
      metadata: {
        ...asRecord(input.metadata),
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
      printer_profile_id: printer.id,
      print_job_id: job.id,
      trigger_source: input.triggerSource,
      reason: normalizeText(input.reason ?? undefined),
      command_status: commandStatus,
      physical_status: drawerProfile.statusSupported ? "unknown" : "unsupported",
      error_code: errorCode
    }
  });

  if (commandStatus === "failed") {
    throw new Error(errorCode ?? "drawer_open_failed");
  }

  return {
    event_id: eventId,
    job: processed ?? job,
    printer: {
      id: printer.id,
      printer_name: printer.printer_name,
      connection_type: printer.connection_type
    },
    physical_status: drawerProfile.statusSupported ? "unknown" : "unsupported"
  };
}

export async function hasConfiguredCashDrawer(auth: AuthContext) {
  const receiptPrinters = await getEnabledPrintersByRole(auth, "receipt");
  const printer = receiptPrinters.find((candidate) => {
    const profile = readCashDrawerProfile(candidate);
    return profile.enabled && profile.openSupported && profile.connectionMode === "printer-kick";
  });
  if (!printer) return { configured: false, printer: null };
  return {
    configured: true,
    printer: {
      id: printer.id,
      printer_name: printer.printer_name,
      connection_type: printer.connection_type
    }
  };
}

export async function enqueueOrderPrintJobs(args: {
  auth: AuthContext;
  orderId: string;
  orderNo: string;
  paymentMethod: "cash" | "bank_transfer";
  input: CreateManualDeliveryOrderInput;
  includeKitchenTicket?: boolean;
}) {
  const { auth, orderId, orderNo, paymentMethod, input, includeKitchenTicket = false } = args;
  const queuedJobs: PrintJobRow[] = [];
  const storeProfile = await loadReceiptStoreProfile(auth.tenantId!);
  const branchName = await loadReceiptBranchName(auth, storeProfile?.display_name ?? storeProfile?.name);
  const receiptPrinters = await getEnabledPrintersByRole(auth, "receipt");

  if (receiptPrinters.length > 0) {
    for (const printer of receiptPrinters) {
      const receiptPayload = renderReceiptTemplate(
        {
          ...receiptStoreTemplateFields(storeProfile),
          order_id: orderId,
          order_no: orderNo,
          branch_name: branchName,
          cashier_name: auth.userId,
          paid_at_iso: nowIso(),
          currency: "THB",
          items: input.items.map((item) => ({
            name: item.product_id,
            qty: item.quantity,
            unit_price: 0,
            line_total: 0
          })),
          subtotal: input.app_total_amount,
          discount_amount: input.discount_amount ?? 0,
          tax_amount: 0,
          total_amount: input.app_total_amount - (input.discount_amount ?? 0) - (input.gp_amount ?? 0),
          payment_method: paymentMethod,
          note: input.notes
        },
        printer.paper_width_mm
      );

      const job = await enqueuePrintJob({
        auth,
        printer,
        orderId,
        printerRole: "receipt",
        payloadText: receiptPayload,
        payloadJson: {
          ...receiptStorePayload(storeProfile),
          branch_name: branchName,
          order_id: orderId,
          order_no: orderNo
        }
      });
      queuedJobs.push(job);
      await processOrQueuePrintJob(job, printer);
    }
  }

  if (includeKitchenTicket) {
    const kitchenPrinters = await getEnabledPrintersByRole(auth, "kitchen");
    for (const printer of kitchenPrinters) {
      const kitchenPayload = renderKitchenTicketTemplate(
        {
          order_id: orderId,
          order_no: orderNo,
          branch_name: branchName,
          ticket_at_iso: nowIso(),
          station: "Main",
          items: input.items.map((item) => ({
            name: item.product_id,
            qty: item.quantity,
            note: item.notes
          }))
        },
        printer.paper_width_mm
      );

      const job = await enqueuePrintJob({
        auth,
        printer,
        orderId,
        printerRole: "kitchen",
        payloadText: kitchenPayload
      });
      queuedJobs.push(job);
      await processOrQueuePrintJob(job, printer);
    }
  }

  return queuedJobs;
}

export async function reprintOrderReceipt(auth: AuthContext, orderId: string, deps: ReprintDeps = {}): Promise<ReprintResult> {
  ensureManagerOrOwner(auth);
  const processJob = deps.processJob ?? processPrintJob;
  const supabase = getSupabaseServiceClient();
  const storeProfile = await loadReceiptStoreProfile(auth.tenantId!);
  const { data: failedRows, error: failedError } = await supabase
    .from("print_jobs")
    .select(
      "id,tenant_id,branch_id,order_id,printer_id,printer_role,connection_type,status,payload_text,payload_json,retry_count,max_retry_count,last_error,printed_at,failed_at,created_at,updated_at,metadata"
    )
    .eq("tenant_id", auth.tenantId!)
    .eq("branch_id", auth.branchId!)
    .eq("order_id", orderId)
    .eq("printer_role", "receipt")
    .eq("status", "failed")
    .order("created_at", { ascending: false })
    .limit(1);

  if (failedError) {
    throw new Error(failedError.message);
  }

  if (failedRows && failedRows.length > 0) {
    const failed = failedRows[0] as PrintJobRow;
    await updatePrintJobStatus(failed.id, {
      status: "pending",
      retry_count: 0,
      last_error: null,
      failed_at: null
    });
    const retried = await processJob(failed.id);
    return {
      mode: "retried_failed_job",
      jobs: retried ? [retried] : []
    };
  }

  const { data: orderRow, error: orderError } = await supabase
    .from("orders")
    .select("id,order_no,subtotal,total_amount,grand_total,discount_amount,gp_amount,tax_total,notes,created_by,payment_completed_at,created_at")
    .eq("tenant_id", auth.tenantId!)
    .eq("branch_id", auth.branchId!)
    .eq("id", orderId)
    .maybeSingle<{
      id: string;
      order_no: string;
      subtotal: number | null;
      total_amount: number | null;
      grand_total: number | null;
      discount_amount: number | null;
      gp_amount: number | null;
      tax_total: number | null;
      notes: string | null;
      created_by: string | null;
      payment_completed_at: string | null;
      created_at: string;
    }>();

  if (orderError) {
    throw new Error(orderError.message);
  }
  if (!orderRow) {
    throw new Error("order_not_found");
  }

  const [itemsResult, paymentsResult, branchResult, cashierResult] = await Promise.all([
    supabase
      .from("order_items")
      .select("product_id,name,quantity,unit_price,line_total")
      .eq("tenant_id", auth.tenantId!)
      .eq("branch_id", auth.branchId!)
      .eq("order_id", orderId),
    supabase
      .from("payments")
      .select("method,amount,created_at")
      .eq("tenant_id", auth.tenantId!)
      .eq("branch_id", auth.branchId!)
      .eq("order_id", orderId)
      .order("created_at", { ascending: false }),
    supabase.from("branches").select("name").eq("tenant_id", auth.tenantId!).eq("id", auth.branchId!).maybeSingle<{ name: string | null }>(),
    orderRow.created_by
      ? supabase.from("users_profiles").select("full_name").eq("id", orderRow.created_by).maybeSingle<{ full_name: string | null }>()
      : Promise.resolve({ data: null, error: null })
  ]);

  if (itemsResult.error) {
    throw new Error(itemsResult.error.message);
  }
  if (paymentsResult.error) {
    throw new Error(paymentsResult.error.message);
  }
  if (branchResult.error) {
    throw new Error(branchResult.error.message);
  }
  if (cashierResult.error) {
    throw new Error(cashierResult.error.message);
  }

  const receiptItems = (itemsResult.data ?? []).map((item) => ({
    name: String(item.name ?? item.product_id ?? "Item"),
    qty: Number(item.quantity ?? 0),
    unit_price: Number(item.unit_price ?? 0),
    line_total: Number(item.line_total ?? 0)
  }));
  const primaryPayment = (paymentsResult.data ?? [])[0] as { method?: string | null } | undefined;
  const paymentMethod = primaryPayment?.method === "bank_transfer" ? "bank_transfer" : "cash";
  const totalAmount = Number(orderRow.grand_total ?? orderRow.total_amount ?? 0);

  const receiptPrinters = await getEnabledPrintersByRole(auth, "receipt");
  const createdJobs: PrintJobRow[] = [];

  for (const printer of receiptPrinters) {
    const payload = renderReceiptTemplate(
      {
        ...receiptStoreTemplateFields(storeProfile),
        order_id: orderId,
        order_no: String(orderRow.order_no),
        branch_name: String(branchResult.data?.name ?? storeProfile?.display_name ?? "Branch POS"),
        cashier_name: String(cashierResult.data?.full_name ?? orderRow.created_by ?? auth.userId),
        paid_at_iso: orderRow.payment_completed_at ?? orderRow.created_at ?? nowIso(),
        currency: "THB",
        items: receiptItems.length > 0 ? receiptItems : [{ name: "Reprint copy", qty: 1, unit_price: 0, line_total: 0 }],
        subtotal: Number(orderRow.subtotal ?? orderRow.total_amount ?? 0),
        discount_amount: Number(orderRow.discount_amount ?? 0),
        tax_amount: Number(orderRow.tax_total ?? 0),
        total_amount: totalAmount,
        payment_method: paymentMethod as PaymentMethod,
        note: `Reprint for order ${orderRow.order_no}`
      },
      printer.paper_width_mm
    );

    const job = await enqueuePrintJob({
      auth,
      printer,
      orderId,
      printerRole: "receipt",
      payloadText: payload,
      payloadJson: receiptStorePayload(storeProfile),
      metadata: { reprint: true, ...receiptStorePayload(storeProfile) }
    });
    createdJobs.push(job);
    await processJob(job.id);
  }

  return {
    mode: "created_new_job",
    jobs: createdJobs
  };
}

export async function enqueuePrintJobsForOrderSnapshot(args: {
  auth: AuthContext;
  order: {
    id: string;
    order_no: string;
    total_amount: number;
    discount_amount: number;
    notes?: string | null;
    customer_name?: string | null;
    mode_label?: string | null;
    cash_received?: number | null;
    change_amount?: number | null;
  };
  items: Array<{ product_name: string; quantity: number; unit_price: number; line_total: number; note?: string | null }>;
  paymentMethod: "cash" | "bank_transfer";
  includeKitchenTicket: boolean;
}) {
  const { auth, order, items, paymentMethod, includeKitchenTicket } = args;
  const queuedJobs: PrintJobRow[] = [];
  const storeProfile = await loadReceiptStoreProfile(auth.tenantId!);
  const branchName = await loadReceiptBranchName(auth, storeProfile?.display_name ?? storeProfile?.name);
  const receiptPrinters = await getEnabledPrintersByRole(auth, "receipt");

  for (const printer of receiptPrinters) {
    const receiptPayload = renderReceiptTemplate(
      {
        ...receiptStoreTemplateFields(storeProfile),
        order_id: order.id,
        order_no: order.order_no,
        branch_name: branchName,
        cashier_name: auth.userId,
        paid_at_iso: nowIso(),
        currency: "THB",
        items: items.map((item) => ({
          name: item.product_name,
          qty: item.quantity,
          unit_price: item.unit_price,
          line_total: item.line_total
        })),
        subtotal: order.total_amount + order.discount_amount,
        discount_amount: order.discount_amount,
        tax_amount: 0,
        total_amount: order.total_amount,
        payment_method: paymentMethod,
        note: order.notes ?? undefined
      },
      printer.paper_width_mm
    );

    const job = await enqueuePrintJob({
      auth,
      printer,
      orderId: order.id,
      printerRole: "receipt",
      payloadText: receiptPayload,
      payloadJson: { ...receiptStorePayload(storeProfile), branch_name: branchName, order_id: order.id, order_no: order.order_no },
      metadata: { payload_html: renderReceiptPrintHtmlFromText({ ...receiptStoreTemplateFields(storeProfile), order_id: order.id, order_no: order.order_no, branch_name: branchName, cashier_name: auth.userId, paid_at_iso: nowIso(), currency: "THB", items: items.map((item) => ({ name: item.product_name, qty: item.quantity, unit_price: item.unit_price, line_total: item.line_total })), subtotal: order.total_amount + order.discount_amount, discount_amount: order.discount_amount, tax_amount: 0, total_amount: order.total_amount, payment_method: paymentMethod, cash_received: order.cash_received ?? null, change_amount: order.change_amount ?? null, mode_label: order.mode_label ?? null, note: order.notes ?? undefined }, printer.paper_width_mm, receiptPayload) }
    });
    queuedJobs.push(job);
    await processOrQueuePrintJob(job, printer);
  }

  if (includeKitchenTicket) {
    const kitchenPrinters = await getEnabledPrintersByRole(auth, "kitchen");
    for (const printer of kitchenPrinters) {
      const kitchenPayload = renderKitchenTicketTemplate(
        {
          order_id: order.id,
          order_no: order.order_no,
          branch_name: branchName,
          ticket_at_iso: nowIso(),
          station: "Main",
          items: items.map((item) => ({
            name: item.product_name,
            qty: item.quantity,
            note: item.note ?? undefined
          }))
        },
        printer.paper_width_mm
      );

      const job = await enqueuePrintJob({
        auth,
        printer,
        orderId: order.id,
        printerRole: "kitchen",
        payloadText: kitchenPayload
      });
      queuedJobs.push(job);
      await processOrQueuePrintJob(job, printer);
    }
  }

  return queuedJobs;
}

export async function enqueueKitchenTicketForOrderSnapshot(args: {
  auth: AuthContext;
  order: {
    id: string;
    order_no: string;
  };
  items: Array<{ product_name: string; quantity: number; note?: string | null }>;
  station?: string;
}) {
  const { auth, order, items, station = "Table QR" } = args;
  const queuedJobs: PrintJobRow[] = [];
  const storeProfile = await loadReceiptStoreProfile(auth.tenantId!);
  const branchName = await loadReceiptBranchName(auth, storeProfile?.display_name ?? storeProfile?.name);
  const kitchenPrinters = await getEnabledPrintersByRole(auth, "kitchen");

  for (const printer of kitchenPrinters) {
    const kitchenPayload = renderKitchenTicketTemplate(
      {
        order_id: order.id,
        order_no: order.order_no,
        branch_name: branchName,
        ticket_at_iso: nowIso(),
        station,
        items: items.map((item) => ({
          name: item.product_name,
          qty: item.quantity,
          note: item.note ?? undefined
        }))
      },
      printer.paper_width_mm
    );
    const job = await enqueuePrintJob({
      auth,
      printer,
      orderId: order.id,
      printerRole: "kitchen",
      payloadText: kitchenPayload,
      metadata: {
        request_source: "table_qr_order",
        station
      }
    });
    queuedJobs.push(job);
    await processOrQueuePrintJob(job, printer);
  }

  return queuedJobs;
}
