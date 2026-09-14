"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { MdmCommandType } from "@/lib/mdm/eligibility";

type ApiEnvelope<T> = {
  data: T;
  error: { code?: string; message?: string } | null;
};

type ControlState = {
  commandType: MdmCommandType;
  label: string;
  enabled: boolean;
  mode: "full_mdm" | "diagnostics_only";
  disabledReason?: string;
  requiresReason: boolean;
  requiresOwnerApproval: boolean;
};

type MdmDevice = {
  tenant_id: string;
  device_id: string;
  display_name: string | null;
  platform: string;
  app_version: string;
  app_flavor: string;
  native_generation: string | null;
  ownership_type: string;
  enrollment_mode: string;
  is_device_owner: boolean;
  is_full_mdm_eligible: boolean;
  capabilities: string[];
  last_heartbeat_at: string | null;
};

type CommandRow = {
  id: string;
  command_type: MdmCommandType;
  status: string;
  reason: string | null;
  queued_at: string;
  picked_up_at: string | null;
  completed_at: string | null;
  failed_at: string | null;
  expires_at: string | null;
  command_result: unknown;
};

type MdmPayload = {
  device: MdmDevice;
  banner: { tone: "success" | "warning"; message: string };
  controls: ControlState[];
  commands: CommandRow[];
  control_plane: { authority: string };
};

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
}

function compactJson(value: unknown) {
  if (value === null || value === undefined) return "-";
  try {
    const encoded = JSON.stringify(value);
    return encoded.length > 180 ? `${encoded.slice(0, 177)}...` : encoded;
  } catch {
    return String(value);
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (!response.ok || !payload?.data || payload.error) {
    throw new Error(payload?.error?.message ?? `Request failed (${response.status}).`);
  }
  return payload.data;
}

const tdStyle = { padding: "8px 10px", borderBottom: "1px solid #f1f5f9", fontSize: 13, verticalAlign: "top" as const };
const thStyle = { ...tdStyle, color: "#475569", textAlign: "left" as const, borderBottom: "1px solid #e2e8f0" };

export function FullMdmControlConsole({ tenantId, deviceId }: { tenantId: string; deviceId: string }) {
  const [data, setData] = useState<MdmPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyCommand, setBusyCommand] = useState<MdmCommandType | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({ tenant_id: tenantId, device_id: deviceId });
      const response = await fetch(`/api/it-admin/v1/mdm/commands?${query.toString()}`, {
        cache: "no-store",
        credentials: "include"
      });
      const payload = await parseResponse<MdmPayload>(response);
      setData(payload);
    } catch (loadError) {
      setData(null);
      setError(loadError instanceof Error ? loadError.message : "Full MDM state is unavailable.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [tenantId, deviceId]);

  useEffect(() => {
    void load(false);
    const timer = window.setInterval(() => void load(true), 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const commandByType = useMemo(() => {
    const map = new Map<MdmCommandType, CommandRow>();
    for (const command of data?.commands ?? []) {
      if (!map.has(command.command_type)) map.set(command.command_type, command);
    }
    return map;
  }, [data?.commands]);

  async function issue(control: ControlState) {
    if (!data || !control.enabled) return;
    const cleanReason = reason.trim();
    if (control.requiresReason && cleanReason.length < 8) {
      setError("Sensitive MDM commands require a reason of at least 8 characters.");
      return;
    }

    setBusyCommand(control.commandType);
    setError(null);
    setSuccess(null);
    try {
      const payload: Record<string, unknown> = {};
      if (control.commandType === "sync_policy") {
        payload.policy_generation = new Date().toISOString();
      }

      const response = await fetch("/api/it-admin/v1/mdm/commands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          tenant_id: tenantId,
          device_id: deviceId,
          command_type: control.commandType,
          reason: cleanReason || undefined,
          payload,
          ttl_minutes: 30
        })
      });
      await parseResponse(response);
      setSuccess(`Queued Full MDM command: ${control.commandType}. Waiting for device pickup / ACK.`);
      setReason("");
      await load(true);
    } catch (commandError) {
      setError(commandError instanceof Error ? commandError.message : "Failed to queue Full MDM command.");
    } finally {
      setBusyCommand(null);
    }
  }

  if (loading && !data) {
    return <section className="surface"><p>Loading Full MDM state...</p></section>;
  }

  if (!data) {
    return (
      <section className="surface" style={{ display: "grid", gap: 8 }}>
        <h3 style={{ margin: 0 }}>Full MDM Control Plane</h3>
        <p style={{ margin: 0, color: "#92400e" }}>
          {error ?? "This device has not advertised the Full MDM registry contract yet."}
        </p>
        <p style={{ margin: 0, color: "#64748b", fontSize: 13 }}>
          A trusted enrollment plus Android 1.0.23 heartbeat is required before managed controls can appear.
        </p>
      </section>
    );
  }

  const { device, controls, commands } = data;

  return (
    <section className="surface" style={{ display: "grid", gap: 14 }}>
      <div>
        <h3 style={{ margin: 0 }}>Full MDM Control Plane</h3>
        <p style={{ margin: "4px 0 0", color: data.banner.tone === "success" ? "#047857" : "#92400e" }}>
          {data.banner.message}
        </p>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: "#64748b" }}>
          Authority: {data.control_plane.authority} · Last heartbeat: {formatDateTime(device.last_heartbeat_at)}
        </p>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {[
          ["Platform", device.platform],
          ["App", device.app_version],
          ["Flavor", device.app_flavor],
          ["Ownership", device.ownership_type],
          ["Enrollment", device.enrollment_mode],
          ["Device Owner", device.is_device_owner ? "Yes" : "No"],
          ["Full MDM", device.is_full_mdm_eligible ? "Eligible" : "Blocked"],
          ["Capabilities", device.capabilities.length ? device.capabilities.join(", ") : "None"]
        ].map(([label, value]) => (
          <div key={label} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: 9, minWidth: 150, background: "#fff" }}>
            <div style={{ fontSize: 12, color: "#64748b" }}>{label}</div>
            <strong style={{ fontSize: 13 }}>{value}</strong>
          </div>
        ))}
      </div>

      <label style={{ display: "grid", gap: 4 }}>
        <span style={{ fontSize: 13, color: "#475569" }}>Reason for sensitive action</span>
        <input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Required for lock, uninstall, location, remote support, etc."
          disabled={busyCommand !== null}
        />
      </label>

      <div>
        <h4 style={{ margin: "0 0 8px" }}>Managed controls</h4>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {controls.map((control) => {
            const latest = commandByType.get(control.commandType);
            const title = control.enabled
              ? `${control.label}${latest ? ` · latest ${latest.status}` : ""}`
              : `${control.label} disabled: ${control.disabledReason ?? "not allowed"}`;
            return (
              <button
                key={control.commandType}
                type="button"
                className="pos-monitor-btn"
                disabled={!control.enabled || busyCommand !== null}
                title={title}
                onClick={() => void issue(control)}
              >
                {busyCommand === control.commandType ? "Queuing..." : control.label}
              </button>
            );
          })}
          <button type="button" className="pos-monitor-btn" disabled={busyCommand !== null} onClick={() => void load(false)}>
            Refresh MDM
          </button>
        </div>
        <p style={{ margin: "8px 0 0", fontSize: 12, color: "#64748b" }}>
          Disabled buttons are intentional. The server enables a command only when ownership, Device Owner enrollment and the native agent capability all match.
        </p>
      </div>

      {success ? <p style={{ margin: 0, color: "#047857" }}>{success}</p> : null}
      {error ? <p style={{ margin: 0, color: "#b91c1c" }}>{error}</p> : null}

      <div>
        <h4 style={{ margin: "0 0 8px" }}>Full MDM queue / ACK</h4>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr><th style={thStyle}>Command</th><th style={thStyle}>Status</th><th style={thStyle}>Queued</th><th style={thStyle}>Picked up</th><th style={thStyle}>Finished</th><th style={thStyle}>Result</th></tr>
            </thead>
            <tbody>
              {commands.length === 0 ? (
                <tr><td style={tdStyle} colSpan={6}>No Full MDM commands yet.</td></tr>
              ) : commands.map((command) => (
                <tr key={command.id}>
                  <td style={tdStyle}>{command.command_type}</td>
                  <td style={tdStyle}>{command.status}</td>
                  <td style={tdStyle}>{formatDateTime(command.queued_at)}</td>
                  <td style={tdStyle}>{formatDateTime(command.picked_up_at)}</td>
                  <td style={tdStyle}>{formatDateTime(command.completed_at ?? command.failed_at)}</td>
                  <td style={tdStyle}>{compactJson(command.command_result)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
