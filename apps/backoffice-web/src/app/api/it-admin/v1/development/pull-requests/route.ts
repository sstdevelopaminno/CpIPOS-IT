import { appendAuditLog } from "@/lib/audit-log";
import { createDevelopmentPullRequest, mergeDevelopmentPullRequest } from "@/lib/development-control";
import { fail, ok } from "@/lib/http";
import { guardItAdminError, ItAdminGuardError, requireItSupport } from "@/lib/it-admin-guard";
import { requireItSupportPin } from "@/lib/it-support-pin";
import { enforceRateLimit } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function actionRateLimit(userId: string, ip: string | null) {
  const rate = await enforceRateLimit({
    namespace: "it-development-pr",
    key: `${userId}:${ip ?? "unknown"}`,
    max: 6,
    windowMs: 10 * 60_000,
    failClosedOnBackendError: true
  });
  if (!rate.ok) {
    throw new ItAdminGuardError("development_pr_rate_limited", `คำสั่ง GitHub ถี่เกินไป กรุณารอ ${rate.retryAfterSeconds} วินาที`, 429);
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireItSupport();
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return fail("development_body_invalid", "ข้อมูลคำสั่งไม่ถูกต้อง", 422);
    await requireItSupportPin(context, body.pin, "pull_request_create");
    await actionRateLimit(context.auth.userId, context.requestMeta.ipAddress);

    const result = await createDevelopmentPullRequest({
      repo: body.repo,
      branch: body.branch,
      baseRef: body.base_ref,
      title: body.title,
      body: body.body
    });

    await appendAuditLog({
      actorUserId: context.auth.userId,
      actorRole: context.auth.platformRole,
      action: "development_pull_request_created",
      targetTable: "github_pull_request",
      targetId: result.number ? String(result.number) : undefined,
      module: "development",
      entityType: "github_pull_request",
      entityId: result.number ? `${result.repo}#${result.number}` : result.repo,
      metadata: result,
      ipAddress: context.requestMeta.ipAddress ?? undefined,
      userAgent: context.requestMeta.userAgent ?? undefined
    });

    return ok({ result });
  } catch (error) {
    return guardItAdminError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const context = await requireItSupport();
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return fail("development_body_invalid", "ข้อมูลคำสั่งไม่ถูกต้อง", 422);
    await requireItSupportPin(context, body.pin, "pull_request_merge");
    await actionRateLimit(context.auth.userId, context.requestMeta.ipAddress);

    const result = await mergeDevelopmentPullRequest({ repo: body.repo, number: body.number });

    await appendAuditLog({
      actorUserId: context.auth.userId,
      actorRole: context.auth.platformRole,
      action: "development_pull_request_merged",
      targetTable: "github_pull_request",
      targetId: String(result.number),
      module: "development",
      entityType: "github_pull_request",
      entityId: `${result.repo}#${result.number}`,
      metadata: result,
      ipAddress: context.requestMeta.ipAddress ?? undefined,
      userAgent: context.requestMeta.userAgent ?? undefined
    });

    return ok({ result });
  } catch (error) {
    return guardItAdminError(error);
  }
}
