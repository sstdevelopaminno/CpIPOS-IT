import { createHash, randomBytes, randomInt } from "crypto";

export const CUSTOMER_DISPLAY_PAIR_CODE_DIGITS = 6;
export const CUSTOMER_DISPLAY_PAIR_CODE_TTL_MINUTES = 10;
export const CUSTOMER_DISPLAY_DEVICE_TOKEN_TTL_DAYS = 180;

export function normalizeDisplayChannel(raw: string | null | undefined): string {
  const value = String(raw ?? "main").trim().toLowerCase();
  if (!value) return "main";
  return value.slice(0, 64);
}

export function normalizePairCode(raw: string | null | undefined): string {
  const digits = String(raw ?? "").replace(/\D/g, "");
  return digits.slice(0, CUSTOMER_DISPLAY_PAIR_CODE_DIGITS);
}

export function hashSecret(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function createPairingCode(): string {
  const max = 10 ** CUSTOMER_DISPLAY_PAIR_CODE_DIGITS;
  return String(randomInt(0, max)).padStart(CUSTOMER_DISPLAY_PAIR_CODE_DIGITS, "0");
}

export function createDeviceToken(): string {
  return `cd_${randomBytes(24).toString("base64url")}`;
}
