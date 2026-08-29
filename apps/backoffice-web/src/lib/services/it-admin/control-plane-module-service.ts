import "server-only";

import { readRequiredEnv } from "@/lib/env";

export const IT_ADMIN_MODULES = [
  "tenants",
  "branches",
  "users",
  "devices",
  "android",
  "printer",
  "packages",
  "entitlements",
  "monitoring",
  "incidents",
  "audit",
  "provisioning"
] as const;

export type ItAdminModule = (typeof IT_ADMIN_MODULES)[number];

export type ItAdminModulePayload = {
  plane: "primary" | "operational";
  module: ItAdminModule;
  checked_at: string;
  summary: Record<string, number | string>;
  rows: Array<Record<string, unknown>>;
  note: string | null;
};

const OPERATIONAL_MODULES = new Set<ItAdminModule>(["devices", "incidents"]);
const BRIDGE_TIMEOUT_MS = 8_000;
const RETRYABLE_STATUS = new Set([502, 503, 504]);

export function parseItAdminModule(value: string): ItAdminModule | null {
  return (IT_ADMIN_MODULES as readonly string[]).includes(value) ? (value as ItAdminModule) : null;
}

async function invokeBridge(args: {
  url: string;
  publishableKey: string;
  slug: string;
  module: ItAdminModule;
  accessToken: string;
  expectedPlane: "primary" | "operational";
}): Promise<ItAdminModulePayload> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), BRIDGE_TIMEOUT_MS);
    try {
      const response = await fetch(`${args.url.replace(/\/$/, "")}/functions/v1/${args.slug}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${args.accessToken}`,
          apikey: args.publishableKey,
          "content-type": "application/json"
        },
        body: JSON.stringify({ module: args.module }),
        cache: "no-store",
        signal: controller.signal
      });

      if (!response.ok) {
        if (attempt === 0 && RETRYABLE_STATUS.has(response.status)) continue;
        throw new Error(`module_bridge_http_${response.status}`);
      }

      const body = (await response.json().catch(() => null)) as ItAdminModulePayload | null;
      if (!body || body.module !== args.module || body.plane !== args.expectedPlane || !Array.isArray(body.rows)) {
        throw new Error("module_bridge_invalid_payload");
      }
      return body;
    } catch (error) {
      const isAbort = error instanceof DOMException && error.name === "AbortError";
      const isBridgeError = error instanceof Error && error.message.startsWith("module_bridge_");
      if (attempt === 0 && (isAbort || !isBridgeError)) continue;
      if (isAbort) throw new Error("module_bridge_timeout");
      if (isBridgeError) throw error;
      throw new Error("module_bridge_network_error");
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error("module_bridge_unavailable");
}

export async function loadItAdminModule(module: ItAdminModule, accessToken: string): Promise<ItAdminModulePayload> {
  const operational = OPERATIONAL_MODULES.has(module);
  const url = readRequiredEnv(operational ? "IT_SUPABASE_URL" : "CPIPOS_SUPABASE_URL");
  const publishableKey = readRequiredEnv(operational ? "IT_SUPABASE_PUBLISHABLE_KEY" : "CPIPOS_SUPABASE_PUBLISHABLE_KEY");

  return invokeBridge({
    url,
    publishableKey,
    slug: operational ? "cpipos-it-module-operational" : "cpipos-it-module-primary",
    module,
    accessToken,
    expectedPlane: operational ? "operational" : "primary"
  });
}
