"use client";

import { useCallback, useEffect, useState } from "react";
import { StoreProvisioningConsole, type ProvisioningPackageOption } from "@/components/it-admin/store-provisioning-console";
import type { Language } from "@/lib/i18n";

type ProvisioningPayload = { rows: Array<Record<string, unknown>> };

function packageOption(row: Record<string, unknown>): ProvisioningPackageOption {
  return {
    id: String(row.id ?? ""),
    code: String(row.code ?? ""),
    name: String(row.name ?? ""),
    monthly_price: Number(row.monthly_price ?? 0),
    yearly_price: Number(row.yearly_price ?? 0),
    max_branches: Number(row.max_branches ?? 0),
    max_devices: Number(row.max_devices ?? 0),
    max_users: Number(row.max_users ?? 0),
    quota_mode: String(row.quota_mode ?? "standard")
  };
}

export function ConnectedStoreProvisioning({ language }: { language: Language }) {
  const [packages, setPackages] = useState<ProvisioningPackageOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/it-admin/v1/modules/provisioning", { cache: "no-store", credentials: "include" });
      const body = (await response.json().catch(() => null)) as { data?: ProvisioningPayload; error?: { message?: string } } | null;
      if (!response.ok || !body?.data) throw new Error(body?.error?.message ?? "Package catalog is temporarily unavailable.");
      setPackages(body.data.rows.filter((row) => String(row.status) === "Active").map(packageOption).filter((item) => item.id && item.code));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Package catalog is temporarily unavailable.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <section className="surface"><strong>กำลังเชื่อม Package catalog...</strong></section>;
  if (error) {
    return (
      <section className="surface" style={{ display: "grid", gap: 10 }}>
        <strong style={{ color: "#8a5a18" }}>ยังโหลดแพ็กเกจสำหรับเปิดร้านไม่ได้</strong>
        <span style={{ color: "#7a8798" }}>{error}</span>
        <button type="button" className="pos-monitor-btn pos-monitor-btn--primary" onClick={() => void load()}>ลองใหม่</button>
      </section>
    );
  }

  return <StoreProvisioningConsole packages={packages} language={language} />;
}
