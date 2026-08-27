import "server-only";

import { readEnv } from "@/lib/env";
import {
  POS_PLATFORM_VERSION_PATH,
  normalizePosPlatformBaseUrl,
  parsePosPlatformVersionEnvelope,
  type PosPlatformTargetId,
  type PosPlatformVersionData
} from "@/lib/pos-platform-contract";

const PLATFORM_REQUEST_TIMEOUT_MS = 5000;

const PLATFORM_TARGETS: Array<{
  id: PosPlatformTargetId;
  label: string;
  envName: "CPIPOS_POS_WEB_BASE_URL" | "CPIPOS_BACKOFFICE_WEB_BASE_URL";
  defaultBaseUrl?: string;
}> = [
  {
    id: "pos_web",
    label: "POS Web",
    envName: "CPIPOS_POS_WEB_BASE_URL",
    defaultBaseUrl: "https://cp-ipos-web.vercel.app"
  },
  {
    id: "backoffice_web",
    label: "POS Backoffice",
    envName: "CPIPOS_BACKOFFICE_WEB_BASE_URL"
  }
];

export type PosPlatformConnectionStatus = "online" | "degraded" | "unreachable" | "unconfigured" | "misconfigured";

export type PosPlatformConnection = {
  id: PosPlatformTargetId;
  label: string;
  status: PosPlatformConnectionStatus;
  hostname: string | null;
  version_endpoint: typeof POS_PLATFORM_VERSION_PATH;
  http_status: number | null;
  latency_ms: number | null;
  checked_at: string;
  version: PosPlatformVersionData | null;
  message: string | null;
};

export type PosPlatformStatusReport = {
  checked_at: string;
  timeout_ms: number;
  summary: {
    total: number;
    online: number;
    attention: number;
  };
  targets: PosPlatformConnection[];
};

function buildStaticStatus(
  target: (typeof PLATFORM_TARGETS)[number],
  status: "unconfigured" | "misconfigured",
  message: string
): PosPlatformConnection {
  return {
    id: target.id,
    label: target.label,
    status,
    hostname: null,
    version_endpoint: POS_PLATFORM_VERSION_PATH,
    http_status: null,
    latency_ms: null,
    checked_at: new Date().toISOString(),
    version: null,
    message
  };
}

async function checkTarget(target: (typeof PLATFORM_TARGETS)[number]): Promise<PosPlatformConnection> {
  const configuredBaseUrl = readEnv(target.envName) ?? target.defaultBaseUrl;
  if (!configuredBaseUrl) {
    return buildStaticStatus(target, "unconfigured", `${target.envName} is not configured.`);
  }

  let baseUrl: string;
  try {
    baseUrl = normalizePosPlatformBaseUrl(configuredBaseUrl);
  } catch {
    return buildStaticStatus(target, "misconfigured", `${target.envName} is invalid.`);
  }

  const endpoint = `${baseUrl}${POS_PLATFORM_VERSION_PATH}`;
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PLATFORM_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(endpoint, {
      method: "GET",
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: controller.signal
    });
    const latencyMs = Date.now() - startedAt;
    const payload = (await response.json().catch(() => null)) as unknown;
    const version = parsePosPlatformVersionEnvelope(payload);
    const hostname = new URL(baseUrl).hostname;

    if (!response.ok) {
      return {
        id: target.id,
        label: target.label,
        status: "degraded",
        hostname,
        version_endpoint: POS_PLATFORM_VERSION_PATH,
        http_status: response.status,
        latency_ms: latencyMs,
        checked_at: new Date().toISOString(),
        version: null,
        message: `Version endpoint returned HTTP ${response.status}.`
      };
    }

    if (!version) {
      return {
        id: target.id,
        label: target.label,
        status: "degraded",
        hostname,
        version_endpoint: POS_PLATFORM_VERSION_PATH,
        http_status: response.status,
        latency_ms: latencyMs,
        checked_at: new Date().toISOString(),
        version: null,
        message: "Version endpoint response does not match the CpIPOS contract."
      };
    }

    return {
      id: target.id,
      label: target.label,
      status: "online",
      hostname,
      version_endpoint: POS_PLATFORM_VERSION_PATH,
      http_status: response.status,
      latency_ms: latencyMs,
      checked_at: new Date().toISOString(),
      version,
      message: null
    };
  } catch (error) {
    return {
      id: target.id,
      label: target.label,
      status: "unreachable",
      hostname: new URL(baseUrl).hostname,
      version_endpoint: POS_PLATFORM_VERSION_PATH,
      http_status: null,
      latency_ms: Date.now() - startedAt,
      checked_at: new Date().toISOString(),
      version: null,
      message: error instanceof Error && error.name === "AbortError" ? "Connection timed out." : "Connection failed."
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function getPosPlatformStatusReport(): Promise<PosPlatformStatusReport> {
  const targets = await Promise.all(PLATFORM_TARGETS.map((target) => checkTarget(target)));
  const online = targets.filter((target) => target.status === "online").length;
  return {
    checked_at: new Date().toISOString(),
    timeout_ms: PLATFORM_REQUEST_TIMEOUT_MS,
    summary: {
      total: targets.length,
      online,
      attention: targets.length - online
    },
    targets
  };
}
