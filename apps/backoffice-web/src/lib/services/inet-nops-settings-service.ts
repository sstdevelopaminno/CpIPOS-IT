import "server-only";

import { appendAuditLog } from "@/lib/audit-log";
import type { AuthContext } from "@/lib/auth-context";
import { FeatureGateError } from "@/lib/feature-gate";
import { hasBranchFeatureSafe } from "@/lib/server/feature-gate-safe";
import {
  allowsInetNopsUatWithoutMerchantId,
  resolveInetNopsEnvironment,
  testInetNopsConnection,
  type InetEnvironment
} from "@/lib/payments/inet-nops-client";
import { assertCanManageSettings } from "@/lib/services/pos-settings-service";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

export const INET_NOPS_FEATURE_KEY = "inet_nops_qr";

export type InetNopsSettings = {
  branch_id: string;
  environment: InetEnvironment;
  merchant_id: string;
  is_active: boolean;
  connection_status: "not_configured" | "ready" | "error" | "disabled";
  last_connection_checked_at: string | null;
  last_connection_error: string;
  last_test_order_id: string;
  callback_url: string;
  callback_is_public: boolean;
  merchant_key_configured: boolean;
  feature_enabled: boolean;
  schema_ready: boolean;
};

export type SaveInetNopsSettingsInput = {
  branch_id?: string;
  environment?: InetEnvironment;
  merchant_id?: string;
  is_active?: boolean;
};

type ProviderSettingsRow = {
  id: string;
  branch_id: string;
  environment: string | null;
  merchant_id: string | null;
  is_active: boolean | null;
  connection_status?: string | null;
  last_connection_checked_at?: string | null;
  last_connection_error?: string | null;
  last_test_order_id?: string | null;
  callback_url?: string | null;
};

function trimText(value: unknown) {
  return String(value ?? "").trim();
}

function isMissingSchemaError(message: string) {
  const normalized = message.toLowerCase();
  return (
    (normalized.includes("pos_payment_provider_settings") && (normalized.includes("does not exist") || normalized.includes("could not find"))) ||
    ((normalized.includes("callback_url") || normalized.includes("connection_status") || normalized.includes("last_connection_") || normalized.includes("last_test_order_id")) &&
      (normalized.includes("column") || normalized.includes("schema cache")))
  );
}

function resolveCallbackUrl(environment: InetEnvironment) {
  const suffix = environment === "production" ? "PROD" : "UAT";
  return trimText(process.env[`INET_NOPS_CALLBACK_PUBLIC_URL_${suffix}`]) || trimText(process.env.INET_NOPS_CALLBACK_PUBLIC_URL);
}

function isPublicHttpsUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

function hasMerchantKey(environment: InetEnvironment) {
  return Boolean(trimText(process.env[`INET_NOPS_MERCHANT_KEY_${environment === "production" ? "PROD" : "UAT"}`]));
}

function normalizeConnectionStatus(value: unknown, active: boolean): InetNopsSettings["connection_status"] {
  if (!active) return "disabled";
  if (value === "ready" || value === "error") return value;
  return "not_configured";
}

function defaultSettings(branchId: string, featureEnabled: boolean, environment: InetEnvironment = "uat"): InetNopsSettings {
  const callbackUrl = resolveCallbackUrl(environment);
  return {
    branch_id: branchId,
    environment,
    merchant_id: "",
    is_active: false,
    connection_status: "not_configured",
    last_connection_checked_at: null,
    last_connection_error: "",
    last_test_order_id: "",
    callback_url: callbackUrl,
    callback_is_public: isPublicHttpsUrl(callbackUrl),
    merchant_key_configured: hasMerchantKey(environment),
    feature_enabled: featureEnabled,
    schema_ready: true
  };
}

function mapSettings(row: ProviderSettingsRow, featureEnabled: boolean): InetNopsSettings {
  const environment = resolveInetNopsEnvironment(row.environment);
  const callbackUrl = trimText(row.callback_url) || resolveCallbackUrl(environment);
  const active = row.is_active === true;
  return {
    branch_id: row.branch_id,
    environment,
    merchant_id: trimText(row.merchant_id),
    is_active: active,
    connection_status: normalizeConnectionStatus(row.connection_status, active),
    last_connection_checked_at: row.last_connection_checked_at ?? null,
    last_connection_error: trimText(row.last_connection_error),
    last_test_order_id: trimText(row.last_test_order_id),
    callback_url: callbackUrl,
    callback_is_public: isPublicHttpsUrl(callbackUrl),
    merchant_key_configured: hasMerchantKey(environment),
    feature_enabled: featureEnabled,
    schema_ready: true
  };
}

async function assertBranchInTenant(tenantId: string, branchId: string) {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase.from("branches").select("id").eq("tenant_id", tenantId).eq("id", branchId).maybeSingle<{ id: string }>();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Branch was not found in this tenant.");
}

async function resolveBranchId(auth: AuthContext, requestedBranchId?: string | null) {
  if (!auth.tenantId) throw new Error("Missing tenant scope.");
  const branchId = trimText(requestedBranchId) || trimText(auth.branchId);
  if (!branchId) throw new Error("Branch is required.");
  if (branchId !== auth.branchId) {
    assertCanManageSettings(auth);
    await assertBranchInTenant(auth.tenantId, branchId);
  }
  return branchId;
}

async function readProviderRow(tenantId: string, branchId: string) {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("pos_payment_provider_settings")
    .select("id,branch_id,environment,merchant_id,is_active,connection_status,last_connection_checked_at,last_connection_error,last_test_order_id,callback_url")
    .eq("tenant_id", tenantId)
    .eq("branch_id", branchId)
    .eq("provider", "inet_nops")
    .order("updated_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  return ((data ?? [])[0] ?? null) as ProviderSettingsRow | null;
}

export async function loadInetNopsSettings(auth: AuthContext, requestedBranchId?: string | null) {
  const branchId = await resolveBranchId(auth, requestedBranchId);
  const featureEnabled = await hasBranchFeatureSafe(auth.tenantId!, branchId, INET_NOPS_FEATURE_KEY);
  try {
    const row = await readProviderRow(auth.tenantId!, branchId);
    return row ? mapSettings(row, featureEnabled) : defaultSettings(branchId, featureEnabled);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load INET settings.";
    if (!isMissingSchemaError(message)) throw error;
    return { ...defaultSettings(branchId, featureEnabled), schema_ready: false };
  }
}

export async function saveInetNopsSettings(auth: AuthContext, input: SaveInetNopsSettingsInput) {
  assertCanManageSettings(auth);
  const branchId = await resolveBranchId(auth, input.branch_id);
  const featureEnabled = await hasBranchFeatureSafe(auth.tenantId!, branchId, INET_NOPS_FEATURE_KEY);
  if (!featureEnabled) {
    throw new FeatureGateError("feature_not_enabled", "INET QR is not included in this branch package.");
  }

  const environment = resolveInetNopsEnvironment(input.environment);
  const merchantId = trimText(input.merchant_id);
  const isActive = input.is_active === true;
  if (isActive && !hasMerchantKey(environment)) {
    throw new Error(`INET ${environment.toUpperCase()} Merchant Key is not configured on the server.`);
  }
  if (isActive && environment === "production" && !merchantId) {
    throw new Error("Merchant ID is required before production INET QR can be enabled.");
  }
  if (isActive && environment === "uat" && !merchantId && !allowsInetNopsUatWithoutMerchantId(environment)) {
    throw new Error("Merchant ID is required unless the explicit UAT fallback is enabled on the server.");
  }

  const callbackUrl = resolveCallbackUrl(environment);
  const supabase = getSupabaseServiceClient();
  let existing: ProviderSettingsRow | null = null;
  try {
    existing = await readProviderRow(auth.tenantId!, branchId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (isMissingSchemaError(message)) throw new Error("INET settings migration is not installed.");
    throw error;
  }

  const payload = {
    tenant_id: auth.tenantId!,
    branch_id: branchId,
    provider: "inet_nops",
    environment,
    merchant_id: merchantId || null,
    is_active: isActive,
    callback_url: callbackUrl || null,
    connection_status: isActive ? (existing?.connection_status === "ready" ? "ready" : "not_configured") : "disabled",
    last_connection_error: isActive ? null : ""
  };
  const result = existing
    ? await supabase.from("pos_payment_provider_settings").update(payload).eq("id", existing.id).select("id,branch_id,environment,merchant_id,is_active,connection_status,last_connection_checked_at,last_connection_error,last_test_order_id,callback_url").single<ProviderSettingsRow>()
    : await supabase.from("pos_payment_provider_settings").insert(payload).select("id,branch_id,environment,merchant_id,is_active,connection_status,last_connection_checked_at,last_connection_error,last_test_order_id,callback_url").single<ProviderSettingsRow>();
  if (result.error) throw new Error(result.error.message);

  void appendAuditLog({
    tenantId: auth.tenantId!,
    branchId,
    actorUserId: auth.userId,
    actorRole: auth.branchRole ?? auth.platformRole,
    action: "inet_nops_settings_saved",
    targetTable: "pos_payment_provider_settings",
    targetId: result.data.id,
    metadata: { environment, is_active: isActive, merchant_id_configured: Boolean(merchantId), callback_is_public: isPublicHttpsUrl(callbackUrl) }
  });

  return mapSettings(result.data, featureEnabled);
}

export async function testInetNopsProviderConnection(auth: AuthContext, requestedBranchId?: string | null) {
  assertCanManageSettings(auth);
  const branchId = await resolveBranchId(auth, requestedBranchId);
  const featureEnabled = await hasBranchFeatureSafe(auth.tenantId!, branchId, INET_NOPS_FEATURE_KEY);
  if (!featureEnabled) throw new FeatureGateError("feature_not_enabled", "INET QR is not included in this branch package.");

  const existing = await readProviderRow(auth.tenantId!, branchId);
  if (!existing) throw new Error("Save INET QR settings before testing the connection.");
  const environment = resolveInetNopsEnvironment(existing.environment);
  const now = new Date().toISOString();
  try {
    const result = await testInetNopsConnection(environment);
    const { data, error } = await getSupabaseServiceClient()
      .from("pos_payment_provider_settings")
      .update({ connection_status: "ready", last_connection_checked_at: now, last_connection_error: null, last_test_order_id: result.providerOrderId })
      .eq("id", existing.id)
      .select("id,branch_id,environment,merchant_id,is_active,connection_status,last_connection_checked_at,last_connection_error,last_test_order_id,callback_url")
      .single<ProviderSettingsRow>();
    if (error) throw new Error(error.message);
    void appendAuditLog({
      tenantId: auth.tenantId!,
      branchId,
      actorUserId: auth.userId,
      actorRole: auth.branchRole ?? auth.platformRole,
      action: "inet_nops_connection_tested",
      targetTable: "pos_payment_provider_settings",
      targetId: existing.id,
      metadata: { environment, provider_order_id: result.providerOrderId, ok: true }
    });
    return mapSettings(data, featureEnabled);
  } catch (error) {
    const message = error instanceof Error ? error.message : "INET connection test failed.";
    await getSupabaseServiceClient()
      .from("pos_payment_provider_settings")
      .update({ connection_status: "error", last_connection_checked_at: now, last_connection_error: message })
      .eq("id", existing.id);
    throw new Error(message);
  }
}
