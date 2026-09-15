import { redirect } from "next/navigation";

export default async function LegacyTenantDevicesPage({
  params
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  redirect(`/tenants/${encodeURIComponent(tenantId)}/devices`);
}
