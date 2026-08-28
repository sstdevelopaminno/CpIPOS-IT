import { fail, ok } from "@/lib/http";
import { guardItAdminError, requireItAdmin } from "@/lib/it-admin-guard";
import {
  provisionStore,
  StoreProvisioningError,
  type StoreProvisioningInput
} from "@/lib/services/it-admin/store-provisioning-service";

function handleError(error: unknown) {
  if (error instanceof StoreProvisioningError) {
    return fail(error.code, error.message, error.status);
  }
  return guardItAdminError(error);
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  try {
    const context = await requireItAdmin();
    const body = (await request.json().catch(() => null)) as StoreProvisioningInput | null;
    if (!body || typeof body !== "object") {
      return fail("invalid_store_provisioning_payload", "Request body is required.", 422);
    }

    const result = await provisionStore(context, body);
    const response = ok(result, 201);
    response.headers.set("x-admin-api-ms", String(Date.now() - startedAt));
    response.headers.set("x-provisioning-request-id", result.request_id);
    return response;
  } catch (error) {
    const response = handleError(error);
    response.headers.set("x-admin-api-ms", String(Date.now() - startedAt));
    return response;
  }
}
