import type {
  PackageBillingInterval,
  PackageContractType,
  PackageDeploymentMode,
  PosFeatureCode
} from "@pos/shared-types";
import { getAuthContext } from "@/lib/auth-context";
import { appendAuditLog } from "@/lib/audit-log";
import { fail, ok } from "@/lib/http";
import { buildSubscriptionQuote } from "@/lib/services/subscription-package-service";

type QuoteRequestBody = {
  package_id?: string;
  package_code?: string;
  contract_type?: PackageContractType;
  billing_interval?: PackageBillingInterval;
  deployment_mode?: PackageDeploymentMode;
  branch_count?: number;
  terminal_count_per_branch?: number;
  selected_feature_codes?: PosFeatureCode[];
};

function normalizeContractType(raw: unknown): PackageContractType {
  return raw === "perpetual" ? "perpetual" : "saas";
}

function normalizeBillingInterval(raw: unknown): PackageBillingInterval {
  return raw === "yearly" ? "yearly" : "monthly";
}

function normalizeDeploymentMode(raw: unknown): PackageDeploymentMode {
  if (raw === "desktop_online") return "desktop_online";
  if (raw === "desktop_offline") return "desktop_offline";
  if (raw === "hybrid") return "hybrid";
  return "cloud";
}

export async function POST(req: Request) {
  try {
    const auth = await getAuthContext({ requireBranchScope: false });
    if (auth.platformRole !== "it_admin") {
      return fail("forbidden", "Only IT admin can calculate package quote.", 403);
    }

    const body = (await req.json()) as QuoteRequestBody;
    const packageId = typeof body.package_id === "string" ? body.package_id : undefined;
    const packageCode = typeof body.package_code === "string" ? body.package_code : undefined;
    if (!packageId && !packageCode) {
      return fail("missing_package", "package_id or package_code is required.", 400);
    }

    const selectedFeatureCodes = Array.isArray(body.selected_feature_codes)
      ? body.selected_feature_codes.map((item) => String(item) as PosFeatureCode)
      : [];

    const result = await buildSubscriptionQuote({
      packageId,
      packageCode,
      selectedFeatureCodes,
      contractType: normalizeContractType(body.contract_type),
      billingInterval: normalizeBillingInterval(body.billing_interval),
      deploymentMode: normalizeDeploymentMode(body.deployment_mode),
      branchCount: Math.max(1, Number(body.branch_count ?? 1)),
      terminalCountPerBranch: Math.max(1, Number(body.terminal_count_per_branch ?? 1))
    });

    await appendAuditLog({
      actorUserId: auth.userId,
      actorRole: "it_admin",
      action: "package_quote_calculated",
      targetTable: "subscription_packages",
      targetId: result.packageDef.id,
      metadata: {
        package_code: result.packageDef.code,
        contract_type: result.quote.contractType,
        billing_interval: result.quote.billingInterval,
        deployment_mode: result.quote.deploymentMode,
        branch_count: result.quote.branchCount,
        terminal_count_per_branch: result.quote.terminalCountPerBranch,
        selected_feature_codes: selectedFeatureCodes,
        total: result.quote.total
      }
    });

    return ok({
      generated_at: new Date().toISOString(),
      package: result.packageDef,
      quote: result.quote
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message === "package_not_found") {
      return fail("package_not_found", "Package not found.", 404);
    }
    return fail("it_admin_package_quote_failed", message, 500);
  }
}
