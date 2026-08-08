import { readEnv } from "@/lib/env";

function readPositiveInt(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const normalized = Math.trunc(parsed);
  return normalized > 0 ? normalized : null;
}

export function resolveBridgeTimeoutMs(metadata: Record<string, unknown>, envName: string, fallbackMs = 6000) {
  const metadataTimeout = readPositiveInt(metadata.bridge_timeout_ms ?? metadata.timeout_ms);
  const envTimeout = readPositiveInt(readEnv(envName) ?? readEnv("PRINT_BRIDGE_TIMEOUT_MS"));
  return Math.min(30000, Math.max(1000, metadataTimeout ?? envTimeout ?? fallbackMs));
}

export async function fetchBridgeWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`bridge_request_timeout:${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
