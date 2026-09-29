import { CpiPosAiTenantDetail } from "@/components/it-admin/cpipos-ai-tenant-detail";

export default async function CpiPosAiTenantPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  return <CpiPosAiTenantDetail tenantId={tenantId} />;
}
