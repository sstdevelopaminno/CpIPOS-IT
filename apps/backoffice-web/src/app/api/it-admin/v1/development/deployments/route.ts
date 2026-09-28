import { appendAuditLog } from "@/lib/audit-log";
import { listVercelDeployments, triggerVercelDeployment } from "@/lib/development-control";
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
    const result = await listVercelDeployments(searchParams.get("repo"));
    return ok({ result });
  } catch (error) {
    return guardItAdminError(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireItSupport();
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return fail("development_body_invalid", "ข้อมูลคำสั่งไม่ถูกต้อง", 422);

    const target = body.target === "production" ? "production" : "preview";
    await requireItSupportPin(context, body.pin, target === "production" ? "vercel_production_deploy" : "vercel_preview_deploy");

    const generalRate = await enforceRateLimit({
      namespace: "it-development-deploy",
      key: `${context.auth.userId}:${context.requestMeta.ipAddress ?? "unknown"}`,
      max: 4,
      windowMs: 10 * 60_000,
      failClosedOnBackendError: true
    });
    if (!generalRate.ok) {
      throw new ItAdminGuardError("development_deploy_rate_limited", `สั่ง Deploy ถี่เกินไป กรุณารอ ${generalRate.retryAfterSeconds} วินาที`, 429);
    }

    if (target === "production") {
      const productionRate = await enforceRateLimit({
        namespace: "it-development-production-deploy",
        key: context.auth.userId,
        max: 2,
        windowMs: 60 * 60_000,
        failClosedOnBackendError: true
      });
      if (!productionRate.ok) {
        throw new ItAdminGuardError(
          "development_production_deploy_rate_limited",
          `Production Deploy ถูกจำกัดเพื่อป้องกัน Vercel quota กรุณารอ ${productionRate.retryAfterSeconds} วินาที`,
          429
        );
      }
    }

    const result = await triggerVercelDeployment({ repo: body.repo, ref: body.ref, target });

    await appendAuditLog({
      actorUserId: context.auth.userId,
      actorRole: context.auth.platformRole,
      action: target === "production" ? "development_vercel_production_deploy" : "development_vercel_preview_deploy",
      targetTable: "vercel_deployments",
      targetId: result.deployment_id ?? undefined,
      module: "development",
      entityType: "vercel_deployment",
      entityId: result.deployment_id ?? result.repo,
      metadata: {
        repository: result.repo,
        ref: result.ref,
        target: result.target,
        project_id: result.project.id,
        project_name: result.project.name,
        deployment_id: result.deployment_id,
        deployment_url: result.url,
        state: result.state
      },
      ipAddress: context.requestMeta.ipAddress ?? undefined,
      userAgent: context.requestMeta.userAgent ?? undefined
    });

    return ok({ result });
  } catch (error) {
    return guardItAdminError(error);
  }
}
