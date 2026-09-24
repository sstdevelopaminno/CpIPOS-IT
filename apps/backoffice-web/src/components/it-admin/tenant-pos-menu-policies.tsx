"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { PosMenuDefinition } from "@/lib/pos-menu-policy";
import type { MenuAvailability } from "@/lib/pos-menu-effective-state";
import styles from "./tenant-pos-menu-policies.module.css";

type Data = { catalog: PosMenuDefinition[]; overrides: Record<string, boolean>;
  availability: Record<string, MenuAvailability>;
  disabled: number; unavailable: number; total: number };
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
      setData(null); // Never present an outdated green switch after an API failure.
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
    const availability = data.availability?.[item.key];
    // The main switch shows actual POS availability, not an IT command that
    // cannot override package/branch access. Avoid a no-op toggle.
    if (!availability || !availability.feature_allowed) {
      setError("เมนูนี้ถูกปิดด้วยเงื่อนไขแพ็กเกจ/สาขา กรุณาตรวจสิทธิ์ฟีเจอร์ก่อน");
      return;
    }
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
    const entitlement = data?.availability?.[item.key];
    const allowed = entitlement?.feature_allowed === true;
    const effective = configured && allowed;
    const blockedByAccess = configured && !allowed;
    const featureLabel = entitlement?.feature_code;
    const message = !configured
      ? "ปิดด้วยคำสั่ง IT"
      : entitlement?.reason === "contract_inactive"
        ? "ปิดจริงใน POS • สัญญาแพ็กเกจไม่พร้อมใช้งาน"
        : entitlement?.reason === "no_active_branch"
          ? "ปิดจริงใน POS • ไม่มีสาขาที่เปิดใช้งาน"
          : entitlement?.reason === "partial_branches"
            ? `ปิดในบางสาขา (${entitlement.available_branches}/${entitlement.total_branches} สาขาใช้งานได้)`
            : !allowed
              ? `ปิดจริงใน POS • ไม่มีสิทธิ์ฟีเจอร์ ${featureLabel ?? ""}`
              : "เปิดใช้งานใน POS";
    return <div key={item.key} className={child ? styles.child : styles.parent}>
      <div className={styles.menuLabel}>
        <strong>{item.label}</strong>
        <small className={effective ? styles.available : styles.unavailable}>{message}</small>
        {blockedByAccess ? <small className={styles.accessHelp}>
          คำสั่ง IT: เปิด แต่สิทธิ์ใช้งานจริงยังปิด •{" "}
          <a href={`/tenants/${encodeURIComponent(tenantId)}/features`}>ตรวจสิทธิ์ฟีเจอร์</a>
        </small> : null}
      </div>
      <button type="button" role="switch" aria-checked={effective}
        aria-label={`${item.label}: ${effective ? "เปิดใช้งานใน POS" : message}`}
        title={blockedByAccess ? "ต้องเปิดสิทธิ์แพ็กเกจหรือสาขาก่อนจึงจะเปิดเมนูนี้ได้" : message}
        className={effective ? styles.switchOn : styles.switchOff}
        disabled={busy !== null || !entitlement || !allowed}
        onClick={() => void toggle(item)}>
        <span>{effective ? "เปิด" : "ปิด"}</span><i aria-hidden />
      </button>
    </div>;
  }
  return <div className={styles.root}>
    <header className={styles.header}><div>
      <strong>เปิด–ปิดเมนูหลักและเมนูย่อย</strong>
      <p>สีเขียว = POS ใช้งานได้ทุกสาขา • สีเทา = IT สั่งปิด หรือแพ็กเกจ/สิทธิ์สาขาทำให้เมนูถูกล็อก • สิทธิ์พนักงานรายคนตรวจแยก</p>
    </div><button type="button" className={styles.refresh} disabled={busy !== null}
      onClick={() => { setLoading(true); void load(); }}>รีเฟรช</button></header>
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    {success ? <p role="status" className={styles.success}>{success}</p> : null}
    {loading ? <p className={styles.empty}>กำลังโหลดนโยบายเมนู…</p> : !data ? <p className={styles.empty}>ยังยืนยันสถานะเมนูไม่ได้ กรุณารีเฟรช</p> :
      main.map(item => <section className={styles.group} key={item.key}>
        {menuRow(item, false)}
        {(byParent.get(item.key)?.length ?? 0) > 0 ? <div className={styles.children}>
          {byParent.get(item.key)?.map(child => menuRow(child, true))}
        </div> : null}
      </section>)}
    <p className={styles.note}>สวิตช์แสดงสถานะที่ POS ใช้งานได้จริงทุกสาขา หากแพ็กเกจไม่รองรับจะขึ้น “ปิด” แม้คำสั่ง IT ยังเป็น “เปิด” และจะไม่แก้แพ็กเกจให้เอง • <a href={`/tenants/${encodeURIComponent(tenantId)}/features`}>ตรวจสิทธิ์ฟีเจอร์ของร้านนี้</a> • การปิดโดย IT ล็อกเฉพาะปุ่มที่เลือก ไม่ซ่อนลิงก์หรือปิด API • POS อ่านสถานะใหม่เมื่อกลับเข้าแท็บ</p>
  </div>;
}
