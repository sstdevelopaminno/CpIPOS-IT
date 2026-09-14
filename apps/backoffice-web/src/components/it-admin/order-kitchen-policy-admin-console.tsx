"use client";

import { useEffect, useMemo, useState } from "react";
import { TenantAdminNav } from "@/components/it-admin/tenant-admin-nav";

type OverrideMode = "inherit" | "force_on" | "force_off";
type Policy = {
  branch_id: string;
  store: { popup_enabled: boolean; kitchen_auto_send_enabled: boolean; kitchen_auto_print_enabled: boolean };
  override: { popup: OverrideMode; kitchen_auto_send: OverrideMode; kitchen_auto_print: OverrideMode };
  effective: { popup_enabled: boolean; kitchen_auto_send_enabled: boolean; kitchen_auto_print_enabled: boolean };
};
type Branch = { id: string; code: string | null; name: string | null; is_active: boolean | null; policy: Policy };

const modeLabels: Record<OverrideMode, string> = {
  inherit: "ตามการตั้งค่าของร้าน",
  force_on: "บังคับเปิด",
  force_off: "บังคับปิด"
};

function statusText(value: boolean) { return value ? "เปิด" : "ปิด"; }

export function OrderKitchenPolicyAdminConsole({ tenantId }: { tenantId: string }) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<Policy["override"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const selected = useMemo(() => branches.find((branch) => branch.id === selectedId) ?? null, [branches, selectedId]);

  async function load() {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/it-admin/admin/tenants/${tenantId}/order-kitchen-policy`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(payload?.error?.message ?? "Load failed"));
      const next = (payload?.data?.branches ?? []) as Branch[];
      setBranches(next);
      const nextId = selectedId && next.some((branch) => branch.id === selectedId) ? selectedId : String(next[0]?.id ?? "");
      setSelectedId(nextId);
      const nextBranch = next.find((branch) => branch.id === nextId) ?? next[0] ?? null;
      setDraft(nextBranch?.policy.override ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Load failed");
    } finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, [tenantId]);

  useEffect(() => {
    if (selected) setDraft(selected.policy.override);
  }, [selectedId]);

  async function save() {
    if (!selected || !draft || saving) return;
    setSaving(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/it-admin/admin/tenants/${tenantId}/order-kitchen-policy`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          branch_id: selected.id,
          popup_override: draft.popup,
          kitchen_auto_send_override: draft.kitchen_auto_send,
          kitchen_auto_print_override: draft.kitchen_auto_print
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(payload?.error?.message ?? "Save failed"));
      const policy = payload?.data?.policy as Policy;
      setBranches((current) => current.map((branch) => branch.id === selected.id ? { ...branch, policy } : branch));
      setDraft(policy.override);
      setMessage("บันทึก IT Override แล้ว");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Save failed");
    } finally { setSaving(false); }
  }

  const selectStyle = { minHeight: 42, border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", background: "#fff" } as const;

  return (
    <section className="surface" style={{ display: "grid", gap: 18 }}>
      <TenantAdminNav tenantId={tenantId} />
      <div>
        <h2 style={{ marginBottom: 6 }}>Order & Kitchen Automation</h2>
        <p style={{ margin: 0, opacity: 0.72 }}>ควบคุมการแจ้งเตือน QR, การส่งเข้าครัว และการพิมพ์ใบครัว โดย IT Override มีสิทธิ์สูงกว่าค่าที่ร้านตั้งไว้</p>
      </div>

      {loading ? <p>Loading…</p> : null}
      {error ? <div style={{ padding: 12, border: "1px solid #fecaca", borderRadius: 8, background: "#fef2f2", color: "#b91c1c" }}>{error}</div> : null}
      {message ? <div style={{ padding: 12, border: "1px solid #bbf7d0", borderRadius: 8, background: "#f0fdf4", color: "#166534" }}>{message}</div> : null}

      {!loading ? <>
        <label style={{ display: "grid", gap: 6, maxWidth: 520 }}>
          <strong>สาขา</strong>
          <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)} style={selectStyle}>
            {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.code ? `${branch.code} · ` : ""}{branch.name || branch.id}</option>)}
          </select>
        </label>

        {selected && draft ? <div style={{ display: "grid", gap: 12 }}>
          {([
            ["popup", "แจ้งเตือนออเดอร์ QR บนหน้าขาย", selected.policy.store.popup_enabled, selected.policy.effective.popup_enabled],
            ["kitchen_auto_send", "ส่งออเดอร์ QR เข้าครัวอัตโนมัติ", selected.policy.store.kitchen_auto_send_enabled, selected.policy.effective.kitchen_auto_send_enabled],
            ["kitchen_auto_print", "พิมพ์ใบรายการครัวอัตโนมัติ", selected.policy.store.kitchen_auto_print_enabled, selected.policy.effective.kitchen_auto_print_enabled]
          ] as const).map(([key, label, storeValue, effectiveValue]) => (
            <div key={key} style={{ display: "grid", gridTemplateColumns: "minmax(240px,1fr) minmax(220px,320px)", gap: 16, alignItems: "center", border: "1px solid var(--border)", borderRadius: 10, padding: 14 }}>
              <div><strong>{label}</strong><div style={{ marginTop: 5, fontSize: 13, opacity: 0.7 }}>ค่าร้าน: {statusText(storeValue)} · ผลใช้งานจริง: <b>{statusText(effectiveValue)}</b></div></div>
              <select value={draft[key]} onChange={(event) => setDraft((current) => current ? { ...current, [key]: event.target.value as OverrideMode } : current)} style={selectStyle}>
                {(Object.keys(modeLabels) as OverrideMode[]).map((mode) => <option key={mode} value={mode}>{modeLabels[mode]}</option>)}
              </select>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "flex-end" }}><button type="button" onClick={save} disabled={saving} style={{ minHeight: 42, border: 0, borderRadius: 8, padding: "10px 18px", background: "#0f62fe", color: "white", fontWeight: 700, cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.6 : 1 }}>{saving ? "Saving…" : "Save IT Override"}</button></div>
        </div> : <p>ไม่พบสาขา</p>}
      </> : null}
    </section>
  );
}
