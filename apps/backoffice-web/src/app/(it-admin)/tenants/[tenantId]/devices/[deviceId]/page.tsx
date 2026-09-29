import { redirect } from "next/navigation";

export default async function DevicePage({
  params
}: {
  params: Promise<{ tenantId: string; deviceId: string }>;
}) {
  const { tenantId, deviceId } = await params;
  redirect(`/tenants/${encodeURIComponent(tenantId)}/devices/${encodeURIComponent(deviceId)}/health`);
}
