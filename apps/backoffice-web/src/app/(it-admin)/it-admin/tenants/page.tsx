import { StoreProvisioningConsole, type ProvisioningPackageOption } from "@/components/it-admin/store-provisioning-console";
import { requireItAdmin } from "@/lib/it-admin-guard";
import { listTenantSummaries } from "@/lib/services/it-admin/tenant-admin-service";

export const dynamic = "force-dynamic";

type PackageRow = {
  id: string;
  code: string;
  name: string;
  monthly_price: number | string | null;
  yearly_price: number | string | null;
  max_branches: number | null;
  max_devices: number | null;
  max_users: number | null;
  quota_mode: string | null;
};

function packageOption(row: PackageRow): ProvisioningPackageOption {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    monthly_price: Number(row.monthly_price ?? 0),
    yearly_price: Number(row.yearly_price ?? 0),
    max_branches: Number(row.max_branches ?? 0),
    max_devices: Number(row.max_devices ?? 0),
    max_users: Number(row.max_users ?? 0),
    quota_mode: String(row.quota_mode ?? "standard")
  };
}

export default async function TenantsPage() {
  const context = await requireItAdmin();
  const [result, packageResult] = await Promise.all([
    listTenantSummaries(context, { limit: 100, status: "all" }),
    context.supabase
      .from("subscription_packages")
      .select("id,code,name,monthly_price,yearly_price,max_branches,max_devices,max_users,quota_mode")
      .eq("is_active", true)
      .eq("status", "active")
      .order("monthly_price", { ascending: true })
      .returns<PackageRow[]>()
  ]);

  if (packageResult.error) {
    throw new Error(`store_provisioning_package_catalog_failed:${packageResult.error.message}`);
  }

  const tenantIds = result.tenants.map((tenant) => tenant.id);
  const { data: accessCodes, error: accessCodeError } = tenantIds.length
    ? await context.supabase
        .from("tenant_access_codes")
        .select("tenant_id,access_code,is_active")
        .in("tenant_id", tenantIds)
        .eq("is_active", true)
    : { data: [], error: null };

  if (accessCodeError) {
    throw new Error(`store_code_lookup_failed:${accessCodeError.message}`);
  }

  const codeMap = new Map((accessCodes ?? []).map((row) => [String(row.tenant_id), String(row.access_code)]));
  const packages = (packageResult.data ?? []).map(packageOption);

  return (
    <section className="surface">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center", marginBottom: 18 }}>
        <div>
          <h2 style={{ margin: 0 }}>Tenant Activation</h2>
          <p>เปิดร้านใหม่ · Store Code · Package · Branch · Owner · Device Enrollment</p>
        </div>
        <span style={{ fontSize: 12, color: "#607089" }}>ทั้งหมด {result.tenants.length} ร้าน</span>
      </div>

      <StoreProvisioningConsole packages={packages} />

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "#718096" }}>
              <th style={{ padding: 10 }}>Store Code</th><th>ร้าน</th><th>แพ็กเกจ</th><th>สาขา</th><th>Devices</th><th>Sessions</th><th>สถานะ</th>
            </tr>
          </thead>
          <tbody>
            {result.tenants.map((tenant) => (
              <tr key={tenant.id} style={{ borderTop: "1px solid #e8edf3" }}>
                <td style={{ padding: 12, fontWeight: 800, color: "#246af0" }}>{codeMap.get(tenant.id) ?? "-"}</td>
                <td><strong>{tenant.name}</strong><br /><small>{tenant.code}</small></td>
                <td>{tenant.package_name ?? "-"}</td>
                <td>{tenant.active_branch_count}/{tenant.branch_count}</td>
                <td>{tenant.active_device_count}/{tenant.device_count}</td>
                <td>{tenant.active_session_count}</td>
                <td>{tenant.is_active ? "Active" : "Inactive"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ marginTop: 16, fontSize: 11, color: "#77869a" }}>
        Store Provisioning เขียนข้อมูลธุรกิจไป CpiPOS-001 เท่านั้น; Device Health/Incident/Command ยังคงอยู่ CpiPOS-002 ตาม control-plane boundary
      </p>
    </section>
  );
}
