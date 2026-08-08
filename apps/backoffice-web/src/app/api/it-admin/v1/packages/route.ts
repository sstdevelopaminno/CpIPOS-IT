import { fail, ok } from "@/lib/http";
import { guardItAdminError, requireItAdmin } from "@/lib/it-admin-guard";
import { createPackage, listPackagesForAdmin } from "@/lib/services/it-admin/package-admin-service";

function parseError(error: unknown) {
  const message = error instanceof Error ? error.message : "Internal server error.";
  const [code, detail] = message.includes(":") ? message.split(/:(.*)/s).map((part) => part.trim()) : ["it_admin_package_failed", message];
  if (code === "invalid_package_payload") return fail(code, detail || message, 422);
  if (code === "package_code_duplicate") return fail(code, detail || message, 409);
  return guardItAdminError(error);
}

export async function GET() {
  const startedAt = Date.now();

  try {
    await requireItAdmin();
    const catalog = await listPackagesForAdmin();
    const response = ok(catalog);
    response.headers.set("x-admin-api-ms", String(Date.now() - startedAt));
    return response;
  } catch (error) {
    const response = parseError(error);
    response.headers.set("x-admin-api-ms", String(Date.now() - startedAt));
    return response;
  }
}

export async function POST(req: Request) {
  const startedAt = Date.now();

  try {
    const context = await requireItAdmin();
    const body = await req.json().catch(() => ({}));
    const created = await createPackage(context, body);
    const response = ok(created, 201);
    response.headers.set("x-admin-api-ms", String(Date.now() - startedAt));
    return response;
  } catch (error) {
    const response = parseError(error);
    response.headers.set("x-admin-api-ms", String(Date.now() - startedAt));
    return response;
  }
}

