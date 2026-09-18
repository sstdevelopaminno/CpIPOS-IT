import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync } from "node:crypto";
import { getAuthContext } from "@/lib/auth-context";
import { getPrimarySupabaseServiceClient } from "@/lib/supabase-admin";
import { fail, ok } from "@/lib/http";
import {
  CPIPOS_DESKTOP_PUBLIC_KEY_FINGERPRINT,
  CPIPOS_DESKTOP_PUBLIC_KEY_SPKI_BASE64,
  getOfflineLicenseSignerStatusServer
} from "@/lib/offline-license-issuer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireItAdmin() {
  const auth = await getAuthContext({ requireBranchScope: false });
  if (auth.platformRole !== "it_admin") throw new Error("FORBIDDEN");
  return auth;
}

function normalizePrivateKeyPem(value: string) {
  return value.includes("\\n") ? value.replace(/\\n/g, "\n") : value;
}

function publicKeyDerFromPrivateKey(value: string) {
  const privateKey = createPrivateKey(normalizePrivateKeyPem(value));
  return createPublicKey(privateKey).export({ type: "spki", format: "der" }) as Buffer;
}

function fingerprintPublicDer(publicDer: Buffer) {
  return createHash("sha256").update(publicDer).digest("hex").toUpperCase().match(/.{1,4}/g)?.join(":") ?? "";
}

function inspectPrivateKey(value: string) {
  const publicDer = publicKeyDerFromPrivateKey(value);
  const publicKeySpkiBase64 = publicDer.toString("base64");
  const fingerprint = fingerprintPublicDer(publicDer);
  const matchesDesktop = publicKeySpkiBase64 === CPIPOS_DESKTOP_PUBLIC_KEY_SPKI_BASE64;
  return { publicKeySpkiBase64, fingerprint, matchesDesktop };
}

function publicStatusFromInspection(inspection: { publicKeySpkiBase64: string; fingerprint: string; matchesDesktop: boolean }) {
  return {
    valid_private_key: true,
    key_matches_desktop: inspection.matchesDesktop,
    public_key_fingerprint: inspection.fingerprint,
    expected_public_key_fingerprint: CPIPOS_DESKTOP_PUBLIC_KEY_FINGERPRINT,
    expected_public_key_spki_base64: CPIPOS_DESKTOP_PUBLIC_KEY_SPKI_BASE64,
    private_key_redacted: true
  };
}

export async function GET() {
  try {
    await requireItAdmin();
    const signer = await getOfflineLicenseSignerStatusServer();
    return ok({
      configured: signer.configured,
      key_matches_desktop: signer.keyMatchesDesktop,
      public_key_fingerprint: signer.publicKeyFingerprint,
      expected_public_key_fingerprint: CPIPOS_DESKTOP_PUBLIC_KEY_FINGERPRINT,
      expected_public_key_spki_base64: CPIPOS_DESKTOP_PUBLIC_KEY_SPKI_BASE64,
      signer_source: signer.source,
      desktop_version: "0.3.1",
      env_names: ["CPIPOS_LICENSE_PRIVATE_KEY_PEM", "CPIPOS_LICENSE_PRIVATE_KEY_BASE64"],
      vault_rpc: "get_cpipos_license_signing_key / set_cpipos_license_signing_key",
      private_key_redacted: true
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message === "FORBIDDEN") return fail("forbidden", "Only IT admin can manage license keys.", 403);
    return fail("license_key_status_failed", message, 500);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireItAdmin();
    const body = (await request.json().catch(() => ({}))) as { action?: string; privateKeyPem?: string };
    const action = String(body.action ?? "").trim();

    if (action === "generate") {
      const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
      const privateKeyPem = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
      const publicKeySpkiBase64 = pair.publicKey.export({ type: "spki", format: "der" }).toString("base64");
      const fingerprint = fingerprintPublicDer(Buffer.from(publicKeySpkiBase64, "base64"));
      return ok({
        generated: true,
        private_key_pem: privateKeyPem,
        public_key_spki_base64: publicKeySpkiBase64,
        public_key_fingerprint: fingerprint,
        key_matches_desktop: publicKeySpkiBase64 === CPIPOS_DESKTOP_PUBLIC_KEY_SPKI_BASE64,
        expected_public_key_fingerprint: CPIPOS_DESKTOP_PUBLIC_KEY_FINGERPRINT,
        private_key_redacted_after_this_response: true,
        production_note: "This private key is shown once so IT can back it up. It will only issue licenses for the current CpIPOS Desktop build if its public_key_spki_base64 matches expected_public_key_spki_base64. Otherwise rebuild CpIPOS Desktop with this public key before using it in production."
      });
    }

    const privateKeyPem = String(body.privateKeyPem ?? "").trim();
    if (!privateKeyPem) return fail("private_key_required", "privateKeyPem is required.", 400);
    const inspection = inspectPrivateKey(privateKeyPem);

    if (action === "validate") {
      return ok(publicStatusFromInspection(inspection));
    }

    if (action === "save_vault") {
      if (!inspection.matchesDesktop) {
        return fail("private_key_mismatch", "This private key does not match the public key embedded in CpIPOS Desktop v0.3.1.", 400);
      }
      const supabase = getPrimarySupabaseServiceClient();
      const { error } = await supabase.rpc("set_cpipos_license_signing_key", {
        private_key_pem: normalizePrivateKeyPem(privateKeyPem),
        changed_by: auth.userId
      });
      if (error) throw error;
      return ok({ saved: true, ...publicStatusFromInspection(inspection), saved_at: new Date().toISOString() });
    }

    return fail("unknown_action", "Use action generate, validate or save_vault.", 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message === "FORBIDDEN") return fail("forbidden", "Only IT admin can manage license keys.", 403);
    return fail("license_key_management_failed", message, 500);
  }
}
