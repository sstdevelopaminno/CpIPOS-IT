import { DeviceHealthConsole } from "@/components/it-admin/device-health-console";
import { getAuthContext } from "@/lib/auth-context";

export default async function DeviceHealthPage({
  params
}: {
  params: Promise<{ tenantId: string; deviceId: string }>;
}) {
  const { tenantId, deviceId } = await params;
  const auth = await getAuthContext({ requireBranchScope: false }).catch(() => null);
  if (!auth || auth.platformRole !== "it_admin") {
    return (
      <section className="surface">
        <h2>Forbidden</h2>
        <p>Platform admin permission is required.</p>
      </section>
    );
  }

  return <DeviceHealthConsole tenantId={tenantId} deviceId={deviceId} />;
}
