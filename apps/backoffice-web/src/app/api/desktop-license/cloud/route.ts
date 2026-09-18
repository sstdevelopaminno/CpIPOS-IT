import {
  completeDesktopCloudBackup,
  getDesktopCloudReceiptArchive,
  getDesktopCloudState,
  listDesktopCloudPlans,
  queryDesktopCloudSalesArchive,
  requestDesktopCloudPlan,
  uploadDesktopCloudBackupChunk,
  type DesktopCloudBackupChunkInput
} from "@/lib/desktop-cloud-backup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 900_000;

type CloudRequest = {
  action?: "status" | "request" | "chunk" | "complete" | "sales" | "receipt";
  token?: string;
  deviceCode?: string;
  planCode?: string;
  entitlementId?: string | null;
  snapshotKey?: string;
  tableName?: string;
  chunkIndex?: number;
  rows?: unknown[];
  databaseBytes?: number | null;
  rowCounts?: Record<string, number> | null;
  checksumSha256?: string | null;
  limit?: number;
  from?: string | null;
  to?: string | null;
  status?: string | null;
  paymentMethod?: string | null;
  receipt?: string | null;
  saleId?: string | null;
};

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400"
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...corsHeaders }
  });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

function statusFor(code: string) {
  if (code.startsWith("LICENSE_")) return 403;
  if (code === "CLOUD_ENTITLEMENT_REQUIRED") return 402;
  if (code === "CLOUD_REQUEST_PENDING" || code === "CLOUD_ALREADY_ACTIVE" || code === "CLOUD_RENEWAL_REVIEW_REQUIRED") return 409;
  if (code.includes("NOT_FOUND") || code === "CLOUD_PLAN_NOT_AVAILABLE") return 404;
  if (code.includes("INVALID") || code.includes("TOO_LARGE") || code.includes("REQUIRED")) return 400;
  return 500;
}

export async function GET() {
  try {
    return json({ data: { plans: await listDesktopCloudPlans(false) }, error: null });
  } catch (error) {
    const code = error instanceof Error ? error.message : "CLOUD_PLANS_FAILED";
    return json({ data: null, error: { code, message: code } }, statusFor(code));
  }
}

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) return json({ data: null, error: { code: "PAYLOAD_TOO_LARGE", message: "Backup chunk is too large." } }, 413);

  try {
    const body = (await request.json()) as CloudRequest;
    const action = String(body.action ?? "status");
    const token = String(body.token ?? "").trim();
    const deviceCode = String(body.deviceCode ?? "").trim().toUpperCase();
    if (!token || !deviceCode || token.length > 16384 || deviceCode.length > 64) {
      return json({ data: null, error: { code: "INVALID_REQUEST", message: "token and deviceCode are required." } }, 400);
    }

    if (action === "status") {
      return json({ data: await getDesktopCloudState(token, deviceCode), error: null });
    }
    if (action === "request") {
      const data = await requestDesktopCloudPlan(token, deviceCode, String(body.planCode ?? ""));
      return json({ data, error: null }, 201);
    }
    if (action === "sales") {
      return json({ data: await queryDesktopCloudSalesArchive({
        token,
        deviceCode,
        limit: body.limit,
        from: body.from,
        to: body.to,
        status: body.status,
        paymentMethod: body.paymentMethod,
        receipt: body.receipt
      }), error: null });
    }
    if (action === "receipt") {
      return json({ data: await getDesktopCloudReceiptArchive(token, deviceCode, String(body.saleId ?? "")), error: null });
    }
    if (action === "chunk") {
      const input: DesktopCloudBackupChunkInput = {
        token,
        deviceCode,
        entitlementId: body.entitlementId ?? null,
        snapshotKey: String(body.snapshotKey ?? ""),
        tableName: String(body.tableName ?? ""),
        chunkIndex: Number(body.chunkIndex ?? -1),
        rows: Array.isArray(body.rows) ? body.rows : [],
        databaseBytes: body.databaseBytes ?? 0,
        rowCounts: body.rowCounts ?? {},
        checksumSha256: body.checksumSha256 ?? null
      };
      return json({ data: await uploadDesktopCloudBackupChunk(input), error: null });
    }
    if (action === "complete") {
      return json({
        data: await completeDesktopCloudBackup({
          token,
          deviceCode,
          entitlementId: body.entitlementId ?? null,
          snapshotKey: String(body.snapshotKey ?? ""),
          databaseBytes: body.databaseBytes ?? 0,
          rowCounts: body.rowCounts ?? {}
        }),
        error: null
      });
    }
    return json({ data: null, error: { code: "INVALID_ACTION", message: "Unknown cloud action." } }, 400);
  } catch (error) {
    const code = error instanceof Error ? error.message : "CLOUD_REQUEST_FAILED";
    return json({ data: null, error: { code, message: code } }, statusFor(code));
  }
}
