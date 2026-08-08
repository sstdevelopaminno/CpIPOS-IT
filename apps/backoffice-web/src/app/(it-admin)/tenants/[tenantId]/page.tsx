import { redirect } from "next/navigation";

export default async function TenantRootRedirectPage({
  params
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  redirect(`/tenants/${tenantId}/branches`);
}
