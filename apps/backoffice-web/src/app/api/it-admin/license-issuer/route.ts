import { getAuthContext } from "@/lib/auth-context";
import { fail, ok } from "@/lib/http";
import {
  getOfflineLicenseSignerStatus,
  issueOfflineLicense,
  type IssueOfflineLicenseInput
} from "@/lib/offline-license-issuer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireItAdmin() {
  const auth = await getAuthContext({ requireBranchScope: false });
  if (auth.platformRole !== "it_admin") {
    throw new Error("FORBIDDEN");
  }
  return auth;
}

export async function GET() {
  try {
    await requireItAdmin();
    const signer = getOfflineLicenseSignerStatus();
    return ok({
      configured: signer.configured,
      key_matches_desktop: signer.keyMatchesDesktop,
      public_key_fingerprint: signer.publicKeyFingerprint,
      expected_public_key_fingerprint: signer.expectedPublicKeyFingerprint,
      product: "CPIPOS-DESKTOP",
      desktop_version: "0.3.0",
      issuer: "CUTTING-POINT-TECH-IT",
      max_devices: 2
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message === "FORBIDDEN") return fail("forbidden", "Only IT admin can issue desktop licenses.", 403);
    return fail("license_issuer_status_failed", message, 500);
  }
}

export async function POST(request: Request) {
  try {
    await requireItAdmin();
    const body = (await request.json()) as IssueOfflineLicenseInput;
    const issued = issueOfflineLicense({
      customer: String(body.customer ?? ""),
      plan: String(body.plan ?? ""),
      devices: Array.isArray(body.devices) ? body.devices.map(String) : [],
      notBefore: body.notBefore ? String(body.notBefore) : null,
      expiresAt: body.expiresAt ? String(body.expiresAt) : null,
      validDays: body.validDays == null ? null : Number(body.validDays),
      features: Array.isArray(body.features) ? body.features.map(String) : []
    });

    return ok({
      generated_at: new Date().toISOString(),
      desktop_version: "0.3.0",
      ...issued
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message === "FORBIDDEN") return fail("forbidden", "Only IT admin can issue desktop licenses.", 403);
    if (message === "CPIPOS_LICENSE_PRIVATE_KEY_NOT_CONFIGURED") {
      return fail(
        "license_private_key_not_configured",
        "Configure CPIPOS_LICENSE_PRIVATE_KEY_PEM or CPIPOS_LICENSE_PRIVATE_KEY_BASE64 in the server environment.",
        503
      );
    }
    if (message === "CPIPOS_LICENSE_PRIVATE_KEY_MISMATCH") {
      return fail(
        "license_private_key_mismatch",
        "The configured signing key does not match the public key embedded in CpIPOS Desktop v0.3.0.",
        503
      );
    }
    if (message.startsWith("LICENSE_")) {
      return fail("license_request_invalid", message, 400);
    }
    return fail("license_issue_failed", message, 500);
  }
}
