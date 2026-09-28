import { appendAuditLog } from "@/lib/audit-log";
import { getRepositoryFile, getRepositoryTree, saveRepositoryFile } from "@/lib/development-control";
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
    const mode = searchParams.get("mode") ?? "tree";
    const repo = searchParams.get("repo");
    const ref = searchParams.get("ref") ?? "main";

    if (mode === "file") {
      const file = await getRepositoryFile(repo, ref, searchParams.get("path"));
      return ok({ file });
    }
    if (mode === "tree") {
      const tree = await getRepositoryTree(repo, ref);
      return ok({ tree });
    }
    return fail("development_source_mode_invalid", "mode ต้องเป็น tree หรือ file", 422);
  } catch (error) {
    return guardItAdminError(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireItSupport();
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return fail("development_body_invalid", "ข้อมูลคำสั่งไม่ถูกต้อง", 422);

    await requireItSupportPin(context, body.pin, "source_write");
    const rate = await enforceRateLimit({
      namespace: "it-development-source-write",
      key: `${context.auth.userId}:${context.requestMeta.ipAddress ?? "unknown"}`,
      max: 12,
      windowMs: 5 * 60_000,
      failClosedOnBackendError: true
    });
    if (!rate.ok) {
      throw new ItAdminGuardError(
        "development_source_rate_limited",
        `แก้ไข Source Code ถี่เกินไป กรุณารอ ${rate.retryAfterSeconds} วินาที`,
        429
      );
    }

    const result = await saveRepositoryFile({
      repo: body.repo,
      baseRef: body.base_ref,
      branch: body.branch,
      path: body.path,
      content: body.content,
      message: body.message
    });

    await appendAuditLog({
      actorUserId: context.auth.userId,
      actorRole: context.auth.platformRole,
      action: result.created_file ? "development_source_file_created" : "development_source_file_updated",
      targetTable: "github_source",
      targetId: result.commit_sha ?? undefined,
      module: "development",
      entityType: "github_file",
      entityId: `${result.repo}:${result.path}`,
      metadata: {
        repository: result.repo,
        branch: result.branch,
        path: result.path,
        commit_sha: result.commit_sha,
        content_sha: result.content_sha,
        content_digest_sha256: result.content_digest,
        created_file: result.created_file
      },
      ipAddress: context.requestMeta.ipAddress ?? undefined,
      userAgent: context.requestMeta.userAgent ?? undefined
    });

    return ok({ result });
  } catch (error) {
    return guardItAdminError(error);
  }
}
