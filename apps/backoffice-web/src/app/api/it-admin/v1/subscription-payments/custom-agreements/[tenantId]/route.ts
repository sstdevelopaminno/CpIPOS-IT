import { guardItAdminError, ItAdminGuardError, requireItAdmin } from "@/lib/it-admin-guard";
import { fail, ok } from "@/lib/http";

export const dynamic = "force-dynamic";
type Params = {params:Promise<{tenantId:string}>};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_request:Request,{params}:Params) {
  try {
    const {supabase}=await requireItAdmin();
    const {tenantId}=await params;
    if(!UUID.test(tenantId)) throw new ItAdminGuardError("invalid_tenant","Invalid store identifier.",422);
    if(process.env.CUSTOM_AGREEMENT_ENABLED!=="true") {
      const response=ok({enabled:false,agreements:[]});response.headers.set("cache-control","private, no-store");return response;
    }
    const [evidence,activation]=await Promise.all([
      supabase.from("tenant_custom_agreement_acceptances")
        .select("id,payment_request_id,actor_user_id,accepted_at,version,acceptance_channel,amount_per_cycle,currency,billing_interval")
        .eq("tenant_id",tenantId).order("accepted_at",{ascending:false}).limit(200),
      supabase.from("tenant_custom_agreement_activations")
        .select("acceptance_id,settlement_id,starts_at,ends_at")
        .eq("tenant_id",tenantId).order("starts_at",{ascending:false}).limit(200)
    ]);
    if(evidence.error||activation.error) return fail("agreement_unavailable","ไม่สามารถโหลดหลักฐานสัญญาได้",503);
    const byId=new Map((activation.data??[]).map(row=>[row.acceptance_id,row]));
    const response=ok({enabled:true,agreements:(evidence.data??[]).map(row=>({...row,activation:byId.get(row.id)??null}))});
    response.headers.set("cache-control","private, no-store");
    return response;
  }catch(error){return guardItAdminError(error);}
}
