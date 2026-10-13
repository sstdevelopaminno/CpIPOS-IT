import "server-only";
import type { ItAdminContext } from "@/lib/it-admin-guard";

export type ItQaMode = "full" | "simulate";

export async function getItQaMode(context: ItAdminContext, tenantId: string): Promise<ItQaMode | null> {
  const tenant = await context.supabase.from("tenants").select("code,metadata").eq("id",tenantId)
    .maybeSingle<{code:string;metadata:Record<string,unknown>|null}>();
  if (tenant.error) throw new Error("qa_tenant_query_failed:"+tenant.error.message);
  if (tenant.data?.code !== "NDL-TH-001") return null;
  const access = await context.supabase.from("tenant_access_codes").select("access_code")
    .eq("tenant_id",tenantId).eq("is_active",true).order("issued_at",{ascending:false}).limit(1)
    .maybeSingle<{access_code:string}>();
  if(access.error)throw new Error("qa_access_query_failed:"+access.error.message);
  if(access.data?.access_code!=="900001")return null;
  return tenant.data.metadata?.it_test_access_mode==="simulate"?"simulate":"full";
}
