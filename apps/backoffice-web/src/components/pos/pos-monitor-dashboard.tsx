"use client";

import { useEffect, useMemo, useState } from "react";

type Lang = "th" | "en";
type RetryQueue = "order" | "payment";

type BranchMonitorRow = {
  branch_id: string;
  branch_name: string;
  level: "ok" | "warn" | "critical";
  queued_orders: number;
  queued_orders_stale: number;
  print_queue_depth: number;
  print_failed_recent: number;
  dead_letters_recent: number;
  order_dead_letters_recent: number;
  payment_dead_letters_recent: number;
};

type AdminMonitorPayload = {
  tenant_id: string;
  generated_at: string;
  limits: {
    order_queue_limit: number;
    print_queue_limit: number;
  };
  totals: {
    branches: number;
    queued_orders: number;
    dead_letters_recent: number;
    order_dead_letters_recent: number;
    payment_dead_letters_recent: number;
    critical: number;
    warn: number;
  };
  items: BranchMonitorRow[];
};

type ApiEnvelope<T> = {
  data?: T | null;
  error?: { code?: string; message?: string } | null;
};

const UI_TEXT = {
  th: {
    title: "POS Monitor หลายสาขา",
    subtitle: "ติดตามคิวงานและเหตุขัดข้องแบบเรียลไทม์",
    loading: "กำลังโหลด...",
    retryLoad: "โหลดใหม่",
    retryOrder: "Retry All (Order Queue)",
    retryPayment: "Retry All (Payment Queue)",
    retrying: "กำลังรีไทร...",
    export: "ส่งออกรายงาน Incident รายวัน",
    date: "วันที่",
    generatedAt: "อัปเดตล่าสุด",
    branch: "สาขา",
    level: "สถานะ",
    queued: "คิวบิล",
    stale: "บิลค้างนาน",
    printQueue: "คิวพิมพ์",
    orderIncidents: "Order Incident",
    paymentIncidents: "Payment Incident",
    totalIncidents: "รวมเหตุขัดข้อง",
    healthy: "ปกติ",
    warn: "เฝ้าระวัง",
    critical: "วิกฤต",
    noData: "ยังไม่มีข้อมูลสาขา",
    doneRetryWithCount: "สำเร็จ: อัปเดต",
    rows: "รายการ",
    failed: "ทำรายการไม่สำเร็จ"
  },
  en: {
    title: "Multi-Branch POS Monitor",
    subtitle: "Realtime queue pressure and incident visibility",
    loading: "Loading...",
    retryLoad: "Reload",
    retryOrder: "Retry All (Order Queue)",
    retryPayment: "Retry All (Payment Queue)",
    retrying: "Retrying...",
    export: "Export daily incident report",
    date: "Date",
    generatedAt: "Last updated",
    branch: "Branch",
    level: "Level",
    queued: "Order Queue",
    stale: "Stale Queue",
    printQueue: "Print Queue",
    orderIncidents: "Order Incidents",
    paymentIncidents: "Payment Incidents",
    totalIncidents: "Total Incidents",
    healthy: "Healthy",
    warn: "Watch",
    critical: "Critical",
    noData: "No branch data",
    doneRetryWithCount: "Success: affected",
    rows: "rows",
    failed: "Request failed"
  }
} as const;

function todayIsoDate(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function levelLabel(lang: Lang, level: BranchMonitorRow["level"]) {
  if (level === "critical") return UI_TEXT[lang].critical;
  if (level === "warn") return UI_TEXT[lang].warn;
  return UI_TEXT[lang].healthy;
}

function numberFmt(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function pollMs(): number {
  const raw = Number(process.env.NEXT_PUBLIC_POS_MONITOR_POLL_MS);
  if (Number.isFinite(raw)) return Math.max(15000, Math.floor(raw));
  return 30000;
}

export function PosMonitorDashboard({ lang }: { lang: Lang }) {
  const t = UI_TEXT[lang];
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState(() => todayIsoDate());
  const [errorText, setErrorText] = useState<string | null>(null);
  const [noticeText, setNoticeText] = useState<string | null>(null);
  const [payload, setPayload] = useState<AdminMonitorPayload | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [retryingQueue, setRetryingQueue] = useState<RetryQueue | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let timer: number | null = null;

    async function load() {
      setErrorText(null);
      try {
        const response = await fetch("/api/admin/pos/monitor", { method: "GET", cache: "no-store", signal: controller.signal });
        const body = (await response.json()) as ApiEnvelope<AdminMonitorPayload>;
        if (!response.ok || body.error || !body.data) {
          throw new Error(body.error?.message ?? "Failed to load monitor.");
        }
        setPayload(body.data);
      } catch (error) {
        if (controller.signal.aborted) return;
        setErrorText(error instanceof Error ? error.message : "Unknown error");
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void load();
    timer = window.setInterval(() => {
      if (!controller.signal.aborted) {
        void load();
      }
    }, pollMs());

    return () => {
      controller.abort();
      if (timer !== null) {
        window.clearInterval(timer);
      }
    };
  }, [reloadToken]);

  useEffect(() => {
    if (!noticeText) return;
    const timer = window.setTimeout(() => setNoticeText(null), 2800);
    return () => window.clearTimeout(timer);
  }, [noticeText]);

  const generatedAtLabel = useMemo(() => {
    if (!payload?.generated_at) return "-";
    const dateValue = new Date(payload.generated_at);
    if (Number.isNaN(dateValue.getTime())) return payload.generated_at;
    return new Intl.DateTimeFormat(lang === "th" ? "th-TH" : "en-US", {
      dateStyle: "medium",
      timeStyle: "medium",
      timeZone: "Asia/Bangkok"
    }).format(dateValue);
  }, [payload?.generated_at, lang]);

  async function handleRetryAll(queue: RetryQueue) {
    if (retryingQueue) return;
    setRetryingQueue(queue);
    setErrorText(null);
    try {
      const response = await fetch("/api/admin/pos/monitor/retry-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queue })
      });
      const body = (await response.json()) as ApiEnvelope<{ affected_count?: number }>;
      if (!response.ok || body.error) {
        throw new Error(body.error?.message ?? t.failed);
      }
      const affected = Number(body.data?.affected_count ?? 0);
      setNoticeText(`${t.doneRetryWithCount} ${numberFmt(affected)} ${t.rows}`);
      setReloadToken((value) => value + 1);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : t.failed);
    } finally {
      setRetryingQueue(null);
    }
  }

  return (
    <section className="surface pos-monitor-card">
      <header className="pos-monitor-head">
        <div>
          <h2 className="pos-monitor-head__title">{t.title}</h2>
          <p className="pos-monitor-head__subtitle">{t.subtitle}</p>
        </div>

        <div className="pos-monitor-head__actions">
          <label className="pos-monitor-date-field">
            <span>{t.date}</span>
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
          <button
            type="button"
            className="pos-monitor-btn pos-monitor-btn--outline"
            onClick={() => {
              window.location.href = `/api/admin/pos/incidents/export?date=${encodeURIComponent(date)}`;
            }}
          >
            {t.export}
          </button>
          <button type="button" className="pos-monitor-btn pos-monitor-btn--ghost" onClick={() => setReloadToken((value) => value + 1)}>
            {t.retryLoad}
          </button>
          <button
            type="button"
            className="pos-monitor-btn pos-monitor-btn--warn"
            disabled={retryingQueue !== null}
            onClick={() => void handleRetryAll("order")}
          >
            {retryingQueue === "order" ? t.retrying : t.retryOrder}
          </button>
          <button
            type="button"
            className="pos-monitor-btn pos-monitor-btn--primary"
            disabled={retryingQueue !== null}
            onClick={() => void handleRetryAll("payment")}
          >
            {retryingQueue === "payment" ? t.retrying : t.retryPayment}
          </button>
        </div>
      </header>

      <div className="pos-monitor-meta">
        <span>
          {t.generatedAt}: <strong>{generatedAtLabel}</strong>
        </span>
        {payload ? (
          <>
            <span className="pos-monitor-pill">{`Branches ${numberFmt(payload.totals.branches)}`}</span>
            <span className="pos-monitor-pill">{`Queued ${numberFmt(payload.totals.queued_orders)}`}</span>
            <span className="pos-monitor-pill pos-monitor-pill--warn">{`Warn ${numberFmt(payload.totals.warn)}`}</span>
            <span className="pos-monitor-pill pos-monitor-pill--critical">{`Critical ${numberFmt(payload.totals.critical)}`}</span>
          </>
        ) : null}
      </div>

      {noticeText ? <div className="pos-monitor-banner pos-monitor-banner--success">{noticeText}</div> : null}
      {errorText ? <div className="pos-monitor-banner pos-monitor-banner--error">{errorText}</div> : null}
      {loading ? <p className="pos-monitor-loading">{t.loading}</p> : null}

      {!loading && !errorText ? (
        payload?.items?.length ? (
          <div className="pos-monitor-table-wrap">
            <table className="pos-monitor-table">
              <thead>
                <tr>
                  <th>{t.branch}</th>
                  <th>{t.level}</th>
                  <th>{t.queued}</th>
                  <th>{t.stale}</th>
                  <th>{t.printQueue}</th>
                  <th>{t.orderIncidents}</th>
                  <th>{t.paymentIncidents}</th>
                  <th>{t.totalIncidents}</th>
                </tr>
              </thead>
              <tbody>
                {payload.items.map((row) => {
                  const totalIncidents = Number(row.dead_letters_recent ?? 0) + Number(row.print_failed_recent ?? 0);
                  const orderIncidents = Number(row.order_dead_letters_recent ?? 0);
                  const paymentIncidents = Number(row.payment_dead_letters_recent ?? 0);
                  return (
                    <tr key={row.branch_id}>
                      <td>
                        <strong>{row.branch_name}</strong>
                      </td>
                      <td>
                        <span className={`pos-monitor-level pos-monitor-level--${row.level}`}>{levelLabel(lang, row.level)}</span>
                      </td>
                      <td>{numberFmt(row.queued_orders)}</td>
                      <td>{numberFmt(row.queued_orders_stale)}</td>
                      <td>{numberFmt(row.print_queue_depth)}</td>
                      <td>{numberFmt(orderIncidents)}</td>
                      <td>{numberFmt(paymentIncidents)}</td>
                      <td>{numberFmt(totalIncidents)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="pos-monitor-loading">{t.noData}</p>
        )
      ) : null}
    </section>
  );
}
