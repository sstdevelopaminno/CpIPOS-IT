function stripTrailingEscapedNewlines(value: string): string {
  return value.replace(/(?:\\r\\n|\\n|\\r)+$/g, "");
}

// These values are intentionally non-secret. Supabase project URLs and
// publishable keys are designed for public clients. Keeping verified defaults
// here prevents the IT deployment from treating public configuration as a
// secret while all privileged service-role credentials remain environment-only.
const SAFE_ENV_DEFAULTS: Record<string, string> = {
  CPIPOS_SUPABASE_URL: "https://deejlitaivfnsbwqdugy.supabase.co",
  CPIPOS_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_nGX5abZtEmd7Ynzyofop1A_caORaUII",
  IT_SUPABASE_URL: "https://kawenyvpentwgugtzqec.supabase.co",
  IT_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_1MbMKrhZkWIEv4PtRd4Hag_xzHOPlKY"
};

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

  const safeDefault = normalize(SAFE_ENV_DEFAULTS[name]);
  if (safeDefault) return safeDefault;

  for (const alias of SERVER_ENV_ALIASES[name] ?? []) {
    const aliasedDefault = normalize(SAFE_ENV_DEFAULTS[alias]);
    if (aliasedDefault) return aliasedDefault;
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
