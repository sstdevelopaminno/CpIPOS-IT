import { getAuthContext } from "@/lib/auth-context";
import {
  deleteDesktopLicenseContract,
  listDesktopLicenseRegistry,
  reissueDesktopLicenseContract,
  type DesktopLicenseRegistryInput
} from "@/lib/desktop-license-registry";
import { appendDesktopLicenseAudit } from "@/lib/desktop-license-audit";
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
    const auth = await requireItAdmin();
    const body = (await request.json()) as { contractId?: string; input?: DesktopLicenseRegistryInput };
    const contractId = String(body.contractId ?? "").trim();
    if (!contractId || !body.input) return fail("license_request_invalid", "contractId and input are required", 400);
    const issued = await reissueDesktopLicenseContract(contractId, body.input);
    await appendDesktopLicenseAudit({
      auth,
      action: "desktop_license_reissued",
      targetId: contractId,
      request,
      metadata: {
        license_id: issued.payload.licenseId,
        customer: issued.payload.customer,
        plan: issued.payload.plan,
        devices: issued.payload.devices,
        features: issued.payload.features,
        expires_at: issued.payload.expiresAt
      },
      afterData: { license_id: issued.payload.licenseId, features: issued.payload.features }
    });
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
    const auth = await requireItAdmin();
    const body = (await request.json().catch(() => ({}))) as { contractId?: string; reason?: string };
    const contractId = String(body.contractId ?? "").trim();
    const reason = String(body.reason ?? "Deleted by IT admin");
    if (!contractId) return fail("license_request_invalid", "contractId is required", 400);
    await deleteDesktopLicenseContract(contractId, reason);
    await appendDesktopLicenseAudit({
      auth,
      action: "desktop_license_revoked",
      targetId: contractId,
      request,
      metadata: { reason },
      afterData: { status: "deleted", reason }
    });
    return ok({ deleted: true, contract_id: contractId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message === "FORBIDDEN") return fail("forbidden", "Only IT admin can manage desktop licenses.", 403);
    return fail("desktop_license_delete_failed", message, 500);
  }
}
