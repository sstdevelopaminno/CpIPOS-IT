function stripTrailingEscapedNewlines(value: string): string {
  return value.replace(/(?:\\r\\n|\\n|\\r)+$/g, "");
}

const SERVER_ENV_ALIASES: Record<string, readonly string[]> = {
  NEXT_PUBLIC_SUPABASE_URL: ["CPIPOS_SUPABASE_URL"],
  NEXT_PUBLIC_SUPABASE_ANON_KEY: ["CPIPOS_SUPABASE_PUBLISHABLE_KEY"]
};

function normalize(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const normalized = stripTrailingEscapedNewlines(raw.trim());
  return normalized.length > 0 ? normalized : undefined;
}

export function readEnv(name: string): string | undefined {
  const direct = normalize(process.env[name]);
  if (direct) return direct;

  for (const alias of SERVER_ENV_ALIASES[name] ?? []) {
    const aliased = normalize(process.env[alias]);
    if (aliased) return aliased;
  }

  return undefined;
}

export function readRequiredEnv(name: string, message?: string): string {
  const value = readEnv(name);
  if (!value) {
    throw new Error(message ?? `Missing required environment variable: ${name}`);
  }

  return value;
}
