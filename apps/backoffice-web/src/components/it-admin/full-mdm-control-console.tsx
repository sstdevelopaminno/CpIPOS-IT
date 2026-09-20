"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { MdmCommandType } from "@/lib/mdm/eligibility";
import styles from "./full-mdm-control-console.module.css";

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

export function FullMdmControlConsole({ tenantId, deviceId }: { tenantId: string; deviceId: string }) {
  const [data, setData] = useState<MdmPayload | null>(null);
  const [lastRefreshTime, setLastRefreshTime] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyCommand, setBusyCommand] = useState<MdmCommandType | null>(null);
  const [reason, setReason] = useState("");
  const [packageName, setPackageName] = useState("");
  const [remoteSupportMode, setRemoteSupportMode] = useState<"attended" | "company_kiosk">("attended");
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
      setLastRefreshTime(Date.now());
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
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(true);
    }, 30_000);
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

    if (control.commandType === "install_app" || control.commandType === "uninstall_app") {
      if (!/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)+$/.test(packageName.trim())) {
        setError("Enter a valid Android package name, e.g. com.example.app.");
        return;
      }
    }
    if (control.requiresOwnerApproval && !window.confirm(`Confirm ${control.label} for ${deviceId}? This records an IT operator confirmation, not a second-person approval.`)) {
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
      if (control.commandType === "start_remote_support") {
        payload.sessionMode = remoteSupportMode;
        payload.ttlMinutes = 30;
      }
      if (control.commandType === "install_app" || control.commandType === "uninstall_app") {
        payload.packageName = packageName.trim();
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
      if (control.commandType === "install_app" || control.commandType === "uninstall_app") setPackageName("");
      await load(true);
    } catch (commandError) {
      setError(commandError instanceof Error ? commandError.message : "Failed to queue Full MDM command.");
    } finally {
      setBusyCommand(null);
    }
  }

  if (loading && !data) {
    return <section className={styles.empty}><h3>Full MDM Control Plane</h3><small>Loading Full MDM state...</small></section>;
  }

  if (!data) {
    return (
      <section className={styles.empty}>
        <h3>Full MDM Control Plane</h3>
        <p>{error ?? "This device has not advertised the Full MDM registry contract yet."}</p>
        <small>A trusted enrollment plus Android 1.0.23 heartbeat is required before managed controls can appear.</small>
      </section>
    );
  }

  const { device, controls, commands } = data;
  const heartbeatTime = device.last_heartbeat_at ? Date.parse(device.last_heartbeat_at) : Number.NaN;
  const heartbeatAge = lastRefreshTime === null ? Number.NaN : lastRefreshTime - heartbeatTime;
  const recentlySeen = Number.isFinite(heartbeatAge) && heartbeatAge >= 0 && heartbeatAge <= 120_000;
  const eligible = device.is_full_mdm_eligible && data.banner.tone === "success";
  const connected = eligible && recentlySeen;

  return (
    <section className={styles.console}>
      <header className={styles.header}>
        <div>
          <h3>Full MDM Control Plane</h3>
          <p>{data.banner.message}</p>
          <p>Authority: {data.control_plane.authority} · Last heartbeat: {formatDateTime(device.last_heartbeat_at)}</p>
        </div>
        <span className={`${styles.connectionBadge} ${connected ? styles.connected : styles.limited}`}>
          <span className={styles.dot}/>
          {connected ? "MDM online" : eligible ? "MDM offline / stale" : "Diagnostics only"}
        </span>
      </header>

      <div className={styles.deviceGrid}>
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
          <div key={label} className={styles.deviceCard}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <h4>Managed controls</h4>
            <p>ปุ่มที่ใช้ไม่ได้จะถูกปิดตาม ownership, Device Owner และ capability จริงของเครื่อง</p>
          </div>
          <button type="button" className={styles.refreshButton} disabled={busyCommand !== null} onClick={() => void load(false)}>Refresh MDM</button>
        </div>

        <label className={styles.reason}>
          <span>Reason for sensitive action</span>
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Required for lock, uninstall, location, remote support, etc."
            disabled={busyCommand !== null}
          />
        </label>

        {controls.some((control) => control.enabled && (control.commandType === "install_app" || control.commandType === "uninstall_app")) ? (
          <label className={styles.reason}>
            <span>Android package name (for install / uninstall)</span>
            <input value={packageName} onChange={(event) => setPackageName(event.target.value)}
              placeholder="com.example.app" autoCapitalize="off" autoComplete="off" spellCheck={false}
              disabled={busyCommand !== null} />
          </label>
        ) : null}
        {controls.some((control) => control.enabled && control.commandType === "start_remote_support") ? (
          <label className={styles.reason}>
            <span>Remote support session mode</span>
            <select value={remoteSupportMode}
              onChange={(event) => setRemoteSupportMode(event.target.value as "attended" | "company_kiosk")}
              disabled={busyCommand !== null}>
              <option value="attended">Attended (screen-sharing permission required on Android)</option>
              <option value="company_kiosk">Company-owned kiosk (only if provisioned and supported)</option>
            </select>
          </label>
        ) : null}
        <div className={styles.controls}>
          {controls.map((control) => {
            const latest = commandByType.get(control.commandType);
            const title = control.enabled
              ? `${control.label}${latest ? ` · latest ${latest.status}` : ""}`
              : `${control.label} disabled: ${control.disabledReason ?? "not allowed"}`;
            return (
              <button
                key={control.commandType}
                type="button"
                className={styles.controlButton}
                disabled={!control.enabled || busyCommand !== null}
                title={title}
                onClick={() => void issue(control)}
              >
                {busyCommand === control.commandType ? "Queuing..." : control.label}
              </button>
            );
          })}
        </div>
        <p className={styles.help}>
          การเชื่อมต่อ/ยกเลิกการเชื่อมต่อ MDM จัดการจาก Device enrollment & pairing; หน้านี้ใช้ควบคุมเครื่องที่ผ่าน enrollment แล้วเท่านั้น · Queued ไม่ใช่คำสั่งที่ทำสำเร็จ ต้องดู completed / ACK ของเครื่อง · Remote screen sharing ต้องขอสิทธิ์ตามระบบ Android
        </p>
      </section>

      {success ? <p className={`${styles.notice} ${styles.success}`}>{success}</p> : null}
      {error ? <p className={`${styles.notice} ${styles.error}`}>{error}</p> : null}

      <section className={styles.section}>
        <div className={styles.sectionHeader}><div><h4>Full MDM queue / ACK</h4><p>สถานะคำสั่งตั้งแต่ queue จนเครื่องรับและตอบกลับ</p></div></div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr><th>Command</th><th>Status</th><th>Queued</th><th>Picked up</th><th>Finished</th><th>Result</th></tr>
            </thead>
            <tbody>
              {commands.length === 0 ? (
                <tr><td colSpan={6}>No Full MDM commands yet.</td></tr>
              ) : commands.map((command) => (
                <tr key={command.id}>
                  <td>{command.command_type}</td>
                  <td><span className={styles.statusPill}>{command.status}</span></td>
                  <td>{formatDateTime(command.queued_at)}</td>
                  <td>{formatDateTime(command.picked_up_at)}</td>
                  <td>{formatDateTime(command.completed_at ?? command.failed_at)}</td>
                  <td className={styles.result}>{compactJson(command.command_result)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
