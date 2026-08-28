import { StoreProvisioningConsole, type ProvisioningPackageOption } from "@/components/it-admin/store-provisioning-console";
import { getCurrentLanguage, type Language } from "@/lib/i18n";
import { requireItAdmin } from "@/lib/it-admin-guard";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

type PackageRow = {
  id: string;
  code: string;
  name: string;
  monthly_price: number | string | null;
  yearly_price: number | string | null;
  max_branches: number | null;
  max_devices: number | null;
  max_users: number | null;
  quota_mode: string | null;
};

const copy = {
  th: {
    eyebrow: "STORE PROVISIONING",
    title: "เปิดร้านใหม่",
    description: "สร้าง Tenant, Store Code, Trial, สาขาหลัก และ Owner ผ่าน authority เดิมของ CpiPOS-001 โดยไม่แก้ SQL หรือ source code ต่อร้าน",
    boundary: "Fast Provisioning รองรับเฉพาะแพ็กเกจ Standard ที่ Active และมีราคาจริง การเปิดแบบชำระเงินยังต้องผ่าน approval flow เดิม"
  },
  en: {
    eyebrow: "STORE PROVISIONING",
    title: "Provision a new store",
    description: "Create the Tenant, Store Code, Trial, main branch, and Owner through the existing CpiPOS-001 authority without per-store SQL or source edits.",
    boundary: "Fast Provisioning accepts active Standard packages with a real price only. Paid activation remains behind the existing approval flow."
  }
} as const;

function packageOption(row: PackageRow): ProvisioningPackageOption {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    monthly_price: Number(row.monthly_price ?? 0),
    yearly_price: Number(row.yearly_price ?? 0),
    max_branches: Number(row.max_branches ?? 0),
    max_devices: Number(row.max_devices ?? 0),
    max_users: Number(row.max_users ?? 0),
    quota_mode: String(row.quota_mode ?? "standard")
  };
}

export default async function StoreProvisioningPage() {
  const context = await requireItAdmin();
  const language = await getCurrentLanguage();
  const text = copy[language as Language];
  const packageResult = await context.supabase
    .from("subscription_packages")
    .select("id,code,name,monthly_price,yearly_price,max_branches,max_devices,max_users,quota_mode")
    .eq("is_active", true)
    .eq("status", "active")
    .order("monthly_price", { ascending: true })
    .returns<PackageRow[]>();

  if (packageResult.error) {
    throw new Error(`store_provisioning_package_catalog_failed:${packageResult.error.message}`);
  }

  const packages = (packageResult.data ?? []).map(packageOption);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <span>{text.eyebrow}</span>
        <h2>{text.title}</h2>
        <p>{text.description}</p>
      </header>
      <StoreProvisioningConsole packages={packages} language={language} />
      <p className={styles.boundary}>{text.boundary}</p>
    </div>
  );
}
