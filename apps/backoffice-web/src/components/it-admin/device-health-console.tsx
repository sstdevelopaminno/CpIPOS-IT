"use client";

import { useCallback, useEffect, useState } from "react";
import { DEVICE_COMMAND_TYPES, type DeviceCommandType } from "@/lib/device-commands";

type ApiEnvelope<T> = {
  data: T;
  error: { code?: string; message?: string } | null;
};

type DeviceRow = {
  id: string;
  tenant_id: string;
  branch_id: string;
  device_code: string;
  device_name: string;
  status: string;
};

type HealthRow = {
  status: string;
  summary: unknown;
  machine_id: string;
  app_version: string | null;
  runtime_version: string | null;
  last_seen_at: string;
  captured_at: string;
} | null;

type IncidentRow = {
  id: string;
  code: string;
  severity: string;
  title: string;
  message: string;
  detected_at: string;
  resolved_at: string | null;
};

type CommandRow = {
  id: string;
  command_type: string;
  status: string;
  issued_at: string;
  delivered_at: string | null;
  expires_at: string;
};

type HealthResponse = {
  device: DeviceRow;
  health: HealthRow;
  incidents: IncidentRow[];
  commands: CommandRow[];
};

const thStyle = { textAlign: "left" as const, padding: "8px 10px", borderBottom: "1px solid #e2e8f0", fontSize: 13, color: "#475569" };
const tdStyle = { padding: "8px 10px", borderBottom: "1px solid #f1f5f9", fontSize: 13 };

function formatDateTime(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return date.toLocaleString("en-US", { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as ApiEnvelope<T>;
  if (!response.ok || payload.error) {
    throw new Error(payload.error?.message ?? "Request failed.");
  }
  return payload.data;
}

export function DeviceHealthConsole({ tenantId, deviceId }: { tenantId: string; deviceId: string }) {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/it-admin/v1/devices/${deviceId}/health`, { cache: "no-store" });
      const result = await parseResponse<HealthResponse>(response);
      setData(result);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load device health.");
    } finally {
      setLoading(false);
    }
  }, [deviceId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function issueCommand(commandType: DeviceCommandType) {
    if (!data) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch("/api/it-admin/v1/device-commands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenant_id: tenantId,
          branch_id: data.device.branch_id,
          pos_device_id: deviceId,
          command_type: commandType
        })
      });
      await parseResponse(response);
      setSuccess(`Command "${commandType}" issued.`);
      await load();
    } catch (commandError) {
      setError(commandError instanceof Error ? commandError.message : "Failed to issue command.");
    } finally {
      setBusy(false);
    }
  }

  if (loading && !data) {
    return (
      <section className="surface">
        <p>Loading device health...</p>
      </section>
    );
  }

  if (!data) {
    return (
      <section className="surface">
        <p style={{ color: "#b91c1c" }}>{error ?? "Device not found."}</p>
      </section>
    );
  }

  const { device, health, incidents, commands } = data;

  return (
    <section className="surface" style={{ display: "grid", gap: 16 }}>
      <div>
        <h2 style={{ margin: 0 }}>
          {device.device_name} ({device.device_code})
        </h2>
        <p style={{ margin: "4px 0 0", color: "#475569" }}>
          Status: <strong>{device.status}</strong>
          {health ? ` · Health: ${health.status} · Last seen: ${formatDateTime(health.last_seen_at)}` : " · No heartbeat received yet"}
        </p>
      </div>

      {success ? <p style={{ margin: 0, color: "#047857" }}>{success}</p> : null}
      {error ? <p style={{ margin: 0, color: "#b91c1c" }}>{error}</p> : null}

      <div>
        <h3 style={{ margin: "0 0 8px" }}>Issue command</h3>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {DEVICE_COMMAND_TYPES.map((commandType) => (
            <button
              key={commandType}
              type="button"
              className="pos-monitor-btn"
              disabled={busy}
              onClick={() => void issueCommand(commandType)}
            >
              {commandType}
            </button>
          ))}
        </div>
      </div>

      <div>
        <h3 style={{ margin: "0 0 8px" }}>Recent incidents</h3>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={thStyle}>Severity</th>
                <th style={thStyle}>Title</th>
                <th style={thStyle}>Detected</th>
                <th style={thStyle}>Resolved</th>
              </tr>
            </thead>
            <tbody>
              {incidents.length === 0 ? (
                <tr>
                  <td style={tdStyle} colSpan={4}>
                    No incidents recorded.
                  </td>
                </tr>
              ) : (
                incidents.map((incident) => (
                  <tr key={incident.id}>
                    <td style={tdStyle}>{incident.severity}</td>
                    <td style={tdStyle}>{incident.title}</td>
                    <td style={tdStyle}>{formatDateTime(incident.detected_at)}</td>
                    <td style={tdStyle}>{formatDateTime(incident.resolved_at)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h3 style={{ margin: "0 0 8px" }}>Command history</h3>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={thStyle}>Command</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Issued</th>
                <th style={thStyle}>Delivered</th>
                <th style={thStyle}>Expires</th>
              </tr>
            </thead>
            <tbody>
              {commands.length === 0 ? (
                <tr>
                  <td style={tdStyle} colSpan={5}>
                    No commands issued yet.
                  </td>
                </tr>
              ) : (
                commands.map((command) => (
                  <tr key={command.id}>
                    <td style={tdStyle}>{command.command_type}</td>
                    <td style={tdStyle}>{command.status}</td>
                    <td style={tdStyle}>{formatDateTime(command.issued_at)}</td>
                    <td style={tdStyle}>{formatDateTime(command.delivered_at)}</td>
                    <td style={tdStyle}>{formatDateTime(command.expires_at)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
