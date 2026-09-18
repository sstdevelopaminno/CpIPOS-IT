import { getAuthContext } from "@/lib/auth-context";
import { appendDesktopLicenseAudit } from "@/lib/desktop-license-audit";
import { fail, ok } from "@/lib/http";
import { getPrimarySupabaseServiceClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireItAdmin() {
  const auth = await getAuthContext({ requireBranchScope: false });
  if (auth.platformRole !== "it_admin") throw new Error("FORBIDDEN");
  return auth;
}

export async function POST(request: Request) {
  try {
    const auth = await requireItAdmin();
    const body = (await request.json().catch(() => ({}))) as { contractId?: string; licenseId?: string };
    const contractId = String(body.contractId ?? "").trim();
    const licenseId = String(body.licenseId ?? "").trim();
    if (!contractId && !licenseId) return fail("license_request_invalid", "contractId or licenseId is required", 400);

    const supabase = getPrimarySupabaseServiceClient();
    let query = supabase
      .from("desktop_license_contracts")
      .select("id,license_id,customer_name,plan,revision,signed_token,token_sha256,created_at,updated_at")
      .is("deleted_at", null);

    query = contractId ? query.eq("id", contractId) : query.eq("license_id", licenseId);
    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    if (!data) return fail("license_not_found", "License not found", 404);
    if (!(data as any).signed_token) return fail("license_token_missing", "Signed license token is not available", 404);

    await appendDesktopLicenseAudit({
      auth,
      action: "desktop_license_key_retrieved",
      targetId: (data as any).id,
      request,
      metadata: {
        license_id: (data as any).license_id,
        customer: (data as any).customer_name,
        plan: (data as any).plan,
        revision: (data as any).revision,
        token_sha256: (data as any).token_sha256
      }
    });

    return ok({
      contract_id: (data as any).id,
      license_id: (data as any).license_id,
      customer_name: (data as any).customer_name,
      plan: (data as any).plan,
      revision: (data as any).revision,
      token: (data as any).signed_token,
      token_sha256: (data as any).token_sha256,
      created_at: (data as any).created_at,
      updated_at: (data as any).updated_at
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message === "FORBIDDEN") return fail("forbidden", "Only IT admin can read desktop license keys.", 403);
    return fail("desktop_license_token_failed", message, 500);
  }
}
