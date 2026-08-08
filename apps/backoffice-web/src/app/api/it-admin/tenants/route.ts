import { getAuthContext } from "@/lib/auth-context";
import { appendAuditLog } from "@/lib/audit-log";
import { ok, fail } from "@/lib/http";

export async function POST(req: Request) {
  try {
    const auth = await getAuthContext({ requireBranchScope: false });

    if (auth.platformRole !== "it_admin") {
      return fail("forbidden", "Only IT admin can create tenants.", 403);
    }

    const body = (await req.json()) as {
      code: string;
      name: string;
      package_id: string;
    };

    const tenantId = crypto.randomUUID();

    await appendAuditLog({
      actorUserId: auth.userId,
      actorRole: "it_admin",
      action: "tenant_created",
      targetTable: "tenants",
      targetId: tenantId,
      metadata: body
    });

    return ok({ id: tenantId, ...body }, 201);
  } catch (error) {
    return fail("unauthorized", error instanceof Error ? error.message : "Authentication failed.", 401);
  }
}

