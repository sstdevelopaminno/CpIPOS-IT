import { SubscriptionPaymentHistory } from "@/components/it-admin/subscription-payment-history";

export default async function SubscriptionPaymentHistoryPage({
  params
}: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  return <SubscriptionPaymentHistory tenantId={tenantId} />;
}
