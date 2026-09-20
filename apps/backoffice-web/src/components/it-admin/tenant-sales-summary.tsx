"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./tenant-sales-summary.module.css";

type Period = "day" | "month" | "year";
type Branch = { id: string; code: string; name: string; is_active: boolean };
type Product = { id: string; branch_id: string | null; branchName: string; sku: string | null; name: string; category: string | null; price: number | string | null; is_active: boolean };
type Receipt = { id: string; orderNo: string; branchId: string; branchName: string; createdAt: string; status: string; gross: number; net: number; discount: number; methods: string[] };
type Report = {
  tenant: { id: string; name: string; display_name: string | null };
  branches: Branch[]; branchId: string; period: Period; date: string;
  range: { from: string; untilExclusive: string; timezone: string };
  summary: { completedCount: number; cancelledCount: number; gross: number; net: number; discount: number; cancelledValue: number; averageBill: number };
  paymentMethods: Array<{ method: string; amount: number }>;
  daily: Array<{ date: string; bills: number; amount: number }>;
  receipts: Receipt[];
  soldProducts: Array<{ key: string; productId: string | null; name: string; quantity: number; amount: number }>;
  products: Product[];
};
type Detail = {
  order: { id: string; order_no: string | null; branch_id: string; created_at: string; status: string; gross: number; net: number; discount_amount: number | string | null; tax_total: number | string | null };
  items: Array<{ id: string; name: string | null; quantity: number | string | null; unit_price: number | string | null; line_total: number | string | null }>;
  payments: Array<{ id: string; method: string; status: string; amount: number | string | null }>;
};
type Envelope<T> = { data: T | null; error: { message?: string } | null };
type Tab = "receipts" | "sold" | "catalog";
const PER_PAGE = 25;
const money = (n: number | string | null | undefined) => new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB", minimumFractionDigits: 2 }).format(Number(n ?? 0));
const number = (n: number | string | null | undefined) => new Intl.NumberFormat("th-TH", { maximumFractionDigits: 2 }).format(Number(n ?? 0));
const time = (iso: string) => new Date(iso).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", dateStyle: "medium", timeStyle: "short" });
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const paymentLabel = (s: string) => s === "cash" ? "เงินสด" : ["bank_transfer", "transfer", "qr", "promptpay"].includes(s.toLowerCase()) ? "โอน / QR" : s === "card" ? "บัตร" : s;
const statusLabel = (s: string) => ({ completed: "ขายสำเร็จ", cancelled: "ยกเลิก", draft: "ฉบับร่าง", queued: "รอดำเนินการ", preparing: "กำลังเตรียม" }[s] ?? s);

async function read<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { credentials: "include", cache: "no-store", signal });
  const payload = (await response.json().catch(() => null)) as Envelope<T> | null;
  if (!response.ok || !payload?.data) throw new Error(payload?.error?.message ?? "โหลดข้อมูลไม่สำเร็จ");
  return payload.data;
}
function Pager({ count, page, setPage }: { count: number; page: number; setPage: (page: number) => void }) {
  const max = Math.max(1, Math.ceil(count / PER_PAGE));
  return <div className={styles.pager}><span>ทั้งหมด {number(count)} รายการ · หน้า {page}/{max}</span><button disabled={page <= 1} onClick={() => setPage(page - 1)}>ก่อนหน้า</button><button disabled={page >= max} onClick={() => setPage(page + 1)}>ถัดไป</button></div>;
}
export function TenantSalesSummary({ tenantId }: { tenantId: string }) {
  const [period, setPeriod] = useState<Period>("day");
  const [date, setDate] = useState(today);
  const [branchId, setBranchId] = useState("all");
  const [refresh, setRefresh] = useState(0);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("receipts");
  const [page, setPage] = useState(1);
  const [receipt, setReceipt] = useState<Detail | null>(null);
  const [receiptLoading, setReceiptLoading] = useState(false);
  const [receiptError, setReceiptError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(""); setReport(null); setReceipt(null); setPage(1);
    const params = new URLSearchParams({ period, date, branchId });
    void read<Report>(`/api/it-admin/v1/tenants/${encodeURIComponent(tenantId)}/sales-summary?${params}`, controller.signal)
      .then(setReport)
      .catch((e: unknown) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "โหลดรายงานไม่สำเร็จ"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [tenantId, period, date, branchId, refresh]);

  const branch = report?.branches.find((b) => b.id === branchId);
  const headline = branch ? `สาขา ${branch.name}` : "ทุกสาขาของร้าน";
  const grouped = useMemo(() => {
    const buckets = new Map<string, number>();
    for (const row of report?.daily ?? []) {
      const key = period === "year" ? row.date.slice(0, 7) : row.date;
      buckets.set(key, (buckets.get(key) ?? 0) + row.amount);
    }
    return [...buckets].map(([date, amount]) => ({ date, amount })).sort((a, b) => a.date.localeCompare(b.date));
  }, [report, period]);
  const maxBar = Math.max(1, ...grouped.map((r) => r.amount));
  const rows = tab === "receipts" ? report?.receipts ?? [] : tab === "sold" ? report?.soldProducts ?? [] : report?.products ?? [];
  const visible = rows.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  async function openReceipt(orderId: string) {
    setReceiptLoading(true); setReceiptError(""); setReceipt(null);
    try {
      const params = new URLSearchParams({ branchId, orderId });
      setReceipt(await read<Detail>(`/api/it-admin/v1/tenants/${encodeURIComponent(tenantId)}/sales-summary?${params}`));
    } catch (e) { setReceiptError(e instanceof Error ? e.message : "ไม่สามารถโหลดรายละเอียดบิลได้"); }
    finally { setReceiptLoading(false); }
  }
  function closeReceipt() { setReceipt(null); setReceiptError(""); setReceiptLoading(false); }
  return <div className={styles.shell}>
    <header className={styles.hero}>
      <div><span className={styles.eyebrow}>STORE SALES INTELLIGENCE · CPIPOS-001</span><h3>สรุปยอดขายร้านค้า</h3><p>{report?.tenant.display_name || report?.tenant.name || "ร้านค้าที่เลือก"} · แสดงข้อมูลจริงจากระบบ POS</p></div>
      <span className={styles.badge}>อ่านข้อมูลเท่านั้น</span>
    </header>
    <div className={styles.filters}>
      <div className={styles.periods} aria-label="ช่วงเวลารายงาน">{([{ id: "day", name: "รายวัน" }, { id: "month", name: "รายเดือน" }, { id: "year", name: "รายปี" }] as const).map((p) =>
        <button key={p.id} type="button" className={period === p.id ? styles.selected : ""} aria-pressed={period === p.id} onClick={() => setPeriod(p.id)}>{p.name}</button>)}</div>
      <label>วันที่อ้างอิง<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
      <label>ขอบเขตยอดขาย<select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
        <option value="all">ทุกสาขาของร้าน</option>
        {report?.branches.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.code}){b.is_active ? "" : " · ปิดใช้งาน"}</option>)}
      </select></label>
      <button type="button" className={styles.refresh} disabled={loading} onClick={() => setRefresh((v) => v + 1)}>{loading ? "กำลังโหลด…" : "รีเฟรชข้อมูล"}</button>
    </div>
    {report ? <p className={styles.scope}>ขอบเขต: <strong>{headline}</strong> · ตั้งแต่ {report.range.from} ถึงก่อน {report.range.untilExclusive} · เวลาไทย (Asia/Bangkok) · ยอดขายนับเฉพาะบิลสถานะ “ขายสำเร็จ” ตามเวลาสร้างบิล</p> : null}
    {loading ? <div className={styles.panel} role="status">กำลังอ่านยอดขายจาก CpiPOS-001…</div> : null}
    {error ? <div className={styles.error} role="alert"><strong>โหลดรายงานไม่สำเร็จ</strong><p>{error}</p><button className={styles.close} onClick={() => setRefresh((v) => v + 1)}>ลองใหม่</button></div> : null}
    {report ? <>
      <section className={styles.metrics} aria-label="ยอดขาย">
        <article className={styles.metric}><span>ยอดขายสุทธิ</span><strong className={styles.positive}>{money(report.summary.net)}</strong><small>บิลขายสำเร็จ · ไม่รวมบิลยกเลิก</small></article>
        <article className={styles.metric}><span>จำนวนบิลขายสำเร็จ</span><strong>{number(report.summary.completedCount)}</strong><small>เฉลี่ย {money(report.summary.averageBill)} / บิล</small></article>
        <article className={styles.metric}><span>ยอดก่อนส่วนลด</span><strong>{money(report.summary.gross)}</strong><small>ส่วนลด {money(report.summary.discount)}</small></article>
        <article className={styles.metric}><span>บิลยกเลิก</span><strong className={styles.warning}>{number(report.summary.cancelledCount)}</strong><small>มูลค่าบิลยกเลิก {money(report.summary.cancelledValue)}</small></article>
      </section>
      <div className={styles.grid}>
        <section className={styles.panel}><h4>แนวโน้มยอดขายสุทธิ {period === "year" ? "รายเดือน" : "รายวัน"}</h4>
          {grouped.length ? <div className={styles.chart} aria-label="แผนภูมิยอดขาย">{grouped.map((g) =>
            <div key={g.date} className={styles.bar} style={{ height: Math.max(3, g.amount / maxBar * 100) + "%" }} title={g.date + " · " + money(g.amount)} aria-label={g.date + " " + money(g.amount)} />)}</div>
            : <p className={styles.empty}>ยังไม่มีบิลขายสำเร็จในช่วงที่เลือก</p>}
          <p className={styles.chartCaption}>{grouped.length ? `แสดง ${grouped.length} ช่วงที่มียอดขาย · สูงสุด ${money(maxBar)}` : "ไม่มีข้อมูลยอดขาย"} · กราฟไม่รวมบิลยกเลิก</p>
        </section>
        <section className={styles.panel}><h4>ช่องทางชำระเงินที่บันทึกใน POS</h4>
          <div className={styles.methods}>{report.paymentMethods.length ? report.paymentMethods.map((m) => {
            const total = report.paymentMethods.reduce((sum, x) => sum + x.amount, 0);
            return <div key={m.method}><div className={styles.methodHead}><strong>{paymentLabel(m.method)}</strong><span>{money(m.amount)}</span></div><div className={styles.track}><span style={{ width: (total > 0 ? (m.amount / total * 100) : 0) + "%" }} /></div></div>;
          }) : <p className={styles.note}>ไม่มีรายการชำระเงินในช่วงที่เลือก</p>}</div>
          <p className={styles.note}>ยอดช่องทางชำระเงินมาจากตาราง payments เฉพาะรายการสถานะ paid; อาจต่างจากยอดบิลหากมีข้อมูลชำระเงินไม่ครบ</p>
        </section>
      </div>
      <div className={styles.tabs} role="tablist" aria-label="รายละเอียด">
        {([{ id: "receipts", label: `รายการขายรายบิล (${number(report.receipts.length)})` }, { id: "sold", label: `สินค้าที่ขาย (${number(report.soldProducts.length)})` }, { id: "catalog", label: `สินค้าของร้าน (${number(report.products.length)})` }] as const).map((t) =>
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? styles.active : ""} onClick={() => { setTab(t.id); setPage(1); }}>{t.label}</button>)}
      </div>
      <section className={styles.panel}>
        <h4>{tab === "receipts" ? "ตรวจสอบรายการขายทีละบิล" : tab === "sold" ? "จำนวนและมูลค่าสินค้าที่ขาย" : "ทะเบียนสินค้าของร้าน / สาขา"}</h4>
        <div className={styles.tableWrap}><table className={styles.table}>
          {tab === "receipts" ? <>
            <thead><tr><th>เลขที่บิล</th><th>วัน/เวลาขาย</th><th>สาขา</th><th>สถานะ</th><th>ชำระเงิน</th><th className={styles.right}>ยอดสุทธิ</th><th>รายละเอียด</th></tr></thead>
            <tbody>{(visible as Receipt[]).map((r) => <tr key={r.id}><td><strong>{r.orderNo}</strong></td><td>{time(r.createdAt)}</td><td>{r.branchName}</td><td><span className={styles.pill} data-status={r.status}>{statusLabel(r.status)}</span></td><td>{r.methods.map(paymentLabel).join(" · ") || "—"}</td><td className={styles.right}>{money(r.net)}</td><td><button className={styles.link} onClick={() => void openReceipt(r.id)}>ดูบิล →</button></td></tr>)}
              {!visible.length ? <tr><td className={styles.empty} colSpan={7}>ยังไม่มีบิลในช่วง/สาขาที่เลือก</td></tr> : null}</tbody>
          </> : tab === "sold" ? <>
            <thead><tr><th>สินค้า</th><th className={styles.right}>จำนวนขาย</th><th className={styles.right}>มูลค่ารายการสินค้า</th></tr></thead>
            <tbody>{(visible as Report["soldProducts"]).map((p) => <tr key={p.key}><td><strong>{p.name}</strong></td><td className={styles.right}>{number(p.quantity)}</td><td className={styles.right}>{money(p.amount)}</td></tr>)}
              {!visible.length ? <tr><td className={styles.empty} colSpan={3}>ยังไม่มีสินค้าที่ขายในช่วงนี้</td></tr> : null}</tbody>
          </> : <>
            <thead><tr><th>รหัสสินค้า</th><th>ชื่อสินค้า</th><th>หมวดหมู่</th><th>สาขา</th><th className={styles.right}>ราคาปัจจุบัน</th><th>สถานะ</th></tr></thead>
            <tbody>{(visible as Product[]).map((p) => <tr key={p.id}><td>{p.sku || "—"}</td><td><strong>{p.name}</strong></td><td>{p.category || "—"}</td><td>{p.branchName}</td><td className={styles.right}>{money(p.price)}</td><td><span className={styles.pill}>{p.is_active ? "เปิดขาย" : "ปิดขาย"}</span></td></tr>)}
              {!visible.length ? <tr><td className={styles.empty} colSpan={6}>ร้านนี้ยังไม่มีสินค้า</td></tr> : null}</tbody>
          </>}</table></div>
        <Pager count={rows.length} page={page} setPage={setPage} />
        {tab === "sold" ? <p className={styles.note}>มูลค่ารายการสินค้าอ้างอิง line_total ก่อนกระจายส่วนลดท้ายบิล จึงไม่ใช่ยอดสุทธิรายสินค้า</p> : null}
        {tab === "catalog" ? <p className={styles.note}>ราคาที่แสดงคือราคาปัจจุบันของสินค้า ไม่ใช่ราคาขายย้อนหลัง · “ทุกสาขา” รวมสินค้าส่วนกลาง</p> : null}
      </section>
    </> : null}
    {receiptLoading || receiptError || receipt ? <div className={styles.receiptOverlay} role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) closeReceipt(); }}>
      <section className={styles.receiptDialog} role="dialog" aria-modal="true" aria-label="รายละเอียดบิล">
        <header className={styles.receiptHead}><div><span className={styles.eyebrow}>RECEIPT DETAILS</span><h4>รายละเอียดรายการขาย</h4></div><button type="button" className={styles.close} onClick={closeReceipt}>ปิด ×</button></header>
        {receiptLoading ? <p>กำลังโหลดรายละเอียดบิล…</p> : null}{receiptError ? <div className={styles.error}>{receiptError}</div> : null}
        {receipt ? <><p><strong>บิล {receipt.order.order_no || receipt.order.id.slice(0, 8)}</strong> · {time(receipt.order.created_at)} · {statusLabel(receipt.order.status)}</p>
          <div className={styles.receiptTotals}><span>ยอดก่อนส่วนลด <strong>{money(receipt.order.gross)}</strong></span><span>ส่วนลด <strong>{money(receipt.order.discount_amount)}</strong></span><span>ยอดสุทธิ <strong>{money(receipt.order.net)}</strong></span></div>
          <h4>สินค้าในบิล</h4><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>รายการ</th><th className={styles.right}>จำนวน</th><th className={styles.right}>ราคา</th><th className={styles.right}>รวม</th></tr></thead><tbody>
            {receipt.items.map((i) => <tr key={i.id}><td>{i.name || "ไม่ระบุชื่อสินค้า"}</td><td className={styles.right}>{number(i.quantity)}</td><td className={styles.right}>{money(i.unit_price)}</td><td className={styles.right}>{money(i.line_total)}</td></tr>)}
            {!receipt.items.length ? <tr><td colSpan={4} className={styles.empty}>ไม่มีรายการสินค้าในบิลนี้</td></tr> : null}</tbody></table></div>
          <h4>การชำระเงิน</h4><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>ช่องทาง</th><th>สถานะ</th><th className={styles.right}>จำนวนเงิน</th></tr></thead><tbody>
            {receipt.payments.map((p) => <tr key={p.id}><td>{paymentLabel(p.method)}</td><td>{p.status}</td><td className={styles.right}>{money(p.amount)}</td></tr>)}
            {!receipt.payments.length ? <tr><td colSpan={3} className={styles.empty}>ไม่มีข้อมูลชำระเงิน</td></tr> : null}</tbody></table></div>
        </> : null}
      </section></div> : null}
  </div>;
}
