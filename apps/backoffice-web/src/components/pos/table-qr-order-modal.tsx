"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";

type QrData = {
  qr_session_id: string;
  table_session_id: string;
  table_id: string;
  table_code: string;
  table_name: string | null;
  order_url: string;
  qr_data_url: string;
  expires_at: string;
};

type ApiResponse = {
  data?: QrData;
  error?: {
    code?: string;
    message?: string;
  };
};

type BluetoothPrintResponse = {
  data?: {
    ok?: boolean;
    data?: {
      fallback_to_browser_print?: boolean;
    };
  };
  error?: {
    code?: string;
    message?: string;
  };
};

const QR_CREATE_TIMEOUT_MS = 60000;
const QR_CREATE_RETRY_DELAY_MS = 1200;
const QR_PRINT_TIMEOUT_MS = 15000;
const NON_RETRYABLE_QR_ERROR_CODES = new Set([
  "table_qr_configuration_missing",
  "table_not_open",
  "table_session_not_open",
  "invalid_table_id",
  "feature_disabled",
  "forbidden"
]);

class TableQrCreateError extends Error {
  code: string | null;
  retryable: boolean;

  constructor(message: string, code: string | null, retryable: boolean) {
    super(message);
    this.name = "TableQrCreateError";
    this.code = code;
    this.retryable = retryable;
  }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "\"":
        return "&quot;";
      case "'":
        return "&#039;";
      default:
        return char;
    }
  });
}

function getPublicErrorMessage(payload: ApiResponse | BluetoothPrintResponse | null, fallback: string) {
  if (payload?.error?.code === "table_qr_configuration_missing") {
    return "ระบบยังไม่ได้ตั้งค่า QR โต๊ะ กรุณาแจ้งผู้ดูแลระบบตรวจสอบ TABLE_QR_SIGNING_SECRET";
  }
  if (payload?.error?.code === "table_not_open" || payload?.error?.code === "table_session_not_open") {
    return "กรุณาเปิดบิลโต๊ะก่อนสร้าง QR สั่งอาหาร";
  }
  const message = payload?.error?.message;
  return typeof message === "string" && message.trim() ? message.trim() : fallback;
}

async function readJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

async function fetchJsonWithTimeout<T>(url: string, init: RequestInit, timeoutMs: number): Promise<{ response: Response; body: T | null }> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal
    });
    const body = await readJson<T>(response);
    return { response, body };
  } finally {
    window.clearTimeout(timeout);
  }
}

function buildPrintHtml(data: QrData) {
  const safeTable = escapeHtml(data.table_code);
  const safeTableName = data.table_name ? escapeHtml(data.table_name) : "";
  const safeUrl = escapeHtml(data.order_url);
  const safeQrDataUrl = escapeHtml(data.qr_data_url);

  return `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>QR โต๊ะ ${safeTable}</title>
<style>
@page{size:58mm auto;margin:0}
*{box-sizing:border-box}
body{width:58mm;margin:0;padding:4mm 3mm;color:#000;background:#fff;font-family:Arial,"Noto Sans Thai",sans-serif;text-align:center}
h1{margin:0;font-size:16px}
p{margin:2mm 0;font-size:11px;line-height:1.35}
.line{border-top:1px dashed #000;margin:3mm 0}
.table{font-size:18px;font-weight:800}
img{display:block;width:46mm;height:46mm;object-fit:contain;margin:2mm auto}
.url{overflow-wrap:anywhere;font-size:7px}
.footer{font-size:12px;font-weight:800}
</style>
</head>
<body>
<h1>CpIPOS</h1>
<p>สแกน QR เพื่อสั่งอาหาร</p>
<div class="line"></div>
<p class="table">โต๊ะ ${safeTable}</p>
${safeTableName ? `<p>${safeTableName}</p>` : ""}
<div class="line"></div>
<img src="${safeQrDataUrl}" alt="QR สั่งอาหารโต๊ะ ${safeTable}">
<p>กรุณาสแกน QR เพื่อเลือกเมนูอาหาร</p>
<p class="url">${safeUrl}</p>
<div class="line"></div>
<p class="footer">สแกนเพื่อสั่งอาหาร</p>
</body>
</html>`;
}

function isAbortError(error: unknown): boolean {
  return (error as { name?: string }).name === "AbortError";
}

export function TableQrOrderModal({
  open,
  tableId,
  tableCode,
  onClose,
  onBusyChange
}: {
  open: boolean;
  tableId: string | null;
  tableCode: string | null;
  onClose: () => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [data, setData] = useState<QrData | null>(null);
  const [loading, setLoading] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [retryToken, setRetryToken] = useState(0);

  const displayTableCode = useMemo(() => data?.table_code ?? tableCode ?? "-", [data?.table_code, tableCode]);

  useEffect(() => {
    if (!open) {
      setData(null);
      setError(null);
      setCopied(false);
      setLoading(false);
      setPrinting(false);
      setRetryToken(0);
      onBusyChange?.(false);
      return;
    }

    if (!tableId) {
      setData(null);
      setError("ไม่พบรหัสโต๊ะ กรุณาเลือกโต๊ะใหม่อีกครั้ง");
      setLoading(false);
      onBusyChange?.(false);
      return;
    }

    let disposed = false;
    const controllers: AbortController[] = [];

    setLoading(true);
    setError(null);
    setCopied(false);
    setData(null);
    onBusyChange?.(true);

    const createQr = async (attempt: number): Promise<void> => {
      const controller = new AbortController();
      controllers.push(controller);
      const timeout = window.setTimeout(() => controller.abort(), QR_CREATE_TIMEOUT_MS);

      try {
        const response = await fetch(`/api/pos/tables/${encodeURIComponent(tableId)}/qr-order`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
          signal: controller.signal
        });
        const body = (await readJson<ApiResponse>(response)) ?? {};

        if (!response.ok || !body.data) {
          const code = body.error?.code ?? null;
          console.error("[table-qr-modal] create QR failed", {
            status: response.status,
            code,
            message: body.error?.message,
            tableId
          });

          throw new TableQrCreateError(
            getPublicErrorMessage(body, "สร้าง QR ไม่สำเร็จ"),
            code,
            response.status >= 500 && !NON_RETRYABLE_QR_ERROR_CODES.has(code ?? "")
          );
        }

        if (disposed) return;
        setData(body.data);
      } catch (loadError) {
        if (disposed) return;

        const retryable = loadError instanceof TableQrCreateError ? loadError.retryable : true;
        if (attempt === 0 && retryable) {
          await new Promise((resolve) => window.setTimeout(resolve, QR_CREATE_RETRY_DELAY_MS));
          if (disposed) return;
          return createQr(1);
        }

        if (isAbortError(loadError)) {
          setError("สร้าง QR ไม่สำเร็จ เนื่องจากระบบใช้เวลานานเกินไป กรุณากดลองใหม่อีกครั้ง");
          return;
        }

        setError(loadError instanceof Error ? loadError.message : "สร้าง QR ไม่สำเร็จ");
      } finally {
        window.clearTimeout(timeout);
      }
    };

    void createQr(0).finally(() => {
      if (disposed) return;
      setLoading(false);
      onBusyChange?.(false);
    });

    return () => {
      disposed = true;
      controllers.forEach((controller) => controller.abort());
      onBusyChange?.(false);
    };
  }, [onBusyChange, open, retryToken, tableId]);

  const copyLink = useCallback(async () => {
    if (!data) return;

    setError(null);

    try {
      await navigator.clipboard.writeText(data.order_url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("คัดลอกลิงก์ไม่สำเร็จ กรุณาคัดลอกลิงก์จากหน้าพิมพ์หรือเปิดลิงก์ใหม่อีกครั้ง");
    }
  }, [data]);

  const printQr = useCallback(async () => {
    if (!data || printing) return;

    setPrinting(true);
    setError(null);

    const html = buildPrintHtml(data);
    const printWindow = window.open("", "_blank", "width=420,height=720");

    if (printWindow) {
      printWindow.document.write('<p style="font-family:Arial;padding:24px">กำลังเตรียมพิมพ์ QR...</p>');
    }

    try {
      const { response, body } = await fetchJsonWithTimeout<BluetoothPrintResponse>(
        "/api/pos/receipts/bluetooth",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            order_no: `TABLE-${data.table_code}-QR`,
            receipt_html: html
          })
        },
        QR_PRINT_TIMEOUT_MS
      );

      if (response.ok && body?.data?.ok === true && body.data.data?.fallback_to_browser_print !== true) {
        printWindow?.close();
        return;
      }

      if (!response.ok) {
        console.error("[table-qr-modal] bluetooth print failed", {
          status: response.status,
          code: body?.error?.code,
          message: body?.error?.message,
          tableId: data.table_id,
          qrSessionId: data.qr_session_id
        });
      }
    } catch (printError) {
      if ((printError as { name?: string }).name !== "AbortError") {
        console.warn("[table-qr-modal] bluetooth print unavailable; using browser print fallback");
      }
    } finally {
      setPrinting(false);
    }

    if (!printWindow) {
      setError("เบราว์เซอร์ปิดกั้นหน้าพิมพ์ กรุณาอนุญาต Pop-up");
      return;
    }

    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.onload = () => {
      printWindow.focus();
      printWindow.print();
    };
  }, [data, printing]);

  if (!open) return null;

  return (
    <div className="posui-modal-backdrop" role="presentation">
      <section className="posui-modal posui-table-qr-modal" role="dialog" aria-modal="true" aria-labelledby="table-qr-title">
        <header className="posui-modal__header">
          <div>
            <h2 id="table-qr-title">QR สแกนสั่งอาหาร</h2>
            <p>โต๊ะ {displayTableCode}</p>
          </div>
          <button type="button" className="posui-btn" onClick={onClose} disabled={printing} aria-label="ปิดหน้าต่าง QR">
            ปิด
          </button>
        </header>

        <div className="posui-table-qr-modal__body">
          {loading ? (
            <div className="posui-table-qr-modal__state" role="status">
              <span className="table-loading-spinner" aria-hidden="true" />
              <strong>กำลังสร้างลิงก์ QR ของโต๊ะ...</strong>
            </div>
          ) : error && !data ? (
            <div className="posui-table-qr-modal__state is-error">
              <strong>สร้าง QR ไม่สำเร็จ</strong>
              <p>{error}</p>
              <button type="button" className="posui-btn posui-btn--primary" onClick={() => setRetryToken((value) => value + 1)}>
                ลองสร้าง QR อีกครั้ง
              </button>
            </div>
          ) : data ? (
            <>
              <div className="posui-table-qr-ticket">
                <strong>CpIPOS</strong>
                <span>สแกน QR เพื่อสั่งอาหาร</span>
                <hr />
                <b>โต๊ะ {data.table_code}</b>
                <Image
                  src={data.qr_data_url}
                  alt={`QR สั่งอาหารสำหรับโต๊ะ ${data.table_code}`}
                  width={250}
                  height={250}
                  unoptimized
                />
                <span>สแกนเพื่อเลือกเมนูอาหาร</span>
              </div>
              <p className="posui-table-qr-modal__expiry">ลิงก์จะหมดอายุเมื่อชำระเงินหรือปิดบิลโต๊ะ</p>
              {error ? <p className="posui-table-qr-modal__error">{error}</p> : null}
              <div className="posui-table-qr-modal__actions">
                <button type="button" className="posui-btn" onClick={copyLink} disabled={printing}>
                  {copied ? "คัดลอกแล้ว" : "คัดลอกลิงก์"}
                </button>
                <button type="button" className="posui-btn posui-btn--primary" onClick={printQr} disabled={printing}>
                  {printing ? "กำลังพิมพ์..." : "พิมพ์ QR 58mm"}
                </button>
              </div>
            </>
          ) : null}
        </div>
      </section>
    </div>
  );
}
