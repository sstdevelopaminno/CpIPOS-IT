import "server-only";

import type { PlatformRole } from "@pos/shared-types";
import { appendAuditLog } from "@/lib/audit-log";

type DesktopLicenseAuditAuth = {
  userId?: string | null;
  platformRole?: string | null;
};

export type DesktopLicenseAuditInput = {
  auth: DesktopLicenseAuditAuth;
  action: string;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
  beforeData?: Record<string, unknown>;
  afterData?: Record<string, unknown>;
  request?: Request;
};

function requestIp(request?: Request) {
  if (!request) return null;
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")
    || request.headers.get("cf-connecting-ip")
    || null;
}

export async function appendDesktopLicenseAudit(input: DesktopLicenseAuditInput) {
  const actorUserId = input.auth.userId || "it-admin";
  const actorRole = (input.auth.platformRole || "it_admin") as PlatformRole;

  return await appendAuditLog({
    actorUserId,
    actorRole,
    action: input.action,
    targetTable: "desktop_license_contracts",
    targetId: input.targetId || undefined,
    module: "desktop_license_control",
    entityType: "desktop_license",
    entityId: input.targetId || undefined,
    metadata: input.metadata || {},
    beforeData: input.beforeData,
    afterData: input.afterData,
    ipAddress: requestIp(input.request) || undefined,
    userAgent: input.request?.headers.get("user-agent") || undefined
  });
}
