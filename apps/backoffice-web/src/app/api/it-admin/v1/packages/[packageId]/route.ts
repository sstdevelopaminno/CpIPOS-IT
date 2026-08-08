import { fail, ok } from "@/lib/http";
import { guardItAdminError, requireItAdmin } from "@/lib/it-admin-guard";
import { deactivatePackage, updatePackage } from "@/lib/services/it-admin/package-admin-service";

function parsePackageId(raw: string | undefined) {
  const value = String(raw ?? "").trim();
  if (!value) throw new Error("missing_package_id: packageId is required.");
  return value;
}

function parseError(error: unknown) {
  const message = error instanceof Error ? error.message : "Internal server error.";
  const [code, detail] = message.includes(":") ? message.split(/:(.*)/s).map((part) => part.trim()) : ["it_admin_package_failed", message];
  if (code === "missing_package_id" || code === "invalid_package_payload") return fail(code, detail || message, 422);
  return guardItAdminError(error);
}

export async function PATCH(req: Request, context: { params: Promise<{ packageId: string }> }) {
  const startedAt = Date.now();

  try {
    const adminContext = await requireItAdmin();
    const { packageId: packageIdParam } = await context.params;
    const packageId = parsePackageId(packageIdParam);
    const body = await req.json().catch(() => ({}));
    const updated = await updatePackage(adminContext, packageId, body);
    if (!updated) return fail("package_not_found", "Package was not found.", 404);

    const response = ok(updated);
    response.headers.set("x-admin-api-ms", String(Date.now() - startedAt));
    return response;
  } catch (error) {
    const response = parseError(error);
    response.headers.set("x-admin-api-ms", String(Date.now() - startedAt));
    return response;
  }
}

export async function DELETE(req: Request, context: { params: Promise<{ packageId: string }> }) {
  const startedAt = Date.now();

  try {
    const adminContext = await requireItAdmin();
    const { packageId: packageIdParam } = await context.params;
    const packageId = parsePackageId(packageIdParam);
    const body = await req.json().catch(() => ({})) as { reason?: string | null };
    const updated = await deactivatePackage(adminContext, packageId, body.reason);
    if (!updated) return fail("package_not_found", "Package was not found.", 404);

    const response = ok({ ...updated, deleted: false, deactivated: true });
    response.headers.set("x-admin-api-ms", String(Date.now() - startedAt));
    return response;
  } catch (error) {
    const response = parseError(error);
    response.headers.set("x-admin-api-ms", String(Date.now() - startedAt));
    return response;
  }
}

