import { OfflineLicenseIssuerConsole } from "@/components/it-admin/offline-license-issuer-console";
import { getCurrentLanguage, type Language } from "@/lib/i18n";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

const copy = {
  th: {
    eyebrow: "OFFLINE DESKTOP LICENSE",
    title: "ออก License โปรแกรม POS Desktop",
    description: "สร้าง License แบบออฟไลน์ที่ลงลายเซ็นดิจิทัลจากฝั่ง CUTTING POINT TECH IT เพื่อกำหนดร้านค้า จำนวนเครื่อง วันเริ่ม วันหมดอายุ และสิทธิ์การใช้งาน โดย Private Key ไม่ออกจาก Server",
    note: "นำ Device Code จาก CpIPOS Desktop มากรอกให้ตรง จากนั้นคัดลอก License Key ที่สร้างได้กลับไปใส่ในโปรแกรมเครื่องลูกค้า"
  },
  en: {
    eyebrow: "OFFLINE DESKTOP LICENSE",
    title: "Issue POS Desktop License",
    description: "Create digitally signed offline licenses from CUTTING POINT TECH IT with customer, device binding, activation, expiry, and feature entitlement metadata. The private key never leaves the server.",
    note: "Copy each Device Code from CpIPOS Desktop, issue the license here, then paste the generated License Key into the customer's desktop application."
  }
} as const;

export default async function OfflineDesktopLicensePage() {
  const language = (await getCurrentLanguage()) as Language;
  const text = copy[language];

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <span>{text.eyebrow}</span>
        <h2>{text.title}</h2>
        <p>{text.description}</p>
      </header>
      <div className={styles.note}>{text.note}</div>
      <OfflineLicenseIssuerConsole language={language} />
    </div>
  );
}
