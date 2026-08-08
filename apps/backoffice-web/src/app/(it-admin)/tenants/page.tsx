import { TenantIndexConsole } from "@/components/it-admin/tenant-index-console";
import { getAuthContext } from "@/lib/auth-context";

export default async function TenantsRootPage() {
  const auth = await getAuthContext({ requireBranchScope: false }).catch(() => null);
  if (!auth || auth.platformRole !== "it_admin") {
    return (
      <section className="surface">
        <h2>Forbidden</h2>
        <p>Platform admin permission is required.</p>
      </section>
    );
  }

  return <TenantIndexConsole />;
}
