import { ConnectedStoreProvisioning } from "@/components/it-admin/connected-store-provisioning";
import { getCurrentLanguage, type Language } from "@/lib/i18n";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

const copy = {
  th: {
    eyebrow: "STORE PROVISIONING",
    title: "เปิดร้านใหม่",
    description: "สร้าง Tenant, Store Code, Trial, สาขาหลัก และ Owner ผ่าน authority เดิมของ CpiPOS-001 โดยหน้าเว็บไม่พึ่ง service-role runtime โดยตรง",
    boundary: "การสร้างจริงยังผ่าน Store Provisioning authority และ audit flow เดิม ไม่มีการสร้างร้านอัตโนมัติจากการเปิดหน้านี้"
  },
  en: {
    eyebrow: "STORE PROVISIONING",
    title: "Provision a new store",
    description: "Create Tenant, Store Code, Trial, primary branch, and Owner through the existing CpiPOS-001 authority without direct page-level service-role dependencies.",
    boundary: "Actual creation still uses the existing Store Provisioning authority and audit flow. Opening this page never creates a store automatically."
  }
} as const;

export default async function StoreProvisioningPage() {
  const language = await getCurrentLanguage();
  const text = copy[language as Language];
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <span>{text.eyebrow}</span>
        <h2>{text.title}</h2>
        <p>{text.description}</p>
      </header>
      <ConnectedStoreProvisioning language={language} />
      <p className={styles.boundary}>{text.boundary}</p>
    </div>
  );
}
