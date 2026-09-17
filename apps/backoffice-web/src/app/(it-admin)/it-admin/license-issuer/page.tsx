import { DesktopLicenseManagementConsole } from "@/components/it-admin/desktop-license-management-console";
import { getCurrentLanguage, type Language } from "@/lib/i18n";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

const copy = {
  th: {
    eyebrow: "DESKTOP LICENSE CONTROL PLANE",
    title: "จัดการ License โปรแกรม POS Desktop",
    description: "ออกและจัดการ License แบบออฟไลน์ พร้อมติดตามสถานะเครื่อง การเชื่อมต่อเครื่องพิมพ์ สุขภาพระบบ การตรวจสอบความสมบูรณ์ และยอดขายที่ซิงก์กลับเมื่อเครื่องมีอินเทอร์เน็ต",
    note: "CpIPOS Desktop ยังขายแบบออฟไลน์ได้ตาม License ที่ลงลายเซ็นไว้ เมื่อมีอินเทอร์เน็ตโปรแกรมจะตรวจสถานะ License และส่ง Telemetry / ยอดขายกลับ CpiPOS-001 เป็นระยะ"
  },
  en: {
    eyebrow: "DESKTOP LICENSE CONTROL PLANE",
    title: "Manage POS Desktop licenses",
    description: "Issue and manage offline-signed licenses while monitoring device, printer, health, integrity and sales telemetry whenever a device is online.",
    note: "CpIPOS Desktop remains offline-first. When connectivity is available it validates the license and periodically syncs telemetry and sales to CpiPOS-001."
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
      <DesktopLicenseManagementConsole language={language} />
    </div>
  );
}
