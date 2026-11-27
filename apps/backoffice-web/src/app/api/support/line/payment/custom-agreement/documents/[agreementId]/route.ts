import { LineSupportError, requireLineSupportSession } from "@/lib/support-chat/line-support-auth";
import { fail } from "@/lib/http";
import { renderActiveCustomAgreement } from "@/lib/printing/custom-agreement-document";
export const dynamic="force-dynamic";
export const runtime="nodejs";
type Params={params:Promise<{agreementId:string}>};
export async function GET(_request:Request,{params}:Params){
  try{
    const session=await requireLineSupportSession();
    const {agreementId}=await params;
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(agreementId))return fail("agreement_invalid","Invalid agreement",422);
    return await renderActiveCustomAgreement(session.tenantId,agreementId);
  }catch(e){if(e instanceof LineSupportError)return fail(e.code,e.message,e.status);return fail("agreement_unavailable","Agreement unavailable",503);}
}
