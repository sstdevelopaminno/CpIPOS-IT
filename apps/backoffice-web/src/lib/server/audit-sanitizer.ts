/** Defense in depth: browser-supplied audit records must not persist credentials. */
export type AuditJson = string | number | boolean | null | AuditJson[] | { [key: string]: AuditJson };
const SECRET_FIELD = /(?:^|[_-])(?:pin|password|passwd|secret|token|cookie|authorization|credential|hash|api_?key|private_?key|signing_?key|license_?key)(?:$|[_-])/i;
const CAMEL_SECRET_FIELD = /(?:ownerPin|userPin|password|passwd|secret|token|cookie|authorization|credential|pinHash|apiKey|privateKey|signingKey|licenseKey)$/i;
const BLOCKED_KEYS = new Set(["__proto__", "prototype", "constructor"]);
function sanitizeValue(value: unknown, depth: number): AuditJson {
  if (value == null) return null;
  if (typeof value === "string") return value.slice(0, 8192);
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (depth >= 10) return "[omitted: depth limit]";
  if (Array.isArray(value)) return value.slice(0, 150).map(item => sanitizeValue(item, depth + 1));
  if (typeof value !== "object") return "[omitted: unsupported type]";
  const result: Record<string, AuditJson> = Object.create(null);
  for (const [key, child] of Object.entries(value as Record<string, unknown>).slice(0, 150)) {
    if (BLOCKED_KEYS.has(key)) continue;
    result[key] = SECRET_FIELD.test(key) || CAMEL_SECRET_FIELD.test(key) ? "[redacted]" : sanitizeValue(child, depth + 1);
  }
  return result;
}
export function sanitizeAuditObject(input: unknown): Record<string, AuditJson> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return sanitizeValue(input, 0) as Record<string, AuditJson>;
}
