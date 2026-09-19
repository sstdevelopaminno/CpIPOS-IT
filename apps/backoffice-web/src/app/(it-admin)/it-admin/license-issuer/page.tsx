import { DesktopCloudApprovalPanel } from "@/components/it-admin/desktop-cloud-approval-panel";
import { DesktopLicenseControlPlaneV031 } from "@/components/it-admin/desktop-license-control-plane-v031";
import { DesktopLicenseReadinessPanel } from "@/components/it-admin/desktop-license-readiness-panel";
import { getCurrentLanguage, type Language } from "@/lib/i18n";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

export default async function OfflineDesktopLicensePage() {
  const language = (await getCurrentLanguage()) as Language;

  return (
    <div className={styles.page}>
      <DesktopLicenseControlPlaneV031 language={language} readiness={<DesktopLicenseReadinessPanel language={language} />} />
      <DesktopCloudApprovalPanel language={language} />
    </div>
  );
}
