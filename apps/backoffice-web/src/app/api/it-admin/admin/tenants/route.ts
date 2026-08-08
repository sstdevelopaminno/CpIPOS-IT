import { requireItAdmin, guardItAdminError } from "@/lib/it-admin-guard";
import { ok } from "@/lib/http";
import { listTenantSummaries } from "@/lib/services/it-admin/tenant-admin-service";

export async function GET(req: Request) {
  const startedAt = Date.now();

  try {
    const context = await requireItAdmin();
    const { searchParams } = new URL(req.url);
    const result = await listTenantSummaries(context, {
      limit: Number(searchParams.get("limit") ?? 50),
      cursor: searchParams.get("cursor"),
      search: searchParams.get("search"),
      status: (searchParams.get("status") ?? "all") as "active" | "inactive" | "suspended" | "all",
      packageCode: searchParams.get("package_code")
    });

    const response = ok({
      tenants: result.tenants,
      next_cursor: result.next_cursor
    });
    response.headers.set("x-admin-api-ms", String(Date.now() - startedAt));
    response.headers.set("x-summary-source", result.source);
    return response;
  } catch (error) {
    const response = guardItAdminError(error);
    response.headers.set("x-admin-api-ms", String(Date.now() - startedAt));
    return response;
  }
}
