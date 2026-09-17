import { getAuthContext } from "@/lib/auth-context";
import {
  deleteDesktopLicenseContract,
  listDesktopLicenseRegistry,
  reissueDesktopLicenseContract,
  type DesktopLicenseRegistryInput
} from "@/lib/desktop-license-registry";
import { fail, ok } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireItAdmin() {
  const auth = await getAuthContext({ requireBranchScope: false });
  if (auth.platformRole !== "it_admin") throw new Error("FORBIDDEN");
  return auth;
}

export async function GET() {
  try {
    await requireItAdmin();
    return ok({ rows: await listDesktopLicenseRegistry(), checked_at: new Date().toISOString() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message === "FORBIDDEN") return fail("forbidden", "Only IT admin can manage desktop licenses.", 403);
    return fail("desktop_license_registry_failed", message, 500);
  }
}

export async function PUT(request: Request) {
  try {
    await requireItAdmin();
    const body = (await request.json()) as { contractId?: string; input?: DesktopLicenseRegistryInput };
    const contractId = String(body.contractId ?? "").trim();
    if (!contractId || !body.input) return fail("license_request_invalid", "contractId and input are required", 400);
    const issued = await reissueDesktopLicenseContract(contractId, body.input);
    return ok({ generated_at: new Date().toISOString(), ...issued });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message === "FORBIDDEN") return fail("forbidden", "Only IT admin can manage desktop licenses.", 403);
    if (message === "CPIPOS_LICENSE_PRIVATE_KEY_NOT_CONFIGURED" || message === "CPIPOS_LICENSE_PRIVATE_KEY_MISMATCH") {
      return fail("license_signing_key_unavailable", message, 503);
    }
    if (message.startsWith("LICENSE_")) return fail("license_request_invalid", message, 400);
    return fail("desktop_license_reissue_failed", message, 500);
  }
}

export async function DELETE(request: Request) {
  try {
    await requireItAdmin();
    const body = (await request.json().catch(() => ({}))) as { contractId?: string; reason?: string };
    const contractId = String(body.contractId ?? "").trim();
    if (!contractId) return fail("license_request_invalid", "contractId is required", 400);
    await deleteDesktopLicenseContract(contractId, String(body.reason ?? "Deleted by IT admin"));
    return ok({ deleted: true, contract_id: contractId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message === "FORBIDDEN") return fail("forbidden", "Only IT admin can manage desktop licenses.", 403);
    return fail("desktop_license_delete_failed", message, 500);
  }
}
