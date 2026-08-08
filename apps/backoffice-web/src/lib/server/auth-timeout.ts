import "server-only";

export class AuthTimeoutError extends Error {
  code: string;
  timeoutMs: number;

  constructor(code: string, timeoutMs: number) {
    super(`${code} timed out after ${timeoutMs}ms`);
    this.name = "AuthTimeoutError";
    this.code = code;
    this.timeoutMs = timeoutMs;
  }
}

function readTimeoutMs() {
  const raw = Number(process.env.AUTH_API_TIMEOUT_MS ?? 8000);
  if (!Number.isFinite(raw)) return 8000;
  return Math.min(30000, Math.max(2500, Math.trunc(raw)));
}

export const AUTH_API_TIMEOUT_MS = readTimeoutMs();

export async function withAuthTimeout<T>(promise: PromiseLike<T>, code: string, timeoutMs = AUTH_API_TIMEOUT_MS): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new AuthTimeoutError(code, timeoutMs)), timeoutMs);
    });
    return await Promise.race([Promise.resolve(promise), timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
