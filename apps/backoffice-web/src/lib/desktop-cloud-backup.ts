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

async function expireStaleEntitlements(deviceId?: string) {
  const supabase = getPrimarySupabaseServiceClient();
  let query = supabase
    .from("desktop_cloud_entitlements")
    .update({ status: "expired", updated_at: new Date().toISOString() })
    .eq("status", "active")
    .lte("expires_at", new Date().toISOString());
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
    supabase.from("desktop_cloud_entitlements").select("id,plan_code,cloud_code,status,starts_at,expires_at,last_backup_at,last_snapshot_id").eq("license_device_id", deviceId).eq("status", "active").gt("expires_at", new Date().toISOString()).order("expires_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("desktop_cloud_backup_snapshots").select("id,snapshot_key,database_bytes,row_counts,status,started_at,completed_at").eq("license_device_id", deviceId).order("created_at", { ascending: false }).limit(10)
  ]);
  if (plansResult.error) throw plansResult.error;
  if (requestResult.error) throw requestResult.error;
  if (entitlementResult.error) throw entitlementResult.error;
  if (snapshotsResult.error) throw snapshotsResult.error;

  return {
    license_id: (license.contract as any).license_id,
    contract_id: contractId,
    device_id: deviceId,
    device_code: (license.device as any).device_code,
    plans: plansResult.data ?? [],
    request: requestResult.data ?? null,
    entitlement: entitlementResult.data ?? null,
    snapshots: snapshotsResult.data ?? [],
    automatic_backup: true,
    connected: Boolean(entitlementResult.data)
  };
}

export async function requestDesktopCloudPlan(token: string, deviceCode: string, planCodeInput: string) {
  const license = await validateDesktopLicenseOnline(token, deviceCode);
  const deviceId = String((license.device as any).id);
  const contractId = String((license.contract as any).id);
  const planCode = asText(planCodeInput).toUpperCase();
  const supabase = getPrimarySupabaseServiceClient();

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
  const { error: entitlementError } = await supabase
    .from("desktop_cloud_entitlements")
    .update({ last_backup_at: new Date().toISOString(), last_snapshot_id: (snapshot as any).id, updated_at: new Date().toISOString() })
    .eq("id", entitlement.id);
  if (entitlementError) throw entitlementError;
  return snapshot;
}

export async function listDesktopCloudAdmin() {
  await expireStaleEntitlements();
  const supabase = getPrimarySupabaseServiceClient();
  const [plansResult, requestsResult, entitlementsResult] = await Promise.all([
    supabase.from("desktop_cloud_plans").select("code,days,label_th,label_en,price_thb,active,updated_at").order("days", { ascending: true }),
    supabase.from("desktop_cloud_purchase_requests").select("id,license_contract_id,license_device_id,plan_code,plan_days,price_thb,status,requested_at,decided_at,decision_note").order("requested_at", { ascending: false }).limit(200),
    supabase.from("desktop_cloud_entitlements").select("id,purchase_request_id,license_contract_id,license_device_id,plan_code,cloud_code,status,starts_at,expires_at,last_backup_at,last_snapshot_id").order("created_at", { ascending: false }).limit(200)
  ]);
  if (plansResult.error) throw plansResult.error;
  if (requestsResult.error) throw requestsResult.error;
  if (entitlementsResult.error) throw entitlementsResult.error;

  const requests = (requestsResult.data ?? []) as any[];
  const contractIds = [...new Set(requests.map(row => row.license_contract_id))];
  const deviceIds = [...new Set(requests.map(row => row.license_device_id))];
  const [contractsResult, devicesResult] = await Promise.all([
    contractIds.length ? supabase.from("desktop_license_contracts").select("id,license_id,customer_name").in("id", contractIds) : Promise.resolve({ data: [], error: null } as any),
    deviceIds.length ? supabase.from("desktop_license_devices").select("id,device_code,device_name,last_seen_at").in("id", deviceIds) : Promise.resolve({ data: [], error: null } as any)
  ]);
  if (contractsResult.error) throw contractsResult.error;
  if (devicesResult.error) throw devicesResult.error;
  const contracts = new Map(((contractsResult.data ?? []) as any[]).map(row => [row.id, row]));
  const devices = new Map(((devicesResult.data ?? []) as any[]).map(row => [row.id, row]));

  return {
    plans: plansResult.data ?? [],
    requests: requests.map(row => ({ ...row, contract: contracts.get(row.license_contract_id) ?? null, device: devices.get(row.license_device_id) ?? null })),
    entitlements: entitlementsResult.data ?? []
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
