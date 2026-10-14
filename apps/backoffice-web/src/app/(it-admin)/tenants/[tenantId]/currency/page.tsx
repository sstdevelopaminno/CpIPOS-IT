import { TenantCurrencyControl } from "@/components/it-admin/tenant-currency-control";
import { getAuthContext } from "@/lib/auth-context";

export default async function TenantCurrencyPage({params}:{params:Promise<{tenantId:string}>}) {
 const {tenantId}=await params;
 const auth=await getAuthContext({requireBranchScope:false}).catch(()=>null);
 if(!auth || (auth.platformRole!=="it_admin" && auth.platformRole!=="it_support")) {
  return <section className="surface"><h2>Forbidden</h2><p>IT access is required.</p></section>;
 }
 return <TenantCurrencyControl tenantId={tenantId}/>;
}
