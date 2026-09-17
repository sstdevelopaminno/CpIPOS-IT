import { DesktopLicenseManagementConsole } from "@/components/it-admin/desktop-license-management-console";
import { getCurrentLanguage, type Language } from "@/lib/i18n";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

export default async function OfflineDesktopLicensePage() {
  const language = (await getCurrentLanguage()) as Language;

  return (
    <div className={styles.page}>
      <DesktopLicenseManagementConsole language={language} />
    </div>
  );
}
