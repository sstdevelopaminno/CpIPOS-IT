export type BrowserPrintAgentStatus = {
  enabled: boolean;
  supported: boolean;
  connected: boolean;
  code: string;
  message: string;
  jobsPrinted: number;
  lastJobId: string | null;
  updatedAt: string;
};

export type BrowserPrintJob = {
  id: string;
  payload_text?: string | null;
  payload_json?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  printer_profiles?: null | {
    printer_name?: string | null;
    paper_width_mm?: 58 | 80 | null;
    metadata?: Record<string, unknown> | null;
  };
};

export type ClaimResponse = {
  data?: {
    jobs?: BrowserPrintJob[];
  };
  error?: {
    message?: string;
  };
};

export function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function isCashDrawerJob(job: BrowserPrintJob) {
  const metadata = job.metadata ?? {};
  const payload = job.payload_json ?? {};
  return metadata.command === "open_cash_drawer" || payload.command === "open_cash_drawer";
}

export function bytesForCashDrawer() {
  return new Uint8Array([0x1b, 0x40, 0x1b, 0x70, 0x00, 0x32, 0xfa]);
}

function receiptHtmlForJob(job: BrowserPrintJob) {
  const metadata = readRecord(job.metadata);
  const payload = readRecord(job.payload_json);
  return readString(metadata.payload_html) ?? readString(metadata.receipt_html) ?? readString(payload.payload_html) ?? readString(payload.receipt_html);
}

function decodeHtml(value: string) {
  if (typeof document === "undefined") return value;
  const textarea = document.createElement("textarea");
  textarea.innerHTML = value;
  return textarea.value;
}

function stripHtmlToLines(html: string) {
  const withBreaks = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<(br|hr)\s*\/?\s*>/gi, "\n")
    .replace(/<\/(p|div|h1|h2|h3|tr|table|section|article|main|header|footer|dl)>/gi, "\n")
    .replace(/<\/(td|th|dt|dd|span|strong)>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  return decodeHtml(withBreaks)
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 160);
}

function textToLines(text: string) {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 160);
}

function paperWidthMmForJob(job: BrowserPrintJob): 58 | 80 {
  return job.printer_profiles?.paper_width_mm === 80 ? 80 : 58;
}

function printerDotsForPaper(paperWidthMm: 58 | 80) {
  return paperWidthMm === 80 ? 576 : 384;
}

function cssPxForMm(mm: number) {
  return mm * (96 / 25.4);
}

function wrapCanvasLine(ctx: CanvasRenderingContext2D, line: string, maxWidth: number) {
  if (ctx.measureText(line).width <= maxWidth) return [line];
  const words = line.split(/\s+/).filter(Boolean);
  const wrapped: string[] = [];
  let current = "";
  for (const word of words.length ? words : [line]) {
    const next = current ? `${current} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidth || !current) {
      current = next;
    } else {
      wrapped.push(current);
      current = word;
    }
  }
  if (current) wrapped.push(current);
  return wrapped;
}

function rasterBytesFromCanvas(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas_context_missing");
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const widthBytes = Math.ceil(canvas.width / 8);
  const raster = new Uint8Array(widthBytes * canvas.height);
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const offset = (y * canvas.width + x) * 4;
      const alpha = image[offset + 3] ?? 0;
      const lum = (image[offset] ?? 255) * 0.299 + (image[offset + 1] ?? 255) * 0.587 + (image[offset + 2] ?? 255) * 0.114;
      if (alpha > 96 && lum < 190) raster[y * widthBytes + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  const header = new Uint8Array([
    0x1b,
    0x40,
    0x1d,
    0x76,
    0x30,
    0x00,
    widthBytes & 0xff,
    (widthBytes >> 8) & 0xff,
    canvas.height & 0xff,
    (canvas.height >> 8) & 0xff
  ]);
  const cut = new Uint8Array([0x0a, 0x0a, 0x1d, 0x56, 0x00]);
  const output = new Uint8Array(header.length + raster.length + cut.length);
  output.set(header, 0);
  output.set(raster, header.length);
  output.set(cut, header.length + raster.length);
  return output;
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

async function waitForAssets(root: HTMLElement) {
  const fonts = "fonts" in document ? document.fonts : null;
  await fonts?.ready.catch(() => undefined);
  const images = Array.from(root.querySelectorAll("img"));
  await Promise.allSettled(
    images.map(
      (image) =>
        new Promise<void>((resolve) => {
          if (image.complete) {
            resolve();
            return;
          }
          image.addEventListener("load", () => resolve(), { once: true });
          image.addEventListener("error", () => resolve(), { once: true });
        })
    )
  );
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

function sanitizeReceiptHtml(html: string) {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  parsed.querySelectorAll("script,iframe,object,embed").forEach((node) => node.remove());
  return {
    styles: Array.from(parsed.querySelectorAll("style")).map((style) => style.textContent ?? "").join("\n"),
    body: parsed.body?.innerHTML?.trim() || html
  };
}

async function rasterBytesFromReceiptHtml(job: BrowserPrintJob, html: string) {
  const paperWidthMm = paperWidthMmForJob(job);
  const printerWidthPx = printerDotsForPaper(paperWidthMm);
  const cssWidthPx = cssPxForMm(paperWidthMm);
  const scale = printerWidthPx / cssWidthPx;
  const sanitized = sanitizeReceiptHtml(html);
  const styleText = `
.receipt-print-page{box-sizing:border-box;width:${paperWidthMm}mm;min-height:1px;margin:0;overflow:visible;background:#fff;color:#000;font-family:Tahoma,"Noto Sans Thai",Arial,sans-serif;text-rendering:geometricPrecision;}
.receipt-print-page *{box-sizing:border-box;}
.receipt-print-page img{max-width:100%;}
${sanitized.styles.replace(/@page[^{}]*\{[^{}]*\}/gi, "")}`;

  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.left = "-10000px";
  host.style.top = "0";
  host.style.width = `${cssWidthPx}px`;
  host.style.opacity = "0";
  host.style.pointerEvents = "none";
  host.style.zIndex = "-1";

  const page = document.createElement("div");
  page.className = "receipt-print-page";
  page.innerHTML = `<style>${styleText}</style>${sanitized.body}`;
  host.appendChild(page);
  document.body.appendChild(host);

  try {
    await waitForAssets(page);
    const rect = page.getBoundingClientRect();
    const cssHeightPx = Math.ceil(Math.max(rect.height, page.scrollHeight, 120));
    const canvasHeightPx = Math.max(120, Math.ceil(cssHeightPx * scale));
    const printPage = page.cloneNode(true) as HTMLElement;
    printPage.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
    const serializedPage = new XMLSerializer().serializeToString(printPage);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cssWidthPx}" height="${cssHeightPx}" viewBox="0 0 ${cssWidthPx} ${cssHeightPx}"><foreignObject width="100%" height="100%">${serializedPage}</foreignObject></svg>`;
    const image = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
    if (!image) throw new Error("receipt_html_image_render_failed");

    const canvas = document.createElement("canvas");
    canvas.width = printerWidthPx;
    canvas.height = canvasHeightPx;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas_context_missing");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, 0, 0, printerWidthPx, canvasHeightPx);
    return rasterBytesFromCanvas(canvas);
  } finally {
    host.remove();
  }
}

async function rasterBytesFromReceiptText(job: BrowserPrintJob, html?: string | null) {
  const lines = html ? stripHtmlToLines(html) : textToLines(job.payload_text?.trim() || "CpIPOS print job");
  const paperWidthMm = paperWidthMmForJob(job);
  const width = printerDotsForPaper(paperWidthMm);
  const canvas = document.createElement("canvas");
  const firstPass = canvas.getContext("2d");
  if (!firstPass) throw new Error("canvas_context_missing");
  const padding = 14;
  const lineHeight = 30;
  firstPass.font = '800 23px "Tahoma", "Noto Sans Thai", sans-serif';
  const wrapped = lines.flatMap((line) => wrapCanvasLine(firstPass, line.replace(/\?(\d)/g, "฿$1"), width - padding * 2));
  canvas.width = width;
  canvas.height = Math.max(120, padding * 2 + wrapped.length * lineHeight);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas_context_missing");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000";
  ctx.textBaseline = "top";
  ctx.font = '800 23px "Tahoma", "Noto Sans Thai", sans-serif';
  let y = padding;
  for (const line of wrapped) {
    const isCenter = y < padding + lineHeight * 4 || line === "CpIPOS";
    ctx.textAlign = isCenter ? "center" : "left";
    ctx.fillText(line, isCenter ? width / 2 : padding, y);
    y += lineHeight;
  }
  return rasterBytesFromCanvas(canvas);
}

export async function bytesForReceipt(job: BrowserPrintJob) {
  if (typeof document === "undefined") {
    const body = new TextEncoder().encode((job.payload_text?.trim() || "CpIPOS print job") + "\n\n\n");
    const output = new Uint8Array(2 + body.length + 3);
    output.set([0x1b, 0x40], 0);
    output.set(body, 2);
    output.set([0x1d, 0x56, 0x00], 2 + body.length);
    return output;
  }

  const html = receiptHtmlForJob(job);
  if (html) {
    try {
      return await rasterBytesFromReceiptHtml(job, html);
    } catch (error) {
      console.warn("[browser-print-agent] receipt HTML raster failed; falling back to text raster", {
        jobId: job.id,
        error: error instanceof Error ? error.message : "Unknown error"
      });
      return rasterBytesFromReceiptText(job, html);
    }
  }
  return rasterBytesFromReceiptText(job);
}

async function readJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export async function postAgentApi<T>(path: string, agentKey: string, body: Record<string, unknown>) {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${agentKey}`
    },
    body: JSON.stringify(body)
  });
  return { response, body: await readJson<T>(response) };
}

export function dispatchStatus(eventName: string, status: Omit<BrowserPrintAgentStatus, "updatedAt">) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<BrowserPrintAgentStatus>(eventName, {
      detail: { ...status, updatedAt: new Date().toISOString() }
    })
  );
}
