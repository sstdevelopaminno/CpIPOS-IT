import "server-only";

import type { ItAdminContext } from "@/lib/it-admin-guard";
import { appendAuditLog } from "@/lib/audit-log";

const BUCKET = "cpipos-ai-documents";

function nullablePositive(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

export async function loadCpiposAiDocumentAdmin(context: ItAdminContext) {
  const [packages, policies, tenants, usage] = await Promise.all([
    context.supabase.from("subscription_packages")
      .select("id,code,name,monthly_price,is_active,display_order")
      .in("code", ["starter","growth","business","custom"])
      .order("display_order", { ascending: true }),
    context.supabase.from("pos_ai_document_package_policies")
      .select("package_id,is_enabled,retention_days,storage_limit_mb,max_files,updated_at"),
    context.supabase.from("tenants")
      .select("id,code,name,display_name,package_id,is_active")
      .eq("is_active", true)
      .order("display_name", { ascending: true })
      .limit(1000),
    context.supabase.rpc("pos_ai_document_admin_usage")
  ]);
  for (const result of [packages,policies,tenants,usage]) {
    if (result.error) throw new Error(result.error.message);
  }

  const policyMap = new Map((policies.data ?? []).map((row) => [String(row.package_id), row]));
  const usageMap = new Map((usage.data ?? []).map((row: Record<string, unknown>) => [String(row.tenant_id), row]));

  return {
    generated_at: new Date().toISOString(),
    packages: (packages.data ?? []).map((pkg) => ({
      ...pkg,
      policy: policyMap.get(String(pkg.id)) ?? {
        package_id: pkg.id,
        is_enabled: false,
        retention_days: null,
        storage_limit_mb: null,
        max_files: null,
        updated_at: null
      }
    })),
    stores: (tenants.data ?? []).map((tenant) => {
      const row = usageMap.get(String(tenant.id)) as Record<string, unknown> | undefined;
      const bytes = Number(row?.total_bytes ?? 0);
      return {
        tenant_id: tenant.id,
        store_code: tenant.code,
        name: tenant.display_name || tenant.name,
        package_id: tenant.package_id,
        is_active: tenant.is_active,
        file_count: Number(row?.file_count ?? 0),
        total_bytes: bytes,
        storage_mb: Number((bytes / (1024 * 1024)).toFixed(3)),
        last_created_at: row?.last_created_at ?? null
      };
    })
  };
}

export async function updateCpiposAiDocumentPackagePolicy(
  context: ItAdminContext,
  packageId: string,
  input: Record<string, unknown>
) {
  const payload = {
    package_id: packageId,
    is_enabled: input.is_enabled !== false,
    retention_days: nullablePositive(input.retention_days),
    storage_limit_mb: nullablePositive(input.storage_limit_mb),
    max_files: nullablePositive(input.max_files),
    updated_by: context.auth.userId,
    updated_at: new Date().toISOString()
  };

  const before = await context.supabase.from("pos_ai_document_package_policies")
    .select("*").eq("package_id", packageId).maybeSingle();
  if (before.error) throw new Error(before.error.message);

  const saved = await context.supabase.from("pos_ai_document_package_policies")
    .upsert(payload, { onConflict: "package_id" })
    .select("*").single();
  if (saved.error) throw new Error(saved.error.message);

  await appendAuditLog({
    actorUserId: context.auth.userId,
    actorRole: context.auth.platformRole,
    action: "it_ai_document_package_policy_changed",
    targetTable: "pos_ai_document_package_policies",
    targetId: packageId,
    beforeData: (before.data ?? null) as never,
    afterData: saved.data as never,
    ipAddress: context.requestMeta.ipAddress ?? undefined,
    userAgent: context.requestMeta.userAgent ?? undefined
  });
  return saved.data;
}

export async function clearCpiposAiDocumentsForTenant(context: ItAdminContext, tenantId: string) {
  let cleared = 0;
  for (let page = 0; page < 100; page += 1) {
    const batch = await context.supabase.from("pos_ai_documents")
      .select("id,object_path")
      .eq("tenant_id", tenantId)
      .limit(250);
    if (batch.error) throw new Error(batch.error.message);
    if (!batch.data?.length) break;

    const paths = batch.data.map((row) => String(row.object_path));
    const storage = await context.supabase.storage.from(BUCKET).remove(paths);
    if (storage.error) throw new Error(storage.error.message);

    const deleted = await context.supabase.from("pos_ai_documents")
      .delete()
      .in("id", batch.data.map((row) => row.id))
      .eq("tenant_id", tenantId);
    if (deleted.error) throw new Error(deleted.error.message);
    cleared += batch.data.length;
    if (batch.data.length < 250) break;
  }

  await appendAuditLog({
    tenantId,
    actorUserId: context.auth.userId,
    actorRole: context.auth.platformRole,
    action: "it_ai_documents_cleared",
    targetTable: "pos_ai_documents",
    targetId: tenantId,
    metadata: { cleared_files: cleared, storage_bucket: BUCKET },
    ipAddress: context.requestMeta.ipAddress ?? undefined,
    userAgent: context.requestMeta.userAgent ?? undefined
  });
  return { cleared_files: cleared };
}
