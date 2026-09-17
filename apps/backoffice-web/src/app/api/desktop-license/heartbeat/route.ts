import { ingestDesktopHeartbeat, publicLicenseError, type DesktopHeartbeatInput } from "@/lib/desktop-license-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 1024 * 1024;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) return json({ valid: false, lock: false, code: "PAYLOAD_TOO_LARGE" }, 413);

  try {
    const input = (await request.json()) as DesktopHeartbeatInput;
    if (!input || typeof input.token !== "string" || typeof input.deviceCode !== "string") {
      return json({ valid: false, lock: false, code: "INVALID_REQUEST" }, 400);
    }
    if (input.token.length > 16384 || input.deviceCode.length > 64) {
      return json({ valid: false, lock: false, code: "INVALID_REQUEST" }, 400);
    }
    if (Array.isArray(input.sales) && input.sales.length > 100) input.sales = input.sales.slice(0, 100);

    const result = await ingestDesktopHeartbeat(input);
    return json({ valid: true, lock: false, ...result });
  } catch (error) {
    const result = publicLicenseError(error);
    return json(result, result.lock ? 403 : 503);
  }
}
