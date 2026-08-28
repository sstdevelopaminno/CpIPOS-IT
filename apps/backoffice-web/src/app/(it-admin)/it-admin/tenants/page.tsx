import Link from "next/link";
import { getCurrentLanguage, type Language } from "@/lib/i18n";
import { requireItAdmin } from "@/lib/it-admin-guard";
import { listTenantSummaries } from "@/lib/services/it-admin/tenant-admin-service";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

const copy = {
  th: {
    eyebrow: "CUSTOMERS & STORES",
    title: "Tenants / Stores",
    description: "รายการลูกค้าจาก CpiPOS-001 สำหรับตรวจ Store Code, แพ็กเกจ, สาขา และสถานะการใช้งาน",
    create: "เปิดร้านใหม่",
    total: "ร้านทั้งหมด",
    storeCode: "Store Code",
    store: "ร้าน",
    package: "แพ็กเกจ",
    branches: "สาขา",
    devices: "อุปกรณ์",
    sessions: "Sessions",
    status: "สถานะ",
    active: "Active",
    inactive: "Inactive",
    noPackage: "ยังไม่ผูกแพ็กเกจ",
    empty: "ยังไม่มีร้านค้าในรายการ",
    boundary: "ข้อมูลธุรกิจและ subscription อยู่ใน CpiPOS-001; device health / incident / remote command อยู่ใน CpiPOS-002"
  },
  en: {
    eyebrow: "CUSTOMERS & STORES",
    title: "Tenants / Stores",
    description: "CpiPOS-001 customer directory for Store Code, package, branch, and operating-state review.",
    create: "Provision store",
    total: "Total stores",
    storeCode: "Store Code",
    store: "Store",
    package: "Package",
    branches: "Branches",
    devices: "Devices",
    sessions: "Sessions",
    status: "Status",
    active: "Active",
    inactive: "Inactive",
    noPackage: "No package",
    empty: "No stores in the current result",
    boundary: "Business/subscription authority stays in CpiPOS-001; device health, incidents, and remote commands stay in CpiPOS-002."
  }
} as const;

export default async function TenantsPage() {
  const context = await requireItAdmin();
  const language = await getCurrentLanguage();
  const text = copy[language as Language];
  const result = await listTenantSummaries(context, { limit: 100, status: "all" });

  const tenantIds = result.tenants.map((tenant) => tenant.id);
  const { data: accessCodes, error: accessCodeError } = tenantIds.length
    ? await context.supabase
        .from("tenant_access_codes")
        .select("tenant_id,access_code,is_active")
        .in("tenant_id", tenantIds)
        .eq("is_active", true)
    : { data: [], error: null };

  if (accessCodeError) throw new Error(`store_code_lookup_failed:${accessCodeError.message}`);

  const codeMap = new Map((accessCodes ?? []).map((row) => [String(row.tenant_id), String(row.access_code)]));

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>{text.eyebrow}</span>
          <h2>{text.title}</h2>
          <p>{text.description}</p>
        </div>
        <div className={styles.headerActions}>
          <span>{text.total}: <strong>{result.tenants.length}{result.next_cursor ? "+" : ""}</strong></span>
          <Link href="/it-admin/store-provisioning">{text.create}</Link>
        </div>
      </header>

      <section className={styles.card}>
        {result.tenants.length === 0 ? (
          <div className={styles.empty}>{text.empty}</div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{text.storeCode}</th>
                  <th>{text.store}</th>
                  <th>{text.package}</th>
                  <th>{text.branches}</th>
                  <th>{text.devices}</th>
                  <th>{text.sessions}</th>
                  <th>{text.status}</th>
                </tr>
              </thead>
              <tbody>
                {result.tenants.map((tenant) => (
                  <tr key={tenant.id}>
                    <td><strong className={styles.storeCode}>{codeMap.get(tenant.id) ?? "—"}</strong></td>
                    <td><strong>{tenant.name}</strong><small>{tenant.code}</small></td>
                    <td>{tenant.package_name ?? text.noPackage}</td>
                    <td>{tenant.active_branch_count}/{tenant.branch_count}</td>
                    <td>{tenant.active_device_count}/{tenant.device_count}</td>
                    <td>{tenant.active_session_count}</td>
                    <td>
                      <span className={`${styles.badge} ${tenant.is_active ? styles.badgeActive : styles.badgeInactive}`}>
                        {tenant.is_active ? text.active : text.inactive}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className={styles.boundary}>{text.boundary}</p>
    </div>
  );
}
