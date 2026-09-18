"use client";

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { Language } from "@/lib/i18n";

type ApiEnvelope<T> = { data: T | null; error: { code?: string; message?: string } | null };
type Plan = { code: string; days: number; label_th: string; label_en: string; price_thb: number | null; active: boolean; updated_at?: string };
type RequestRow = { id: string; plan_code: string; plan_days: number; price_thb: number | null; status: string; requested_at: string; decided_at?: string | null; decision_note?: string | null; contract?: { license_id?: string; customer_name?: string } | null; device?: { device_code?: string; device_name?: string; last_seen_at?: string } | null };
type EntitlementRow = { id: string; plan_code: string; cloud_code: string; status: string; starts_at: string; expires_at: string; last_backup_at?: string | null; expired_at?: string | null; cancelled_at?: string | null; cancellation_reason?: string | null; contract?: { license_id?: string; customer_name?: string } | null; device?: { device_code?: string; device_name?: string; last_seen_at?: string } | null };
type CloudAdminData = { plans: Plan[]; requests: RequestRow[]; entitlements: EntitlementRow[]; expired_pending_count: number; checked_at?: string };

const money = (value: unknown) => new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB", maximumFractionDigits: 2 }).format(Number(value ?? 0));
const when = (value?: string | null) => value ? new Date(value).toLocaleString("th-TH") : "—";
const sx = (style: CSSProperties) => style;

export function DesktopCloudApprovalPanel({ language }: { language: Language }) {
  const th = language === "th";
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<CloudAdminData | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [prices, setPrices] = useState<Record<string, string>>({});

  const pending = useMemo<RequestRow[]>(() => (data?.requests ?? []).filter((row) => row.status === "pending"), [data]);
  const active = useMemo<EntitlementRow[]>(() => (data?.entitlements ?? []).filter((row) => row.status === "active" || row.status === "expired_pending"), [data]);

  const load = async () => {
    try {
      const response = await fetch("/api/it-admin/cloud-backup", { cache: "no-store" });
      const body = await response.json() as ApiEnvelope<CloudAdminData>;
      if (!response.ok || !body.data) throw new Error(body.error?.message || "CLOUD_ADMIN_LOAD_FAILED");
      setData(body.data);
      const nextPrices: Record<string, string> = {};
      for (const plan of body.data.plans ?? []) nextPrices[plan.code] = plan.price_thb == null ? "" : String(plan.price_thb);
      setPrices(nextPrices);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  useEffect(() => {
    if (open) void load();
  }, [open]);

  const action = async (payload: Record<string, unknown>, okText: string) => {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/it-admin/cloud-backup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      const body = await response.json() as ApiEnvelope<unknown>;
      if (!response.ok || !body.data) throw new Error(body.error?.message || "CLOUD_ACTION_FAILED");
      setMessage(okText);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const approve = (row: RequestRow) => action({ action: "approve", requestId: row.id, note: "Approved from License Control Plane" }, th ? "อนุมัติ Cloud แล้ว" : "Cloud approved");
  const reject = (row: RequestRow) => action({ action: "reject", requestId: row.id, note: "Rejected from License Control Plane" }, th ? "ปฏิเสธคำขอ Cloud แล้ว" : "Cloud request rejected");
  const renew = (row: EntitlementRow) => action({ action: "renew", entitlementId: row.id, note: "Renewed from License Control Plane" }, th ? "ต่อ Cloud แล้ว" : "Cloud renewed");
  const cancelCloud = (row: EntitlementRow) => {
    if (!window.confirm(th ? "ยกเลิก Cloud รายการนี้? ข้อมูลบน Cloud ของ License นี้จะถูกลบตามระบบ" : "Cancel this cloud entitlement?")) return;
    void action({ action: "cancel", entitlementId: row.id, note: "Cancelled from License Control Plane" }, th ? "ยกเลิก Cloud แล้ว" : "Cloud cancelled");
  };
  const savePlan = (plan: Plan) => action({ action: "update_plan", planCode: plan.code, priceThb: prices[plan.code] === "" ? null : Number(prices[plan.code]), active: plan.active }, th ? "บันทึกราคา Cloud แล้ว" : "Cloud plan saved");

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} style={sx({ position: "fixed", right: 24, bottom: 24, zIndex: 45, border: "1px solid #bfd3ec", borderRadius: 999, padding: "12px 16px", background: "#0b6ff6", color: "white", fontWeight: 900, boxShadow: "0 14px 34px rgba(15,63,126,.2)" })}>
        ☁ {th ? "Cloud อนุมัติ" : "Cloud approvals"}{pending.length ? ` (${pending.length})` : ""}
      </button>

      {open ? (
        <div style={sx({ position: "fixed", inset: 0, zIndex: 80, background: "rgba(10,22,40,.55)", display: "grid", placeItems: "center", padding: 24 })} onMouseDown={() => setOpen(false)}>
          <section style={sx({ width: "min(1180px, 96vw)", maxHeight: "88vh", overflow: "auto", background: "#fff", borderRadius: 22, boxShadow: "0 24px 80px rgba(0,0,0,.28)", padding: 24 })} onMouseDown={(event) => event.stopPropagation()}>
            <header style={sx({ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, borderBottom: "1px solid #e5edf7", paddingBottom: 16 })}>
              <div>
                <small style={sx({ color: "#0b6ff6", fontWeight: 900, letterSpacing: ".08em" })}>CLOUD BACKUP APPROVAL</small>
                <h2 style={sx({ margin: "6px 0", fontSize: 28 })}>{th ? "อนุมัติ Cloud สำรองข้อมูล CpIPOS Desktop" : "CpIPOS Desktop Cloud approvals"}</h2>
                <p style={sx({ margin: 0, color: "#5c6f89" })}>{th ? "ตั้งราคาแพ็กเกจ รับคำขอซื้อ อนุมัติ/ปฏิเสธ ต่ออายุ หรือยกเลิก Cloud ของแต่ละ License" : "Set prices, approve purchases, renew or cancel cloud backup per license."}</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} style={sx({ width: 44, height: 44, border: 0, borderRadius: 14, background: "#eef4fb", fontSize: 24 })}>×</button>
            </header>

            {message ? <div style={sx({ marginTop: 14, padding: 12, borderRadius: 12, background: "#fff4e8", color: "#9a4a00", fontWeight: 800 })}>{message}</div> : null}

            <h3>{th ? "แพ็กเกจ Cloud" : "Cloud plans"}</h3>
            <div style={sx({ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12 })}>
              {(data?.plans ?? []).map((plan) => (
                <div key={plan.code} style={sx({ border: "1px solid #d9e5f3", borderRadius: 16, padding: 14, background: "#f9fcff" })}>
                  <b>{plan.label_th}</b>
                  <small style={sx({ display: "block", color: "#60758e", margin: "4px 0 8px" })}>{plan.code}</small>
                  <input value={prices[plan.code] ?? ""} placeholder="ราคา (บาท)" inputMode="decimal" onChange={(event) => setPrices((current) => ({ ...current, [plan.code]: event.target.value.replace(/[^0-9.]/g, "") }))} style={sx({ width: "100%", height: 40, border: "1px solid #cbd9e8", borderRadius: 10, padding: "0 10px" })} />
                  <button disabled={busy} onClick={() => void savePlan(plan)} style={sx({ marginTop: 10, width: "100%", height: 40, border: 0, borderRadius: 10, background: "#0b6ff6", color: "white", fontWeight: 900 })}>{th ? "บันทึกราคา" : "Save price"}</button>
                </div>
              ))}
            </div>

            <h3>{th ? `คำขอรออนุมัติ (${pending.length})` : `Pending requests (${pending.length})`}</h3>
            <div style={sx({ display: "grid", gap: 10 })}>
              {pending.length ? pending.map((row) => (
                <article key={row.id} style={sx({ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 12, alignItems: "center", border: "1px solid #dbe7f4", borderRadius: 16, padding: 14 })}>
                  <div>
                    <b>{row.contract?.license_id || row.id}</b>
                    <p style={sx({ margin: "4px 0", color: "#5c6f89" })}>{row.contract?.customer_name || "-"} · {row.device?.device_code || "-"} · {row.plan_code} · {money(row.price_thb)}</p>
                    <small>{th ? "ขอเมื่อ" : "Requested"}: {when(row.requested_at)}</small>
                  </div>
                  <div style={sx({ display: "flex", gap: 8 })}>
                    <button disabled={busy} onClick={() => void approve(row)} style={sx({ padding: "10px 14px", border: 0, borderRadius: 10, background: "#16a34a", color: "white", fontWeight: 900 })}>{th ? "อนุมัติ" : "Approve"}</button>
                    <button disabled={busy} onClick={() => void reject(row)} style={sx({ padding: "10px 14px", border: "1px solid #fecaca", borderRadius: 10, background: "#fff1f2", color: "#b91c1c", fontWeight: 900 })}>{th ? "ปฏิเสธ" : "Reject"}</button>
                  </div>
                </article>
              )) : <div style={sx({ padding: 24, border: "1px dashed #cbd9e8", borderRadius: 14, color: "#789" })}>{th ? "ยังไม่มีคำขอซื้อ Cloud" : "No pending cloud requests"}</div>}
            </div>

            <h3>{th ? `Cloud ที่ใช้งาน/รอต่ออายุ (${active.length})` : `Active / renewal review (${active.length})`}</h3>
            <div style={sx({ display: "grid", gap: 10 })}>
              {active.map((row) => (
                <article key={row.id} style={sx({ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 12, alignItems: "center", border: "1px solid #dbe7f4", borderRadius: 16, padding: 14 })}>
                  <div>
                    <b>{row.cloud_code}</b>
                    <p style={sx({ margin: "4px 0", color: "#5c6f89" })}>{row.contract?.license_id || "-"} · {row.contract?.customer_name || "-"} · {row.device?.device_code || "-"}</p>
                    <small>{row.status} · {th ? "หมดอายุ" : "Expires"}: {when(row.expires_at)} · {th ? "Backup ล่าสุด" : "Last backup"}: {when(row.last_backup_at)}</small>
                  </div>
                  <div style={sx({ display: "flex", gap: 8 })}>
                    <button disabled={busy || row.status !== "expired_pending"} onClick={() => void renew(row)} style={sx({ padding: "10px 14px", border: 0, borderRadius: 10, background: row.status === "expired_pending" ? "#0b6ff6" : "#cbd5e1", color: "white", fontWeight: 900 })}>{th ? "ต่อ Cloud" : "Renew"}</button>
                    <button disabled={busy} onClick={() => cancelCloud(row)} style={sx({ padding: "10px 14px", border: "1px solid #fecaca", borderRadius: 10, background: "#fff1f2", color: "#b91c1c", fontWeight: 900 })}>{th ? "ยกเลิก Cloud" : "Cancel"}</button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
