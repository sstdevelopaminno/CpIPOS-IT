import { appendAuditLog } from "@/lib/audit-log";
import {
  cancelDevelopmentWorkspaceRun,
  dispatchDevelopmentWorkspace,
  getDevelopmentWorkspaceRun,
  listDevelopmentWorkspaceRuns
} from "@/lib/development-control";
import { fail, ok } from "@/lib/http";
import { guardItAdminError, ItAdminGuardError, requireItSupport } from "@/lib/it-admin-guard";
import { requireItSupportPin } from "@/lib/it-support-pin";
import { enforceRateLimit } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await requireItSupport();
    const { searchParams } = new URL(request.url);
    const runId = searchParams.get("run_id");
    if (runId) {
      return ok({ run: await getDevelopmentWorkspaceRun(runId) });
    }
    return ok({ runs: await listDevelopmentWorkspaceRuns(searchParams.get("limit") ?? 12) });
  } catch (error) {
    return guardItAdminError(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireItSupport();
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return fail("development_workspace_body_invalid", "ข้อมูล Build/Run ไม่ถูกต้อง", 422);

    await requireItSupportPin(context, body.pin, "isolated_workspace_run");

    const rate = await enforceRateLimit({
      namespace: "it-development-workspace-run",
      key: `${context.auth.userId}:${context.requestMeta.ipAddress ?? "unknown"}`,
      max: 4,
      windowMs: 15 * 60_000,
      failClosedOnBackendError: true
    });
    if (!rate.ok) {
      throw new ItAdminGuardError(
        "development_workspace_rate_limited",
        `สั่ง Build/Run ถี่เกินไป กรุณารอ ${rate.retryAfterSeconds} วินาที`,
        429
      );
    }

    const result = await dispatchDevelopmentWorkspace({
      repo: body.repo,
      ref: body.ref,
      task: body.task
    });

    await appendAuditLog({
      actorUserId: context.auth.userId,
      actorRole: context.auth.platformRole,
      action: "development_workspace_dispatched",
      targetTable: "github_actions",
      targetId: result.request_id,
      module: "development",
      entityType: "isolated_workspace",
      entityId: result.request_id,
      metadata: {
        repository: result.repository,
        ref: result.ref,
        task: result.task,
        request_id: result.request_id,
        runner: "github_hosted_ephemeral",
        production_secrets_injected: false
      },
      ipAddress: context.requestMeta.ipAddress ?? undefined,
      userAgent: context.requestMeta.userAgent ?? undefined
    });

    return ok({ result }, 202);
  } catch (error) {
    return guardItAdminError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const context = await requireItSupport();
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return fail("development_workspace_body_invalid", "ข้อมูลยกเลิก Run ไม่ถูกต้อง", 422);

    await requireItSupportPin(context, body.pin, "isolated_workspace_cancel");
    const result = await cancelDevelopmentWorkspaceRun(body.run_id);

    await appendAuditLog({
      actorUserId: context.auth.userId,
      actorRole: context.auth.platformRole,
      action: "development_workspace_cancelled",
      targetTable: "github_actions",
      targetId: String(result.run_id),
      module: "development",
      entityType: "isolated_workspace",
      entityId: String(result.run_id),
      metadata: { run_id: result.run_id },
      ipAddress: context.requestMeta.ipAddress ?? undefined,
      userAgent: context.requestMeta.userAgent ?? undefined
    });

    return ok({ result });
  } catch (error) {
    return guardItAdminError(error);
  }
}
