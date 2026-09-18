import "server-only";

import { createHash } from "node:crypto";
import { getPrimarySupabaseServiceClient } from "@/lib/supabase-admin";
import {
  issueOfflineLicenseServer,
  verifyOfflineLicenseToken,
  type IssuedOfflineLicense,
  type IssueOfflineLicenseInput
} from "@/lib/offline-license-issuer";

const ONLINE_WINDOW_MS = 5 * 60 * 1000;
const HEARTBEAT_SNAPSHOT_INTERVAL_MS = 15 * 60 * 1000;

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function bangkokDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function asNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeDeviceCode(value: unknown) {
  return String(value ?? "").trim().toUpperCase();
}

export type DesktopLicenseRegistryInput = IssueOfflineLicenseInput;

export type DesktopTelemetrySaleItem = {
  lineNo?: number;
  localProductId?: string | null;
  productName: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
};

export type DesktopTelemetrySale = {
  localSaleId: string;
  receiptNo: string;
  soldAt: string;
  totalAmount: number;
  paidAmount: number;
  changeAmount: number;
  paymentMethod: string;
  status: "completed" | "cancelled";
  cashierName?: string | null;
  employeeCode?: string | null;
  localShiftId?: string | null;
  items?: DesktopTelemetrySaleItem[];
  payload?: Record<string, unknown>;
};

export type DesktopHeartbeatInput = {
  token: string;
  deviceCode: string;
  appVersion?: string | null;
  runtimeVersion?: string | null;
  deviceName?: string | null;
  machineId?: string | null;
  cpuPercent?: number | null;
  memoryPercent?: number | null;
  diskFreeBytes?: number | null;
  databaseBytes?: number | null;
  printerStatus?: string | null;
  printerName?: string | null;
  integrityStatus?: "unknown" | "ok" | "warning" | "tamper_detected";
  tamperDetected?: boolean;
  connectivity?: Record<string, unknown>;
  systemHealth?: Record<string, unknown>;
  printerHealth?: Record<string, unknown>;
  securitySignals?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  sales?: DesktopTelemetrySale[];
};

async function requireContractByLicenseId(licenseId: string) {
  const supabase = getPrimarySupabaseServiceClient();
  const { data, error } = await supabase
    .from("desktop_license_contracts")
    .select("*")
    .eq("license_id", licenseId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("LICENSE_NOT_REGISTERED");
  return data as any;
}

export async function saveIssuedDesktopLicense(issued: IssuedOfflineLicense, createdBy?: string | null) {
  const supabase = getPrimarySupabaseServiceClient();
  const payload = issued.payload;
  const { data: contract, error: contractError } = await supabase
    .from("desktop_license_contracts")
    .insert({
      license_id: payload.licenseId,
      customer_name: payload.customer,
      plan: payload.plan,
      max_devices: payload.maxDevices,
      starts_at: payload.notBefore,
      expires_at: payload.expiresAt,
      status: "active",
      features: payload.features,
      signed_token: issued.token,
      token_sha256: sha256(issued.token),
      key_fingerprint: issued.publicKeyFingerprint,
      created_by: createdBy || null
    })
    .select("id,license_id")
    .single();
  if (contractError) throw contractError;

  const deviceRows = payload.devices.map((deviceCode) => ({
    license_contract_id: (contract as any).id,
    device_code: deviceCode,
    status: "never_seen",
    is_authorized: true
  }));
  const { error: deviceError } = await supabase.from("desktop_license_devices").insert(deviceRows);
  if (deviceError) {
    await supabase.from("desktop_license_contracts").delete().eq("id", (contract as any).id);
    throw deviceError;
  }
  return contract as { id: string; license_id: string };
}

export async function listDesktopLicenseRegistry() {
  const supabase = getPrimarySupabaseServiceClient();
  const { data: contracts, error } = await supabase
    .from("desktop_license_contracts")
    .select("id,license_id,customer_name,plan,max_devices,starts_at,expires_at,status,features,revision,revoked_at,revoked_reason,created_at,updated_at")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (error) throw error;
  const contractRows = (contracts ?? []) as any[];
  if (!contractRows.length) return [];

  const contractIds = contractRows.map((row) => row.id);
  const { data: devices, error: deviceError } = await supabase
    .from("desktop_license_devices")
    .select("id,license_contract_id,device_code,device_name,machine_id,status,is_authorized,remote_management_enabled,app_version,runtime_version,last_seen_at,last_license_check_at,last_sales_sync_at,printer_status,printer_name,cpu_percent,memory_percent,disk_free_bytes,database_bytes,integrity_status,tamper_detected,security_signals,metadata")
    .in("license_contract_id", contractIds)
    .order("created_at", { ascending: true });
  if (deviceError) throw deviceError;
  const deviceRows = (devices ?? []) as any[];
  const deviceIds = deviceRows.map((row) => row.id);

  const today = bangkokDateKey();
  const month = `${today.slice(0, 7)}-01`;
  const dailyPromise = supabase
    .from("desktop_license_sales_daily")
    .select("license_contract_id,license_device_id,sale_date,bill_count,cancelled_count,gross_sales,cancelled_value")
    .in("license_contract_id", contractIds)
    .eq("sale_date", today);
  const monthlyPromise = supabase
    .from("desktop_license_sales_monthly")
    .select("license_contract_id,license_device_id,sale_month,bill_count,cancelled_count,gross_sales,cancelled_value")
    .in("license_contract_id", contractIds)
    .eq("sale_month", month);
  const receiptsPromise = deviceIds.length
    ? supabase
        .from("desktop_license_sales_receipts")
        .select("id,license_device_id,receipt_no,sold_at,total_amount,payment_method,status,cashier_name")
        .in("license_device_id", deviceIds)
        .order("sold_at", { ascending: false })
        .limit(100)
    : Promise.resolve({ data: [], error: null } as any);

  const [dailyResult, monthlyResult, receiptsResult] = await Promise.all([dailyPromise, monthlyPromise, receiptsPromise]);
  if (dailyResult.error) throw dailyResult.error;
  if (monthlyResult.error) throw monthlyResult.error;
  if (receiptsResult.error) throw receiptsResult.error;

  const now = Date.now();
  return contractRows.map((contract) => {
    const contractDevices = deviceRows
      .filter((device) => device.license_contract_id === contract.id)
      .map((device) => {
        const seen = device.last_seen_at ? Date.parse(device.last_seen_at) : 0;
        const online = Boolean(device.is_authorized && seen && now - seen <= ONLINE_WINDOW_MS);
        return { ...device, online };
      });
    const todayRows = (dailyResult.data ?? []).filter((row: any) => row.license_contract_id === contract.id);
    const monthRows = (monthlyResult.data ?? []).filter((row: any) => row.license_contract_id === contract.id);
    const ids = new Set(contractDevices.map((device) => device.id));
    const recentReceipts = (receiptsResult.data ?? []).filter((row: any) => ids.has(row.license_device_id)).slice(0, 20);
    return {
      ...contract,
      devices: contractDevices,
      today: {
        bill_count: todayRows.reduce((sum: number, row: any) => sum + asNumber(row.bill_count), 0),
        cancelled_count: todayRows.reduce((sum: number, row: any) => sum + asNumber(row.cancelled_count), 0),
        gross_sales: todayRows.reduce((sum: number, row: any) => sum + asNumber(row.gross_sales), 0),
        cancelled_value: todayRows.reduce((sum: number, row: any) => sum + asNumber(row.cancelled_value), 0)
      },
      month: {
        bill_count: monthRows.reduce((sum: number, row: any) => sum + asNumber(row.bill_count), 0),
        cancelled_count: monthRows.reduce((sum: number, row: any) => sum + asNumber(row.cancelled_count), 0),
        gross_sales: monthRows.reduce((sum: number, row: any) => sum + asNumber(row.gross_sales), 0),
        cancelled_value: monthRows.reduce((sum: number, row: any) => sum + asNumber(row.cancelled_value), 0)
      },
      recent_receipts: recentReceipts
    };
  });
}

export async function reissueDesktopLicenseContract(contractId: string, input: DesktopLicenseRegistryInput) {
  const supabase = getPrimarySupabaseServiceClient();
  const { data: existing, error } = await supabase
    .from("desktop_license_contracts")
    .select("id,license_id,revision")
    .eq("id", contractId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!existing) throw new Error("LICENSE_NOT_REGISTERED");

  const issued = await issueOfflineLicenseServer({ ...input, licenseId: (existing as any).license_id });
  const payload = issued.payload;
  const { error: updateError } = await supabase
    .from("desktop_license_contracts")
    .update({
      customer_name: payload.customer,
      plan: payload.plan,
      max_devices: payload.maxDevices,
      starts_at: payload.notBefore,
      expires_at: payload.expiresAt,
      status: "active",
      features: payload.features,
      signed_token: issued.token,
      token_sha256: sha256(issued.token),
      key_fingerprint: issued.publicKeyFingerprint,
      revision: asNumber((existing as any).revision) + 1,
      revoked_at: null,
      revoked_reason: null,
      updated_at: new Date().toISOString()
    })
    .eq("id", contractId);
  if (updateError) throw updateError;

  const approved = new Set(payload.devices);
  const { data: currentDevices, error: currentError } = await supabase
    .from("desktop_license_devices")
    .select("id,device_code")
    .eq("license_contract_id", contractId);
  if (currentError) throw currentError;
  for (const row of (currentDevices ?? []) as any[]) {
    if (!approved.has(row.device_code)) {
      await supabase
        .from("desktop_license_devices")
        .update({ is_authorized: false, status: "blocked", updated_at: new Date().toISOString() })
        .eq("id", row.id);
    }
  }
  for (const deviceCode of payload.devices) {
    const existingDevice = ((currentDevices ?? []) as any[]).find((row) => row.device_code === deviceCode);
    if (existingDevice) {
      await supabase
        .from("desktop_license_devices")
        .update({ is_authorized: true, status: "offline", updated_at: new Date().toISOString() })
        .eq("id", existingDevice.id);
    } else {
      const { error: insertError } = await supabase.from("desktop_license_devices").insert({
        license_contract_id: contractId,
        device_code: deviceCode,
        status: "never_seen",
        is_authorized: true
      });
      if (insertError) throw insertError;
    }
  }
  return issued;
}

export async function deleteDesktopLicenseContract(contractId: string, reason = "Deleted by IT admin") {
  const supabase = getPrimarySupabaseServiceClient();
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("desktop_license_contracts")
    .update({ status: "deleted", deleted_at: now, revoked_at: now, revoked_reason: reason, updated_at: now })
    .eq("id", contractId);
  if (error) throw error;
  await supabase
    .from("desktop_license_devices")
    .update({ is_authorized: false, status: "blocked", updated_at: now })
    .eq("license_contract_id", contractId);
}

export async function validateDesktopLicenseOnline(token: string, deviceCodeInput: string) {
  const payload = verifyOfflineLicenseToken(token);
  const deviceCode = normalizeDeviceCode(deviceCodeInput);
  if (!payload.devices.includes(deviceCode)) throw new Error("LICENSE_DEVICE_NOT_ALLOWED");
  const contract = await requireContractByLicenseId(payload.licenseId);
  if (contract.status !== "active" || contract.deleted_at || contract.revoked_at) throw new Error("LICENSE_REVOKED");
  if (sha256(token) !== contract.token_sha256) throw new Error("LICENSE_SUPERSEDED");
  const now = Date.now();
  if (now < Date.parse(contract.starts_at)) throw new Error("LICENSE_NOT_ACTIVE_YET");
  if (contract.expires_at && now > Date.parse(contract.expires_at)) throw new Error("LICENSE_EXPIRED");

  const supabase = getPrimarySupabaseServiceClient();
  const { data: device, error } = await supabase
    .from("desktop_license_devices")
    .select("*")
    .eq("license_contract_id", contract.id)
    .eq("device_code", deviceCode)
    .eq("is_authorized", true)
    .maybeSingle();
  if (error) throw error;
  if (!device) throw new Error("LICENSE_DEVICE_NOT_ALLOWED");
  await supabase
    .from("desktop_license_devices")
    .update({ last_license_check_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", (device as any).id);
  return { payload, contract, device: device as any };
}

async function syncSales(licenseDeviceId: string, sales: DesktopTelemetrySale[]) {
  if (!sales.length) return 0;
  const supabase = getPrimarySupabaseServiceClient();
  let accepted = 0;
  for (const sale of sales.slice(0, 100)) {
    if (!sale.localSaleId || !sale.receiptNo || !sale.soldAt) continue;
    const payloadHash = sha256(JSON.stringify({ ...sale, items: sale.items ?? [] }));
    const { data: receipt, error } = await supabase
      .from("desktop_license_sales_receipts")
      .upsert({
        license_device_id: licenseDeviceId,
        local_sale_id: sale.localSaleId,
        receipt_no: sale.receiptNo,
        sold_at: sale.soldAt,
        total_amount: asNumber(sale.totalAmount),
        paid_amount: asNumber(sale.paidAmount),
        change_amount: asNumber(sale.changeAmount),
        payment_method: String(sale.paymentMethod || "unknown"),
        status: sale.status === "cancelled" ? "cancelled" : "completed",
        cashier_name: sale.cashierName || null,
        employee_code: sale.employeeCode || null,
        local_shift_id: sale.localShiftId || null,
        payload_hash: payloadHash,
        payload: sale.payload ?? {},
        received_at: new Date().toISOString()
      }, { onConflict: "license_device_id,local_sale_id" })
      .select("id")
      .single();
    if (error) throw error;
    const receiptId = (receipt as any).id;
    if (Array.isArray(sale.items)) {
      const lines = sale.items.slice(0, 250).map((item, index) => ({
        receipt_id: receiptId,
        line_no: Number.isInteger(item.lineNo) ? item.lineNo : index + 1,
        local_product_id: item.localProductId || null,
        product_name: String(item.productName || "Item"),
        quantity: asNumber(item.quantity),
        unit_price: asNumber(item.unitPrice),
        line_total: asNumber(item.lineTotal)
      }));
      if (lines.length) {
        const { error: itemError } = await supabase
          .from("desktop_license_sales_receipt_items")
          .upsert(lines, { onConflict: "receipt_id,line_no" });
        if (itemError) throw itemError;
      }
    }
    accepted += 1;
  }
  return accepted;
}

export async function ingestDesktopHeartbeat(input: DesktopHeartbeatInput) {
  const validation = await validateDesktopLicenseOnline(input.token, input.deviceCode);
  const supabase = getPrimarySupabaseServiceClient();
  const now = new Date().toISOString();
  const integrity = input.tamperDetected ? "tamper_detected" : (input.integrityStatus ?? "unknown");
  const status = input.tamperDetected ? "tamper_warning" : "online";
  const deviceId = validation.device.id as string;
  const metadata = {
    ...(validation.device.metadata ?? {}),
    ...(input.metadata ?? {})
  };

  const { error: updateError } = await supabase
    .from("desktop_license_devices")
    .update({
      device_name: input.deviceName || validation.device.device_name,
      machine_id: input.machineId || validation.device.machine_id,
      status,
      app_version: input.appVersion || null,
      runtime_version: input.runtimeVersion || null,
      last_seen_at: now,
      last_license_check_at: now,
      printer_status: input.printerStatus || null,
      printer_name: input.printerName || null,
      cpu_percent: input.cpuPercent == null ? null : asNumber(input.cpuPercent),
      memory_percent: input.memoryPercent == null ? null : asNumber(input.memoryPercent),
      disk_free_bytes: input.diskFreeBytes == null ? null : Math.max(0, Math.trunc(asNumber(input.diskFreeBytes))),
      database_bytes: input.databaseBytes == null ? null : Math.max(0, Math.trunc(asNumber(input.databaseBytes))),
      integrity_status: integrity,
      tamper_detected: Boolean(input.tamperDetected),
      connectivity: input.connectivity ?? {},
      system_health: input.systemHealth ?? {},
      printer_health: input.printerHealth ?? {},
      security_signals: input.securitySignals ?? {},
      metadata,
      updated_at: now
    })
    .eq("id", deviceId);
  if (updateError) throw updateError;

  const lastSnapshotAt = metadata.last_heartbeat_snapshot_at ? Date.parse(String(metadata.last_heartbeat_snapshot_at)) : 0;
  if (!lastSnapshotAt || Date.now() - lastSnapshotAt >= HEARTBEAT_SNAPSHOT_INTERVAL_MS) {
    const { error: heartbeatError } = await supabase.from("desktop_license_heartbeats").insert({
      license_device_id: deviceId,
      captured_at: now,
      app_version: input.appVersion || null,
      cpu_percent: input.cpuPercent == null ? null : asNumber(input.cpuPercent),
      memory_percent: input.memoryPercent == null ? null : asNumber(input.memoryPercent),
      disk_free_bytes: input.diskFreeBytes == null ? null : Math.max(0, Math.trunc(asNumber(input.diskFreeBytes))),
      database_bytes: input.databaseBytes == null ? null : Math.max(0, Math.trunc(asNumber(input.databaseBytes))),
      printer_status: input.printerStatus || null,
      integrity_status: integrity,
      payload: {
        connectivity: input.connectivity ?? {},
        systemHealth: input.systemHealth ?? {},
        printerHealth: input.printerHealth ?? {},
        securitySignals: input.securitySignals ?? {}
      }
    });
    if (heartbeatError) throw heartbeatError;
    await supabase
      .from("desktop_license_devices")
      .update({ metadata: { ...metadata, last_heartbeat_snapshot_at: now } })
      .eq("id", deviceId);
  }

  if (input.tamperDetected) {
    await supabase.from("desktop_license_security_events").insert({
      license_device_id: deviceId,
      event_type: "desktop_integrity_tamper",
      severity: "critical",
      details: input.securitySignals ?? {},
      captured_at: now
    });
  }

  const salesAccepted = await syncSales(deviceId, Array.isArray(input.sales) ? input.sales : []);
  if (salesAccepted > 0) {
    await supabase
      .from("desktop_license_devices")
      .update({ last_sales_sync_at: now, updated_at: now })
      .eq("id", deviceId);
  }

  return {
    valid: true,
    server_time: now,
    license_id: validation.payload.licenseId,
    status: validation.contract.status,
    expires_at: validation.contract.expires_at,
    next_check_seconds: 120,
    sales_accepted: salesAccepted
  };
}

export function publicLicenseError(error: unknown) {
  const code = error instanceof Error ? error.message : "LICENSE_CHECK_FAILED";
  const explicitInvalid = new Set([
    "LICENSE_REVOKED",
    "LICENSE_SUPERSEDED",
    "LICENSE_EXPIRED",
    "LICENSE_DEVICE_NOT_ALLOWED",
    "LICENSE_SIGNATURE_INVALID",
    "LICENSE_PRODUCT_INVALID",
    "LICENSE_NOT_REGISTERED",
    "LICENSE_NOT_ACTIVE_YET",
    "LICENSE_FORMAT_INVALID"
  ]);
  return { code, valid: false, lock: explicitInvalid.has(code) };
}
