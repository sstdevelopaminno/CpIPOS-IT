"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./cpipos-ai-admin-console.module.css";

type UsageRow = {
  id: string;
  branch_id: string;
  user_id: string;
  openai_conversation_id: string | null;
  response_id: string | null;
  model: string;
  prompt_text: string | null;
  input_tokens: number;
  cached_input_tokens: number;
  cache_write_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  total_tokens: number;
  total_cost_usd: number | string;
  pricing_source: string;
  service_tier: string | null;
  status: string;
  requested_at: string;
  history_cleared_at: string | null;
};

type UserRow = {
  user_id: string;
  full_name: string;
  email: string;
  role: string;
  branch_id: string;
  branch_name: string;
  room_count: number;
};

type RoomRow = {
  room_id: string;
  room_title: string;
  user_id: string;
  full_name: string;
  email: string;
  role: string;
  branch_id: string;
  branch_name: string;
  conversation_id: string;
  conversation_created_at: string;
  conversation_updated_at: string;
  last_message_at: string;
};

type SeriesRow = {
  bucket_start: string;
  request_count: number | string;
  user_count: number | string;
  input_tokens: number | string;
  output_tokens: number | string;
  total_tokens: number | string;
  total_cost_usd: number | string;
};

type Detail = {
  generated_at: string;
  tenant: { id: string; code: string; name: string; active: boolean };
  menu_enabled: boolean;
  package: { id: string; code: string; name: string } | null;
  contract_status: string | null;
  quota: {
    enabled: boolean;
    mode: "inherit" | "custom" | "unlimited";
    source: string;
    limits: { requests: number | null; tokens: number | null; cost_usd: number | null };
    history_retention_days: number | null;
    documents: { storage_limit_mb: number | null; retention_days: number | null; max_file_mb: number | null };
    override: {
      quota_mode?: "inherit" | "custom" | "unlimited";
      is_enabled_override?: boolean | null;
      monthly_request_limit?: number | null;
      monthly_token_limit?: number | null;
      monthly_cost_limit_usd?: number | string | null;
      history_retention_days?: number | null;
      document_storage_mb?: number | null;
      document_retention_days?: number | null;
      document_max_file_mb?: number | null;
    } | null;
    package_default: {
      is_enabled?: boolean;
      monthly_request_limit?: number | null;
      monthly_token_limit?: number | null;
      monthly_cost_limit_usd?: number | string | null;
      history_retention_days?: number | null;
      document_storage_mb?: number | null;
      document_retention_days?: number | null;
      document_max_file_mb?: number | null;
    } | null;
    month: string;
    usage: { requests: number; users: number; total_tokens: number; input_tokens: number; output_tokens: number; cost_usd: number };
  };
  users: UserRow[];
  rooms: RoomRow[];
  events: UsageRow[];
  series: { daily: SeriesRow[]; monthly: SeriesRow[]; yearly: SeriesRow[] };
};

type Envelope<T> = { data?: T | null; error?: { message?: string } | null };

function fmt(value: unknown) {
  return new Intl.NumberFormat("th-TH").format(Number(value ?? 0));
}

function usd(value: unknown) {
  return "$" + Number(value ?? 0).toFixed(6);
}

function dt(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
}

function field(value: unknown) {
  return value == null ? "" : String(value);
}

export function CpiPosAiTenantDetail({ tenantId }: { tenantId: string }) {
  const [data, setData] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [quotaMode, setQuotaMode] = useState<"inherit" | "custom" | "unlimited">("inherit");
  const [enabledMode, setEnabledMode] = useState<"inherit" | "enabled" | "disabled">("inherit");
  const [requests, setRequests] = useState("");
  const [tokens, setTokens] = useState("");
  const [cost, setCost] = useState("");
  const [retentionDays, setRetentionDays] = useState("");
  const [documentStorageMb, setDocumentStorageMb] = useState("");
  const [documentRetentionDays, setDocumentRetentionDays] = useState("");
  const [documentMaxFileMb, setDocumentMaxFileMb] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/it-admin/v1/cpipos-ai/tenants/${encodeURIComponent(tenantId)}`, {
        cache: "no-store", credentials: "include"
      });
      const body = (await response.json().catch(() => null)) as Envelope<Detail> | null;
      if (!response.ok || !body?.data) throw new Error(body?.error?.message ?? "โหลดข้อมูล AI ของร้านไม่สำเร็จ");
      setData(body.data);
      const override = body.data.quota.override;
      setQuotaMode(override?.quota_mode ?? "inherit");
      setEnabledMode(override?.is_enabled_override === true ? "enabled" : override?.is_enabled_override === false ? "disabled" : "inherit");
      setRequests(field(override?.monthly_request_limit));
      setTokens(field(override?.monthly_token_limit));
      setCost(field(override?.monthly_cost_limit_usd));
      setRetentionDays(field(override?.history_retention_days));
      setDocumentStorageMb(field(override?.document_storage_mb));
      setDocumentRetentionDays(field(override?.document_retention_days));
      setDocumentMaxFileMb(field(override?.document_max_file_mb));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "โหลดข้อมูล AI ของร้านไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => { void load(); }, [load]);

  const userMap = useMemo(() => new Map((data?.users ?? []).map((user) => [user.user_id, user])), [data?.users]);

  async function saveQuota() {
    if (busy) return;
    setBusy("quota");
    setError("");
    try {
      const response = await fetch(`/api/it-admin/v1/cpipos-ai/tenants/${encodeURIComponent(tenantId)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          quota_mode: quotaMode,
          is_enabled_override: enabledMode === "inherit" ? null : enabledMode === "enabled",
          monthly_request_limit: quotaMode === "custom" && requests ? requests : null,
          monthly_token_limit: quotaMode === "custom" && tokens ? tokens : null,
          monthly_cost_limit_usd: quotaMode === "custom" && cost ? cost : null,
          history_retention_days: retentionDays || null,
          document_storage_mb: documentStorageMb || null,
          document_retention_days: documentRetentionDays || null,
          document_max_file_mb: documentMaxFileMb || null
        })
      });
      const body = (await response.json().catch(() => null)) as Envelope<unknown> | null;
      if (!response.ok) throw new Error(body?.error?.message ?? "บันทึก AI Quota ของร้านไม่สำเร็จ");
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "บันทึก AI Quota ของร้านไม่สำเร็จ");
    } finally {
      setBusy("");
    }
  }

  async function clearHistory(room?: RoomRow) {
    if (busy) return;
    const scopeText = room ? `ห้อง “${room.room_title}” ของ ${room.full_name}` : "ทั้งหมดของร้านนี้";
    if (!window.confirm(`ล้างประวัติ CpiPOS AI ${scopeText} หรือไม่?\n\nข้อความใน OpenAI Conversation จะถูกลบ แต่ token และค่าใช้จ่ายเดิมจะยังคงอยู่เพื่อการบัญชี/Quota`)) return;
    setBusy(room ? `history:${room.room_id}` : "history:all");
    setError("");
    try {
      const response = await fetch(`/api/it-admin/v1/cpipos-ai/tenants/${encodeURIComponent(tenantId)}/history`, {
        method: "DELETE",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(room ? { room_id: room.room_id } : {})
      });
      const body = (await response.json().catch(() => null)) as Envelope<unknown> | null;
      if (!response.ok) throw new Error(body?.error?.message ?? "ล้างประวัติ AI ไม่สำเร็จ");
      await load();
    } catch (clearError) {
      setError(clearError instanceof Error ? clearError.message : "ล้างประวัติ AI ไม่สำเร็จ");
    } finally {
      setBusy("");
    }
  }

  if (loading && !data) return <div className={styles.detailLoading}>กำลังโหลด CpiPOS AI ของร้าน…</div>;

  const usage = data?.quota.usage;
  const limits = data?.quota.limits;
  const requestPercent = limits?.requests ? Math.min(100, (Number(usage?.requests ?? 0) / limits.requests) * 100) : 0;

  return (
    <div className={styles.page}>
      <header className={styles.detailHeader}>
        <div>
          <Link href="/it-admin/cpipos-ai" className={styles.backLink}>← กลับ CpiPOS AI</Link>
          <div className={styles.eyebrow}>AI STORE DETAIL</div>
          <h2>{data?.tenant.name ?? "CpiPOS AI"}</h2>
          <p>{data?.tenant.code ?? "—"} · Tenant ID: {data?.tenant.id ?? tenantId}</p>
        </div>
        <div className={styles.headerActions}>
          <span className={data?.menu_enabled ? styles.goodBadge : styles.offBadge}>{data?.menu_enabled ? "เมนู AI เปิด" : "เมนู AI ปิด"}</span>
          <button type="button" className={styles.dangerButton} disabled={Boolean(busy)} onClick={() => void clearHistory()}>
            {busy === "history:all" ? "กำลังล้าง…" : "ล้างประวัติทั้งร้าน"}
          </button>
        </div>
      </header>

      {error ? <div className={styles.error} role="alert">{error}</div> : null}

      <section className={styles.summaryGrid}>
        <article><span>แพ็กเกจ</span><strong className={styles.smallStrong}>{data?.package?.name ?? "—"}</strong><small>{data?.contract_status ?? "—"}</small></article>
        <article><span>AI Users / ห้องแชท</span><strong>{fmt(data?.users.length)} / {fmt(data?.rooms.length)}</strong><small>Owner / Manager · OpenAI Conversations</small></article>
        <article><span>คำขอเดือนนี้</span><strong>{fmt(usage?.requests)}</strong><small>{data?.quota.month ?? "—"}</small></article>
        <article><span>Token เดือนนี้</span><strong>{fmt(usage?.total_tokens)}</strong><small>Input {fmt(usage?.input_tokens)} · Output {fmt(usage?.output_tokens)}</small></article>
        <article><span>ต้นทุนเดือนนี้</span><strong className={styles.smallStrong}>{usd(usage?.cost_usd)}</strong><small>Estimated OpenAI cost</small></article>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div><span className={styles.eyebrow}>STORE QUOTA</span><h3>AI Quota ของร้านนี้</h3></div>
          <small>Package default → Tenant override → usage เดือนปัจจุบัน</small>
        </div>
        <div className={styles.quotaLayout}>
          <div className={styles.quotaForm}>
            <label><span>โหมด Quota</span><select value={quotaMode} onChange={(event) => setQuotaMode(event.target.value as typeof quotaMode)}>
              <option value="inherit">ตามแพ็กเกจ</option><option value="custom">กำหนดเฉพาะร้าน</option><option value="unlimited">ไม่จำกัด</option>
            </select></label>
            <label><span>เปิด/ปิด AI Override</span><select value={enabledMode} onChange={(event) => setEnabledMode(event.target.value as typeof enabledMode)}>
              <option value="inherit">ตามแพ็กเกจ</option><option value="enabled">บังคับเปิด</option><option value="disabled">บังคับปิด</option>
            </select></label>
            <label><span>คำขอ / เดือน</span><input disabled={quotaMode !== "custom"} inputMode="numeric" value={requests} onChange={(event) => setRequests(event.target.value.replace(/[^0-9]/g,""))} placeholder="ไม่จำกัด" /></label>
            <label><span>Token / เดือน</span><input disabled={quotaMode !== "custom"} inputMode="numeric" value={tokens} onChange={(event) => setTokens(event.target.value.replace(/[^0-9]/g,""))} placeholder="ไม่จำกัด" /></label>
            <label><span>เก็บประวัติแชท (วัน)</span><input inputMode="numeric" value={retentionDays} onChange={(event) => setRetentionDays(event.target.value.replace(/[^0-9]/g,""))} placeholder="ว่าง = ตามแพ็กเกจ" /></label>
            <label><span>พื้นที่เอกสาร AI (MB)</span><input inputMode="numeric" value={documentStorageMb} onChange={(event) => setDocumentStorageMb(event.target.value.replace(/[^0-9]/g,""))} placeholder="ว่าง = ตามแพ็กเกจ" /></label>
            <label><span>เก็บเอกสาร (วัน)</span><input inputMode="numeric" value={documentRetentionDays} onChange={(event) => setDocumentRetentionDays(event.target.value.replace(/[^0-9]/g,""))} placeholder="ว่าง = ตามแพ็กเกจ" /></label>
            <label><span>ขนาดไฟล์สูงสุด (MB)</span><input inputMode="numeric" value={documentMaxFileMb} onChange={(event) => setDocumentMaxFileMb(event.target.value.replace(/[^0-9]/g,""))} placeholder="ว่าง = ตามแพ็กเกจ" /></label>
            <label className={styles.span2}><span>งบ AI / เดือน (USD)</span><input disabled={quotaMode !== "custom"} inputMode="decimal" value={cost} onChange={(event) => setCost(event.target.value.replace(/[^0-9.]/g,""))} placeholder="ไม่จำกัด" /></label>
            <button type="button" className={styles.primaryButton} disabled={Boolean(busy)} onClick={() => void saveQuota()}>{busy === "quota" ? "กำลังบันทึก…" : "บันทึก Quota ร้าน"}</button>
          </div>
          <div className={styles.quotaStatus}>
            <span>Effective quota</span>
            <strong>{data?.quota.source ?? "—"}</strong>
            <p>Requests: {limits?.requests ? `${fmt(usage?.requests)}/${fmt(limits.requests)}` : "ไม่จำกัด"}</p>
            <p>Tokens: {limits?.tokens ? `${fmt(usage?.total_tokens)}/${fmt(limits.tokens)}` : "ไม่จำกัด"}</p>
            <p>Cost: {limits?.cost_usd ? `${usd(usage?.cost_usd)}/${usd(limits.cost_usd)}` : "ไม่จำกัด"}</p>
            <p>เก็บประวัติ: {data?.quota.history_retention_days ? `${fmt(data.quota.history_retention_days)} วัน` : "ตามสัญญา / ไม่กำหนด"}</p>
            <p>เอกสาร: {data?.quota.documents.storage_limit_mb ? `${fmt(data.quota.documents.storage_limit_mb)} MB` : "ตามแพ็กเกจ/สัญญา"} · {data?.quota.documents.retention_days ? `${fmt(data.quota.documents.retention_days)} วัน` : "ไม่กำหนด"}</p>
            {limits?.requests ? <div className={styles.progress}><i style={{ width: `${requestPercent}%` }} /></div> : null}
          </div>
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div><span className={styles.eyebrow}>AI CHAT ROOMS & IDS</span><h3>ห้องแชทและ OpenAI Conversation ID</h3></div>
          <small>ข้อความเต็มอยู่ฝั่ง OpenAI · CpiPOS เก็บเฉพาะ Room ID / Conversation ID / ชื่อห้อง</small>
        </div>
        <div className={styles.tableWrap}><table>
          <thead><tr><th>ห้องแชท</th><th>ผู้ใช้ / Role</th><th>สาขา</th><th>Room ID</th><th>Conversation ID</th><th>ล่าสุด</th><th /></tr></thead>
          <tbody>{(data?.rooms ?? []).length ? data!.rooms.map((room) => {
            const key = `history:${room.room_id}`;
            return <tr key={room.room_id}>
              <td><div className={styles.storeCell}><strong>{room.room_title}</strong><span>{room.email}</span></div></td>
              <td>{room.full_name}<small className={styles.muted}>{room.role} · {room.user_id}</small></td>
              <td>{room.branch_name}<small className={styles.muted}>{room.branch_id}</small></td>
              <td><code className={styles.code}>{room.room_id}</code></td>
              <td><code className={styles.code}>{room.conversation_id}</code></td>
              <td>{dt(room.last_message_at)}</td>
              <td><button type="button" className={styles.dangerOutlineButton} disabled={Boolean(busy)} onClick={() => void clearHistory(room)}>{busy === key ? "กำลังลบ…" : "ลบห้องแชท"}</button></td>
            </tr>;
          }) : <tr><td colSpan={7} className={styles.empty}>ยังไม่มีห้องแชทของร้านนี้</td></tr>}</tbody>
        </table></div>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeader}><div><span className={styles.eyebrow}>COMMAND LOG</span><h3>คำสั่งที่ผู้ใช้พิมพ์และ Token ต่อคำขอ</h3></div><small>เก็บเฉพาะคำสั่ง + usage ledger; AI reply เต็มยังอยู่ใน OpenAI Conversation</small></div>
        <div className={styles.tableWrap}><table>
          <thead><tr><th>เวลา</th><th>ผู้ใช้</th><th>คำสั่ง</th><th>Model</th><th>Input</th><th>Output</th><th>Total</th><th>Cost</th><th>Response ID</th></tr></thead>
          <tbody>{(data?.events ?? []).length ? data!.events.map((event) => {
            const user = userMap.get(event.user_id);
            return <tr key={event.id}>
              <td>{dt(event.requested_at)}</td>
              <td>{user?.full_name ?? event.user_id}<small className={styles.muted}>{event.user_id}</small></td>
              <td><div className={styles.promptText}>{event.prompt_text ?? "— ล้างประวัติแล้ว —"}</div></td>
              <td>{event.model}</td>
              <td>{fmt(event.input_tokens)}<small className={styles.muted}>cached {fmt(event.cached_input_tokens)}</small></td>
              <td>{fmt(event.output_tokens)}<small className={styles.muted}>reasoning {fmt(event.reasoning_tokens)}</small></td>
              <td>{fmt(event.total_tokens)}</td>
              <td>{usd(event.total_cost_usd)}</td>
              <td><code className={styles.code}>{event.response_id ?? "—"}</code></td>
            </tr>;
          }) : <tr><td colSpan={9} className={styles.empty}>ยังไม่มีการใช้งาน AI ที่บันทึก usage</td></tr>}</tbody>
        </table></div>
      </section>

      <section className={styles.seriesGrid}>
        {(["daily","monthly","yearly"] as const).map((kind) => (
          <article className={styles.panel} key={kind}>
            <div className={styles.panelHeader}><div><span className={styles.eyebrow}>{kind.toUpperCase()}</span><h3>{kind === "daily" ? "สรุปรายวัน" : kind === "monthly" ? "สรุปรายเดือน" : "สรุปรายปี"}</h3></div></div>
            <div className={styles.miniTable}><table><thead><tr><th>ช่วงเวลา</th><th>Requests</th><th>Tokens</th><th>Cost</th></tr></thead>
            <tbody>{(data?.series[kind] ?? []).length ? data!.series[kind].map((row) => <tr key={row.bucket_start}><td>{row.bucket_start}</td><td>{fmt(row.request_count)}</td><td>{fmt(row.total_tokens)}</td><td>{usd(row.total_cost_usd)}</td></tr>) : <tr><td colSpan={4}>ยังไม่มีข้อมูล</td></tr>}</tbody></table></div>
          </article>
        ))}
      </section>
    </div>
  );
}
