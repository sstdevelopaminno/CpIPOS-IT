"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type JsonRecord = Record<string, unknown>;

type Enrollment = {
  id: string;
  tenant_id: string;
  branch_id: string | null;
  device_code: string;
  device_type: string;
  enrollment_status: string;
  trust_level: string;
  approved_at: string | null;
  revoked_at: string | null;
  last_seen_at: string | null;
};

type Command = {
  id: string;
  command_type: string;
  status: string;
  issued_at: string;
  delivered_at: string | null;
  expires_at: string;
  result: JsonRecord | null;
};

type Health = {
  status: string | null;
  machine_id: string | null;
  hostname: string | null;
  app_version: string | null;
  runtime_version: string | null;
  connectivity: JsonRecord | null;
  system_health: JsonRecord | null;
  runtime_health: JsonRecord | null;
  peripheral_health: JsonRecord | null;
  offline_sale_health: JsonRecord | null;
  security_signals: JsonRecord | null;
  last_error: string | null;
  captured_at: string | null;
  last_seen_at: string | null;
};

type PrintAgent = {
  id: string;
  agent_name: string;
  status: string;
  last_seen_at: string | null;
  last_claim_at: string | null;
  app_version: string | null;
  metadata: JsonRecord | null;
};

type LastPrint = {
  id: string;
  printer_id: string | null;
  status: string;
  created_at: string;
  claimed_at: string | null;
  agent_error_code: string | null;
  last_error: string | null;
  updated_at: string;
};

type SupportDevice = {
  id: string;
  tenant_id: string;
  branch_id: string;
  device_code: string;
  device_name: string;
  device_type: string | null;
  status: string;
  is_locked: boolean | null;
  is_active: boolean | null;
  last_seen_at: string | null;
  telemetry_state: "reporting" | "awaiting_heartbeat";
  pairing_state: string;
  print_agent_state: string;
  health: Health | null;
  enrollment: Enrollment | null;
  last_command: Command | null;
  print_agent: PrintAgent | null;
  last_print: LastPrint | null;
};

type SupportPayload = {
  devices: SupportDevice[];
  generated_at: string;
};

type DetailPayload = {
  device: SupportDevice;
  health: Health | null;
  telemetry_state: string;
  incidents: Array<{
    id: string;
    code: string;
    severity: string;
    title: string;
    message: string;
    detected_at: string;
    resolved_at: string | null;
  }>;
  commands: Command[];
};

const COMMANDS = [
  "refresh_config",
  "reload_ui",
  "test_printer",
  "request_diagnostics_bundle",
  "disable_device",
  "enable_device"
] as const;

function fmt(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("th-TH");
}

function pretty(value: unknown) {
  if (!value || (typeof value === "object" && Object.keys(value as object).length === 0)) return "-";
  return JSON.stringify(value, null, 2);
}

function ackText(command: Command | null | undefined) {
  if (!command) return "-";
  const execution = typeof command.result?.execution_status === "string" ? command.result.execution_status : null;
  if (execution) return `${command.status} / ACK: ${execution}`;
  return command.status;
}

export default function DeviceSupportPage() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<SupportPayload | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailPayload | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const [tenantId, setTenantId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [pairingToken, setPairingToken] = useState<string | null>(null);
  const [pairingExpiry, setPairingExpiry] = useState<string | null>(null);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/it-admin/v1/device-support", {
        cache: "no-store",
        credentials: "include"
      });
      const body = (await response.json()) as { data?: SupportPayload; error?: { message?: string } };
      if (!response.ok || body.error || !body.data) throw new Error(body.error?.message ?? "Unable to load device support data.");
      setData(body.data);
      if (!selectedId && body.data.devices.length > 0) setSelectedId(body.data.devices[0].id);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unknown error");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedId]);

  const loadDetail = useCallback(async (deviceId: string) => {
    try {
      const response = await fetch(`/api/it-admin/v1/devices/${encodeURIComponent(deviceId)}/health`, {
        cache: "no-store",
        credentials: "include"
      });
      const body = (await response.json()) as { data?: DetailPayload; error?: { message?: string } };
      if (!response.ok || body.error || !body.data) throw new Error(body.error?.message ?? "Unable to load device health.");
      setDetail(body.data);
    } catch (detailError) {
      setActionMessage(detailError instanceof Error ? detailError.message : "Unable to load device detail.");
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  useEffect(() => {
    if (selectedId) void loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void load(true);
      if (selectedId) void loadDetail(selectedId);
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [load, loadDetail, selectedId]);

  const selected = useMemo(
    () => data?.devices.find((item) => item.id === selectedId) ?? null,
    [data?.devices, selectedId]
  );

  async function createPairingToken() {
    setActionMessage(null);
    setPairingToken(null);
    if (!tenantId.trim() || !branchId.trim()) {
      setActionMessage("กรุณาระบุ Tenant ID และ Branch ID ก่อนสร้าง pairing token");
      return;
    }
    const response = await fetch("/api/it-admin/v1/activation-tokens", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tenant_id: tenantId.trim(),
        branch_id: branchId.trim(),
        token_type: "pos_terminal",
        purpose: "device_activation",
        expires_in_minutes: 15,
        metadata: { source: "it_device_support_console", agent_pairing: true }
      })
    });
    const body = (await response.json()) as {
      data?: { activation_token?: string; expires_at?: string };
      error?: { message?: string };
    };
    if (!response.ok || body.error || !body.data?.activation_token) {
      setActionMessage(body.error?.message ?? "สร้าง pairing token ไม่สำเร็จ");
      return;
    }
    setPairingToken(body.data.activation_token);
    setPairingExpiry(body.data.expires_at ?? null);
    setActionMessage("สร้าง pairing token สำเร็จ — token แสดงครั้งเดียวและไม่ถูกเก็บเป็น plaintext");
  }

  async function loadEnrollments() {
    setActionMessage(null);
    if (!tenantId.trim()) {
      setActionMessage("กรุณาระบุ Tenant ID");
      return;
    }
    const query = new URLSearchParams({ tenant_id: tenantId.trim() });
    if (branchId.trim()) query.set("branch_id", branchId.trim());
    const response = await fetch(`/api/it-admin/v1/device-enrollments?${query.toString()}`, {
      cache: "no-store",
      credentials: "include"
    });
    const body = (await response.json()) as { data?: { enrollments?: Enrollment[] }; error?: { message?: string } };
    if (!response.ok || body.error) {
      setActionMessage(body.error?.message ?? "โหลด enrollment ไม่สำเร็จ");
      return;
    }
    setEnrollments(body.data?.enrollments ?? []);
  }

  async function approveEnrollment(id: string) {
    setActionMessage(null);
    const response = await fetch(`/api/it-admin/v1/device-enrollments/${encodeURIComponent(id)}/approve`, {
      method: "POST",
      credentials: "include"
    });
    const body = (await response.json()) as { error?: { message?: string } };
    if (!response.ok || body.error) {
      setActionMessage(body.error?.message ?? "Approve enrollment ไม่สำเร็จ");
      return;
    }
    setActionMessage("Approve device enrollment สำเร็จ");
    await loadEnrollments();
    await load(true);
  }

  async function issueCommand(commandType: (typeof COMMANDS)[number]) {
    if (!selected) return;
    setActionMessage(null);
    const response = await fetch("/api/it-admin/v1/device-commands", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tenant_id: selected.tenant_id,
        branch_id: selected.branch_id,
        pos_device_id: selected.id,
        command_type: commandType
      })
    });
    const body = (await response.json()) as { data?: { command?: Command }; error?: { message?: string } };
    if (!response.ok || body.error) {
      setActionMessage(body.error?.message ?? "ส่ง remote command ไม่สำเร็จ");
      return;
    }
    setActionMessage(`ส่ง ${commandType} แล้ว: ${body.data?.command?.status ?? "queued"}`);
    await loadDetail(selected.id);
    await load(true);
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <section className="surface" style={{ padding: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <h2 style={{ margin: 0 }}>Device Enrollment / MDM Support</h2>
            <p style={{ marginBottom: 0, opacity: 0.75 }}>
              Pair Android/Print Agent, ดู CPU/RAM/storage และแยก Print Agent heartbeat/last print/error พร้อมติดตาม Remote Command → ACK
            </p>
          </div>
          <button type="button" onClick={() => void load(false)} disabled={loading || refreshing}>
            {loading || refreshing ? "กำลังรีเฟรช..." : "รีเฟรช"}
          </button>
        </div>
        {error ? <p style={{ color: "crimson" }}>{error}</p> : null}
        {actionMessage ? <p>{actionMessage}</p> : null}
      </section>

      <section className="surface" style={{ padding: 18 }}>
        <h3 style={{ marginTop: 0 }}>1. Android / Print Agent Pairing</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 10 }}>
          <label>
            Tenant ID
            <input value={tenantId} onChange={(event) => setTenantId(event.target.value)} style={{ width: "100%" }} />
          </label>
          <label>
            Branch ID
            <input value={branchId} onChange={(event) => setBranchId(event.target.value)} style={{ width: "100%" }} />
          </label>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          <button type="button" onClick={() => void createPairingToken()}>สร้าง Pairing Token 15 นาที</button>
          <button type="button" onClick={() => void loadEnrollments()}>โหลด Enrollment</button>
        </div>
        {pairingToken ? (
          <div style={{ marginTop: 12, padding: 12, border: "1px solid currentColor", borderRadius: 8 }}>
            <strong>One-time token</strong>
            <div style={{ overflowWrap: "anywhere", fontFamily: "monospace", marginTop: 6 }}>{pairingToken}</div>
            <small>หมดอายุ: {fmt(pairingExpiry)}</small>
          </div>
        ) : null}
        {enrollments.length > 0 ? (
          <div style={{ overflowX: "auto", marginTop: 14 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr><th>Device</th><th>Type</th><th>Status</th><th>Trust</th><th>Last seen</th><th>Action</th></tr></thead>
              <tbody>
                {enrollments.map((item) => (
                  <tr key={item.id}>
                    <td>{item.device_code}</td><td>{item.device_type}</td><td>{item.enrollment_status}</td><td>{item.trust_level}</td><td>{fmt(item.last_seen_at)}</td>
                    <td>{item.enrollment_status === "pending" ? <button type="button" onClick={() => void approveEnrollment(item.id)}>Approve</button> : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section className="surface" style={{ padding: 18 }}>
        <h3 style={{ marginTop: 0 }}>2. Customer Devices</h3>
        {loading && !data ? <p>กำลังโหลด...</p> : null}
        <div style={{ display: "grid", gridTemplateColumns: "minmax(260px,0.8fr) minmax(0,2fr)", gap: 14 }}>
          <div style={{ display: "grid", gap: 8, alignContent: "start" }}>
            {(data?.devices ?? []).map((device) => (
              <button
                type="button"
                key={device.id}
                onClick={() => setSelectedId(device.id)}
                style={{ textAlign: "left", padding: 10, border: selectedId === device.id ? "2px solid currentColor" : "1px solid #999", borderRadius: 8 }}
              >
                <strong>{device.device_code}</strong><br />
                <small>{device.device_name} · {device.status}</small><br />
                <small>Pair: {device.pairing_state} · Telemetry: {device.telemetry_state}</small><br />
                <small>Print Agent: {device.print_agent_state}</small>
              </button>
            ))}
            {!loading && (data?.devices.length ?? 0) === 0 ? <p>ยังไม่มี device registry ใน CpiPOS-002</p> : null}
          </div>

          <div>
            {selected ? (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <h3 style={{ marginTop: 0 }}>{selected.device_code}</h3>
                    <div>Tenant: {selected.tenant_id}</div>
                    <div>Branch: {selected.branch_id}</div>
                    <div>Registry: {selected.status} {selected.is_locked ? "· LOCKED" : ""}</div>
                    <div>Registry last seen: {fmt(selected.last_seen_at)}</div>
                  </div>
                  <div>
                    <div><strong>Telemetry:</strong> {detail?.telemetry_state ?? selected.telemetry_state}</div>
                    <div><strong>Health:</strong> {detail?.health?.status ?? selected.health?.status ?? "no data"}</div>
                    <div><strong>Health last seen:</strong> {fmt(detail?.health?.last_seen_at ?? selected.health?.last_seen_at)}</div>
                    <div><strong>Print Agent:</strong> {selected.print_agent_state}</div>
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 10, marginTop: 14 }}>
                  <article><strong>Identity / Version</strong><pre style={{ whiteSpace: "pre-wrap" }}>{pretty({ machine_id: detail?.health?.machine_id, hostname: detail?.health?.hostname, app_version: detail?.health?.app_version, runtime_version: detail?.health?.runtime_version })}</pre></article>
                  <article><strong>CPU / RAM / Storage</strong><pre style={{ whiteSpace: "pre-wrap" }}>{pretty(detail?.health?.system_health)}</pre></article>
                  <article><strong>Runtime / Errors</strong><pre style={{ whiteSpace: "pre-wrap" }}>{pretty({ runtime: detail?.health?.runtime_health, last_error: detail?.health?.last_error })}</pre></article>
                  <article><strong>Printer / Peripheral</strong><pre style={{ whiteSpace: "pre-wrap" }}>{pretty(detail?.health?.peripheral_health)}</pre></article>
                  <article><strong>Print Agent</strong><pre style={{ whiteSpace: "pre-wrap" }}>{pretty(selected.print_agent ? { state: selected.print_agent_state, agent_name: selected.print_agent.agent_name, status: selected.print_agent.status, app_version: selected.print_agent.app_version, last_seen_at: selected.print_agent.last_seen_at, last_claim_at: selected.print_agent.last_claim_at, metadata: selected.print_agent.metadata } : { state: selected.print_agent_state })}</pre></article>
                  <article><strong>Last Print / Error</strong><pre style={{ whiteSpace: "pre-wrap" }}>{pretty(selected.last_print ? { status: selected.last_print.status, printer_id: selected.last_print.printer_id, created_at: selected.last_print.created_at, claimed_at: selected.last_print.claimed_at, updated_at: selected.last_print.updated_at, agent_error_code: selected.last_print.agent_error_code, last_error: selected.last_print.last_error } : null)}</pre></article>
                  <article><strong>Connectivity</strong><pre style={{ whiteSpace: "pre-wrap" }}>{pretty(detail?.health?.connectivity)}</pre></article>
                  <article><strong>Offline Sale Sync</strong><pre style={{ whiteSpace: "pre-wrap" }}>{pretty(detail?.health?.offline_sale_health)}</pre></article>
                </div>

                <h4>Remote Commands</h4>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {COMMANDS.map((command) => (
                    <button key={command} type="button" onClick={() => void issueCommand(command)}>{command}</button>
                  ))}
                </div>

                <h4>Command / ACK History</h4>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead><tr><th>Command</th><th>Status / ACK</th><th>Issued</th><th>Result</th></tr></thead>
                    <tbody>
                      {(detail?.commands ?? []).map((command) => (
                        <tr key={command.id}>
                          <td>{command.command_type}</td><td>{ackText(command)}</td><td>{fmt(command.issued_at)}</td><td><pre style={{ whiteSpace: "pre-wrap" }}>{pretty(command.result)}</pre></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <h4>Incidents</h4>
                {(detail?.incidents ?? []).length === 0 ? <p>ไม่มี warning/critical incident ที่บันทึกไว้</p> : (
                  <ul>
                    {(detail?.incidents ?? []).map((incident) => (
                      <li key={incident.id}><strong>{incident.severity.toUpperCase()}</strong> {incident.title} — {incident.message} ({fmt(incident.detected_at)})</li>
                    ))}
                  </ul>
                )}
              </>
            ) : <p>เลือกอุปกรณ์เพื่อดูรายละเอียด</p>}
          </div>
        </div>
      </section>
    </div>
  );
}
