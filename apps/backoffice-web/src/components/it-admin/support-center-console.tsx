"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Language } from "@/lib/i18n";
import type { SupportCenterSnapshot, SupportDevice } from "@/lib/services/it-admin/support-center-service";
import styles from "./support-center-console.module.css";

type ApiEnvelope = {
  data: { snapshot?: SupportCenterSnapshot } | null;
  error: { code?: string; message?: string } | null;
};

type Tone = "ok" | "warn" | "danger" | "muted";

function statusTone(status: string): Tone {
  if (["healthy", "live", "active", "online", "ready"].includes(status)) return "ok";
  if (["degraded", "stale", "warning", "retrying", "pending"].includes(status)) return "warn";
  if (["critical", "offline", "failed", "locked", "inactive"].includes(status)) return "danger";
  return "muted";
}

function formatDate(value: string | null, language: Language) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-GB", {
    timeZone: "Asia/Bangkok",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(date);
}

function formatAge(seconds: number | null, language: Language) {
  if (seconds == null) return language === "th" ? "ไม่เคยพบ" : "Never seen";
  if (seconds < 60) return language === "th" ? `${seconds} วินาที` : `${seconds}s`;
  if (seconds < 3600) return language === "th" ? `${Math.floor(seconds / 60)} นาที` : `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return language === "th" ? `${Math.floor(seconds / 3600)} ชม.` : `${Math.floor(seconds / 3600)}h`;
  return language === "th" ? `${Math.floor(seconds / 86400)} วัน` : `${Math.floor(seconds / 86400)}d`;
}

function StatusBadge({ value, label }: { value: string; label?: string }) {
  const tone = statusTone(value);
  return <span className={`${styles.statusBadge} ${styles[`tone_${tone}`]}`}>{label ?? value}</span>;
}

function MetricCard({ label, value, detail, tone = "muted" }: { label: string; value: string | number; detail: string; tone?: Tone }) {
  return (
    <div className={`${styles.metricCard} ${styles[`metric_${tone}`]}`}>
      <div className={styles.metricLabel}>{label}</div>
      <div className={styles.metricValue}>{value}</div>
      <div className={styles.metricDetail}>{detail}</div>
    </div>
  );
}

function DeviceMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.deviceMetric}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function DeviceRow({ device, tenantId, language }: { device: SupportDevice; tenantId: string; language: Language }) {
  const labels = language === "th"
    ? { online: "สด", stale: "ช้า", offline: "ออฟไลน์", never_seen: "ไม่เคยพบ", open: "เปิดรายละเอียด", locked: "ล็อก" }
    : { online: "Live", stale: "Stale", offline: "Offline", never_seen: "Never seen", open: "Open details", locked: "Locked" };

  return (
    <article className={styles.deviceCard}>
      <div className={styles.deviceHeader}>
        <div>
          <div className={styles.deviceTitleRow}>
            <strong>{device.device_name}</strong>
            <StatusBadge value={device.effective_status} />
            {device.is_locked ? <StatusBadge value="locked" label={labels.locked} /> : null}
          </div>
          <div className={styles.deviceMeta}>
            {device.branch_name ?? "—"} · {device.device_code} · {device.telemetry_profile}
          </div>
        </div>
        <div className={styles.deviceHeartbeat}>
          <span className={`${styles.heartbeatDot} ${styles[`dot_${statusTone(device.connection_state)}`]}`} />
          <div>
            <strong>{labels[device.connection_state === "live" ? "online" : device.connection_state]}</strong>
            <span>{formatAge(device.last_seen_age_seconds, language)}</span>
          </div>
        </div>
      </div>

      <div className={styles.deviceMetrics}>
        <DeviceMetric label="OS" value={[device.platform, device.os_version].filter(Boolean).join(" ") || "—"} />
        <DeviceMetric label="App" value={device.app_version ?? "—"} />
        <DeviceMetric label="CPU" value={device.cpu_percent == null ? "—" : `${device.cpu_percent.toFixed(0)}%`} />
        <DeviceMetric label="RAM" value={device.memory_percent == null ? "—" : `${device.memory_percent.toFixed(0)}%`} />
        <DeviceMetric label="Disk" value={device.disk_free_gb == null ? "—" : `${device.disk_free_gb.toFixed(1)} GB`} />
        <DeviceMetric label="Battery" value={device.battery_percent == null ? "—" : `${device.battery_percent.toFixed(0)}%`} />
      </div>

      <div className={styles.deviceFooter}>
        <div className={styles.incidentSummary}>
          {device.primary_incident ? (
            <>
              <span className={`${styles.incidentMarker} ${styles[`marker_${device.primary_incident.severity}`]}`} />
              <div>
                <strong>{device.primary_incident.title}</strong>
                <span>{device.primary_incident.message}</span>
              </div>
            </>
          ) : (
            <>
              <span className={`${styles.incidentMarker} ${styles.marker_info}`} />
              <div>
                <strong>{language === "th" ? "ไม่พบ incident ปัจจุบัน" : "No current incident"}</strong>
                <span>{language === "th" ? "สถานะล่าสุดผ่านเกณฑ์ MDM" : "Latest telemetry passes the MDM rules"}</span>
              </div>
            </>
          )}
        </div>
        <Link href={`/tenants/${tenantId}/devices/${device.id}`} className={styles.textAction}>{labels.open} →</Link>
      </div>
    </article>
  );
}

export function SupportCenterConsole({ language }: { language: Language }) {
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [snapshot, setSnapshot] = useState<SupportCenterSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latestQueryRef = useRef("");

  const copy = language === "th"
    ? {
        title: "ศูนย์บริการลูกค้า 24/7",
        subtitle: "ค้นหาด้วยรหัสร้าน แล้วตรวจ POS, MDM, Print, KDS และสถานะการใช้งานของร้านเดียวในหน้าจอเดียว",
        input: "รหัสร้าน 6 หลัก หรือ Tenant Code",
        search: "เปิดร้าน",
        refreshing: "กำลังอัปเดต",
        refreshed: "อัปเดตอัตโนมัติทุก 30 วินาที",
        emptyTitle: "เริ่มจากรหัสร้านของลูกค้า",
        emptyText: "ระบบจะ scope ข้อมูลตาม tenant ก่อนอ่านสาขา เครื่อง POS และเหตุขัดข้อง เพื่อป้องกันข้อมูลข้ามร้าน",
        customer: "ข้อมูลลูกค้า",
        operations: "สถานะปฏิบัติการ",
        devices: "เครื่อง POS / MDM",
        incidents: "Incident ที่ต้องดูแล",
        printing: "Printing & Kitchen",
        activeSessions: "Session ที่ใช้งาน",
        openShifts: "กะที่เปิดอยู่",
        liveDevices: "เครื่อง Live",
        attention: "เครื่องต้องตรวจ",
        printQueue: "Print ค้าง/Retry",
        owner: "ผู้ดูแลร้าน",
        subscription: "สิทธิ์ใช้งาน",
        access: "การเข้าถึง",
        generated: "ข้อมูล ณ",
        noIncident: "ไม่พบ incident จาก telemetry ปัจจุบัน",
        recentFailures: "งานพิมพ์ที่ล้มเหลว/Retry ล่าสุด",
        noPrintFailures: "ไม่มีงานพิมพ์ failed/retrying ที่ค้างอยู่",
        storesafe: "Store code ใช้ค้นหาเท่านั้น การอนุญาตยังตรวจจาก IT role บน server"
      }
    : {
        title: "24/7 Customer Support Center",
        subtitle: "Open a store by code and inspect POS, MDM, print, KDS and live operations in one workspace.",
        input: "6-digit store code or Tenant Code",
        search: "Open store",
        refreshing: "Refreshing",
        refreshed: "Auto-refresh every 30 seconds",
        emptyTitle: "Start with the customer store code",
        emptyText: "Every read is scoped to the resolved tenant before branches, POS devices and incidents are loaded.",
        customer: "Customer profile",
        operations: "Operations status",
        devices: "POS / MDM devices",
        incidents: "Incidents requiring attention",
        printing: "Printing & Kitchen",
        activeSessions: "Active sessions",
        openShifts: "Open shifts",
        liveDevices: "Live devices",
        attention: "Devices to inspect",
        printQueue: "Print pending/retry",
        owner: "Store owner",
        subscription: "Subscription",
        access: "Access",
        generated: "Snapshot at",
        noIncident: "No incident from current telemetry",
        recentFailures: "Recent failed/retrying print jobs",
        noPrintFailures: "No failed or retrying print jobs are currently queued",
        storesafe: "Store code is lookup-only; server-side IT role authorization remains mandatory"
      };

  const loadStore = useCallback(async (code: string, silent = false) => {
    const normalized = code.trim();
    if (!normalized) return;
    latestQueryRef.current = normalized;
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/it-admin/v1/support/store?code=${encodeURIComponent(normalized)}`, {
        method: "GET",
        cache: "no-store",
        headers: { accept: "application/json" }
      });
      const payload = (await response.json()) as ApiEnvelope;
      if (!response.ok || payload.error || !payload.data?.snapshot) {
        throw new Error(payload.error?.message ?? `Support API returned ${response.status}`);
      }
      if (latestQueryRef.current !== normalized) return;
      setSnapshot(payload.data.snapshot);
      setActiveQuery(normalized);
    } catch (err) {
      if (latestQueryRef.current !== normalized) return;
      setError(err instanceof Error ? err.message : "Support lookup failed");
      if (!silent) setSnapshot(null);
    } finally {
      if (latestQueryRef.current === normalized) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!activeQuery) return;
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadStore(activeQuery, true);
    }, 30_000);
    return () => window.clearInterval(interval);
  }, [activeQuery, loadStore]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void loadStore(query, false);
  }

  const attentionCount = useMemo(
    () => snapshot?.devices.filter((device) => device.effective_status === "critical" || device.effective_status === "degraded" || device.effective_status === "offline").length ?? 0,
    [snapshot]
  );

  return (
    <div className={styles.console}>
      <section className={styles.hero}>
        <div>
          <div className={styles.kicker}>SERVICE DESK / MDM / POS OPS</div>
          <h1>{copy.title}</h1>
          <p>{copy.subtitle}</p>
        </div>
        <form className={styles.searchBox} onSubmit={submit}>
          <label htmlFor="store-code">{copy.input}</label>
          <div className={styles.searchRow}>
            <input
              id="store-code"
              value={query}
              onChange={(event) => setQuery(event.target.value.toUpperCase())}
              placeholder="100001 / FG0003"
              autoComplete="off"
              spellCheck={false}
            />
            <button type="submit" disabled={loading || !query.trim()}>{loading ? "…" : copy.search}</button>
          </div>
          <div className={styles.securityHint}><span>i</span>{copy.storesafe}</div>
        </form>
      </section>

      {error ? <div className={styles.errorBanner}><strong>Support lookup error</strong><span>{error}</span></div> : null}

      {!snapshot ? (
        <section className={styles.emptyState}>
          <div className={styles.emptyTerminal}>
            <span>$</span>
            <code>support open --store &lt;STORE_CODE&gt;</code>
          </div>
          <h2>{copy.emptyTitle}</h2>
          <p>{copy.emptyText}</p>
        </section>
      ) : (
        <>
          <section className={styles.customerBar}>
            <div className={styles.customerIdentity}>
              <div className={styles.customerMonogram}>{(snapshot.tenant.display_name ?? snapshot.tenant.name).slice(0, 2).toUpperCase()}</div>
              <div>
                <div className={styles.customerTitleRow}>
                  <h2>{snapshot.tenant.display_name ?? snapshot.tenant.name}</h2>
                  <StatusBadge value={snapshot.tenant.is_active ? "active" : "inactive"} />
                  {snapshot.lifecycle?.access_locked ? <StatusBadge value="locked" /> : null}
                </div>
                <div className={styles.customerCodes}>
                  <span>STORE <strong>{snapshot.access_code ?? "—"}</strong></span>
                  <span>TENANT <strong>{snapshot.tenant.code}</strong></span>
                  <span>{snapshot.branches.length} BRANCH</span>
                </div>
              </div>
            </div>
            <div className={styles.snapshotMeta}>
              <span className={`${styles.refreshDot} ${refreshing ? styles.refreshing : ""}`} />
              <div>
                <strong>{refreshing ? copy.refreshing : copy.refreshed}</strong>
                <span>{copy.generated} {formatDate(snapshot.generated_at, language)}</span>
              </div>
            </div>
          </section>

          <section className={styles.metricsGrid}>
            <MetricCard label={copy.liveDevices} value={`${snapshot.health.live}/${snapshot.health.registered_devices}`} detail={`${snapshot.health.offline} offline · ${snapshot.health.stale} stale`} tone={snapshot.health.offline ? "danger" : "ok"} />
            <MetricCard label={copy.attention} value={attentionCount} detail={`${snapshot.health.critical} critical · ${snapshot.health.degraded} degraded`} tone={attentionCount ? "warn" : "ok"} />
            <MetricCard label={copy.activeSessions} value={snapshot.operations.active_sessions} detail={`${snapshot.operations.open_shifts} ${copy.openShifts.toLowerCase()}`} tone="muted" />
            <MetricCard label={copy.printQueue} value={snapshot.operations.printing.pending + snapshot.operations.printing.retrying} detail={`${snapshot.operations.printing.failed} failed / 24h`} tone={snapshot.operations.printing.failed || snapshot.operations.printing.retrying ? "danger" : "ok"} />
          </section>

          <div className={styles.twoColumn}>
            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <div><span className={styles.panelEyebrow}>CUSTOMER</span><h3>{copy.customer}</h3></div>
                <Link href={`/tenants/${snapshot.tenant.id}/branches`} className={styles.textAction}>Tenant console →</Link>
              </div>
              <div className={styles.profileGrid}>
                <div><span>{copy.owner}</span><strong>{snapshot.tenant.owner_name ?? "—"}</strong><small>{snapshot.tenant.owner_phone ?? snapshot.tenant.contact_phone ?? "—"}</small></div>
                <div><span>{copy.subscription}</span><strong>{snapshot.contract?.status ?? snapshot.lifecycle?.status ?? "—"}</strong><small>{snapshot.lifecycle?.subscription_expires_at ? formatDate(snapshot.lifecycle.subscription_expires_at, language) : "—"}</small></div>
                <div><span>{copy.access}</span><strong>{snapshot.lifecycle?.access_locked ? "LOCKED" : snapshot.tenant.is_active ? "ACTIVE" : "INACTIVE"}</strong><small>{snapshot.lifecycle?.lock_reason ?? snapshot.lifecycle?.data_home ?? "primary"}</small></div>
                <div><span>Contract</span><strong>{snapshot.contract ? `${snapshot.contract.max_devices ?? "∞"} devices` : "—"}</strong><small>{snapshot.contract?.end_date ?? "No end date"}</small></div>
              </div>
            </section>

            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <div><span className={styles.panelEyebrow}>PRINT / KDS</span><h3>{copy.printing}</h3></div>
                <span className={styles.smallMuted}>24H WINDOW</span>
              </div>
              <div className={styles.opsStrip}>
                <div><span>Jobs</span><strong>{snapshot.operations.printing.jobs_24h}</strong></div>
                <div><span>Printers</span><strong>{snapshot.operations.printing.printers_online}/{snapshot.operations.printing.printers}</strong></div>
                <div><span>Agents</span><strong>{snapshot.operations.printing.agents_online}/{snapshot.operations.printing.agents}</strong></div>
                <div><span>KDS active</span><strong>{snapshot.operations.kitchen.active_tickets}</strong></div>
              </div>
              <div className={styles.queueLine}>
                <StatusBadge value={snapshot.operations.printing.pending ? "pending" : "healthy"} label={`Pending ${snapshot.operations.printing.pending}`} />
                <StatusBadge value={snapshot.operations.printing.retrying ? "retrying" : "healthy"} label={`Retry ${snapshot.operations.printing.retrying}`} />
                <StatusBadge value={snapshot.operations.printing.failed ? "failed" : "healthy"} label={`Failed ${snapshot.operations.printing.failed}`} />
                <span>KDS 24h {snapshot.operations.kitchen.tickets_24h}</span>
              </div>
            </section>
          </div>

          <section className={styles.sectionBlock}>
            <div className={styles.sectionHeader}>
              <div><span className={styles.panelEyebrow}>FLEET</span><h3>{copy.devices}</h3></div>
              <div className={styles.sectionStats}>
                <span><i className={`${styles.legendDot} ${styles.legendOk}`} />{snapshot.health.healthy} healthy</span>
                <span><i className={`${styles.legendDot} ${styles.legendWarn}`} />{snapshot.health.degraded} degraded</span>
                <span><i className={`${styles.legendDot} ${styles.legendDanger}`} />{snapshot.health.critical + snapshot.health.offline} critical/offline</span>
              </div>
            </div>
            <div className={styles.deviceList}>
              {snapshot.devices.map((device) => <DeviceRow key={device.id} device={device} tenantId={snapshot.tenant.id} language={language} />)}
              {!snapshot.devices.length ? <div className={styles.inlineEmpty}>No registered POS devices.</div> : null}
            </div>
          </section>

          <div className={styles.twoColumnBottom}>
            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <div><span className={styles.panelEyebrow}>INCIDENT QUEUE</span><h3>{copy.incidents}</h3></div>
                <span className={styles.countPill}>{snapshot.incidents.length}</span>
              </div>
              <div className={styles.incidentList}>
                {snapshot.incidents.slice(0, 10).map((incident, index) => (
                  <div key={`${incident.device_id}-${incident.code}-${index}`} className={styles.incidentRow}>
                    <span className={`${styles.incidentMarker} ${styles[`marker_${incident.severity}`]}`} />
                    <div className={styles.incidentBody}>
                      <strong>{incident.title}</strong>
                      <span>{incident.branch_name ?? "—"} · {incident.device_code}</span>
                    </div>
                    <StatusBadge value={incident.severity === "critical" ? "critical" : "degraded"} label={incident.severity} />
                  </div>
                ))}
                {!snapshot.incidents.length ? <div className={styles.inlineEmpty}>{copy.noIncident}</div> : null}
              </div>
            </section>

            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <div><span className={styles.panelEyebrow}>PRINT FAILURES</span><h3>{copy.recentFailures}</h3></div>
                <Link href="/it-admin/monitoring" className={styles.textAction}>Monitoring →</Link>
              </div>
              <div className={styles.printFailureList}>
                {snapshot.operations.printing.recent_failures.map((job) => (
                  <div key={job.id} className={styles.printFailureRow}>
                    <div>
                      <strong>{job.printer_role ?? "printer"} · {job.status}</strong>
                      <span>{job.last_error ?? "No agent error message"}</span>
                    </div>
                    <div className={styles.jobMeta}>retry {job.retry_count}<br />{formatDate(job.created_at, language)}</div>
                  </div>
                ))}
                {!snapshot.operations.printing.recent_failures.length ? <div className={styles.inlineEmpty}>{copy.noPrintFailures}</div> : null}
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
