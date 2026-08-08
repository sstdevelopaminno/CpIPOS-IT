import { TenantSectionConsole } from "@/components/it-admin/tenant-section-console";
import { getAuthContext } from "@/lib/auth-context";

export default async function TenantSessionsPage({
  params
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const auth = await getAuthContext({ requireBranchScope: false }).catch(() => null);
  if (!auth || auth.platformRole !== "it_admin") {
    return (
      <section className="surface">
        <h2>Forbidden</h2>
        <p>Platform admin permission is required.</p>
      </section>
    );
  }

  return <TenantSectionConsole tenantId={tenantId} section="sessions" />;
}
