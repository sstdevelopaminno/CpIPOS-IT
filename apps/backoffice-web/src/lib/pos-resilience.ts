import type { AuthContext } from "@/lib/auth-context";
import { appendAuditLog } from "@/lib/audit-log";
import { readEnv } from "@/lib/env";

function readIntEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = readEnv(name);
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

export const POS_TIMEOUT_POLICY = {
  orderCreateMs: readIntEnv("POS_TIMEOUT_ORDER_CREATE_MS", 15000, 2000, 120000),
  paymentCompleteMs: readIntEnv("POS_TIMEOUT_PAYMENT_COMPLETE_MS", 15000, 2000, 120000)
} as const;

export const POS_GUARDS = {
  orderQueueHardLimit: readIntEnv("POS_ORDER_QUEUE_HARD_LIMIT", 120, 10, 2000),
  printQueueHardLimit: readIntEnv("POS_PRINT_QUEUE_HARD_LIMIT", 250, 10, 5000),
  staleQueuedMinutes: readIntEnv("POS_ORDER_QUEUE_STALE_MINUTES", 20, 1, 240),
  deadLetterWindowMinutes: readIntEnv("POS_DEAD_LETTER_WINDOW_MINUTES", 60, 5, 1440),
  clientMonitorPollMs: readIntEnv("NEXT_PUBLIC_POS_MONITOR_POLL_MS", 30000, 15000, 120000)
} as const;

export class PosTimeoutError extends Error {
  code: string;

  timeoutMs: number;

  constructor(code: string, timeoutMs: number) {
    super(`${code} timed out after ${timeoutMs}ms`);
    this.name = "PosTimeoutError";
    this.code = code;
    this.timeoutMs = timeoutMs;
  }
}

export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, code: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new PosTimeoutError(code, timeoutMs)), timeoutMs);
    });
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

type DeadLetterChannel = "order" | "payment" | "print";

export function appendPosDeadLetter(args: {
  auth: AuthContext;
  channel: DeadLetterChannel;
  targetTable: string;
  targetId?: string | null;
  reason: string;
  metadata?: Record<string, unknown>;
}) {
  const { auth, channel, targetTable, targetId, reason, metadata } = args;
  void appendAuditLog({
    tenantId: auth.tenantId ?? undefined,
    branchId: auth.branchId ?? undefined,
    actorUserId: auth.userId,
    actorRole: auth.branchRole ?? auth.platformRole,
    action: `pos_${channel}_dead_letter`,
    targetTable,
    targetId: targetId ?? undefined,
    metadata: {
      reason,
      ...(metadata ?? {})
    }
  });
}
