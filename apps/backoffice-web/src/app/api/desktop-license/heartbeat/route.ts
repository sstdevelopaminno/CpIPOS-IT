import { enforceDesktopMachineBinding } from "@/lib/desktop-license-machine-guard";
import { ingestDesktopHeartbeat, publicLicenseError, type DesktopHeartbeatInput } from "@/lib/desktop-license-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 1024 * 1024;
const NEXT_CHECK_SECONDS = 300;

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

    await enforceDesktopMachineBinding(input);
    const result = await ingestDesktopHeartbeat(input);
    return json({ lock: false, ...result, next_check_seconds: NEXT_CHECK_SECONDS });
  } catch (error) {
    const code = error instanceof Error ? error.message : "LICENSE_CHECK_FAILED";
    if (code === "LICENSE_MACHINE_MISMATCH") {
      return json({ valid: false, lock: true, code }, 403);
    }
    const result = publicLicenseError(error);
    return json(result, result.lock ? 403 : 503);
  }
}
