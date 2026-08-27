export const POS_PLATFORM_VERSION_PATH = "/api/system/version" as const;

export type PosPlatformTargetId = "pos_web" | "backoffice_web";

export type PosPlatformVersionData = {
  web: {
    commit_sha: string | null;
    commit_ref: string | null;
    environment: string | null;
  };
  source_versions: Record<string, string>;
  generated_at: string | null;
};

export function normalizePosPlatformBaseUrl(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) throw new Error("POS platform base URL is empty.");

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("POS platform base URL is invalid.");
  }

  const isLocalHttp = url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if (url.protocol !== "https:" && !isLocalHttp) {
    throw new Error("POS platform base URL must use HTTPS (localhost HTTP is allowed for development). ");
  }
  if (url.username || url.password) throw new Error("POS platform base URL must not contain credentials.");
  if (url.search || url.hash) throw new Error("POS platform base URL must not contain query or hash values.");
  if (url.pathname !== "/" && url.pathname !== "") {
    throw new Error("POS platform base URL must not contain an application path.");
  }

  url.pathname = "/";
  return url.toString().replace(/\/$/, "");
}

function readNullableString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

export function parsePosPlatformVersionEnvelope(payload: unknown): PosPlatformVersionData | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const envelope = payload as { data?: unknown; error?: unknown };
  if (envelope.error) return null;
  if (!envelope.data || typeof envelope.data !== "object" || Array.isArray(envelope.data)) return null;

  const data = envelope.data as Record<string, unknown>;
  if (!data.web || typeof data.web !== "object" || Array.isArray(data.web)) return null;
  const web = data.web as Record<string, unknown>;

  const versions: Record<string, string> = {};
  if (data.source_versions && typeof data.source_versions === "object" && !Array.isArray(data.source_versions)) {
    for (const [key, value] of Object.entries(data.source_versions as Record<string, unknown>)) {
      if (typeof value === "string" && value.trim()) versions[key] = value.trim();
    }
  }

  return {
    web: {
      commit_sha: readNullableString(web.commit_sha),
      commit_ref: readNullableString(web.commit_ref),
      environment: readNullableString(web.environment)
    },
    source_versions: versions,
    generated_at: readNullableString(data.generated_at)
  };
}
