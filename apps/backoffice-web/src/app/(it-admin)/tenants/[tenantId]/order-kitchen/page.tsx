import { OrderKitchenPolicyAdminConsole } from "@/components/it-admin/order-kitchen-policy-admin-console";
import { getAuthContext } from "@/lib/auth-context";

export default async function TenantOrderKitchenPolicyPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  const auth = await getAuthContext({ requireBranchScope: false }).catch(() => null);
  if (!auth || auth.platformRole !== "it_admin") {
    return <section className="surface"><h2>Forbidden</h2><p>Platform admin permission is required.</p></section>;
  }
  return <OrderKitchenPolicyAdminConsole tenantId={tenantId} />;
}
