/**
 * CpiPOS acquisition tags are untrusted browser input.
 * Only persist these five campaign keys, never an IP, full referrer, email, or
 * privileged registration field. Unknown/untagged visits stay {} (unknown).
 */
export const MARKETING_UTM_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term"
] as const;

export type MarketingAttribution = Partial<Record<(typeof MARKETING_UTM_KEYS)[number], string>>;

// Deliberately rejects URL, email, whitespace and personal free text.
const TAG_VALUE = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,119}$/;

export function sanitizeMarketingAttribution(value: unknown): MarketingAttribution {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const result: MarketingAttribution = {};
  for (const key of MARKETING_UTM_KEYS) {
    const raw = source[key];
    if (typeof raw !== "string") continue;
    const tag = raw.trim();
    if (TAG_VALUE.test(tag)) result[key] = tag;
  }
  return result;
}
