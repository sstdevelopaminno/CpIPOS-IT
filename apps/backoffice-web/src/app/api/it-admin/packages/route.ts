import { getAuthContext } from "@/lib/auth-context";
import { fail, ok } from "@/lib/http";
import { getPackageCatalogWithFeatures } from "@/lib/services/subscription-package-service";

export async function GET() {
  try {
    const auth = await getAuthContext({ requireBranchScope: false });
    if (auth.platformRole !== "it_admin") {
      return fail("forbidden", "Only IT admin can view package catalog.", 403);
    }

    const catalog = await getPackageCatalogWithFeatures();
    return ok({
      generated_at: new Date().toISOString(),
      contract_types: ["saas", "perpetual"],
      billing_intervals: ["monthly", "yearly"],
      deployment_modes: ["cloud", "desktop_online", "desktop_offline", "hybrid"],
      packages: catalog.packages.filter((item) => item.isActive),
      features: catalog.features.filter((item) => item.isActive)
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return fail("it_admin_packages_fetch_failed", message, 500);
  }
}
