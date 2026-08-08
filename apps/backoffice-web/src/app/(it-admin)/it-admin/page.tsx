import { getCurrentLanguage, t } from "@/lib/i18n";

export default async function ItAdminHomePage() {
  const lang = await getCurrentLanguage();

  return (
    <section className="surface">
      <h2>{t(lang, "it_admin_overview")}</h2>
      <p>ภาพรวม tenants, สถานะ package billing, การใช้งานฐานข้อมูล และ audit ระดับ platform</p>
    </section>
  );
}