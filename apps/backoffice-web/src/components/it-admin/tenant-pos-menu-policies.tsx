"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { PosMenuDefinition } from "@/lib/pos-menu-policy";
import { isPosMenuEnabled } from "@/lib/pos-menu-policy";
import styles from "./tenant-pos-menu-policies.module.css";

type Data = { catalog: PosMenuDefinition[]; overrides: Record<string, boolean>;
  disabled: number; total: number };
type ResponseBody<T> = { data?: T | null; error?: { message?: string } | null };

export function TenantPosMenuPolicies({ tenantId, storeName }: {
  tenantId: string; storeName: string
}) {
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(true);
  const endpoint = `/api/it-admin/v1/tenants/${encodeURIComponent(tenantId)}/pos-menu-policies`;

  const load = useCallback(async () => {
    try {
      const response = await fetch(endpoint, { cache: "no-store", credentials: "include" });
      const body = await response.json() as ResponseBody<Data>;
      if (!response.ok || !body.data) throw new Error(body.error?.message ?? "โหลดการตั้งค่าเมนูไม่สำเร็จ");
      setData(body.data); setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "โหลดการตั้งค่าเมนูไม่สำเร็จ");
    } finally { setLoading(false); }
  }, [endpoint]);
  useEffect(() => { void load(); }, [load]);
  const main = useMemo(() => data?.catalog.filter(item => item.group === "main") ?? [], [data]);
  const byParent = useMemo(() => new Map(main.map(item => [item.key,
    data?.catalog.filter(child => child.parent === item.key) ?? []
  ])), [data, main]);
  async function toggle(item: PosMenuDefinition) {
    if (!data || busy) return;
    const enabled = data.overrides[item.key] !== false;
    const prompt = enabled ? "ปิดใช้งาน" : "เปิดใช้งาน";
    if (!window.confirm(`${prompt} "${item.label}" ของร้าน ${storeName}?\n\nล็อกเฉพาะเมนูที่เลือก โดยยังแสดงรายการและลิงก์ใน POS ไม่เปลี่ยนค่าของเมนูอื่นหรือสิทธิ์แพ็กเกจ`)) return;
    setBusy(item.key); setError(""); setSuccess("");
    try {
      const response = await fetch(endpoint, {
        method: "PATCH", credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ menu_key: item.key, is_enabled: !enabled })
      });
      const body = await response.json() as ResponseBody<{ is_enabled: boolean }>;
      if (!response.ok || !body.data) throw new Error(body.error?.message ?? "บันทึกไม่สำเร็จ");
      setData(previous => previous ? {
        ...previous, overrides: { ...previous.overrides, [item.key]: body.data!.is_enabled },
        disabled: previous.catalog.filter(menu => (menu.key === item.key
          ? body.data!.is_enabled : previous.overrides[menu.key] !== false) === false).length
      } : previous);
      setSuccess(`${prompt}เมนู "${item.label}" เรียบร้อยแล้ว`);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "บันทึกไม่สำเร็จ");
    } finally { setBusy(null); }
  }
  function menuRow(item: PosMenuDefinition, child: boolean) {
    const configured = data?.overrides[item.key] !== false;
    const effective = data ? isPosMenuEnabled(item.key, data.overrides) : true;
    return <div key={item.key} className={child ? styles.child : styles.parent}>
      <div className={styles.menuLabel}>
        <strong>{item.label}</strong>
        <small>{effective ? "เปิดให้ใช้งาน" : "ล็อกเมนูใน POS"}</small>
      </div>
      <button type="button" role="switch" aria-checked={configured}
        aria-label={`${item.label}: ${configured ? "เปิด" : "ปิด"}`}
        className={configured ? styles.switchOn : styles.switchOff}
        disabled={busy !== null} onClick={() => void toggle(item)}>
        <span>{configured ? "เปิด" : "ปิด"}</span><i aria-hidden />
      </button>
    </div>;
  }
  return <div className={styles.root}>
    <header className={styles.header}><div>
      <strong>เปิด–ปิดเมนูหลักและเมนูย่อย</strong>
      <p>ล็อกเฉพาะปุ่มเมนูที่เลือกใน POS โดยยังคงแสดงลิงก์และไม่กระทบระบบหรือเมนูอื่น • ตั้งค่าแยกร้าน</p>
    </div><button type="button" className={styles.refresh} disabled={busy !== null}
      onClick={() => { setLoading(true); void load(); }}>รีเฟรช</button></header>
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    {success ? <p role="status" className={styles.success}>{success}</p> : null}
    {loading ? <p className={styles.empty}>กำลังโหลดนโยบายเมนู…</p> :
      main.map(item => <section className={styles.group} key={item.key}>
        {menuRow(item, false)}
        {(byParent.get(item.key)?.length ?? 0) > 0 ? <div className={styles.children}>
          {byParent.get(item.key)?.map(child => menuRow(child, true))}
        </div> : null}
      </section>)}
    <p className={styles.note}>การปิดสวิตช์จะล็อกปุ่มเมนูที่เลือกเท่านั้น ไม่ซ่อนลิงก์ ไม่ปิด API ไม่ลบข้อมูล และไม่แก้สิทธิ์ผู้ใช้หรือแพ็กเกจ • POS โหลดนโยบายใหม่หลังรีเฟรชหน้า</p>
  </div>;
}
