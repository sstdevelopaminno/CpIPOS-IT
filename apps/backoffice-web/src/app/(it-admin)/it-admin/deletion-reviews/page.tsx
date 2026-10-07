import { TenantDeletionReviewConsole } from "@/components/it-admin/tenant-deletion-review-console";
import { getCurrentLanguage } from "@/lib/i18n";

export default async function TenantDeletionReviewsPage() {
  const language = await getCurrentLanguage();
  return <TenantDeletionReviewConsole language={language} />;
}
