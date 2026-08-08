import "server-only";

import { NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import { writeAuditLog, writeLoginAttempt, getRequestMeta, type AuditLogPayload, type LoginAttemptPayload } from "@/lib/server/audit-log";
import { consumeLoginContext, validateLoginContext, type LoginContextValidationResult } from "@/lib/server/login-context";
import { createPosSession, createSessionHandoffToken, resolvePosRedirectTarget, resolveSessionCookieConfig } from "@/lib/server/pos-session";
import { resolveUserBranchRole } from "@/lib/server/auth-verification";
import { hasBranchFeature } from "@/lib/server/feature-gate";
import { buildRateLimitKey, enforceRateLimit, getClientIpAddress, readRateLimitSetting, type RateLimitResult } from "@/lib/server/rate-limit";

type LoginMethod = "pin" | "staff_card";

type MethodVerifierFailureCode =
  | "auth_failed"
  | "staff_card_missing"
  | "staff_card_invalid"
  | "staff_card_inactive"
  | "staff_card_lost"
  | "staff_card_revoked"
  | "staff_card_scope_mismatch"
  | "staff_card_role_not_allowed";

type MethodVerifier = (input: LoginContextValidationResult & { ok: true }) => Promise<
  { ok: true; userId: string; metadata: Record<string, unknown> } | { ok: false; code: MethodVerifierFailureCode; message: string }
>;

type MethodPolicyGuard = (input: LoginContextValidationResult & { ok: true }) => true | { code: "login_method_not_allowed"; message: string };

type PublicFailureCode =
  | "missing_context"
  | "invalid_context"
  | "expired_context"
  | "context_consumed"
  | "context_replay_detected"
  | "inactive_tenant"
  | "inactive_branch"
  | "missing_policy"
  | "missing_device"
  | "unregistered_device"
  | "inactive_device"
  | "device_branch_mismatch"
  | "device_tenant_mismatch"
  | "device_not_allowed"
  | "device_policy_blocked"
  | "login_method_not_allowed"
  | "feature_not_enabled"
  | "feature_gate_check_failed"
  | "role_not_allowed"
  | "auth_failed"
  | "staff_card_missing"
  | "staff_card_invalid"
  | "staff_card_inactive"
  | "staff_card_lost"
  | "staff_card_revoked"
  | "staff_card_scope_mismatch"
  | "staff_card_role_not_allowed"
  | "session_creation_failed"
  | "session_scope_conflict"
  | "rate_limited"
  | "internal_error";

const DEFAULT_IP_MAX = 25;
const DEFAULT_DEVICE_MAX = 40;
const DEFAULT_WINDOW_SECONDS = 60;

async function revokeSession(sessionId: string) {
  const supabase = getSupabaseServiceClient();
  await supabase.from("pos_sessions").update({ status: "revoked", revoked_at: new Date().toISOString() }).eq("id", sessionId).eq("status", "active");
}

function failureStatus(code: PublicFailureCode): number {
  if (code === "missing_context" || code === "invalid_context") return 400;
  if (code === "context_consumed" || code === "context_replay_detected") return 409;
  if (code === "expired_context") return 410;
  if (code === "rate_limited") return 429;
  if (code === "staff_card_missing") return 400;
  if (code === "staff_card_scope_mismatch") return 403;
  if (code === "staff_card_invalid" || code === "staff_card_inactive" || code === "staff_card_lost" || code === "staff_card_revoked") return 401;
  if (code === "login_method_not_allowed") return 403;
  if (code === "feature_not_enabled") return 403;
  if (code === "role_not_allowed" || code === "auth_failed" || code === "staff_card_role_not_allowed") return 401;
  if (code === "session_scope_conflict") return 409;
  if (code === "session_creation_failed" || code === "feature_gate_check_failed" || code === "internal_error") return 500;
  return 403;
}

function publicMessageForCode(code: PublicFailureCode): string {
  switch (code) {
    case "missing_context":
      return "Missing login context. Restart login from store selection.";
    case "invalid_context":
      return "Login context is invalid. Restart login.";
    case "expired_context":
      return "Login context expired. Please start again.";
    case "context_consumed":
      return "Login context is no longer active.";
    case "context_replay_detected":
      return "This login context was already used. Please restart login.";
    case "inactive_tenant":
      return "This store is inactive.";
    case "inactive_branch":
      return "This branch is inactive.";
    case "missing_policy":
      return "Login policy is not configured for this branch.";
    case "missing_device":
    case "unregistered_device":
    case "inactive_device":
    case "device_branch_mismatch":
    case "device_tenant_mismatch":
    case "device_not_allowed":
    case "device_policy_blocked":
      return "This device is not allowed to login at this branch.";
    case "login_method_not_allowed":
      return "This login method is disabled for the current branch.";
    case "feature_not_enabled":
      return "This feature is not enabled for the current branch.";
    case "feature_gate_check_failed":
      return "Cannot validate feature gate at this time.";
    case "role_not_allowed":
      return "Your account is not allowed for this branch.";
    case "auth_failed":
      return "Authentication failed.";
    case "staff_card_missing":
      return "Staff card code is required.";
    case "staff_card_invalid":
      return "Staff card is invalid.";
    case "staff_card_inactive":
      return "Staff card is inactive.";
    case "staff_card_lost":
      return "Staff card is reported lost.";
    case "staff_card_revoked":
      return "Staff card is revoked.";
    case "staff_card_scope_mismatch":
      return "Staff card does not belong to this tenant/branch.";
    case "staff_card_role_not_allowed":
      return "Staff card user is not allowed for this branch.";
    case "session_creation_failed":
      return "Cannot create POS session at this time.";
    case "session_scope_conflict":
      return "This device or session scope is currently in use.";
    case "rate_limited":
      return "Too many attempts. Please try again shortly.";
    default:
      return "Login verification failed.";
  }
}

function withRateLimitHeaders(response: NextResponse, result: RateLimitResult): NextResponse {
  response.headers.set("X-RateLimit-Limit", String(result.limit));
  response.headers.set("X-RateLimit-Remaining", String(result.remaining));
  response.headers.set("X-RateLimit-Reset", String(Math.floor(result.resetAt / 1000)));
  if (!result.ok && result.retryAfterSeconds > 0) {
    response.headers.set("Retry-After", String(result.retryAfterSeconds));
  }
  return response;
}

function rateLimitedResponse(result: RateLimitResult): NextResponse {
  const response = NextResponse.json(
    {
      data: null,
      error: {
        code: "rate_limited",
        message: publicMessageForCode("rate_limited")
      }
    },
    { status: failureStatus("rate_limited") }
  );
  return withRateLimitHeaders(response, result);
}

async function safeWriteLoginAttempt(payload: LoginAttemptPayload) {
  try {
    await writeLoginAttempt(payload);
  } catch (error) {
    console.error("[auth-flow] Failed to write login attempt", {
      failureReason: payload.failureReason ?? null,
      loginContextId: payload.loginContextId ?? null,
      tenantId: payload.tenantId ?? null,
      branchId: payload.branchId ?? null,
      error: error instanceof Error ? error.message : "Unknown error"
    });
  }
}

async function safeWriteAuditLog(payload: AuditLogPayload) {
  try {
    await writeAuditLog(payload);
  } catch (error) {
    console.error("[auth-flow] Failed to write audit log", {
      action: payload.action,
      targetId: payload.targetId ?? null,
      tenantId: payload.tenantId ?? null,
      branchId: payload.branchId ?? null,
      error: error instanceof Error ? error.message : "Unknown error"
    });
  }
}

function resolveFailureAction(code: PublicFailureCode): string {
  if (code === "context_replay_detected") return "pos_login_replay_attempt";
  if (code === "context_consumed") return "pos_login_context_consumed_rejected";
  if (code === "rate_limited") return "pos_login_rate_limited";
  if (
    code === "missing_device" ||
    code === "unregistered_device" ||
    code === "inactive_device" ||
    code === "device_branch_mismatch" ||
    code === "device_tenant_mismatch" ||
    code === "device_not_allowed" ||
    code === "device_policy_blocked"
  ) {
    return "pos_login_device_mismatch";
  }
  if (code === "auth_failed") return "pos_login_auth_failed";
  if (code === "staff_card_lost") return "pos_staff_card_lost";
  if (code === "staff_card_revoked") return "pos_staff_card_revoked";
  if (code === "staff_card_scope_mismatch") return "pos_staff_card_scope_mismatch";
  if (code === "staff_card_invalid" || code === "staff_card_missing" || code === "staff_card_inactive") return "pos_staff_card_invalid";
  if (code === "staff_card_role_not_allowed") return "pos_staff_card_role_not_allowed";
  if (code === "role_not_allowed") return "pos_login_role_not_allowed";
  if (code === "session_scope_conflict") return "pos_login_session_scope_conflict";
  if (code === "session_creation_failed") return "pos_login_session_creation_failed";
  return "pos_login_failed";
}

function getIpRateLimitConfig() {
  const max = readRateLimitSetting("POS_LOGIN_RATE_LIMIT_IP_MAX", DEFAULT_IP_MAX, { min: 5, max: 500 });
  const windowSeconds = readRateLimitSetting("POS_LOGIN_RATE_LIMIT_WINDOW_SECONDS", DEFAULT_WINDOW_SECONDS, { min: 10, max: 3_600 });
  return { max, windowMs: windowSeconds * 1000 };
}

function getDeviceRateLimitConfig() {
  const max = readRateLimitSetting("POS_LOGIN_RATE_LIMIT_DEVICE_MAX", DEFAULT_DEVICE_MAX, { min: 5, max: 1_000 });
  const windowSeconds = readRateLimitSetting("POS_LOGIN_RATE_LIMIT_WINDOW_SECONDS", DEFAULT_WINDOW_SECONDS, { min: 10, max: 3_600 });
  return { max, windowMs: windowSeconds * 1000 };
}

async function applyIpRateLimit(request: Request, method: LoginMethod): Promise<RateLimitResult> {
  const clientIp = getClientIpAddress(request);
  const config = getIpRateLimitConfig();
  const key = buildRateLimitKey({ namespace: `${method}:ip`, parts: [clientIp] });
  return await enforceRateLimit({
    namespace: `${method}_verify`,
    key,
    max: config.max,
    windowMs: config.windowMs,
    failClosedOnBackendError: true
  });
}

async function applyDeviceRateLimit(deviceCode: string, method: LoginMethod): Promise<RateLimitResult> {
  const config = getDeviceRateLimitConfig();
  const key = buildRateLimitKey({ namespace: `${method}:device`, parts: [deviceCode] });
  return await enforceRateLimit({
    namespace: `${method}_verify`,
    key,
    max: config.max,
    windowMs: config.windowMs,
    failClosedOnBackendError: true
  });
}

export async function handleMethodVerification(
  request: Request,
  input: {
    ctx: string | null;
    method: LoginMethod;
    methodVerifier: MethodVerifier;
    methodPolicyGuard?: MethodPolicyGuard;
    requiredFeatureKey?: string;
  }
) {
  const { ipAddress, userAgent } = getRequestMeta(request);

  try {
    const ipRate = await applyIpRateLimit(request, input.method);
    if (!ipRate.ok) {
      await safeWriteLoginAttempt({
        loginContextId: input.ctx,
        loginMethod: input.method,
        success: false,
        failureReason: "rate_limited_ip",
        ipAddress,
        userAgent,
        metadata: {
          retry_after_seconds: ipRate.retryAfterSeconds
        }
      });
      return rateLimitedResponse(ipRate);
    }

    const validated = await validateLoginContext(input.ctx);

    if (!validated.ok) {
      const failureCode = validated.code as PublicFailureCode;
      await safeWriteLoginAttempt({
        tenantId: validated.context?.tenant_id ?? null,
        branchId: validated.context?.branch_id ?? null,
        deviceCode: validated.context?.device_code ?? null,
        loginContextId: validated.context?.id ?? input.ctx,
        loginMethod: input.method,
        success: false,
        failureReason: validated.code,
        ipAddress,
        userAgent
      });

      if (validated.context?.tenant_id && validated.context?.branch_id) {
        await safeWriteAuditLog({
          tenantId: validated.context.tenant_id,
          branchId: validated.context.branch_id,
          actorRole: "system",
          deviceCode: validated.context.device_code,
          action: resolveFailureAction(failureCode),
          targetType: "pos_login_context",
          targetId: validated.context.id,
          ipAddress,
          userAgent,
          metadata: {
            code: validated.code,
            method: input.method
          }
        });
      }

      return NextResponse.json(
        {
          data: null,
          error: {
            code: validated.code,
            message: publicMessageForCode(failureCode)
          }
        },
        { status: failureStatus(failureCode) }
      );
    }

    if (validated.deviceCode) {
      const deviceRate = await applyDeviceRateLimit(validated.deviceCode, input.method);
      if (!deviceRate.ok) {
        await safeWriteLoginAttempt({
          tenantId: validated.tenant.id,
          branchId: validated.branch.id,
          deviceCode: validated.deviceCode,
          loginContextId: validated.context.id,
          loginMethod: input.method,
          success: false,
          failureReason: "rate_limited_device",
          ipAddress,
          userAgent,
          metadata: {
            retry_after_seconds: deviceRate.retryAfterSeconds
          }
        });
        await safeWriteAuditLog({
          tenantId: validated.tenant.id,
          branchId: validated.branch.id,
          actorRole: "system",
          deviceCode: validated.deviceCode,
          action: "pos_login_rate_limited",
          targetType: "device",
          targetId: validated.deviceCode,
          ipAddress,
          userAgent,
          metadata: {
            method: input.method,
            retry_after_seconds: deviceRate.retryAfterSeconds
          }
        });
        return rateLimitedResponse(deviceRate);
      }
    }

    if (input.methodPolicyGuard) {
      const policyCheck = input.methodPolicyGuard(validated);
      if (policyCheck !== true) {
        await safeWriteLoginAttempt({
          tenantId: validated.tenant.id,
          branchId: validated.branch.id,
          deviceCode: validated.deviceCode,
          loginContextId: validated.context.id,
          loginMethod: input.method,
          success: false,
          failureReason: policyCheck.code,
          ipAddress,
          userAgent
        });
        await safeWriteAuditLog({
          tenantId: validated.tenant.id,
          branchId: validated.branch.id,
          actorRole: "system",
          deviceCode: validated.deviceCode,
          action: "pos_login_method_not_allowed",
          targetType: "branch_login_policy",
          targetId: validated.branch.id,
          ipAddress,
          userAgent,
          metadata: {
            method: input.method
          }
        });
        return NextResponse.json(
          { data: null, error: { code: policyCheck.code, message: publicMessageForCode("login_method_not_allowed") } },
          { status: failureStatus("login_method_not_allowed") }
        );
      }
    }

    if (input.requiredFeatureKey) {
      let featureEnabled = false;
      try {
        featureEnabled = await hasBranchFeature(validated.tenant.id, validated.branch.id, input.requiredFeatureKey);
      } catch (error) {
        await safeWriteLoginAttempt({
          tenantId: validated.tenant.id,
          branchId: validated.branch.id,
          deviceCode: validated.deviceCode,
          loginContextId: validated.context.id,
          loginMethod: input.method,
          success: false,
          failureReason: "feature_gate_check_failed",
          ipAddress,
          userAgent,
          metadata: {
            feature_key: input.requiredFeatureKey
          }
        });
        console.error("[auth-flow] Feature gate check failed", {
          method: input.method,
          featureKey: input.requiredFeatureKey,
          tenantId: validated.tenant.id,
          branchId: validated.branch.id,
          error: error instanceof Error ? error.message : "Unknown error"
        });
        return NextResponse.json(
          { data: null, error: { code: "feature_gate_check_failed", message: publicMessageForCode("feature_gate_check_failed") } },
          { status: failureStatus("feature_gate_check_failed") }
        );
      }
      if (!featureEnabled) {
        await safeWriteLoginAttempt({
          tenantId: validated.tenant.id,
          branchId: validated.branch.id,
          deviceCode: validated.deviceCode,
          loginContextId: validated.context.id,
          loginMethod: input.method,
          success: false,
          failureReason: "feature_not_enabled",
          ipAddress,
          userAgent,
          metadata: {
            feature_key: input.requiredFeatureKey
          }
        });
        return NextResponse.json(
          { data: null, error: { code: "feature_not_enabled", message: publicMessageForCode("feature_not_enabled") } },
          { status: failureStatus("feature_not_enabled") }
        );
      }
    }

    const verified = await input.methodVerifier(validated);
    if (!verified.ok) {
      const verifierFailureCode = verified.code as PublicFailureCode;
      await safeWriteLoginAttempt({
        tenantId: validated.tenant.id,
        branchId: validated.branch.id,
        deviceCode: validated.deviceCode,
        loginContextId: validated.context.id,
        loginMethod: input.method,
        success: false,
        failureReason: verified.code,
        ipAddress,
        userAgent
      });
      await safeWriteAuditLog({
        tenantId: validated.tenant.id,
        branchId: validated.branch.id,
        actorRole: "system",
        deviceCode: validated.deviceCode,
        action: resolveFailureAction(verifierFailureCode),
        targetType: "pos_login_context",
        targetId: validated.context.id,
        ipAddress,
        userAgent,
        metadata: {
          method: input.method,
          code: verified.code
        }
      });
      return NextResponse.json(
        { data: null, error: { code: verified.code, message: publicMessageForCode(verifierFailureCode) } },
        { status: failureStatus(verifierFailureCode) }
      );
    }

    const roleResolved = await resolveUserBranchRole({
      tenantId: validated.tenant.id,
      branchId: validated.branch.id,
      userId: verified.userId
    });
    if (!roleResolved.ok) {
      await safeWriteLoginAttempt({
        tenantId: validated.tenant.id,
        branchId: validated.branch.id,
        deviceCode: validated.deviceCode,
        loginContextId: validated.context.id,
        userId: verified.userId,
        loginMethod: input.method,
        success: false,
        failureReason: roleResolved.code,
        ipAddress,
        userAgent
      });
      return NextResponse.json(
        {
          data: null,
          error: {
            code: roleResolved.code,
            message: publicMessageForCode(roleResolved.code === "role_not_allowed" ? "role_not_allowed" : "auth_failed")
          }
        },
        { status: failureStatus(roleResolved.code === "role_not_allowed" ? "role_not_allowed" : "auth_failed") }
      );
    }

    const sessionCreated = await createPosSession({
      tenantId: validated.tenant.id,
      branchId: validated.branch.id,
      deviceId: validated.deviceId,
      deviceCode: validated.deviceCode,
      userId: verified.userId,
      role: roleResolved.role,
      loginContextId: validated.context.id,
      loginMethod: input.method,
      metadata: {
        ...verified.metadata
      }
    });
    if (!sessionCreated.ok) {
      await safeWriteLoginAttempt({
        tenantId: validated.tenant.id,
        branchId: validated.branch.id,
        deviceCode: validated.deviceCode,
        loginContextId: validated.context.id,
        userId: verified.userId,
        loginMethod: input.method,
        success: false,
        failureReason: sessionCreated.code,
        ipAddress,
        userAgent
      });
      await safeWriteAuditLog({
        tenantId: validated.tenant.id,
        branchId: validated.branch.id,
        actorUserId: verified.userId,
        actorRole: roleResolved.role,
        targetUserId: verified.userId,
        deviceCode: validated.deviceCode,
        action: "pos_session_create_failed",
        targetType: "pos_session",
        targetId: null,
        ipAddress,
        userAgent,
        metadata: {
          method: input.method,
          context_id: validated.context.id
        }
      });
      const sessionFailureCode = sessionCreated.code as PublicFailureCode;
      return NextResponse.json(
        { data: null, error: { code: sessionCreated.code, message: publicMessageForCode(sessionFailureCode) } },
        { status: failureStatus(sessionFailureCode) }
      );
    }

    const consumed = await consumeLoginContext(validated.context.id);
    if (!consumed.ok) {
      await revokeSession(sessionCreated.session.id);
      await safeWriteLoginAttempt({
        tenantId: validated.tenant.id,
        branchId: validated.branch.id,
        deviceCode: validated.deviceCode,
        loginContextId: validated.context.id,
        userId: verified.userId,
        loginMethod: input.method,
        success: false,
        failureReason: consumed.code,
        ipAddress,
        userAgent
      });
      await safeWriteAuditLog({
        tenantId: validated.tenant.id,
        branchId: validated.branch.id,
        actorUserId: verified.userId,
        actorRole: roleResolved.role,
        targetUserId: verified.userId,
        deviceCode: validated.deviceCode,
        action: consumed.code === "context_replay_detected" ? "pos_login_replay_attempt" : "pos_login_context_consume_failed",
        targetType: "pos_login_context",
        targetId: validated.context.id,
        ipAddress,
        userAgent,
        metadata: {
          method: input.method,
          code: consumed.code
        }
      });
      return NextResponse.json(
        { data: null, error: { code: consumed.code, message: publicMessageForCode(consumed.code as PublicFailureCode) } },
        { status: failureStatus(consumed.code as PublicFailureCode) }
      );
    }

    await safeWriteLoginAttempt({
      tenantId: validated.tenant.id,
      branchId: validated.branch.id,
      deviceCode: validated.deviceCode,
      loginContextId: validated.context.id,
      userId: verified.userId,
      loginMethod: input.method,
      success: true,
      ipAddress,
      userAgent,
      metadata: {
        role: roleResolved.role,
        session_id: sessionCreated.session.id
      }
    });

    await safeWriteAuditLog({
      tenantId: validated.tenant.id,
      branchId: validated.branch.id,
      actorUserId: verified.userId,
      actorRole: roleResolved.role,
      targetUserId: verified.userId,
      deviceCode: validated.deviceCode,
      posSessionId: sessionCreated.session.id,
      action: `pos_login_${input.method}_success`,
      targetTable: "pos_sessions",
      targetId: sessionCreated.session.id,
      targetType: "pos_session",
      newValue: {
        login_method: input.method,
        session_status: sessionCreated.session.status
      },
      ipAddress,
      userAgent,
      metadata: {
        login_context_id: validated.context.id
      }
    });

    await safeWriteAuditLog({
      tenantId: validated.tenant.id,
      branchId: validated.branch.id,
      actorUserId: verified.userId,
      actorRole: roleResolved.role,
      targetUserId: verified.userId,
      deviceCode: validated.deviceCode,
      posSessionId: sessionCreated.session.id,
      action: "pos_login_context_consumed",
      targetTable: "pos_login_contexts",
      targetId: validated.context.id,
      targetType: "pos_login_context",
      newValue: {
        status: "consumed"
      },
      ipAddress,
      userAgent,
      metadata: {
        method: input.method
      }
    });

    const token = createSessionHandoffToken({
      sessionId: sessionCreated.session.id,
      tenantId: validated.tenant.id,
      branchId: validated.branch.id,
      userId: verified.userId,
      role: roleResolved.role
    });

    const redirectTo = resolvePosRedirectTarget();
    const cookieConfig = resolveSessionCookieConfig();
    const response = NextResponse.json({
      data: {
        session_id: sessionCreated.session.id,
        redirect_to: redirectTo
      },
      error: null
    });
    response.cookies.set({
      name: cookieConfig.name,
      value: token,
      httpOnly: true,
      secure: cookieConfig.secure,
      sameSite: "lax",
      path: "/",
      domain: cookieConfig.domain,
      maxAge: 120
    });
    response.cookies.set({
      name: cookieConfig.sessionIdName,
      value: sessionCreated.session.id,
      httpOnly: true,
      secure: cookieConfig.secure,
      sameSite: "lax",
      path: "/",
      domain: cookieConfig.domain,
      maxAge: cookieConfig.sessionMaxAgeSeconds
    });

    return response;
  } catch (error) {
    console.error("[auth-flow] Unexpected authentication error", {
      method: input.method,
      loginContextId: input.ctx,
      error: error instanceof Error ? error.message : "Unknown error"
    });
    await safeWriteLoginAttempt({
      loginContextId: input.ctx,
      loginMethod: input.method,
      success: false,
      failureReason: "internal_error",
      ipAddress,
      userAgent
    });
    return NextResponse.json(
      {
        data: null,
        error: {
          code: "internal_error",
          message: publicMessageForCode("internal_error")
        }
      },
      { status: failureStatus("internal_error") }
    );
  }
}
