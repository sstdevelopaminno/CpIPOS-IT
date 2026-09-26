export type SubscriptionReceiptHtmlInput = {
  receiptNumber: string;
  issuedAt: string;
  amount: number;
  currency: string;
  issuer: Record<string, unknown>;
  customer: Record<string, unknown>;
  packageSnapshot: Record<string, unknown>;
  paymentSnapshot: Record<string, unknown>;
};

function text(value: unknown) {
  const valueText = String(value ?? "").trim();
  return valueText || "";
}
function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
function formatDateTime(value: unknown) {
  const raw = text(value);
  if (!raw) return "—";
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok"
  }).format(parsed);
}
function formatDate(value: unknown) {
  const raw = text(value);
  if (!raw) return "—";
  const parsed = new Date(raw + (raw.length === 10 ? "T12:00:00+07:00" : ""));
  if (Number.isNaN(parsed.getTime())) return raw;
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeZone: "Asia/Bangkok" }).format(parsed);
}
function money(value: unknown, currency: string) {
  const n = Number(value ?? 0);
  return new Intl.NumberFormat("th-TH", {
    style: "currency", currency: currency || "THB", minimumFractionDigits: 2
  }).format(Number.isFinite(n) ? n : 0);
}

export function renderSubscriptionReceiptHtml(input: SubscriptionReceiptHtmlInput) {
  const issuerName = text(input.issuer.legal_name_th) || text(input.issuer.legal_name_en) || "CpIPOS";
  const issuerAddress = text(input.issuer.registered_address);
  const issuerRegNo = text(input.issuer.registration_no);
  const issuerEmail = text(input.issuer.billing_email);
  const vatRegistered = input.issuer.vat_registered === true;

  const storeName = text(input.customer.store_name) || "ร้านค้า";
  const storeCode = text(input.customer.store_code);
  const ownerName = text(input.customer.owner_name);
  const customerAddress = text(input.customer.address);
  const customerPhone = text(input.customer.phone);
  const customerEmail = text(input.customer.email);

  const packageName = text(input.packageSnapshot.package_name) || "CpIPOS";
  const interval = input.packageSnapshot.billing_interval === "yearly" ? "รายปี" : "รายเดือน";
  const periodStart = formatDate(input.packageSnapshot.period_start);
  const periodEnd = formatDate(input.packageSnapshot.period_end);
  const bankRef = text(input.paymentSnapshot.bank_transaction_reference);
  const bankReceivedAt = formatDateTime(input.paymentSnapshot.bank_received_at);
  const payerName = text(input.paymentSnapshot.payer_name);
  const transferRef = text(input.paymentSnapshot.customer_transfer_reference);

  return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(input.receiptNumber)} - ใบเสร็จรับเงิน CpIPOS</title>
  <style>
    @page { size: A4; margin: 14mm; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #eef3f9; color: #0f172a; font-family: "Noto Sans Thai","Tahoma","Segoe UI",sans-serif; }
    .toolbar { max-width: 820px; margin: 16px auto 0; display:flex; justify-content:flex-end; gap:8px; }
    .toolbar button { border:0; border-radius:10px; padding:10px 16px; background:#1762ed; color:#fff; font-weight:800; cursor:pointer; }
    .sheet { width: 100%; max-width: 820px; min-height: 1040px; margin: 12px auto 28px; background:#fff; padding:42px 48px; box-shadow:0 10px 35px rgba(15,23,42,.12); }
    .head { display:flex; justify-content:space-between; gap:32px; border-bottom:2px solid #1d4ed8; padding-bottom:22px; }
    .brand { max-width:58%; }
    .brand img { width:128px; height:auto; object-fit:contain; margin-bottom:10px; }
    h1 { margin:0; font-size:28px; color:#123b84; }
    .muted { color:#64748b; font-size:12px; line-height:1.65; }
    .doc { text-align:right; min-width:260px; }
    .doc strong { display:block; font-size:18px; }
    .doc .number { margin-top:7px; font-size:17px; color:#1d4ed8; font-weight:900; }
    .notice { margin:18px 0; padding:12px 14px; border-radius:10px; background:#f8fafc; border:1px solid #dbe3ef; font-size:12px; color:#475569; }
    .grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-top:20px; }
    .box { border:1px solid #dbe3ef; border-radius:12px; padding:16px; }
    .box h2 { margin:0 0 10px; font-size:14px; color:#1e3a8a; }
    .line { margin:5px 0; font-size:13px; line-height:1.55; }
    .label { color:#64748b; min-width:100px; display:inline-block; }
    table { width:100%; border-collapse:collapse; margin-top:22px; font-size:13px; }
    th { background:#eff6ff; color:#1e3a8a; text-align:left; padding:11px; border-bottom:1px solid #bfdbfe; }
    td { padding:12px 11px; border-bottom:1px solid #e2e8f0; vertical-align:top; }
    .right { text-align:right; }
    .summary { width:340px; margin:20px 0 0 auto; }
    .summary .row { display:flex; justify-content:space-between; gap:20px; padding:8px 0; }
    .summary .grand { border-top:2px solid #1d4ed8; margin-top:5px; padding-top:12px; font-size:20px; font-weight:900; color:#123b84; }
    .footer { margin-top:34px; border-top:1px solid #dbe3ef; padding-top:18px; font-size:12px; line-height:1.7; color:#475569; }
    .verified { display:inline-flex; margin-top:8px; border-radius:999px; padding:5px 10px; background:#ecfdf5; color:#047857; font-weight:800; font-size:11px; }
    @media print {
      body { background:#fff; }
      .toolbar { display:none; }
      .sheet { max-width:none; min-height:0; margin:0; padding:0; box-shadow:none; }
    }
  </style>
</head>
<body>
  <div class="toolbar"><button type="button" onclick="window.print()">พิมพ์ / บันทึกเป็น PDF</button></div>
  <main class="sheet">
    <section class="head">
      <div class="brand">
        <img src="/brand/cpipos-logo.png" alt="CpIPOS" />
        <h1>ใบเสร็จรับเงิน / RECEIPT</h1>
        <div class="muted">
          <strong>${escapeHtml(issuerName)}</strong><br/>
          ${issuerAddress ? escapeHtml(issuerAddress) + "<br/>" : ""}
          ${issuerRegNo ? "เลขทะเบียน/เลขประจำตัว: " + escapeHtml(issuerRegNo) + "<br/>" : ""}
          ${issuerEmail ? "อีเมล: " + escapeHtml(issuerEmail) : ""}
        </div>
      </div>
      <div class="doc">
        <strong>เลขที่ใบเสร็จ</strong>
        <div class="number">${escapeHtml(input.receiptNumber)}</div>
        <div class="muted">วันที่ออก: ${escapeHtml(formatDateTime(input.issuedAt))}</div>
        <span class="verified">ยืนยันรับเงินจริงแล้ว</span>
      </div>
    </section>

    <div class="notice">
      ${vatRegistered
        ? "เอกสารนี้เป็นใบเสร็จรับเงินตามสถานะภาษีของผู้ออกเอกสาร ณ วันที่ออก"
        : "เอกสารนี้เป็นใบเสร็จรับเงิน ไม่ใช่ใบกำกับภาษี VAT"}
    </div>

    <section class="grid">
      <div class="box">
        <h2>ผู้ชำระ / ร้านค้า</h2>
        <div class="line"><span class="label">ร้านค้า</span>${escapeHtml(storeName)}</div>
        ${storeCode ? `<div class="line"><span class="label">รหัสร้าน</span>${escapeHtml(storeCode)}</div>` : ""}
        ${ownerName ? `<div class="line"><span class="label">ผู้ติดต่อ</span>${escapeHtml(ownerName)}</div>` : ""}
        ${customerAddress ? `<div class="line"><span class="label">ที่อยู่</span>${escapeHtml(customerAddress)}</div>` : ""}
        ${customerPhone ? `<div class="line"><span class="label">โทร</span>${escapeHtml(customerPhone)}</div>` : ""}
        ${customerEmail ? `<div class="line"><span class="label">อีเมล</span>${escapeHtml(customerEmail)}</div>` : ""}
      </div>
      <div class="box">
        <h2>ข้อมูลการรับชำระ</h2>
        <div class="line"><span class="label">วิธีชำระ</span>โอนเข้าบัญชีบริษัท</div>
        <div class="line"><span class="label">เงินเข้าเมื่อ</span>${escapeHtml(bankReceivedAt)}</div>
        ${bankRef ? `<div class="line"><span class="label">Bank Ref.</span>${escapeHtml(bankRef)}</div>` : ""}
        ${payerName ? `<div class="line"><span class="label">ชื่อผู้โอน</span>${escapeHtml(payerName)}</div>` : ""}
        ${transferRef ? `<div class="line"><span class="label">Ref. จากร้าน</span>${escapeHtml(transferRef)}</div>` : ""}
      </div>
    </section>

    <table>
      <thead><tr><th>รายการ</th><th>รอบบริการ</th><th>ระยะเวลา</th><th class="right">จำนวนเงิน</th></tr></thead>
      <tbody><tr>
        <td><strong>ค่าบริการแพ็กเกจ CpIPOS — ${escapeHtml(packageName)}</strong></td>
        <td>${escapeHtml(interval)}</td>
        <td>${escapeHtml(periodStart)} – ${escapeHtml(periodEnd)}</td>
        <td class="right"><strong>${escapeHtml(money(input.amount,input.currency))}</strong></td>
      </tr></tbody>
    </table>

    <section class="summary">
      <div class="row"><span>ยอดรับชำระ</span><strong>${escapeHtml(money(input.amount,input.currency))}</strong></div>
      <div class="row grand"><span>ยอดสุทธิ</span><span>${escapeHtml(money(input.amount,input.currency))}</span></div>
    </section>

    <footer class="footer">
      ใบเสร็จนี้ออกจากรายการรับเงินจริงที่ยืนยันโดยระบบหลังบ้าน IT และผูกกับรอบบิลแพ็กเกจแบบหนึ่งต่อหนึ่ง
      เลขที่ใบเสร็จและข้อมูลธุรกรรมถูกบันทึกเป็น snapshot เพื่อไม่ให้การแก้ไขข้อมูลบริษัทในภายหลังเปลี่ยนเอกสารเดิม
    </footer>
  </main>
</body>
</html>`;
}
