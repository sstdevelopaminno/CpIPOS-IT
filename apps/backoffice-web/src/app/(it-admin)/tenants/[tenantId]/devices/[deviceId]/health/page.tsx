import { DeviceHealthConsole } from "@/components/it-admin/device-health-console";
import { FullMdmControlConsole } from "@/components/it-admin/full-mdm-control-console";
import { getAuthContext } from "@/lib/auth-context";

export default async function DeviceHealthPage({
  params
}: {
  params: Promise<{ tenantId: string; deviceId: string }>;
}) {
  const { tenantId, deviceId } = await params;
  const auth = await getAuthContext({ requireBranchScope: false }).catch(() => null);
  if (!auth || !["it_admin", "it_support"].includes(auth.platformRole)) {
    return (
      <section className="surface">
        <h2>ไม่มีสิทธิ์เข้าถึง</h2>
        <p>เมนูนี้อนุญาตเฉพาะเจ้าหน้าที่ IT ที่ได้รับสิทธิ์</p>
      </section>
    );
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <DeviceHealthConsole tenantId={tenantId} deviceId={deviceId} />
      <FullMdmControlConsole tenantId={tenantId} deviceId={deviceId} />
    </div>
  );
}
