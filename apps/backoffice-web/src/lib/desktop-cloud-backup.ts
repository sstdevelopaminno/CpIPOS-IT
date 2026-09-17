import "server-only";

import { createHash } from "node:crypto";
import { getPrimarySupabaseServiceClient } from "@/lib/supabase-admin";
import { validateDesktopLicenseOnline } from "@/lib/desktop-license-registry";

const ALLOWED_BACKUP_TABLES = new Set([
  "app_meta",
  "app_settings",
  "staff",
  "employee_permissions",
  "products",
  "shifts",
  "sales",
  "sale_items",
  "sale_cancellations",
  "stock_movements",
  "audit_events"
]);
const MAX_CHUNK_ROWS = 250;
const MAX_CHUNK_JSON_BYTES = 700_000;
const MAX_ARCHIVE_QUERY_ROWS = 3000;

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function asText(value: unknown) {
  return String(value ?? "").trim();
}

function asMoney(value: unknown): number | null {
  if (value == null || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error("CLOUD_PRICE_INVALID");
  return Math.round(number * 100) / 100;
}

function asIso(value: unknown) {
  const text = asText(value);
  if (!text) return new Date().toISOString();
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function numberValue(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

async function expireStaleEntitlements(deviceId?: string) {
  const supabase = getPrimarySupabaseServiceClient();
  const now = new Date().toISOString();
  let query = supabase
    .from("desktop_cloud_entitlements")
    .update({ status: "expired_pending", expired_at: now, updated_at: now })
    .eq("status", "active")
    .lte("expires_at", now);
  if (deviceId) query = query.eq("license_device_id", deviceId);
  const { error } = await query;
  if (error) throw error;
}

export async function listDesktopCloudPlans(includeInactive = false) {
  const supabase = getPrimarySupabaseServiceClient();
  let query = supabase
    .from("desktop_cloud_plans")
    .select("code,days,label_th,label_en,price_thb,active,updated_at")
    .order("days", { ascending: true });
  if (!includeInactive) query = query.eq("active", true);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function getDesktopCloudState(token: string, deviceCode: string) {
  const license = await validateDesktopLicenseOnline(token, deviceCode);
  const deviceId = String((license.device as any).id);
  const contractId = String((license.contract as any).id);
  await expireStaleEntitlements(deviceId);
  const supabase = getPrimarySupabaseServiceClient();

  const [plansResult, requestResult, entitlementResult, snapshotsResult] = await Promise.all([
    supabase.from("desktop_cloud_plans").select("code,days,label_th,label_en,price_thb,active").eq("active", true).order("days", { ascending: true }),
    supabase.from("desktop_cloud_purchase_requests").select("id,plan_code,plan_days,price_thb,status,requested_at,decided_at,decision_note").eq("license_device_id", deviceId).order("requested_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("desktop_cloud_entitlements").select("id,plan_code,cloud_code,status,starts_at,expires_at,last_backup_at,last_snapshot_id,expired_at,cancelled_at,cancellation_reason").eq("license_device_id", deviceId).in("status", ["active", "expired_pending"]).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("desktop_cloud_backup_snapshots").select("id,snapshot_key,database_bytes,row_counts,status,started_at,completed_at").eq("license_device_id", deviceId).order("created_at", { ascending: false }).limit(10)
  ]);
  if (plansResult.error) throw plansResult.error;
  if (requestResult.error) throw requestResult.error;
  if (entitlementResult.error) throw entitlementResult.error;
  if (snapshotsResult.error) throw snapshotsResult.error;

  const entitlement = entitlementResult.data as any;
  const lifecycleStatus = entitlement?.status ?? "not_active";
  return {
    license_id: (license.contract as any).license_id,
    contract_id: contractId,
    device_id: deviceId,
    device_code: (license.device as any).device_code,
    plans: plansResult.data ?? [],
    request: requestResult.data ?? null,
    entitlement: entitlement ?? null,
    snapshots: snapshotsResult.data ?? [],
    automatic_backup: lifecycleStatus === "active",
    connected: lifecycleStatus === "active",
    cloud_readable: lifecycleStatus === "active" || lifecycleStatus === "expired_pending",
    renewal_required: lifecycleStatus === "expired_pending",
    lifecycle_status: lifecycleStatus
  };
}

export async function requestDesktopCloudPlan(token: string, deviceCode: string, planCodeInput: string) {
  const license = await validateDesktopLicenseOnline(token, deviceCode);
  const deviceId = String((license.device as any).id);
  const contractId = String((license.contract as any).id);
  const planCode = asText(planCodeInput).toUpperCase();
  const supabase = getPrimarySupabaseServiceClient();
  await expireStaleEntitlements(deviceId);

  const { data: active, error: activeError } = await supabase
    .from("desktop_cloud_entitlements")
    .select("id,status,expires_at")
    .eq("license_device_id", deviceId)
    .in("status", ["active", "expired_pending"])
    .limit(1)
    .maybeSingle();
  if (activeError) throw activeError;
  if (active) throw new Error((active as any).status === "expired_pending" ? "CLOUD_RENEWAL_REVIEW_REQUIRED" : "CLOUD_ALREADY_ACTIVE");

  const { data: plan, error: planError } = await supabase
    .from("desktop_cloud_plans")
    .select("code,days,price_thb,active")
    .eq("code", planCode)
    .eq("active", true)
    .maybeSingle();
  if (planError) throw planError;
  if (!plan) throw new Error("CLOUD_PLAN_NOT_AVAILABLE");

  const { data: pending, error: pendingError } = await supabase
    .from("desktop_cloud_purchase_requests")
    .select("id,plan_code,plan_days,price_thb,status,requested_at")
    .eq("license_device_id", deviceId)
    .eq("status", "pending")
    .maybeSingle();
  if (pendingError) throw pendingError;
  if (pending) {
    if ((pending as any).plan_code === planCode) return pending;
    throw new Error("CLOUD_REQUEST_PENDING");
  }

  const { data, error } = await supabase
    .from("desktop_cloud_purchase_requests")
    .insert({
      license_contract_id: contractId,
      license_device_id: deviceId,
      plan_code: (plan as any).code,
      plan_days: (plan as any).days,
      price_thb: (plan as any).price_thb,
      status: "pending"
    })
    .select("id,plan_code,plan_days,price_thb,status,requested_at")
    .single();
  if (error) throw error;
  return data;
}

async function requireActiveEntitlement(token: string, deviceCode: string, entitlementIdInput?: string | null) {
  const license = await validateDesktopLicenseOnline(token, deviceCode);
  const deviceId = String((license.device as any).id);
  await expireStaleEntitlements(deviceId);
  const supabase = getPrimarySupabaseServiceClient();
  let query = supabase
    .from("desktop_cloud_entitlements")
    .select("id,license_contract_id,license_device_id,plan_code,cloud_code,status,starts_at,expires_at,last_backup_at")
    .eq("license_device_id", deviceId)
    .eq("status", "active")
    .gt("expires_at", new Date().toISOString());
  const entitlementId = asText(entitlementIdInput);
  if (entitlementId) query = query.eq("id", entitlementId);
  const { data, error } = await query.order("expires_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("CLOUD_ENTITLEMENT_REQUIRED");
  return { license, entitlement: data as any };
}

async function requireReadableEntitlement(token: string, deviceCode: string) {
  const license = await validateDesktopLicenseOnline(token, deviceCode);
  const deviceId = String((license.device as any).id);
  await expireStaleEntitlements(deviceId);
  const supabase = getPrimarySupabaseServiceClient();
  const { data, error } = await supabase
    .from("desktop_cloud_entitlements")
    .select("id,license_contract_id,license_device_id,plan_code,cloud_code,status,starts_at,expires_at")
    .eq("license_device_id", deviceId)
    .in("status", ["active", "expired_pending"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("CLOUD_ENTITLEMENT_REQUIRED");
  return { license, entitlement: data as any };
}

export type DesktopCloudBackupChunkInput = {
  token: string;
  deviceCode: string;
  entitlementId?: string | null;
  snapshotKey: string;
  tableName: string;
  chunkIndex: number;
  rows: unknown[];
  databaseBytes?: number | null;
  rowCounts?: Record<string, number> | null;
  checksumSha256?: string | null;
};

export async function uploadDesktopCloudBackupChunk(input: DesktopCloudBackupChunkInput) {
  const tableName = asText(input.tableName);
  if (!ALLOWED_BACKUP_TABLES.has(tableName)) throw new Error("CLOUD_BACKUP_TABLE_INVALID");
  const chunkIndex = Number(input.chunkIndex);
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex > 100000) throw new Error("CLOUD_BACKUP_CHUNK_INVALID");
  if (!Array.isArray(input.rows) || input.rows.length > MAX_CHUNK_ROWS) throw new Error("CLOUD_BACKUP_ROWS_INVALID");
  const payloadJson = JSON.stringify(input.rows);
  if (Buffer.byteLength(payloadJson, "utf8") > MAX_CHUNK_JSON_BYTES) throw new Error("CLOUD_BACKUP_CHUNK_TOO_LARGE");
  const snapshotKey = asText(input.snapshotKey);
  if (!snapshotKey || snapshotKey.length > 120) throw new Error("CLOUD_BACKUP_SNAPSHOT_INVALID");

  const { license, entitlement } = await requireActiveEntitlement(input.token, input.deviceCode, input.entitlementId);
  const supabase = getPrimarySupabaseServiceClient();
  const deviceId = String((license.device as any).id);
  const contractId = String((license.contract as any).id);

  const { data: snapshot, error: snapshotError } = await supabase
    .from("desktop_cloud_backup_snapshots")
    .upsert({
      entitlement_id: entitlement.id,
      license_contract_id: contractId,
      license_device_id: deviceId,
      snapshot_key: snapshotKey,
      database_bytes: Math.max(0, Math.trunc(Number(input.databaseBytes ?? 0) || 0)),
      row_counts: input.rowCounts ?? {},
      checksum_sha256: asText(input.checksumSha256) || null,
      status: "uploading",
      updated_at: new Date().toISOString()
    }, { onConflict: "license_device_id,snapshot_key" })
    .select("id,snapshot_key,status")
    .single();
  if (snapshotError) throw snapshotError;

  const { error: chunkError } = await supabase
    .from("desktop_cloud_backup_chunks")
    .upsert({
      snapshot_id: (snapshot as any).id,
      table_name: tableName,
      chunk_index: chunkIndex,
      row_count: input.rows.length,
      payload: input.rows,
      checksum_sha256: sha256(payloadJson)
    }, { onConflict: "snapshot_id,table_name,chunk_index" });
  if (chunkError) throw chunkError;
  return snapshot;
}

async function snapshotRows(snapshotId: string, tableName: string) {
  const supabase = getPrimarySupabaseServiceClient();
  const { data, error } = await supabase
    .from("desktop_cloud_backup_chunks")
    .select("payload,chunk_index")
    .eq("snapshot_id", snapshotId)
    .eq("table_name", tableName)
    .order("chunk_index", { ascending: true });
  if (error) throw error;
  const rows: Record<string, unknown>[] = [];
  for (const chunk of data ?? []) {
    const payload = (chunk as any).payload;
    if (Array.isArray(payload)) rows.push(...payload.filter(row => row && typeof row === "object") as Record<string, unknown>[]);
  }
  return rows;
}

async function upsertBatches(table: string, rows: Record<string, unknown>[], conflict: string) {
  if (!rows.length) return;
  const supabase = getPrimarySupabaseServiceClient();
  for (let index = 0; index < rows.length; index += 500) {
    const { error } = await supabase.from(table).upsert(rows.slice(index, index + 500), { onConflict: conflict });
    if (error) throw error;
  }
}

async function materializeSnapshotArchive(snapshotId: string, contractId: string, deviceId: string, entitlementId: string) {
  const [salesRows, itemRows] = await Promise.all([
    snapshotRows(snapshotId, "sales"),
    snapshotRows(snapshotId, "sale_items")
  ]);
  const now = new Date().toISOString();
  const sales = salesRows.flatMap(row => {
    const id = asText(row.id);
    const receiptNo = asText(row.receipt_no);
    const createdAt = asText(row.created_at);
    if (!id || !receiptNo || !createdAt) return [];
    return [{
      license_contract_id: contractId,
      license_device_id: deviceId,
      entitlement_id: entitlementId,
      local_sale_id: id,
      receipt_no: receiptNo,
      total: numberValue(row.total),
      paid: numberValue(row.paid),
      change_amount: numberValue(row.change_amount),
      payment_method: asText(row.payment_method) || "cash",
      created_at: asIso(createdAt),
      status: asText(row.status) || "completed",
      cashier_name: asText(row.cashier_name) || null,
      employee_code: asText(row.employee_code) || null,
      shift_id: asText(row.shift_id) || null,
      cancelled_at: row.cancelled_at ? asIso(row.cancelled_at) : null,
      cancelled_reason: asText(row.cancelled_reason) || null,
      row_data: row,
      archived_at: now
    }];
  });
  const items = itemRows.flatMap((row, index) => {
    const saleId = asText(row.sale_id);
    if (!saleId) return [];
    const id = asText(row.id) || `${saleId}:${index}:${sha256(JSON.stringify(row)).slice(0, 12)}`;
    return [{
      license_contract_id: contractId,
      license_device_id: deviceId,
      entitlement_id: entitlementId,
      local_item_id: id,
      local_sale_id: saleId,
      product_id: asText(row.product_id) || null,
      name: asText(row.name) || "สินค้า",
      quantity: numberValue(row.quantity),
      unit_price: numberValue(row.unit_price),
      line_total: numberValue(row.line_total),
      row_data: row,
      archived_at: now
    }];
  });
  await upsertBatches("desktop_cloud_sales_archive", sales, "license_device_id,local_sale_id");
  await upsertBatches("desktop_cloud_sale_items_archive", items, "license_device_id,local_item_id");
  return { sales: sales.length, items: items.length };
}

export async function completeDesktopCloudBackup(args: {
  token: string;
  deviceCode: string;
  entitlementId?: string | null;
  snapshotKey: string;
  databaseBytes?: number | null;
  rowCounts?: Record<string, number> | null;
}) {
  const { license, entitlement } = await requireActiveEntitlement(args.token, args.deviceCode, args.entitlementId);
  const supabase = getPrimarySupabaseServiceClient();
  const deviceId = String((license.device as any).id);
  const contractId = String((license.contract as any).id);
  const { data: snapshot, error } = await supabase
    .from("desktop_cloud_backup_snapshots")
    .update({
      database_bytes: Math.max(0, Math.trunc(Number(args.databaseBytes ?? 0) || 0)),
      row_counts: args.rowCounts ?? {},
      status: "complete",
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq("license_device_id", deviceId)
    .eq("snapshot_key", asText(args.snapshotKey))
    .eq("entitlement_id", entitlement.id)
    .select("id,snapshot_key,database_bytes,row_counts,status,completed_at")
    .maybeSingle();
  if (error) throw error;
  if (!snapshot) throw new Error("CLOUD_BACKUP_SNAPSHOT_NOT_FOUND");

  const archive = await materializeSnapshotArchive(String((snapshot as any).id), contractId, deviceId, String(entitlement.id));
  const { error: entitlementError } = await supabase
    .from("desktop_cloud_entitlements")
    .update({ last_backup_at: new Date().toISOString(), last_snapshot_id: (snapshot as any).id, updated_at: new Date().toISOString() })
    .eq("id", entitlement.id);
  if (entitlementError) throw entitlementError;
  return { ...(snapshot as any), archive };
}

export async function queryDesktopCloudSalesArchive(args: {
  token: string;
  deviceCode: string;
  limit?: number;
  from?: string | null;
  to?: string | null;
  status?: string | null;
  paymentMethod?: string | null;
  receipt?: string | null;
}) {
  const { license, entitlement } = await requireReadableEntitlement(args.token, args.deviceCode);
  const supabase = getPrimarySupabaseServiceClient();
  const deviceId = String((license.device as any).id);
  const limit = Math.max(1, Math.min(MAX_ARCHIVE_QUERY_ROWS, Math.trunc(Number(args.limit ?? 500) || 500)));
  let query = supabase
    .from("desktop_cloud_sales_archive")
    .select("local_sale_id,receipt_no,total,paid,change_amount,payment_method,created_at,status,cashier_name,employee_code,shift_id,cancelled_at,cancelled_reason")
    .eq("license_device_id", deviceId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (args.from) query = query.gte("created_at", args.from);
  if (args.to) query = query.lte("created_at", args.to);
  if (args.status && args.status !== "all") query = query.eq("status", args.status);
  if (args.paymentMethod && args.paymentMethod !== "all") query = query.eq("payment_method", args.paymentMethod);
  if (asText(args.receipt)) query = query.ilike("receipt_no", `%${asText(args.receipt)}%`);
  const { data, error } = await query;
  if (error) throw error;
  return {
    entitlement_status: entitlement.status,
    rows: (data ?? []).map((row: any) => ({
      id: row.local_sale_id,
      receiptNo: row.receipt_no,
      total: numberValue(row.total),
      paid: numberValue(row.paid),
      changeAmount: numberValue(row.change_amount),
      paymentMethod: row.payment_method,
      createdAt: row.created_at,
      status: row.status,
      cashierName: row.cashier_name || undefined,
      employeeCode: row.employee_code || undefined,
      shiftId: row.shift_id || undefined,
      cancelledAt: row.cancelled_at || undefined,
      cancelledReason: row.cancelled_reason || undefined,
      cloudArchived: true
    }))
  };
}

export async function getDesktopCloudReceiptArchive(token: string, deviceCode: string, saleIdInput: string) {
  const saleId = asText(saleIdInput);
  if (!saleId) throw new Error("CLOUD_SALE_ID_REQUIRED");
  const { license, entitlement } = await requireReadableEntitlement(token, deviceCode);
  const supabase = getPrimarySupabaseServiceClient();
  const deviceId = String((license.device as any).id);
  const [saleResult, itemResult] = await Promise.all([
    supabase.from("desktop_cloud_sales_archive").select("local_sale_id,receipt_no,total,paid,change_amount,payment_method,created_at,status,cashier_name,employee_code,shift_id,cancelled_at,cancelled_reason,row_data").eq("license_device_id", deviceId).eq("local_sale_id", saleId).maybeSingle(),
    supabase.from("desktop_cloud_sale_items_archive").select("local_item_id,local_sale_id,product_id,name,quantity,unit_price,line_total,row_data").eq("license_device_id", deviceId).eq("local_sale_id", saleId).order("archived_at", { ascending: true })
  ]);
  if (saleResult.error) throw saleResult.error;
  if (itemResult.error) throw itemResult.error;
  if (!saleResult.data) throw new Error("CLOUD_SALE_NOT_FOUND");
  const sale: any = saleResult.data;
  return {
    entitlement_status: entitlement.status,
    sale: {
      id: sale.local_sale_id,
      receiptNo: sale.receipt_no,
      total: numberValue(sale.total),
      paid: numberValue(sale.paid),
      changeAmount: numberValue(sale.change_amount),
      paymentMethod: sale.payment_method,
      createdAt: sale.created_at,
      status: sale.status,
      cashierName: sale.cashier_name || undefined,
      employeeCode: sale.employee_code || undefined,
      shiftId: sale.shift_id || undefined,
      cancelledAt: sale.cancelled_at || undefined,
      cancelledReason: sale.cancelled_reason || undefined
    },
    items: (itemResult.data ?? []).map((item: any) => ({
      id: item.local_item_id,
      saleId: item.local_sale_id,
      productId: item.product_id || undefined,
      name: item.name,
      quantity: numberValue(item.quantity),
      unitPrice: numberValue(item.unit_price),
      lineTotal: numberValue(item.line_total)
    }))
  };
}

export async function listDesktopCloudAdmin() {
  await expireStaleEntitlements();
  const supabase = getPrimarySupabaseServiceClient();
  const [plansResult, requestsResult, entitlementsResult] = await Promise.all([
    supabase.from("desktop_cloud_plans").select("code,days,label_th,label_en,price_thb,active,updated_at").order("days", { ascending: true }),
    supabase.from("desktop_cloud_purchase_requests").select("id,license_contract_id,license_device_id,plan_code,plan_days,price_thb,status,requested_at,decided_at,decision_note").order("requested_at", { ascending: false }).limit(200),
    supabase.from("desktop_cloud_entitlements").select("id,purchase_request_id,license_contract_id,license_device_id,plan_code,cloud_code,status,starts_at,expires_at,last_backup_at,last_snapshot_id,expired_at,cancelled_at,cancellation_reason").order("created_at", { ascending: false }).limit(200)
  ]);
  if (plansResult.error) throw plansResult.error;
  if (requestsResult.error) throw requestsResult.error;
  if (entitlementsResult.error) throw entitlementsResult.error;

  const requests = (requestsResult.data ?? []) as any[];
  const entitlements = (entitlementsResult.data ?? []) as any[];
  const contractIds = [...new Set([...requests, ...entitlements].map(row => row.license_contract_id).filter(Boolean))];
  const deviceIds = [...new Set([...requests, ...entitlements].map(row => row.license_device_id).filter(Boolean))];
  const [contractsResult, devicesResult] = await Promise.all([
    contractIds.length ? supabase.from("desktop_license_contracts").select("id,license_id,customer_name").in("id", contractIds) : Promise.resolve({ data: [], error: null } as any),
    deviceIds.length ? supabase.from("desktop_license_devices").select("id,device_code,device_name,last_seen_at").in("id", deviceIds) : Promise.resolve({ data: [], error: null } as any)
  ]);
  if (contractsResult.error) throw contractsResult.error;
  if (devicesResult.error) throw devicesResult.error;
  const contracts = new Map(((contractsResult.data ?? []) as any[]).map(row => [row.id, row]));
  const devices = new Map(((devicesResult.data ?? []) as any[]).map(row => [row.id, row]));
  const enrich = (row: any) => ({ ...row, contract: contracts.get(row.license_contract_id) ?? null, device: devices.get(row.license_device_id) ?? null });

  return {
    plans: plansResult.data ?? [],
    requests: requests.map(enrich),
    entitlements: entitlements.map(enrich),
    expired_pending_count: entitlements.filter(row => row.status === "expired_pending").length
  };
}

export async function updateDesktopCloudPlan(planCodeInput: string, priceInput: unknown, activeInput?: unknown) {
  const planCode = asText(planCodeInput).toUpperCase();
  const supabase = getPrimarySupabaseServiceClient();
  const changes: Record<string, unknown> = { price_thb: asMoney(priceInput), updated_at: new Date().toISOString() };
  if (typeof activeInput === "boolean") changes.active = activeInput;
  const { data, error } = await supabase
    .from("desktop_cloud_plans")
    .update(changes)
    .eq("code", planCode)
    .select("code,days,label_th,label_en,price_thb,active,updated_at")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("CLOUD_PLAN_NOT_FOUND");
  return data;
}

export async function approveDesktopCloudPurchase(requestIdInput: string, approvedBy?: string | null, note?: string | null) {
  const requestId = asText(requestIdInput);
  if (!requestId) throw new Error("CLOUD_REQUEST_ID_REQUIRED");
  const supabase = getPrimarySupabaseServiceClient();
  const { data, error } = await supabase.rpc("approve_desktop_cloud_purchase", {
    p_request_id: requestId,
    p_approved_by: approvedBy || null,
    p_note: note || null
  });
  if (error) throw error;
  const result = Array.isArray(data) ? data[0] : data;
  if (!result) throw new Error("CLOUD_APPROVAL_FAILED");
  return result;
}

export async function rejectDesktopCloudPurchase(requestIdInput: string, decidedBy?: string | null, note?: string | null) {
  const requestId = asText(requestIdInput);
  if (!requestId) throw new Error("CLOUD_REQUEST_ID_REQUIRED");
  const supabase = getPrimarySupabaseServiceClient();
  const { data, error } = await supabase
    .from("desktop_cloud_purchase_requests")
    .update({ status: "rejected", decided_at: new Date().toISOString(), decided_by: decidedBy || null, decision_note: note || null, updated_at: new Date().toISOString() })
    .eq("id", requestId)
    .eq("status", "pending")
    .select("id,status,plan_code,decided_at,decision_note")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("CLOUD_REQUEST_NOT_PENDING");
  return data;
}

export async function renewDesktopCloudEntitlement(entitlementIdInput: string, decidedBy?: string | null, note?: string | null) {
  const entitlementId = asText(entitlementIdInput);
  if (!entitlementId) throw new Error("CLOUD_ENTITLEMENT_ID_REQUIRED");
  const supabase = getPrimarySupabaseServiceClient();
  const { data, error } = await supabase.rpc("renew_desktop_cloud_entitlement", {
    p_entitlement_id: entitlementId,
    p_decided_by: decidedBy || null,
    p_note: note || null
  });
  if (error) throw error;
  const result = Array.isArray(data) ? data[0] : data;
  if (!result) throw new Error("CLOUD_RENEW_FAILED");
  return result;
}

export async function cancelDesktopCloudEntitlement(entitlementIdInput: string, decidedBy?: string | null, note?: string | null) {
  const entitlementId = asText(entitlementIdInput);
  if (!entitlementId) throw new Error("CLOUD_ENTITLEMENT_ID_REQUIRED");
  const supabase = getPrimarySupabaseServiceClient();
  const { data, error } = await supabase.rpc("cancel_desktop_cloud_entitlement", {
    p_entitlement_id: entitlementId,
    p_decided_by: decidedBy || null,
    p_note: note || null
  });
  if (error) throw error;
  const result = Array.isArray(data) ? data[0] : data;
  if (!result) throw new Error("CLOUD_CANCEL_FAILED");
  return result;
}
