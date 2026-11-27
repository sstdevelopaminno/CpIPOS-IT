import { guardItAdminError, ItAdminGuardError, requireItAdmin } from "@/lib/it-admin-guard";
import { renderActiveCustomAgreement } from "@/lib/printing/custom-agreement-document";
import { fail } from "@/lib/http";
export const dynamic="force-dynamic";
export const runtime="nodejs";
type Params={params:Promise<{tenantId:string;agreementId:string}>};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function GET(_request:Request,{params}:Params){
  try{
    await requireItAdmin();
    const {tenantId,agreementId}=await params;
    if(!UUID.test(tenantId)||!UUID.test(agreementId))throw new ItAdminGuardError("invalid_agreement","Invalid agreement identifier.",422);
    return await renderActiveCustomAgreement(tenantId,agreementId);
  }catch(error){if(error instanceof ItAdminGuardError)return guardItAdminError(error);return fail("agreement_unavailable","Agreement unavailable",503);}
}
