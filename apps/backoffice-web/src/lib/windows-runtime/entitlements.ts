import "server-only";

export const WINDOWS_RUNTIME_CONTRACT_VERSION = "2026-08-02.windows-runtime.v1";
export const WINDOWS_LOCAL_SCHEMA_VERSION = "0.1.0";
export const WINDOWS_RUNTIME_IDENTITY_ANCHOR = "store_code" as const;

export const WINDOWS_RUNTIME_FEATURE_KEYS = [
  "offline_sales_enabled",
  "local_database_enabled",
  "local_print_bridge_enabled",
  "cash_payment_offline_enabled",
  "receipt_print_offline_enabled",
  "shift_offline_enabled",
  "cloud_sync_enabled",
  "cloud_backup_enabled",
  "multi_branch_cloud_enabled",
  "advanced_reports_enabled",
  "inventory_enabled",
  "kitchen_display_enabled",
  "table_qr_ordering_enabled",
  "staff_attendance_enabled",
  "online_payment_enabled",
  "ai_feature_enabled"
] as const;

export type WindowsRuntimeFeatureKey = (typeof WINDOWS_RUNTIME_FEATURE_KEYS)[number];
export type WindowsRuntimeFeatureMap = Record<WindowsRuntimeFeatureKey, boolean>;

export type WindowsRuntimeEntitlementMode = "store_code_required" | "store_code_locked" | "offline_purchase" | "cloud_package";
export type WindowsRuntimeLicenseType = "store_code_required" | "offline_purchase" | "cloud_package";
export type WindowsRuntimeLicenseStatus = "active" | "not_activated" | "expired" | "suspended";
export type WindowsRuntimePackageCode =
  | "STORE_CODE_REQUIRED"
  | "STORE_CODE_LOCKED"
  | "OFFLINE_PURCHASE"
  | "CPIPOS_FULL_TEST"
  | "PACKAGE_REQUIRED";

type WindowsRuntimeLimits = {
  max_local_devices: number | null;
  max_branches: number | null;
  max_offline_days: number | null;
  max_pending_sync_items: number | null;
};

type StoreCodeEntitlementPolicy = {
  store_code: string;
  mode: Exclude<WindowsRuntimeEntitlementMode, "store_code_required" | "store_code_locked">;
  license_type: Exclude<WindowsRuntimeLicenseType, "store_code_required">;
  status: Extract<WindowsRuntimeLicenseStatus, "active">;
  package_code: Exclude<WindowsRuntimePackageCode, "STORE_CODE_REQUIRED" | "STORE_CODE_LOCKED" | "PACKAGE_REQUIRED">;
  package_name: string;
  tenant_id: string | null;
  tenant_name: string | null;
  cloud_sync_allowed: boolean;
  features: WindowsRuntimeFeatureMap;
  limits: WindowsRuntimeLimits;
  warnings: string[];
};

export type WindowsRuntimeBootstrapRequest = {
  store_code?: unknown;
  runtime_device_id?: unknown;
  device_code?: unknown;
  tenant_id?: unknown;
  branch_id?: unknown;
  app_version?: unknown;
  bridge_version?: unknown;
};

export type WindowsRuntimeBootstrapPayload = {
  contract_version: string;
  identity_anchor: typeof WINDOWS_RUNTIME_IDENTITY_ANCHOR;
  mode: WindowsRuntimeEntitlementMode;
  server_time: string;
  runtime: {
    store_code: string | null;
    store_code_required: boolean;
    device_code: string;
    runtime_device_id: string | null;
    app_version: string | null;
    bridge_version: string | null;
    unlock_source: "it_backoffice_store_code";
  };
  store: {
    store_code: string | null;
    resolved_by_server: boolean;
    tenant_id: string | null;
    tenant_name: string | null;
    branch_id: string | null;
  };
  activation: {
    requires_online_first_activation: boolean;
    unlocked_by_it_backoffice: boolean;
    can_run_windows_runtime: boolean;
    can_run_web_runtime: boolean;
    can_run_mobile_runtime: boolean;
  };
  license: {
    status: WindowsRuntimeLicenseStatus;
    license_type: WindowsRuntimeLicenseType;
    package_code: WindowsRuntimePackageCode;
    package_name: string;
    cloud_sync_allowed: boolean;
    expires_at: string | null;
    offline_grace_until: string | null;
  };
  entitlements: {
    features: WindowsRuntimeFeatureMap;
    limits: WindowsRuntimeLimits;
  };
  local_database: {
    enabled: boolean;
    provider: "sqlite";
    schema_version: string;
    recommended_path: string;
  };
  sync: {
    status: "disabled_store_code_required" | "disabled_store_code_locked" | "disabled_offline_purchase" | "enabled_by_package";
    endpoint_prefix: string;
    order_sync_ready: boolean;
    requires_idempotency_key: boolean;
    validates_package_on_server: boolean;
  };
  warnings: string[];
};

const OFFLINE_PURCHASE_TRUE: WindowsRuntimeFeatureKey[] = [
  "offline_sales_enabled",
  "local_database_enabled",
  "local_print_bridge_enabled",
  "cash_payment_offline_enabled",
  "receipt_print_offline_enabled",
  "shift_offline_enabled"
];

const NDL_TH_001_POLICY: StoreCodeEntitlementPolicy = {
  store_code: "NDL-TH-001",
  mode: "cloud_package",
  license_type: "cloud_package",
  status: "active",
  package_code: "CPIPOS_FULL_TEST",
  package_name: "CpIPOS Full Package - Sales Demo and Development",
  tenant_id: null,
  tenant_name: "NDL-TH-001 Sales Demo Store",
  cloud_sync_allowed: true,
  features: allFeatures(true),
  limits: {
    max_local_devices: null,
    max_branches: null,
    max_offline_days: 7,
    max_pending_sync_items: 10000
  },
  warnings: [
    "NDL-TH-001 is unlocked only when WINDOWS_RUNTIME_ENABLE_DEMO_STORE_CODE is enabled on the server.",
    "This temporary policy must be replaced by Supabase/IT Backoffice package resolution before production customer activation.",
    "Order/payment cloud sync endpoints are contract-ready but live sync writes are still disabled."
  ]
};

const STORE_CODE_POLICIES: Record<string, StoreCodeEntitlementPolicy> = {
  [NDL_TH_001_POLICY.store_code]: NDL_TH_001_POLICY
};

export function parseWindowsRuntimeRequest(input: unknown): WindowsRuntimeBootstrapRequest {
  if (!input || typeof input !== "object") return {};
  return input as WindowsRuntimeBootstrapRequest;
}

export function buildWindowsRuntimeBootstrap(input: WindowsRuntimeBootstrapRequest): WindowsRuntimeBootstrapPayload {
  const storeCode = normalizeStoreCode(input.store_code);
  const deviceCode = readString(input.device_code) || "WINDOWS-POS-LOCAL";
  const runtimeDeviceId = readString(input.runtime_device_id);
  const appVersion = readString(input.app_version);
  const bridgeVersion = readString(input.bridge_version);

  if (!storeCode) {
    return buildLockedPayload({
      mode: "store_code_required",
      syncStatus: "disabled_store_code_required",
      storeCode: null,
      deviceCode,
      runtimeDeviceId,
      appVersion,
      bridgeVersion,
      packageCode: "STORE_CODE_REQUIRED",
      packageName: "Store code required",
      warning: "Store code is required before CpIPOS Windows, CpIPOS Web, or future CpIPOS mobile runtimes can activate package features."
    });
  }

  const policy = resolveStoreCodePolicy(storeCode);
  if (!policy) {
    return buildLockedPayload({
      mode: "store_code_locked",
      syncStatus: "disabled_store_code_locked",
      storeCode,
      deviceCode,
      runtimeDeviceId,
      appVersion,
      bridgeVersion,
      packageCode: "STORE_CODE_LOCKED",
      packageName: "Store code is not unlocked for CpIPOS Windows",
      warning: "This store code has not been unlocked by server-side IT Backoffice package policy for CpIPOS Windows yet."
    });
  }

  return buildPolicyPayload(policy, {
    deviceCode,
    runtimeDeviceId,
    appVersion,
    bridgeVersion
  });
}

function resolveStoreCodePolicy(storeCode: string): StoreCodeEntitlementPolicy | null {
  if (!isDemoStoreCodeUnlockEnabled()) return null;
  return STORE_CODE_POLICIES[storeCode] ?? null;
}

function isDemoStoreCodeUnlockEnabled() {
  const raw = String(process.env.WINDOWS_RUNTIME_ENABLE_DEMO_STORE_CODE ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function buildPolicyPayload(
  policy: StoreCodeEntitlementPolicy,
  input: {
    deviceCode: string;
    runtimeDeviceId: string | null;
    appVersion: string | null;
    bridgeVersion: string | null;
  }
): WindowsRuntimeBootstrapPayload {
  return {
    contract_version: WINDOWS_RUNTIME_CONTRACT_VERSION,
    identity_anchor: WINDOWS_RUNTIME_IDENTITY_ANCHOR,
    mode: policy.mode,
    server_time: new Date().toISOString(),
    runtime: {
      store_code: policy.store_code,
      store_code_required: true,
      device_code: input.deviceCode,
      runtime_device_id: input.runtimeDeviceId,
      app_version: input.appVersion,
      bridge_version: input.bridgeVersion,
      unlock_source: "it_backoffice_store_code"
    },
    store: {
      store_code: policy.store_code,
      resolved_by_server: true,
      tenant_id: policy.tenant_id,
      tenant_name: policy.tenant_name,
      branch_id: null
    },
    activation: {
      requires_online_first_activation: true,
      unlocked_by_it_backoffice: true,
      can_run_windows_runtime: true,
      can_run_web_runtime: true,
      can_run_mobile_runtime: true
    },
    license: {
      status: policy.status,
      license_type: policy.license_type,
      package_code: policy.package_code,
      package_name: policy.package_name,
      cloud_sync_allowed: policy.cloud_sync_allowed,
      expires_at: null,
      offline_grace_until: null
    },
    entitlements: {
      features: policy.features,
      limits: policy.limits
    },
    local_database: {
      enabled: true,
      provider: "sqlite",
      schema_version: WINDOWS_LOCAL_SCHEMA_VERSION,
      recommended_path: "%LOCALAPPDATA%\\CpIPOS\\WindowsRuntime\\data\\cpipos-local.db"
    },
    sync: {
      status: policy.cloud_sync_allowed ? "enabled_by_package" : "disabled_offline_purchase",
      endpoint_prefix: "/api/windows-runtime/v1/sync",
      order_sync_ready: false,
      requires_idempotency_key: true,
      validates_package_on_server: true
    },
    warnings: policy.warnings
  };
}

function buildLockedPayload(input: {
  mode: Extract<WindowsRuntimeEntitlementMode, "store_code_required" | "store_code_locked">;
  syncStatus: Extract<WindowsRuntimeBootstrapPayload["sync"]["status"], "disabled_store_code_required" | "disabled_store_code_locked">;
  storeCode: string | null;
  deviceCode: string;
  runtimeDeviceId: string | null;
  appVersion: string | null;
  bridgeVersion: string | null;
  packageCode: Extract<WindowsRuntimePackageCode, "STORE_CODE_REQUIRED" | "STORE_CODE_LOCKED">;
  packageName: string;
  warning: string;
}): WindowsRuntimeBootstrapPayload {
  return {
    contract_version: WINDOWS_RUNTIME_CONTRACT_VERSION,
    identity_anchor: WINDOWS_RUNTIME_IDENTITY_ANCHOR,
    mode: input.mode,
    server_time: new Date().toISOString(),
    runtime: {
      store_code: input.storeCode,
      store_code_required: true,
      device_code: input.deviceCode,
      runtime_device_id: input.runtimeDeviceId,
      app_version: input.appVersion,
      bridge_version: input.bridgeVersion,
      unlock_source: "it_backoffice_store_code"
    },
    store: {
      store_code: input.storeCode,
      resolved_by_server: false,
      tenant_id: null,
      tenant_name: null,
      branch_id: null
    },
    activation: {
      requires_online_first_activation: true,
      unlocked_by_it_backoffice: false,
      can_run_windows_runtime: false,
      can_run_web_runtime: false,
      can_run_mobile_runtime: false
    },
    license: {
      status: "not_activated",
      license_type: "store_code_required",
      package_code: input.packageCode,
      package_name: input.packageName,
      cloud_sync_allowed: false,
      expires_at: null,
      offline_grace_until: null
    },
    entitlements: {
      features: allFeatures(false),
      limits: {
        max_local_devices: 0,
        max_branches: 0,
        max_offline_days: 0,
        max_pending_sync_items: 0
      }
    },
    local_database: {
      enabled: true,
      provider: "sqlite",
      schema_version: WINDOWS_LOCAL_SCHEMA_VERSION,
      recommended_path: "%LOCALAPPDATA%\\CpIPOS\\WindowsRuntime\\data\\cpipos-local.db"
    },
    sync: {
      status: input.syncStatus,
      endpoint_prefix: "/api/windows-runtime/v1/sync",
      order_sync_ready: false,
      requires_idempotency_key: true,
      validates_package_on_server: true
    },
    warnings: [
      input.warning,
      "The first activation must be online so IT Backoffice can resolve and unlock the package from the store code.",
      "Client-supplied tenant_id and branch_id are intentionally ignored by this Windows runtime contract.",
      "CpIPOS Web, CpIPOS Windows, and future CpIPOS mobile apps use the same store-code-first model."
    ]
  };
}

function allFeatures(value: boolean): WindowsRuntimeFeatureMap {
  return Object.fromEntries(WINDOWS_RUNTIME_FEATURE_KEYS.map((key) => [key, value])) as WindowsRuntimeFeatureMap;
}

export function offlinePurchaseFeatures(): WindowsRuntimeFeatureMap {
  const features = allFeatures(false);
  for (const key of OFFLINE_PURCHASE_TRUE) features[key] = true;
  return features;
}

function normalizeStoreCode(value: unknown): string | null {
  const text = readString(value);
  if (!text) return null;
  return text.toUpperCase().replace(/\s+/g, "");
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
