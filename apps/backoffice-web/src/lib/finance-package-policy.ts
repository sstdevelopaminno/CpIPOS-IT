/** Keep the IT UI plan matrix identical to the POS finance gate.
 * This controls availability display only; POS always reauthorizes on its own server.
 */
export type FinancePackageRuntime = {
  lifecycle_status: string | null;
  access_locked: boolean | null;
  lock_reason: string | null;
  expires_at: string | null;
};
export function isFinancePackageAllowed(input: {
  packageCode: string | null | undefined;
  contractStatus: string | null | undefined;
  endedAt: string | null | undefined;
  runtime: FinancePackageRuntime | null;
  now?: number;
}): boolean {
  const packageCode = String(input.packageCode ?? "").toLowerCase();
  const status = String(input.contractStatus ?? "").toLowerCase();
  if (packageCode !== "business" && packageCode !== "custom") return false;
  if (status !== "active" && status !== "trial") return false;
  if (input.runtime?.access_locked === true) return false;
  const now = input.now ?? Date.now();
  const end = input.endedAt ? Date.parse(input.endedAt) : NaN;
  if (!Number.isFinite(end) || end > now) return true;
  if (status !== "active" || input.runtime?.lifecycle_status !== "grace" ||
      input.runtime?.access_locked !== false ||
      input.runtime?.lock_reason !== "subscription_payment_grace") return false;
  const graceEnd = Date.parse(input.runtime.expires_at ?? "");
  return Number.isFinite(end) && end <= now && Number.isFinite(graceEnd) && graceEnd > now;
}
