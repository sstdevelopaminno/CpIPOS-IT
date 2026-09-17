import { getAuthContext } from "@/lib/auth-context";
import { DESKTOP_MDM_COMMANDS, issueDesktopMdmCommand, type DesktopMdmCommandType } from "@/lib/desktop-mdm-control";
import { fail, ok } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireItAdmin() {
  const auth = await getAuthContext({ requireBranchScope: false });
  if (auth.platformRole !== "it_admin") throw new Error("FORBIDDEN");
  return auth;
}

export async function POST(request: Request) {
  try {
    const auth = await requireItAdmin();
    const body = (await request.json()) as {
      contractId?: string;
      deviceId?: string;
      commandType?: DesktopMdmCommandType;
      payload?: Record<string, unknown>;
    };
    const contractId = String(body.contractId ?? "").trim();
    const deviceId = String(body.deviceId ?? "").trim();
    const commandType = String(body.commandType ?? "").trim() as DesktopMdmCommandType;
    if (!contractId || !deviceId || !DESKTOP_MDM_COMMANDS.includes(commandType)) {
      return fail("mdm_request_invalid", "contractId, deviceId and an allowed commandType are required", 400);
    }
    const command = await issueDesktopMdmCommand({
      contractId,
      deviceId,
      commandType,
      payload: body.payload ?? {},
      issuedBy: auth.userId
    });
    return ok({ command });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message === "FORBIDDEN") return fail("forbidden", "Only IT admin can control desktop devices.", 403);
    if (message === "MDM_COMMAND_NOT_ALLOWED") return fail("mdm_command_not_allowed", message, 400);
    if (message === "MDM_DEVICE_NOT_AUTHORIZED" || message === "MDM_DISABLED_FOR_DEVICE") return fail("mdm_device_unavailable", message, 409);
    return fail("desktop_mdm_command_failed", message, 500);
  }
}
