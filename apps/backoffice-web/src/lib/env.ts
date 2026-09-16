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
  // The current POS topology uses one authoritative Supabase project.
  // A future operational database may be configured independently, but it is
  // not a POS health dependency until this flag is explicitly enabled.
  IT_DASHBOARD_OPERATIONAL_PLANE_ENABLED: "false",
  IT_SUPABASE_URL: "https://kawenyvpentwgugtzqec.supabase.co",
  IT_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_1MbMKrhZkWIEv4PtRd4Hag_xzHOPlKY"
};


const DIRECT_ENV_READERS: Record<string, () => string | undefined> = {
  CPIPOS_SUPABASE_URL: () => process.env.CPIPOS_SUPABASE_URL,
  CPIPOS_SUPABASE_PUBLISHABLE_KEY: () => process.env.CPIPOS_SUPABASE_PUBLISHABLE_KEY,
  CPIPOS_SUPABASE_SERVICE_ROLE_KEY: () => process.env.CPIPOS_SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_SERVICE_ROLE_KEY: () => process.env.SUPABASE_SERVICE_ROLE_KEY,
  NEXT_PUBLIC_SUPABASE_URL: () => process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: () => process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  IT_DASHBOARD_OPERATIONAL_PLANE_ENABLED: () => process.env.IT_DASHBOARD_OPERATIONAL_PLANE_ENABLED,
  IT_SUPABASE_URL: () => process.env.IT_SUPABASE_URL,
  IT_SUPABASE_PUBLISHABLE_KEY: () => process.env.IT_SUPABASE_PUBLISHABLE_KEY,
  IT_SUPABASE_SERVICE_ROLE_KEY: () => process.env.IT_SUPABASE_SERVICE_ROLE_KEY,
  TRIAL_SUPABASE_URL: () => process.env.TRIAL_SUPABASE_URL,
  TRIAL_SUPABASE_SERVICE_ROLE_KEY: () => process.env.TRIAL_SUPABASE_SERVICE_ROLE_KEY,
  TRIAL_DATA_ROUTING_ENABLED: () => process.env.TRIAL_DATA_ROUTING_ENABLED,
  CPIPOS_PRODUCTION_URL: () => process.env.CPIPOS_PRODUCTION_URL
};
const SERVER_ENV_ALIASES: Record<string, readonly string[]> = {
  SUPABASE_SERVICE_ROLE_KEY: ["CPIPOS_SUPABASE_SERVICE_ROLE_KEY"],
  CPIPOS_SUPABASE_SERVICE_ROLE_KEY: ["SUPABASE_SERVICE_ROLE_KEY"],
  NEXT_PUBLIC_SUPABASE_URL: ["CPIPOS_SUPABASE_URL"],
  NEXT_PUBLIC_SUPABASE_ANON_KEY: ["CPIPOS_SUPABASE_PUBLISHABLE_KEY"]
};

function normalize(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const normalized = stripTrailingEscapedNewlines(raw.trim());
  return normalized.length > 0 ? normalized : undefined;
}

export class RequiredEnvironmentVariableError extends Error {
  variableName: string;

  constructor(variableName: string, message?: string) {
    super(message ?? `Missing required environment variable: ${variableName}`);
    this.name = "RequiredEnvironmentVariableError";
    this.variableName = variableName;
  }
}

export function readEnv(name: string): string | undefined {
  const direct = normalize(DIRECT_ENV_READERS[name]?.() ?? process.env[name]);
  if (direct) return direct;

  for (const alias of SERVER_ENV_ALIASES[name] ?? []) {
    const aliased = normalize(DIRECT_ENV_READERS[alias]?.() ?? process.env[alias]);
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
    throw new RequiredEnvironmentVariableError(name, message);
  }

  return value;
}
