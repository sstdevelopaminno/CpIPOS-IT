import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase-admin";

type SupabaseClient = ReturnType<typeof getSupabaseServiceClient>;

type PackageRow = {
  id: string;
  code: string | null;
  max_branches: number | null;
  max_devices: number | null;
  metadata: Record<string, unknown> | null;
};

type ContractRow = {
  id: string;
  package_id: string;
  status: string | null;
  ended_at: string | null;
  max_branches: number | null;
  max_devices: number | null;
  metadata: Record<string, unknown> | null;
};

export type StoreLoginMode = {
  singleRegister: boolean;
  branchSelection: "hidden" | "visible";
  maxBranches: number | null;
  maxDevices: number | null;
  packageCode: string | null;
  source: "contract_package" | "tenant_package" | "fallback";
};

function positiveInt(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const normalized = Math.trunc(parsed);
  return normalized > 0 ? normalized : null;
}

function readBool(value: unknown) {
  if (typeof value === "boolean") return value;
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function isActiveContract(contract: ContractRow | null) {
  if (!contract) return false;
  if (contract.status && contract.status !== "active" && contract.status !== "trial") return false;
  if (!contract.ended_at) return true;
  const endMs = new Date(contract.ended_at).getTime();
  return !Number.isFinite(endMs) || endMs > Date.now();
}

function deriveMode(args: {
  contract: ContractRow | null;
  packageRow: PackageRow | null;
  source: StoreLoginMode["source"];
}): StoreLoginMode {
  const packageMetadata = args.packageRow?.metadata ?? {};
  const contractMetadata = args.contract?.metadata ?? {};
  const metadata = { ...packageMetadata, ...contractMetadata };
  const maxBranches = positiveInt(args.contract?.max_branches) ?? positiveInt(args.packageRow?.max_branches);
  const maxDevices =
    positiveInt(args.contract?.max_devices) ??
    positiveInt(metadata.max_cashier_devices) ??
    positiveInt(metadata.max_devices_per_branch) ??
    positiveInt(args.packageRow?.max_devices);

  const branchSelection = String(metadata.branch_selection ?? "").trim().toLowerCase();
  const loginMode = String(metadata.login_mode ?? "").trim().toLowerCase();
  const singleRegister =
    loginMode === "single_register" ||
    branchSelection === "hidden" ||
    readBool(metadata.single_register) ||
    readBool(metadata.no_branch_mode) ||
    readBool(metadata.single_device_mode) ||
    (maxBranches === 1 && maxDevices === 1 && readBool(metadata.force_single_register));

  return {
    singleRegister,
    branchSelection: singleRegister || branchSelection === "hidden" ? "hidden" : "visible",
    maxBranches,
    maxDevices,
    packageCode: args.packageRow?.code ?? null,
    source: args.source
  };
}

async function readPackage(supabase: SupabaseClient, packageId: string | null | undefined) {
  const normalized = String(packageId ?? "").trim();
  if (!normalized) return null;
  const { data, error } = await supabase
    .from("subscription_packages")
    .select("id,code,max_branches,max_devices,metadata")
    .eq("id", normalized)
    .maybeSingle<PackageRow>();
  if (error) {
    console.warn("[store-login-mode] package lookup failed", { packageId: normalized, error: error.message });
    return null;
  }
  return data ?? null;
}

export async function resolveStoreLoginMode(tenantId: string): Promise<StoreLoginMode> {
  const supabase = getSupabaseServiceClient();
  const { data: contract, error: contractError } = await supabase
    .from("tenant_subscription_contracts")
    .select("id,package_id,status,ended_at,max_branches,max_devices,metadata")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<ContractRow>();

  if (!contractError && isActiveContract(contract ?? null)) {
    const packageRow = await readPackage(supabase, contract?.package_id);
    return deriveMode({ contract: contract ?? null, packageRow, source: "contract_package" });
  }

  if (contractError) {
    console.warn("[store-login-mode] contract lookup failed", { tenantId, error: contractError.message });
  }

  const { data: tenant, error: tenantError } = await supabase
    .from("tenants")
    .select("package_id")
    .eq("id", tenantId)
    .maybeSingle<{ package_id: string | null }>();

  if (tenantError) {
    console.warn("[store-login-mode] tenant package lookup failed", { tenantId, error: tenantError.message });
  }

  const packageRow = await readPackage(supabase, tenant?.package_id);
  return deriveMode({ contract: null, packageRow, source: packageRow ? "tenant_package" : "fallback" });
}

export function shouldSkipBranchSelection(mode: StoreLoginMode, activeBranchCount: number, autoSkipSingleBranch: boolean) {
  if (activeBranchCount !== 1) return false;
  if (mode.singleRegister || mode.branchSelection === "hidden") return true;
  return autoSkipSingleBranch;
}