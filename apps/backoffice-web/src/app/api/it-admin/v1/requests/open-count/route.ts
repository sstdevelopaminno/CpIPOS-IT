import { guardItAdminError, requireItAdmin } from "@/lib/it-admin-guard";
import { ok } from "@/lib/http";

export const dynamic="force-dynamic";

export async function GET(){
  try{
    const {supabase}=await requireItAdmin();
    const result=await supabase.from("tenant_subscription_payment_requests")
      .select("id",{count:"exact",head:true})
      .in("status",["pending","under_review"]);
    if(result.error)throw result.error;
    const response=ok({total:result.count??0});
    response.headers.set("cache-control","private, no-store");
    return response;
  }catch(error){return guardItAdminError(error);}
}
