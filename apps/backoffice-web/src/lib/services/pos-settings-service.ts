import "server-only";

import { appendAuditLog } from "@/lib/audit-log";
import type { AuthContext } from "@/lib/auth-context";
import { enforceQuota } from "@/lib/feature-gate";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

export type StoreSettings = {
  id: string;
  code: string;
  name: string;
  display_name: string;
  logo_url: string;
  company_address: string;
  contact_phone: string;
};

export type BranchSettings = {
  id: string;
  code: string;
  name: string;
  address: string;
  is_active: boolean;
};

export type PaymentAccountSettings = {
  id: string;
  branch_id: string;
  bank_name: string;
  account_name: string;
  account_number: string;
  promptpay_phone: string;
  promptpay_payload: string;
  qr_image_url: string;
  qr_mode: "promptpay_link" | "qr_image";
  applies_to_all_branches: boolean;
  is_active: boolean;
};

export type TaxLineMode = "add_to_bill" | "deduct_from_bill";

export type TaxLineSettings = {
  id: string;
  label: string;
  rate_pct: number;
  mode: TaxLineMode;
  is_active: boolean;
};

export type TaxSettings = {
  is_enabled: boolean;
  calculation_base: "net_after_discount";
  lines: TaxLineSettings[];
};

export type PosNotificationSettings = {
  table_qr_popup_enabled: boolean;
  table_qr_sound_enabled: boolean;
  table_qr_sound_volume: number;
};

export type PosDeviceSettings = {
  id: string;
  branch_id: string;
  device_code: string;
  device_name: string;
  device_type: "pos_terminal" | "mobile_scanner" | "kiosk";
  status: "active" | "inactive" | "maintenance";
  is_locked: boolean;
  counter_name: string;
  location: string;
  last_seen_at: string | null;
};

export type PosSettingsSnapshot = {
  store: StoreSettings | null;
  branches: BranchSettings[];
  payment_accounts: PaymentAccountSettings[];
  tax_settings: TaxSettings;
  notification_settings: PosNotificationSettings;
  metadata: {
    tenant_id: string | null;
    branch_id: string | null;
    can_manage: boolean;
    payment_accounts_ready: boolean;
  };
};

type DbError = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
};

type StoreRow = {
  id: string;
  code: string | null;
  name: string | null;
  display_name?: string | null;
  logo_url?: string | null;
  company_address?: string | null;
  contact_phone?: string | null;
  owner_phone?: string | null;
};

type BranchRow = {
  id: string;
  code: string | null;
  name: string | null;
  address: string | null;
  is_active: boolean | null;
};

type PaymentAccountRow = {
  id: string;
  branch_id: string;
  bank_name: string | null;
  account_name: string | null;
  account_number: string | null;
  promptpay_phone: string | null;
  promptpay_payload?: string | null;
  qr_image_url: string | null;
  qr_mode?: string | null;
  applies_to_all_branches?: boolean | null;
  is_active: boolean | null;
};

type PosDeviceRow = {
  id: string;
  branch_id: string;
  device_code: string | null;
  device_name: string | null;
  device_type: string | null;
  status: string | null;
  is_locked: boolean | null;
  metadata: Record<string, unknown> | null;
  last_seen_at: string | null;
};

type TaxSettingsRow = {
  is_enabled: boolean | null;
  calculation_base: string | null;
  settings: Record<string, unknown> | null;
};

type PosNotificationSettingsRow = {
  table_qr_popup_enabled: boolean | null;
  table_qr_sound_enabled: boolean | null;
  table_qr_sound_volume: number | null;
};

export type StoreSettingsInput = {
  display_name?: string;
  logo_url?: string;
  company_address?: string;
  contact_phone?: string;
};

export type BranchSettingsInput = {
  id?: string;
  code?: string;
  name?: string;
  address?: string;
  is_active?: boolean;
};

export type PaymentAccountInput = {
  id?: string;
  branch_id?: string;
  bank_name?: string;
  account_name?: string;
  account_number?: string;
  promptpay_phone?: string;
  qr_image_url?: string;
  qr_mode?: "promptpay_link" | "qr_image";
  applies_to_all_branches?: boolean;
  is_active?: boolean;
};

export type TaxSettingsInput = Partial<TaxSettings> & {
  branch_id?: string;
};

export type PosNotificationSettingsInput = Partial<PosNotificationSettings> & {
  branch_id?: string;
};

export const DEFAULT_TAX_SETTINGS: TaxSettings = {
  is_enabled: false,
  calculation_base: "net_after_discount",
  lines: [
    { id: "vat-7", label: "VAT 7%", rate_pct: 7, mode: "add_to_bill", is_active: true },
    { id: "withholding-3", label: "หัก ณ ที่จ่าย 3%", rate_pct: 3, mode: "deduct_from_bill", is_active: false }
  ]
};

export const DEFAULT_POS_NOTIFICATION_SETTINGS: PosNotificationSettings = {
  table_qr_popup_enabled: true,
  table_qr_sound_enabled: true,
  table_qr_sound_volume: 0.8
};

export type PosDeviceInput = {
  id?: string;
  branch_id?: string;
  device_code?: string;
  device_name?: string;
  device_type?: "pos_terminal" | "mobile_scanner" | "kiosk";
  status?: "active" | "inactive" | "maintenance";
  is_locked?: boolean;
  counter_name?: string;
  location?: string;
};

function trimText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeStoreLogoUrl(value: unknown) {
  const logoUrl = trimText(value);
  if (!logoUrl) return "";
  if (logoUrl.length > 220_000) {
    throw new Error("Store logo file is too large. Please upload a smaller image.");
  }
  if (logoUrl.startsWith("data:image/") || logoUrl.startsWith("https://") || logoUrl.startsWith("http://") || logoUrl.startsWith("/")) {
    return logoUrl;
  }
  throw new Error("Store logo must be an image upload or image URL.");
}

function normalizeDigits(value: unknown) {
  return trimText(value).replace(/[^\d]/g, "");
}

function isMissingSchemaError(error: DbError | null | undefined, relationOrColumn?: string) {
  if (!error) return false;
  const code = String(error.code ?? "");
  const message = `${error.message ?? ""} ${error.details ?? ""}`.toLowerCase();
  const target = relationOrColumn?.toLowerCase() ?? "";
  return (
    code === "42P01" ||
    code === "42703" ||
    code === "PGRST204" ||
    code === "PGRST205" ||
    message.includes("does not exist") ||
    message.includes("could not find") ||
    (target ? message.includes(target) : false)
  );
}

function isMissingRelationSchemaError(error: DbError | null | undefined, relationName: string) {
  if (!error) return false;
  const code = String(error.code ?? "");
  const message = `${error.message ?? ""} ${error.details ?? ""}`.toLowerCase();
  const relation = relationName.toLowerCase();
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    (message.includes(relation) && (message.includes("does not exist") || message.includes("could not find the table")))
  );
}

function canManageSettings(auth: AuthContext) {
  return auth.platformRole === "it_admin" || auth.branchRole === "owner";
}

export function assertCanManageSettings(auth: AuthContext) {
  if (!canManageSettings(auth)) {
    throw new Error("Only owner can manage POS settings.");
  }
}

function mapStore(row: StoreRow | null | undefined): StoreSettings | null {
  if (!row) return null;
  const name = trimText(row.name);
  return {
    id: row.id,
    code: trimText(row.code),
    name,
    display_name: trimText(row.display_name) || name,
    logo_url: trimText(row.logo_url),
    company_address: trimText(row.company_address),
    contact_phone: trimText(row.contact_phone) || trimText(row.owner_phone)
  };
}

function mapBranch(row: BranchRow): BranchSettings {
  return {
    id: row.id,
    code: trimText(row.code),
    name: trimText(row.name),
    address: trimText(row.address),
    is_active: row.is_active !== false
  };
}

export function buildPromptPayPayload(phone: unknown) {
  const digits = normalizeDigits(phone);
  return digits ? `https://promptpay.io/${digits}` : "";
}

export async function loadTaxSettings(auth: AuthContext, requestedBranchId?: string | null): Promise<TaxSettings> {
  if (!auth.tenantId) return DEFAULT_TAX_SETTINGS;
  const supabase = getSupabaseServiceClient();
  const branchId = trimText(requestedBranchId) || auth.branchId || null;
  if (branchId && branchId !== auth.branchId) {
    assertCanManageSettings(auth);
    await assertBranchInTenant(auth.tenantId, branchId);
  }
  let query = supabase
    .from("tenant_tax_settings")
    .select("is_enabled,calculation_base,settings")
    .eq("tenant_id", auth.tenantId);
  query = branchId ? query.eq("branch_id", branchId) : query.is("branch_id", null);
  const { data, error } = await query.maybeSingle<TaxSettingsRow>();
  if (error) {
    if (isMissingRelationSchemaError(error, "tenant_tax_settings")) return DEFAULT_TAX_SETTINGS;
    throw new Error(error.message);
  }
  return mapTaxSettings(data);
}

function mapPaymentAccount(row: PaymentAccountRow): PaymentAccountSettings {
  const promptpayPhone = trimText(row.promptpay_phone);
  const qrMode = row.qr_mode === "qr_image" ? "qr_image" : "promptpay_link";
  return {
    id: row.id,
    branch_id: row.branch_id,
    bank_name: trimText(row.bank_name),
    account_name: trimText(row.account_name),
    account_number: trimText(row.account_number),
    promptpay_phone: promptpayPhone,
    promptpay_payload: trimText(row.promptpay_payload) || buildPromptPayPayload(promptpayPhone),
    qr_image_url: trimText(row.qr_image_url),
    qr_mode: qrMode,
    applies_to_all_branches: Boolean(row.applies_to_all_branches),
    is_active: row.is_active !== false
  };
}

async function deactivateConflictingActivePaymentAccounts(args: {
  tenantId: string;
  branchId: string;
  accountId?: string;
  appliesToAllBranches: boolean;
}) {
  const supabase = getSupabaseServiceClient();

  let query = supabase
    .from("tenant_payment_accounts")
    .update({ is_active: false })
    .eq("tenant_id", args.tenantId)
    .eq("is_active", true);

  query = args.appliesToAllBranches
    ? query
    : query.or(`branch_id.eq.${args.branchId},applies_to_all_branches.eq.true`);

  if (args.accountId) {
    query = query.neq("id", args.accountId);
  }

  const { error } = await query;
  if (error) {
    if (!isMissingSchemaError(error, "tenant_payment_accounts")) {
      throw new Error(error.message);
    }
    let legacyQuery = supabase
      .from("tenant_payment_accounts")
      .update({ is_active: false })
      .eq("tenant_id", args.tenantId)
      .eq("branch_id", args.branchId)
      .eq("is_active", true);
    if (args.accountId) {
      legacyQuery = legacyQuery.neq("id", args.accountId);
    }
    const legacyResult = await legacyQuery;
    if (legacyResult.error && !isMissingSchemaError(legacyResult.error, "tenant_payment_accounts")) {
      throw new Error(legacyResult.error.message);
    }
  }
}

function normalizeDeviceCode(value: unknown) {
  return trimText(value)
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeDeviceType(value: unknown): PosDeviceSettings["device_type"] {
  if (value === "mobile_scanner" || value === "kiosk") return value;
  return "pos_terminal";
}

function normalizeDeviceStatus(value: unknown): PosDeviceSettings["status"] {
  if (value === "inactive" || value === "maintenance") return value;
  return "active";
}

function normalizeTaxRate(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return 0;
  return Number(Math.min(100, numeric).toFixed(2));
}

function normalizeTaxLineMode(value: unknown): TaxLineMode {
  return value === "deduct_from_bill" ? "deduct_from_bill" : "add_to_bill";
}

function normalizeTaxSettings(input: unknown): TaxSettings {
  const source = input && typeof input === "object" ? (input as Partial<TaxSettings>) : {};
  const rawLines = Array.isArray(source.lines) ? source.lines : DEFAULT_TAX_SETTINGS.lines;
  const lines = rawLines.slice(0, 6).map((line, index) => {
    const item = line && typeof line === "object" ? (line as Partial<TaxLineSettings>) : {};
    return {
      id: trimText(item.id) || `tax-line-${index + 1}`,
      label: trimText(item.label) || (index === 0 ? "VAT 7%" : `Tax ${index + 1}`),
      rate_pct: normalizeTaxRate(item.rate_pct),
      mode: normalizeTaxLineMode(item.mode),
      is_active: item.is_active !== false
    };
  });
  return {
    is_enabled: source.is_enabled === true,
    calculation_base: "net_after_discount",
    lines: lines.length > 0 ? lines : DEFAULT_TAX_SETTINGS.lines
  };
}

function normalizeNotificationVolume(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_POS_NOTIFICATION_SETTINGS.table_qr_sound_volume;
  return Number(Math.max(0, Math.min(1, numeric)).toFixed(2));
}

function normalizePosNotificationSettings(input: unknown): PosNotificationSettings {
  const source = input && typeof input === "object" ? (input as Partial<PosNotificationSettings>) : {};
  return {
    table_qr_popup_enabled: source.table_qr_popup_enabled !== false,
    table_qr_sound_enabled: source.table_qr_sound_enabled !== false,
    table_qr_sound_volume: normalizeNotificationVolume(source.table_qr_sound_volume)
  };
}

export function calculateTaxBreakdown(baseAmount: number, settings: TaxSettings) {
  const safeBase = Number(Math.max(0, Number(baseAmount) || 0).toFixed(2));
  if (!settings.is_enabled) {
    return { base_amount: safeBase, tax_total: 0, grand_total: safeBase, lines: [] as Array<TaxLineSettings & { amount: number }> };
  }
  const lines = settings.lines
    .filter((line) => line.is_active && line.rate_pct > 0)
    .map((line) => {
      const rawAmount = Number((safeBase * (line.rate_pct / 100)).toFixed(2));
      return { ...line, amount: line.mode === "deduct_from_bill" ? -rawAmount : rawAmount };
    });
  const taxTotal = Number(lines.reduce((sum, line) => sum + line.amount, 0).toFixed(2));
  return {
    base_amount: safeBase,
    tax_total: taxTotal,
    grand_total: Number(Math.max(0, safeBase + taxTotal).toFixed(2)),
    lines
  };
}

function mapDevice(row: PosDeviceRow): PosDeviceSettings {
  const metadata = row.metadata ?? {};
  return {
    id: row.id,
    branch_id: row.branch_id,
    device_code: trimText(row.device_code),
    device_name: trimText(row.device_name),
    device_type: normalizeDeviceType(row.device_type),
    status: normalizeDeviceStatus(row.status),
    is_locked: row.is_locked !== false,
    counter_name: typeof metadata.counter_name === "string" ? metadata.counter_name : "",
    location: typeof metadata.location === "string" ? metadata.location : "",
    last_seen_at: row.last_seen_at ?? null
  };
}

function mapTaxSettings(row: TaxSettingsRow | null | undefined): TaxSettings {
  if (!row) return DEFAULT_TAX_SETTINGS;
  return normalizeTaxSettings({
    is_enabled: row.is_enabled === true,
    calculation_base: row.calculation_base,
    lines: Array.isArray(row.settings?.lines) ? row.settings.lines : DEFAULT_TAX_SETTINGS.lines
  });
}

function mapPosNotificationSettings(row: PosNotificationSettingsRow | null | undefined): PosNotificationSettings {
  if (!row) return DEFAULT_POS_NOTIFICATION_SETTINGS;
  return normalizePosNotificationSettings({
    table_qr_popup_enabled: row.table_qr_popup_enabled,
    table_qr_sound_enabled: row.table_qr_sound_enabled,
    table_qr_sound_volume: row.table_qr_sound_volume
  });
}

export async function loadPosNotificationSettings(
  auth: AuthContext,
  requestedBranchId?: string | null
): Promise<PosNotificationSettings> {
  if (!auth.tenantId) return DEFAULT_POS_NOTIFICATION_SETTINGS;
  const supabase = getSupabaseServiceClient();
  const branchId = trimText(requestedBranchId) || auth.branchId || null;
  if (!branchId) return DEFAULT_POS_NOTIFICATION_SETTINGS;
  if (branchId !== auth.branchId) {
    assertCanManageSettings(auth);
    await assertBranchInTenant(auth.tenantId, branchId);
  }
  const { data, error } = await supabase
    .from("tenant_pos_notification_settings")
    .select("table_qr_popup_enabled,table_qr_sound_enabled,table_qr_sound_volume")
    .eq("tenant_id", auth.tenantId)
    .eq("branch_id", branchId)
    .maybeSingle<PosNotificationSettingsRow>();
  if (error) {
    if (isMissingRelationSchemaError(error, "tenant_pos_notification_settings")) return DEFAULT_POS_NOTIFICATION_SETTINGS;
    throw new Error(error.message);
  }
  return mapPosNotificationSettings(data);
}

async function loadStoreSettings(tenantId: string) {
  const supabase = getSupabaseServiceClient();
  const fullResult = await supabase
    .from("tenants")
    .select("id,code,name,display_name,logo_url,company_address,contact_phone,owner_phone")
    .eq("id", tenantId)
    .maybeSingle<StoreRow>();

  if (fullResult.error && isMissingSchemaError(fullResult.error)) {
    const legacyResult = await supabase.from("tenants").select("id,code,name,owner_phone").eq("id", tenantId).maybeSingle<StoreRow>();
    if (legacyResult.error) throw new Error(legacyResult.error.message);
    return mapStore(legacyResult.data);
  }
  if (fullResult.error) throw new Error(fullResult.error.message);
  return mapStore(fullResult.data);
}

export async function loadPosSettingsSnapshot(auth: AuthContext): Promise<PosSettingsSnapshot> {
  if (!auth.tenantId) {
    return {
      store: null,
      branches: [],
      payment_accounts: [],
      tax_settings: DEFAULT_TAX_SETTINGS,
      notification_settings: DEFAULT_POS_NOTIFICATION_SETTINGS,
      metadata: { tenant_id: null, branch_id: auth.branchId, can_manage: false, payment_accounts_ready: false }
    };
  }

  const supabase = getSupabaseServiceClient();
  const [store, branchesResult, paymentResult, taxSettings, notificationSettings] = await Promise.all([
    loadStoreSettings(auth.tenantId),
    supabase.from("branches").select("id,code,name,address,is_active").eq("tenant_id", auth.tenantId).order("name", { ascending: true }),
    (async () => {
      const fullResult = await supabase
        .from("tenant_payment_accounts")
        .select("id,branch_id,bank_name,account_name,account_number,promptpay_phone,promptpay_payload,qr_image_url,qr_mode,applies_to_all_branches,is_active")
        .eq("tenant_id", auth.tenantId)
        .order("is_active", { ascending: false })
        .order("bank_name", { ascending: true });

      if (
        fullResult.error &&
        isMissingSchemaError(fullResult.error, "tenant_payment_accounts") &&
        !isMissingRelationSchemaError(fullResult.error, "tenant_payment_accounts")
      ) {
        return supabase
          .from("tenant_payment_accounts")
          .select("id,branch_id,bank_name,account_name,account_number,promptpay_phone,promptpay_payload,qr_image_url,is_active")
          .eq("tenant_id", auth.tenantId)
          .order("is_active", { ascending: false })
          .order("bank_name", { ascending: true });
      }

      return fullResult;
    })(),
    loadTaxSettings(auth),
    loadPosNotificationSettings(auth)
  ]);

  if (branchesResult.error) throw new Error(branchesResult.error.message);

  const paymentAccountsReady = !paymentResult.error || !isMissingSchemaError(paymentResult.error, "tenant_payment_accounts");
  if (paymentResult.error && paymentAccountsReady) {
    throw new Error(paymentResult.error.message);
  }

  return {
    store,
    branches: ((branchesResult.data ?? []) as BranchRow[]).map(mapBranch),
    payment_accounts: paymentResult.error ? [] : ((paymentResult.data ?? []) as PaymentAccountRow[]).map(mapPaymentAccount),
    tax_settings: taxSettings,
    notification_settings: notificationSettings,
    metadata: {
      tenant_id: auth.tenantId,
      branch_id: auth.branchId,
      can_manage: canManageSettings(auth),
      payment_accounts_ready: paymentAccountsReady
    }
  };
}

export async function loadDeviceSettings(auth: AuthContext): Promise<PosDeviceSettings[]> {
  if (!auth.tenantId) return [];
  const supabase = getSupabaseServiceClient();
  let query = supabase
    .from("branch_devices")
    .select("id,branch_id,device_code,device_name,device_type,status,is_locked,metadata,last_seen_at")
    .eq("tenant_id", auth.tenantId)
    .order("device_code", { ascending: true });

  if (!canManageSettings(auth) && auth.branchId) {
    query = query.eq("branch_id", auth.branchId);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return ((data ?? []) as PosDeviceRow[]).map(mapDevice);
}

async function syncBranchDevicePolicy(tenantId: string, branchId: string) {
  const supabase = getSupabaseServiceClient();
  const [{ count, error: countError }, { data: policy, error: policyError }] = await Promise.all([
    supabase.from("branch_devices").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("branch_id", branchId).eq("status", "active"),
    supabase.from("branch_login_policies").select("max_devices").eq("tenant_id", tenantId).eq("branch_id", branchId).maybeSingle<{ max_devices: number | null }>()
  ]);

  if (countError) throw new Error(countError.message);
  if (policyError) throw new Error(policyError.message);

  const activeDevices = Math.max(1, Number(count ?? 0));
  const currentMax = Math.max(1, Number(policy?.max_devices ?? 1));
  const nextMax = Math.max(activeDevices, currentMax);
  const { error } = await supabase
    .from("branch_login_policies")
    .upsert(
      {
        tenant_id: tenantId,
        branch_id: branchId,
        max_devices: nextMax
      },
      { onConflict: "tenant_id,branch_id" }
    );
  if (error) throw new Error(error.message);
}

function runDeviceSettingsBackgroundTask(label: string, task: () => Promise<unknown>) {
  void task().catch((error) => {
    console.error(`[pos-settings] background task failed: ${label}`, {
      error: error instanceof Error ? error.message : String(error)
    });
  });
}

export async function saveDeviceSettings(auth: AuthContext, input: PosDeviceInput) {
  assertCanManageSettings(auth);
  if (!auth.tenantId) throw new Error("Missing tenant scope.");
  const tenantId = auth.tenantId;

  const deviceName = trimText(input.device_name);
  const deviceCode = normalizeDeviceCode(input.device_code);
  const counterName = trimText(input.counter_name);
  const location = trimText(input.location);
  const deviceType = normalizeDeviceType(input.device_type);
  const status = normalizeDeviceStatus(input.status);
  const isLocked = input.is_locked !== false;
  if (!deviceCode || !deviceName) throw new Error("Device code and device name are required.");

  const supabase = getSupabaseServiceClient();
  const deviceId = trimText(input.id);
  const currentDevice = deviceId
    ? await supabase
        .from("branch_devices")
        .select("id,branch_id,device_code,status")
        .eq("tenant_id", auth.tenantId)
        .eq("id", deviceId)
        .maybeSingle<{ id: string; branch_id: string; device_code: string | null; status: string | null }>()
    : null;
  if (currentDevice?.error) throw new Error(currentDevice.error.message);
  if (deviceId && !currentDevice?.data) throw new Error("Cashier device was not found.");

  const previousBranchId = currentDevice?.data?.branch_id ?? null;
  const branchId = trimText(input.branch_id) || previousBranchId || trimText(auth.branchId);
  if (!branchId) throw new Error("Branch is required for cashier device.");
  await assertBranchInTenant(auth.tenantId, branchId);

  const willActivateDevice = status === "active" && (!deviceId || currentDevice?.data?.status !== "active");
  if (willActivateDevice) {
    await enforceQuota(auth.tenantId, "devices", branchId);
  }

  const isDeviceIdentityChanged = Boolean(
    deviceId && currentDevice?.data && (currentDevice.data.branch_id !== branchId || currentDevice.data.device_code !== deviceCode)
  );
  if (isDeviceIdentityChanged) {
    const nowIso = new Date().toISOString();
    const revokeByDeviceId = await supabase
      .from("pos_sessions")
      .update({ status: "revoked", revoked_at: nowIso })
      .eq("tenant_id", auth.tenantId)
      .eq("device_id", deviceId)
      .eq("status", "active");
    if (revokeByDeviceId.error) throw new Error(revokeByDeviceId.error.message);

    if (currentDevice?.data?.device_code) {
      const revokeByDeviceCode = await supabase
        .from("pos_sessions")
        .update({ status: "revoked", revoked_at: nowIso })
        .eq("tenant_id", auth.tenantId)
        .eq("branch_id", currentDevice.data.branch_id)
        .eq("device_code", currentDevice.data.device_code)
        .eq("status", "active");
      if (revokeByDeviceCode.error) throw new Error(revokeByDeviceCode.error.message);
    }
  }

  const metadata = {
    counter_name: counterName || null,
    location: location || null,
    provisioned_from: "pos_settings"
  };
  const payload = {
    branch_id: branchId,
    device_code: deviceCode,
    device_name: deviceName,
    device_type: deviceType,
    status,
    is_locked: isLocked,
    metadata
  };

  const result = deviceId
    ? await supabase
        .from("branch_devices")
        .update(payload)
        .eq("tenant_id", auth.tenantId)
        .eq("id", deviceId)
        .select("id,branch_id,device_code,device_name,device_type,status,is_locked,metadata,last_seen_at")
        .maybeSingle<PosDeviceRow>()
    : await supabase
        .from("branch_devices")
        .insert({
          tenant_id: auth.tenantId,
          ...payload
        })
        .select("id,branch_id,device_code,device_name,device_type,status,is_locked,metadata,last_seen_at")
        .single<PosDeviceRow>();

  if (result.error) throw new Error(result.error.message);
  if (!result.data) throw new Error("Cashier device was not found.");

  const savedDevice = mapDevice(result.data);

  runDeviceSettingsBackgroundTask("sync_branch_device_policy", async () => {
    await syncBranchDevicePolicy(tenantId, branchId);
    if (previousBranchId && previousBranchId !== branchId) {
      await syncBranchDevicePolicy(tenantId, previousBranchId);
    }
  });
  runDeviceSettingsBackgroundTask("append_device_audit_log", () =>
    appendAuditLog({
      tenantId,
      branchId,
      actorUserId: auth.userId,
      actorRole: auth.branchRole ?? "owner",
      action: deviceId ? "pos_cashier_device_updated" : "pos_cashier_device_created",
      targetTable: "branch_devices",
      targetId: savedDevice.id,
      metadata: {
        device_code: deviceCode,
        device_name: deviceName,
        status,
        is_locked: isLocked
      }
    })
  );

  return savedDevice;
}

export async function deleteDeviceSettings(auth: AuthContext, deviceId: string) {
  assertCanManageSettings(auth);
  if (!auth.tenantId) throw new Error("Missing tenant scope.");
  const normalizedDeviceId = trimText(deviceId);
  if (!normalizedDeviceId) throw new Error("device_id is required.");
  const supabase = getSupabaseServiceClient();

  const { data: current, error: currentError } = await supabase
    .from("branch_devices")
    .select("id,branch_id,device_code,device_name")
    .eq("tenant_id", auth.tenantId)
    .eq("id", normalizedDeviceId)
    .maybeSingle<{ id: string; branch_id: string; device_code: string | null; device_name: string | null }>();
  if (currentError) throw new Error(currentError.message);
  if (!current) throw new Error("Cashier device was not found.");

  const nowIso = new Date().toISOString();
  const revokeByDeviceId = await supabase
    .from("pos_sessions")
    .update({ status: "revoked", revoked_at: nowIso })
    .eq("tenant_id", auth.tenantId)
    .eq("branch_id", current.branch_id)
    .eq("device_id", current.id)
    .eq("status", "active");
  if (revokeByDeviceId.error) throw new Error(revokeByDeviceId.error.message);

  if (current.device_code) {
    const revokeByDeviceCode = await supabase
      .from("pos_sessions")
      .update({ status: "revoked", revoked_at: nowIso })
      .eq("tenant_id", auth.tenantId)
      .eq("branch_id", current.branch_id)
      .eq("device_code", current.device_code)
      .eq("status", "active");
    if (revokeByDeviceCode.error) throw new Error(revokeByDeviceCode.error.message);
  }

  const deleteResult = await supabase.from("branch_devices").delete().eq("tenant_id", auth.tenantId).eq("id", normalizedDeviceId);
  if (deleteResult.error) throw new Error(deleteResult.error.message);

  await syncBranchDevicePolicy(auth.tenantId, current.branch_id);
  await appendAuditLog({
    tenantId: auth.tenantId,
    branchId: current.branch_id,
    actorUserId: auth.userId,
    actorRole: auth.branchRole ?? "owner",
    action: "pos_cashier_device_deleted",
    targetTable: "branch_devices",
    targetId: current.id,
    metadata: {
      device_code: current.device_code,
      device_name: current.device_name
    }
  });

  return { id: current.id, deleted: true };
}

export async function updateStoreSettings(auth: AuthContext, input: StoreSettingsInput) {
  assertCanManageSettings(auth);
  if (!auth.tenantId) throw new Error("Missing tenant scope.");

  const displayName = trimText(input.display_name);
  const logoUrl = normalizeStoreLogoUrl(input.logo_url);
  const companyAddress = trimText(input.company_address);
  const contactPhone = trimText(input.contact_phone);
  if (!displayName) throw new Error("Store display name is required.");

  const supabase = getSupabaseServiceClient();
  const updateResult = await supabase
    .from("tenants")
    .update({
      name: displayName,
      display_name: displayName,
      logo_url: logoUrl || null,
      company_address: companyAddress || null,
      contact_phone: contactPhone || null,
      owner_phone: contactPhone || null
    })
    .eq("id", auth.tenantId)
    .select("id,code,name,display_name,logo_url,company_address,contact_phone,owner_phone")
    .maybeSingle<StoreRow>();

  if (updateResult.error && isMissingSchemaError(updateResult.error)) {
    const legacyResult = await supabase
      .from("tenants")
      .update({ name: displayName, owner_phone: contactPhone || null })
      .eq("id", auth.tenantId)
      .select("id,code,name,owner_phone")
      .maybeSingle<StoreRow>();
    if (legacyResult.error) throw new Error(legacyResult.error.message);
    return mapStore(legacyResult.data);
  }
  if (updateResult.error) throw new Error(updateResult.error.message);

  await appendAuditLog({
    tenantId: auth.tenantId,
    branchId: auth.branchId ?? undefined,
    actorUserId: auth.userId,
    actorRole: auth.branchRole ?? "owner",
    action: "pos_store_settings_updated",
    targetTable: "tenants",
    targetId: auth.tenantId,
    metadata: {
      display_name: displayName,
      has_logo: Boolean(logoUrl),
      has_address: Boolean(companyAddress),
      has_contact_phone: Boolean(contactPhone)
    }
  });

  return mapStore(updateResult.data);
}

export async function saveTaxSettings(auth: AuthContext, input: TaxSettingsInput) {
  assertCanManageSettings(auth);
  if (!auth.tenantId) throw new Error("Missing tenant scope.");
  const tenantId = auth.tenantId;
  const branchId = trimText(input.branch_id) || trimText(auth.branchId);
  if (!branchId) throw new Error("Branch is required for tax settings.");
  await assertBranchInTenant(tenantId, branchId);
  const settings = normalizeTaxSettings(input);
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("tenant_tax_settings")
    .upsert(
      {
        tenant_id: tenantId,
        branch_id: branchId,
        is_enabled: settings.is_enabled,
        calculation_base: settings.calculation_base,
        settings: { lines: settings.lines }
      },
      { onConflict: "tenant_id,branch_id" }
    )
    .select("is_enabled,calculation_base,settings")
    .maybeSingle<TaxSettingsRow>();
  if (error) throw new Error(error.message);

  runDeviceSettingsBackgroundTask("append_tax_settings_audit_log", () =>
    appendAuditLog({
      tenantId,
      branchId,
      actorUserId: auth.userId,
      actorRole: auth.branchRole ?? "owner",
      action: "pos_tax_settings_updated",
      targetTable: "tenant_tax_settings",
      metadata: {
        is_enabled: settings.is_enabled,
        lines: settings.lines
      }
    })
  );

  return mapTaxSettings(data);
}

export async function savePosNotificationSettings(auth: AuthContext, input: PosNotificationSettingsInput) {
  assertCanManageSettings(auth);
  if (!auth.tenantId) throw new Error("Missing tenant scope.");
  const tenantId = auth.tenantId;
  const branchId = trimText(input.branch_id) || trimText(auth.branchId);
  if (!branchId) throw new Error("Branch is required for notification settings.");
  await assertBranchInTenant(tenantId, branchId);
  const settings = normalizePosNotificationSettings(input);
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("tenant_pos_notification_settings")
    .upsert(
      {
        tenant_id: tenantId,
        branch_id: branchId,
        table_qr_popup_enabled: settings.table_qr_popup_enabled,
        table_qr_sound_enabled: settings.table_qr_sound_enabled,
        table_qr_sound_volume: settings.table_qr_sound_volume
      },
      { onConflict: "tenant_id,branch_id" }
    )
    .select("table_qr_popup_enabled,table_qr_sound_enabled,table_qr_sound_volume")
    .maybeSingle<PosNotificationSettingsRow>();
  if (error) throw new Error(error.message);

  runDeviceSettingsBackgroundTask("append_pos_notification_settings_audit_log", () =>
    appendAuditLog({
      tenantId,
      branchId,
      actorUserId: auth.userId,
      actorRole: auth.branchRole ?? "owner",
      action: "pos_notification_settings_updated",
      targetTable: "tenant_pos_notification_settings",
      metadata: settings
    })
  );

  return mapPosNotificationSettings(data);
}

async function assertBranchInTenant(tenantId: string, branchId: string) {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase.from("branches").select("id").eq("tenant_id", tenantId).eq("id", branchId).maybeSingle<{ id: string }>();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Branch was not found in this tenant.");
}

export async function saveBranchSettings(auth: AuthContext, input: BranchSettingsInput) {
  assertCanManageSettings(auth);
  if (!auth.tenantId) throw new Error("Missing tenant scope.");

  const code = trimText(input.code).toUpperCase();
  const name = trimText(input.name);
  const address = trimText(input.address);
  if (!code || !name) throw new Error("Branch code and branch name are required.");

  const supabase = getSupabaseServiceClient();
  const branchId = trimText(input.id);
  if (branchId) {
    await assertBranchInTenant(auth.tenantId, branchId);
    const { data, error } = await supabase
      .from("branches")
      .update({ code, name, address: address || null, is_active: input.is_active ?? true })
      .eq("tenant_id", auth.tenantId)
      .eq("id", branchId)
      .select("id,code,name,address,is_active")
      .maybeSingle<BranchRow>();
    if (error) throw new Error(error.message);
    return mapBranch(data!);
  }

  const { data, error } = await supabase
    .from("branches")
    .insert({ tenant_id: auth.tenantId, code, name, address: address || null, is_active: input.is_active ?? true })
    .select("id,code,name,address,is_active")
    .single<BranchRow>();
  if (error) throw new Error(error.message);

  const ownerRoleResult = await supabase.from("user_branch_roles").upsert(
    {
      user_id: auth.userId,
      tenant_id: auth.tenantId,
      branch_id: data.id,
      role: "owner",
      is_default: false
    },
    { onConflict: "user_id,tenant_id,branch_id" }
  );
  if (ownerRoleResult.error) throw new Error(ownerRoleResult.error.message);

  await appendAuditLog({
    tenantId: auth.tenantId,
    branchId: data.id,
    actorUserId: auth.userId,
    actorRole: auth.branchRole ?? "owner",
    action: "pos_branch_saved",
    targetTable: "branches",
    targetId: data.id,
    metadata: { code, name }
  });

  return mapBranch(data);
}

export async function deactivateBranchSettings(auth: AuthContext, branchId: string) {
  assertCanManageSettings(auth);
  if (!auth.tenantId) throw new Error("Missing tenant scope.");
  const normalizedBranchId = trimText(branchId);
  if (!normalizedBranchId) throw new Error("branch_id is required.");
  if (normalizedBranchId === auth.branchId) throw new Error("Current active branch cannot be deleted from this screen.");

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("branches")
    .update({ is_active: false })
    .eq("tenant_id", auth.tenantId)
    .eq("id", normalizedBranchId)
    .select("id,code,name,address,is_active")
    .maybeSingle<BranchRow>();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Branch was not found.");
  return mapBranch(data);
}

export async function savePaymentAccount(auth: AuthContext, input: PaymentAccountInput) {
  assertCanManageSettings(auth);
  if (!auth.tenantId) throw new Error("Missing tenant scope.");
  const branchId = trimText(input.branch_id) || trimText(auth.branchId);
  if (!branchId) throw new Error("Branch is required for payment account.");
  await assertBranchInTenant(auth.tenantId, branchId);

  const bankName = trimText(input.bank_name);
  const accountName = trimText(input.account_name);
  const accountNumber = trimText(input.account_number);
  const promptpayPhone = trimText(input.promptpay_phone);
  const qrImageUrl = trimText(input.qr_image_url);
  const qrMode = input.qr_mode === "qr_image" ? "qr_image" : "promptpay_link";
  const appliesToAllBranches = input.applies_to_all_branches === true;
  const isActive = input.is_active ?? true;
  if (!bankName || !accountName) throw new Error("Bank name and account name are required.");
  if (qrMode === "promptpay_link" && !promptpayPhone) throw new Error("PromptPay phone is required for generated QR mode.");
  if (qrMode === "qr_image" && !qrImageUrl) throw new Error("QR image is required for image QR mode.");

  const supabase = getSupabaseServiceClient();
  const accountId = trimText(input.id);
  if (isActive) {
    await deactivateConflictingActivePaymentAccounts({
      tenantId: auth.tenantId,
      branchId,
      accountId,
      appliesToAllBranches
    });
  }

  const payload = {
    tenant_id: auth.tenantId,
    branch_id: branchId,
    bank_name: bankName,
    account_name: accountName,
    account_number: accountNumber,
    promptpay_phone: promptpayPhone || null,
    promptpay_payload: buildPromptPayPayload(promptpayPhone) || null,
    qr_image_url: qrImageUrl || null,
    qr_mode: qrMode,
    applies_to_all_branches: appliesToAllBranches,
    is_active: isActive,
    created_by: auth.userId
  };

  const updatePayload = {
    branch_id: branchId,
    bank_name: bankName,
    account_name: accountName,
    account_number: accountNumber,
    promptpay_phone: promptpayPhone || null,
    promptpay_payload: buildPromptPayPayload(promptpayPhone) || null,
    qr_image_url: qrImageUrl || null,
    qr_mode: qrMode,
    applies_to_all_branches: appliesToAllBranches,
    is_active: isActive
  };
  let result = accountId
    ? await supabase
        .from("tenant_payment_accounts")
        .update(updatePayload)
        .eq("tenant_id", auth.tenantId)
        .eq("id", accountId)
        .select("id,branch_id,bank_name,account_name,account_number,promptpay_phone,promptpay_payload,qr_image_url,qr_mode,applies_to_all_branches,is_active")
        .maybeSingle<PaymentAccountRow>()
    : await supabase
        .from("tenant_payment_accounts")
        .insert(payload)
        .select("id,branch_id,bank_name,account_name,account_number,promptpay_phone,promptpay_payload,qr_image_url,qr_mode,applies_to_all_branches,is_active")
        .single<PaymentAccountRow>();

  if (
    result.error &&
    isMissingSchemaError(result.error, "tenant_payment_accounts") &&
    !isMissingRelationSchemaError(result.error, "tenant_payment_accounts")
  ) {
    const legacyPayload = {
      tenant_id: auth.tenantId,
      branch_id: branchId,
      bank_name: bankName,
      account_name: accountName,
      account_number: accountNumber,
      promptpay_phone: promptpayPhone || null,
      promptpay_payload: buildPromptPayPayload(promptpayPhone) || null,
      qr_image_url: qrImageUrl || null,
      is_active: isActive,
      created_by: auth.userId
    };
    const legacyUpdatePayload = {
      branch_id: branchId,
      bank_name: bankName,
      account_name: accountName,
      account_number: accountNumber,
      promptpay_phone: promptpayPhone || null,
      promptpay_payload: buildPromptPayPayload(promptpayPhone) || null,
      qr_image_url: qrImageUrl || null,
      is_active: isActive
    };

    result = accountId
      ? await supabase
          .from("tenant_payment_accounts")
          .update(legacyUpdatePayload)
          .eq("tenant_id", auth.tenantId)
          .eq("id", accountId)
          .select("id,branch_id,bank_name,account_name,account_number,promptpay_phone,promptpay_payload,qr_image_url,is_active")
          .maybeSingle<PaymentAccountRow>()
      : await supabase
          .from("tenant_payment_accounts")
          .insert(legacyPayload)
          .select("id,branch_id,bank_name,account_name,account_number,promptpay_phone,promptpay_payload,qr_image_url,is_active")
          .single<PaymentAccountRow>();
  }

  if (result.error) {
    if (String(result.error.code ?? "") === "23505") {
      throw new Error(
        appliesToAllBranches
          ? "Active tenant-wide payment account already exists."
          : "Active payment account already exists for this branch."
      );
    }
    if (isMissingSchemaError(result.error, "tenant_payment_accounts")) {
      throw new Error("Payment account table is missing. Please run the latest migration.");
    }
    throw new Error(result.error.message);
  }
  if (!result.data) throw new Error("Payment account was not found.");
  return mapPaymentAccount(result.data);
}

export async function deletePaymentAccount(auth: AuthContext, accountId: string) {
  assertCanManageSettings(auth);
  if (!auth.tenantId) throw new Error("Missing tenant scope.");
  const normalizedAccountId = trimText(accountId);
  if (!normalizedAccountId) throw new Error("account_id is required.");
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase.from("tenant_payment_accounts").delete().eq("tenant_id", auth.tenantId).eq("id", normalizedAccountId);
  if (error) {
    if (isMissingSchemaError(error, "tenant_payment_accounts")) {
      throw new Error("Payment account table is missing. Please run the latest migration.");
    }
    throw new Error(error.message);
  }
  return { id: normalizedAccountId, deleted: true };
}
